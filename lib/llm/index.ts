import { generateGeminiResponse } from './gemini'
import { generateGroqResponse } from './groq'
import { NextResponse } from 'next/server'
import Groq from 'groq-sdk'
import { GoogleGenerativeAIError } from '@google/generative-ai'
import {
  getResolvedRuntimeConfig,
  getProviderRuntime,
  recordProviderOutcome,
  incrementFallbackCount,
  ResolvedRuntimeProvider,
  LLMProviderId,
} from './config'

export const USER_SAFE_ERROR_MESSAGE = 'Unable to process this request at the moment. Please try again shortly.'

/**
 * Checks if an error encountered while calling a provider is an eligible condition for automatic failover.
 * Strictly verifies recognized provider-side operational failures and rejects application programming bugs,
 * input validation errors, unrelated HTTP 400 errors, and ordinary application errors.
 */
export function isEligibleForFailover(err: unknown): boolean {
  if (!err) return false

  // 1. Ineligible: Application-level programming bugs
  if (err instanceof TypeError || err instanceof RangeError || err instanceof ReferenceError) {
    return false
  }

  const errObj = typeof err === 'object' && err !== null ? (err as Record<string, unknown>) : null
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()

  // 2. Ineligible: Prompt or application input validation errors
  if (
    msg.includes('prompt cannot be empty') ||
    msg.includes('empty prompt') ||
    msg.includes('search query cannot be empty') ||
    msg.includes('missing required field')
  ) {
    return false
  }

  // 3. Eligible: Recognized transport errors, socket resets, and timeouts
  const hasNetworkErrorCode =
    errObj !== null &&
    (errObj.code === 'ETIMEDOUT' ||
      errObj.code === 'ECONNRESET' ||
      errObj.code === 'ECONNREFUSED' ||
      errObj.code === 'ENOTFOUND' ||
      errObj.code === 'UND_ERR_CONNECT_TIMEOUT' ||
      errObj.code === 'UND_ERR_SOCKET')

  // Bounded adapter timeout: requires known adapter-specific context or dedicated timeout marker
  const hasAdapterTimeout =
    (errObj !== null && (errObj.adapterTimeout === true || (errObj.isProviderError === true && errObj.code === 'ETIMEDOUT'))) ||
    msg.includes('[groq] request timed out after 25s') ||
    msg.includes('[gemini] request timed out after 25s')

  const hasSpecificNetworkMessage =
    msg.includes('connect etimedout') ||
    msg.includes('read econnreset') ||
    msg.includes('socket hang up') ||
    hasAdapterTimeout

  if (hasNetworkErrorCode || hasSpecificNetworkMessage) {
    return true
  }

  // 4. Accept structured HTTP status codes ONLY when supported by reliable provider evidence:
  // - An actual recognized provider SDK error class (Groq.APIError or GoogleGenerativeAIError)
  // - An explicit provider identifier attached by the application's provider adapter (provider: 'groq' | 'gemini')
  // - A dedicated, trusted provider-error marker set by the adapter (isProviderError: true)
  // Weak indicators (generic headers, errorDetails, statusText, or arbitrary message mentions) DO NOT qualify.
  let status: number | undefined = undefined
  if (errObj && (typeof errObj.status === 'number' || typeof errObj.statusCode === 'number')) {
    const rawStatus = typeof errObj.status === 'number' ? errObj.status : (errObj.statusCode as number)

    const isRecognizedSDKClass =
      (typeof Groq?.APIError === 'function' && err instanceof Groq.APIError) ||
      (typeof GoogleGenerativeAIError === 'function' && err instanceof GoogleGenerativeAIError)

    const hasTrustedAdapterTag =
      errObj.provider === 'groq' ||
      errObj.provider === 'gemini' ||
      errObj.isProviderError === true

    if (isRecognizedSDKClass || hasTrustedAdapterTag) {
      status = rawStatus
    }
  }

  // 5. Provider HTTP status evaluation
  if (status !== undefined) {
    // 5a. Provider authentication, key revocation, or authorization failure
    if (status === 401 || status === 403) {
      return true
    }

    // 5b. Provider rate limiting / quota exhaustion
    if (status === 429) {
      return true
    }

    // 5c. Provider 5xx server errors
    if (status >= 500 && status <= 599) {
      return true
    }

    // 5d. HTTP 400: ONLY eligible if it is specifically Groq's json_validate_failed caused by completion-token exhaustion
    if (status === 400) {
      const isTrustedGroqOrigin =
        (typeof Groq?.APIError === 'function' && err instanceof Groq.APIError) ||
        (errObj !== null && errObj.provider === 'groq')

      if (!isTrustedGroqOrigin) {
        return false
      }

      const isGroqJsonValidate =
        msg.includes('json_validate_failed') ||
        (errObj && errObj.code === 'json_validate_failed')

      // Must explicitly establish completion-token exhaustion
      const isCompletionTokenExhaustion =
        msg.includes('max completion tokens reached') ||
        msg.includes('max_completion_tokens reached') ||
        msg.includes('completion token limit reached') ||
        msg.includes('reached max completion tokens') ||
        msg.includes('exceeded max completion tokens')

      return Boolean(isGroqJsonValidate && isCompletionTokenExhaustion)
    }

    // Any other 4xx status is ineligible
    return false
  }

  // 6. Default: Ineligible for failover (arbitrary application errors do not fail over)
  return false
}

/**
 * Centrally managed LLM execution with automatic fallback.
 * Interviewers and candidates never choose providers or see failover events.
 *
 * @param prompt Full prompt text
 * @param forceProvider Admin-only or internal override provider
 * @returns Result object containing response text and provider identifier
 */
export async function generateLLMResponse(
  prompt: string,
  forceProvider?: string
): Promise<{ text: string; provider: string }> {
  if (!prompt || prompt.trim().length === 0) {
    throw new Error('Prompt cannot be empty')
  }

  // 1. Controlled override execution (Admin-only or internal testing)
  if (forceProvider && (forceProvider === 'gemini' || forceProvider === 'groq')) {
    const providerId = forceProvider as LLMProviderId
    console.log(`[LLM] Direct override request to: ${providerId}`)
    try {
      const target = await getProviderRuntime(providerId)
      const text =
        target.id === 'groq'
          ? await generateGroqResponse(prompt, target.apiKey)
          : await generateGeminiResponse(prompt, target.apiKey)

      await recordProviderOutcome(target.id, true)
      return { text, provider: target.id }
    } catch (err: unknown) {
      console.error(`[LLM] Direct override to ${providerId} failed:`, err)
      await recordProviderOutcome(providerId, false, err)
      throw new Error(USER_SAFE_ERROR_MESSAGE)
    }
  }

  // 2. Dual-Provider Automatic Failover Architecture
  const { primary, fallback } = await getResolvedRuntimeConfig()

  console.log(`[LLM] Dispatching request to primary provider: ${primary.id}`)

  const invokeProvider = async (target: ResolvedRuntimeProvider): Promise<string> => {
    try {
      if (target.id === 'groq') {
        return await generateGroqResponse(prompt, target.apiKey)
      } else {
        return await generateGeminiResponse(prompt, target.apiKey)
      }
    } catch (err: unknown) {
      if (err && typeof err === 'object') {
        try {
          (err as Record<string, unknown>).provider = target.id;
          (err as Record<string, unknown>).isProviderError = true;
        } catch {
          // Ignore if object is frozen
        }
      }
      throw err
    }
  }

  // Attempt 1: Primary Provider
  try {
    const text = await invokeProvider(primary)
    await recordProviderOutcome(primary.id, true)
    console.log(`[LLM] Primary provider (${primary.id}) responded successfully`)
    return { text, provider: primary.id }
  } catch (primaryErr: unknown) {
    const errMsg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr)
    console.error(`[LLM] Primary provider (${primary.id}) failed: ${errMsg}`)

    // Record failure in health metrics for Admin visibility
    await recordProviderOutcome(primary.id, false, primaryErr)

    // Check if fallback is eligible and available
    const eligible = isEligibleForFailover(primaryErr)
    if (!eligible || !fallback) {
      if (!fallback) {
        console.warn(`[LLM Failover] Fallback provider is not enabled or not configured. Cannot failover.`)
      } else {
        console.warn(`[LLM Failover] Primary failure is ineligible for failover: ${errMsg}`)
      }
      throw new Error(USER_SAFE_ERROR_MESSAGE)
    }

    // Attempt 2: Automatic Fallback Provider
    console.log(
      `[LLM Failover] Triggering automatic failover from ${primary.id} to fallback: ${fallback.id}`
    )
    await incrementFallbackCount()

    try {
      const text = await invokeProvider(fallback)
      await recordProviderOutcome(fallback.id, true)
      console.log(`[LLM Failover] Fallback provider (${fallback.id}) responded successfully`)
      return { text, provider: fallback.id }
    } catch (fallbackErr: unknown) {
      const fallbackMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
      console.error(`[LLM Failover] Fallback provider (${fallback.id}) also failed: ${fallbackMsg}`)
      await recordProviderOutcome(fallback.id, false, fallbackErr)

      // Both providers failed
      console.error(`[LLM Failover] Complete provider outage: Both ${primary.id} and ${fallback.id} failed.`)
      throw new Error(USER_SAFE_ERROR_MESSAGE)
    }
  }
}

/**
 * Standard error handler for LLM API routes.
 * Ensures NO technical details, provider names, or API errors are exposed to candidates or interviewers.
 */
export function handleLLMError(err: unknown) {
  console.error('[LLM API Error handler caught]:', err)
  return NextResponse.json(
    {
      success: false,
      error: USER_SAFE_ERROR_MESSAGE,
    },
    { status: 503 }
  )
}
