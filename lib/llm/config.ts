import crypto from 'crypto'
import prisma from '@/lib/db'
import { GEMINI_MODEL, generateGeminiResponse } from './gemini'
import { GROQ_MODEL, generateGroqResponse } from './groq'

export type LLMProviderId = 'gemini' | 'groq'

export interface ProviderMetrics {
  lastSuccess: string | null
  lastFailure: string | null
  lastError: string | null
}

export interface ProviderConfig {
  id: LLMProviderId
  name: string
  model: string
  configured: boolean
  enabled: boolean
  isPrimary: boolean
  isFallback: boolean
  status: 'available' | 'unavailable' | 'disabled' | 'not_configured'
  maskedKey: string
  lastSuccess: string | null
  lastFailure: string | null
  lastError: string | null
}

export interface AdminAIConfigResponse {
  primaryProvider: LLMProviderId
  fallbackProvider: LLMProviderId | null
  fallbackEnabled: boolean
  fallbackCount: number
  providers: ProviderConfig[]
  hasConfigError: boolean
  configErrorMessage: string | null
}

export interface ResolvedRuntimeProvider {
  id: LLMProviderId
  apiKey?: string
  model: string
}

export interface ResolvedRuntimeConfig {
  primary: ResolvedRuntimeProvider
  fallback: ResolvedRuntimeProvider | null
}

// -----------------------------------------------------------------------------
// Encryption Helpers (AES-256-GCM)
// -----------------------------------------------------------------------------
function getEncryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET || 'smartinterview_default_secret_key_32_chars_min'
  return crypto.createHash('sha256').update(secret).digest()
}

export function encryptSecret(plainText: string): string {
  if (!plainText) return ''
  const iv = crypto.randomBytes(12)
  const key = getEncryptionKey()
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  let encrypted = cipher.update(plainText, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const tag = cipher.getAuthTag()
  return `enc:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`
}

export function decryptSecret(cipherText: string): string {
  if (!cipherText) return ''
  if (!cipherText.startsWith('enc:')) {
    // If not encrypted with prefix, return as-is (for backward compatibility)
    return cipherText
  }
  try {
    const parts = cipherText.split(':')
    if (parts.length !== 4) return ''
    const [, ivHex, tagHex, encryptedHex] = parts
    const iv = Buffer.from(ivHex, 'hex')
    const tag = Buffer.from(tagHex, 'hex')
    const key = getEncryptionKey()
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    return decrypted
  } catch (err) {
    console.error('[LLM Config] Failed to decrypt API key:', err)
    return ''
  }
}

export function maskApiKey(key: string | null | undefined): string {
  if (!key || typeof key !== 'string') return ''
  const trimmed = key.trim()
  if (trimmed.length === 0) return ''
  if (trimmed.length <= 8) return '••••••••'
  const first = trimmed.slice(0, 4)
  const last = trimmed.slice(-4)
  return `${first}••••••••${last}`
}

export function isMaskedPlaceholder(value: string | null | undefined): boolean {
  if (!value) return false
  return value.includes('••••') || value.includes('***')
}

// -----------------------------------------------------------------------------
// Database AppSettings Access
// -----------------------------------------------------------------------------
async function getSettingsMap(): Promise<Map<string, string>> {
  try {
    const settings = await prisma.appSettings.findMany({
      where: {
        key: {
          in: [
            'llm.primary_provider',
            'llm.default_provider',
            'llm.gemini_enabled',
            'llm.groq_enabled',
            'llm.gemini_api_key',
            'llm.groq_api_key',
            'llm.gemini_last_success',
            'llm.gemini_last_failure',
            'llm.gemini_last_error',
            'llm.groq_last_success',
            'llm.groq_last_failure',
            'llm.groq_last_error',
            'llm.fallback_count',
          ],
        },
      },
    })
    const map = new Map<string, string>()
    for (const s of settings) {
      map.set(s.key, s.value)
    }
    return map
  } catch (err) {
    console.error('[LLM Config] Error fetching AppSettings:', err)
    return new Map<string, string>()
  }
}

async function setSetting(key: string, value: string): Promise<void> {
  try {
    await prisma.appSettings.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    })
  } catch (err) {
    console.error(`[LLM Config] Error saving setting "${key}":`, err)
  }
}

// -----------------------------------------------------------------------------
// Configuration Resolution
// -----------------------------------------------------------------------------
export async function getAdminAIConfig(): Promise<AdminAIConfigResponse> {
  const map = await getSettingsMap()

  // Gemini API key resolution: DB (decrypted) -> process.env
  const dbGeminiEncrypted = map.get('llm.gemini_api_key')
  const dbGeminiKey = dbGeminiEncrypted ? decryptSecret(dbGeminiEncrypted) : ''
  const geminiApiKey = dbGeminiKey || process.env.GEMINI_API_KEY || ''
  const geminiConfigured = !!geminiApiKey.trim()

  // Groq API key resolution: DB (decrypted) -> process.env
  const dbGroqEncrypted = map.get('llm.groq_api_key')
  const dbGroqKey = dbGroqEncrypted ? decryptSecret(dbGroqEncrypted) : ''
  const groqApiKey = dbGroqKey || process.env.GROQ_API_KEY || ''
  const groqConfigured = !!groqApiKey.trim()

  // Enabled flags (default to true if configured and not explicitly disabled)
  const geminiEnabledVal = map.get('llm.gemini_enabled')
  const geminiEnabled = geminiEnabledVal === 'false' ? false : (geminiEnabledVal === 'true' || geminiConfigured)

  const groqEnabledVal = map.get('llm.groq_enabled')
  const groqEnabled = groqEnabledVal === 'false' ? false : (groqEnabledVal === 'true' || groqConfigured)

  // Primary Provider resolution
  const configuredPrimary = (map.get('llm.primary_provider') || map.get('llm.default_provider') || 'gemini') as LLMProviderId
  const primaryProvider: LLMProviderId = configuredPrimary === 'groq' ? 'groq' : 'gemini'

  // Metric fields
  const geminiLastSuccess = map.get('llm.gemini_last_success') || null
  const geminiLastFailure = map.get('llm.gemini_last_failure') || null
  const geminiLastError = map.get('llm.gemini_last_error') || null

  const groqLastSuccess = map.get('llm.groq_last_success') || null
  const groqLastFailure = map.get('llm.groq_last_failure') || null
  const groqLastError = map.get('llm.groq_last_error') || null

  const fallbackCount = parseInt(map.get('llm.fallback_count') || '0', 10) || 0

  // Calculate provider statuses
  const getStatus = (
    configured: boolean,
    enabled: boolean,
    lastSuccess: string | null,
    lastFailure: string | null
  ): 'available' | 'unavailable' | 'disabled' | 'not_configured' => {
    if (!configured) return 'not_configured'
    if (!enabled) return 'disabled'
    if (lastFailure && (!lastSuccess || new Date(lastFailure) > new Date(lastSuccess))) {
      return 'unavailable'
    }
    return 'available'
  }

  const geminiStatus = getStatus(geminiConfigured, geminiEnabled, geminiLastSuccess, geminiLastFailure)
  const groqStatus = getStatus(groqConfigured, groqEnabled, groqLastSuccess, groqLastFailure)

  const isGeminiPrimary = primaryProvider === 'gemini'
  const isGroqPrimary = primaryProvider === 'groq'

  // Determine fallback provider
  let fallbackProvider: LLMProviderId | null = null
  let fallbackEnabled = false

  if (isGeminiPrimary && groqConfigured && groqEnabled) {
    fallbackProvider = 'groq'
    fallbackEnabled = true
  } else if (isGroqPrimary && geminiConfigured && geminiEnabled) {
    fallbackProvider = 'gemini'
    fallbackEnabled = true
  }

  const providers: ProviderConfig[] = [
    {
      id: 'gemini',
      name: 'Google Gemini',
      model: GEMINI_MODEL,
      configured: geminiConfigured,
      enabled: geminiEnabled,
      isPrimary: isGeminiPrimary,
      isFallback: fallbackProvider === 'gemini',
      status: geminiStatus,
      maskedKey: maskApiKey(geminiApiKey),
      lastSuccess: geminiLastSuccess,
      lastFailure: geminiLastFailure,
      lastError: geminiLastError,
    },
    {
      id: 'groq',
      name: 'Groq',
      model: GROQ_MODEL,
      configured: groqConfigured,
      enabled: groqEnabled,
      isPrimary: isGroqPrimary,
      isFallback: fallbackProvider === 'groq',
      status: groqStatus,
      maskedKey: maskApiKey(groqApiKey),
      lastSuccess: groqLastSuccess,
      lastFailure: groqLastFailure,
      lastError: groqLastError,
    },
  ]

  let hasConfigError = false
  let configErrorMessage: string | null = null

  const geminiUsable = geminiConfigured && geminiEnabled
  const groqUsable = groqConfigured && groqEnabled

  if (!geminiUsable && !groqUsable) {
    hasConfigError = true
    configErrorMessage = 'No AI provider is configured and enabled. Please provide a valid Gemini or Groq API key and enable it.'
  }

  return {
    primaryProvider,
    fallbackProvider,
    fallbackEnabled,
    fallbackCount,
    providers,
    hasConfigError,
    configErrorMessage,
  }
}

/**
 * Resolves the primary and fallback provider runtime targets with actual API keys for execution.
 */
export async function getResolvedRuntimeConfig(): Promise<ResolvedRuntimeConfig> {
  const map = await getSettingsMap()

  // Gemini Key
  const dbGemini = map.get('llm.gemini_api_key')
  const geminiKey = (dbGemini ? decryptSecret(dbGemini) : '') || process.env.GEMINI_API_KEY || ''
  const geminiConfigured = !!geminiKey.trim()
  const geminiEnabledVal = map.get('llm.gemini_enabled')
  const geminiEnabled = geminiEnabledVal === 'false' ? false : (geminiEnabledVal === 'true' || geminiConfigured)

  // Groq Key
  const dbGroq = map.get('llm.groq_api_key')
  const groqKey = (dbGroq ? decryptSecret(dbGroq) : '') || process.env.GROQ_API_KEY || ''
  const groqConfigured = !!groqKey.trim()
  const groqEnabledVal = map.get('llm.groq_enabled')
  const groqEnabled = groqEnabledVal === 'false' ? false : (groqEnabledVal === 'true' || groqConfigured)

  const configuredPrimary = (map.get('llm.primary_provider') || map.get('llm.default_provider') || 'gemini') as LLMProviderId
  const preferredPrimary: LLMProviderId = configuredPrimary === 'groq' ? 'groq' : 'gemini'

  const geminiUsable = geminiConfigured && geminiEnabled
  const groqUsable = groqConfigured && groqEnabled

  if (!geminiUsable && !groqUsable) {
    throw new Error('No AI providers are configured and enabled on the server.')
  }

  let primary: ResolvedRuntimeProvider
  let fallback: ResolvedRuntimeProvider | null = null

  if (preferredPrimary === 'gemini') {
    if (geminiUsable) {
      primary = { id: 'gemini', apiKey: geminiKey, model: GEMINI_MODEL }
      if (groqUsable) {
        fallback = { id: 'groq', apiKey: groqKey, model: GROQ_MODEL }
      }
    } else {
      // Preferred primary is unavailable/disabled, but Groq is usable
      primary = { id: 'groq', apiKey: groqKey, model: GROQ_MODEL }
    }
  } else {
    // Preferred primary is Groq
    if (groqUsable) {
      primary = { id: 'groq', apiKey: groqKey, model: GROQ_MODEL }
      if (geminiUsable) {
        fallback = { id: 'gemini', apiKey: geminiKey, model: GEMINI_MODEL }
      }
    } else {
      // Preferred primary is unavailable/disabled, but Gemini is usable
      primary = { id: 'gemini', apiKey: geminiKey, model: GEMINI_MODEL }
    }
  }

  return { primary, fallback }
}

/**
 * Resolves a specific provider with its configured API key for controlled admin actions or tests.
 */
export async function getProviderRuntime(providerId: LLMProviderId): Promise<ResolvedRuntimeProvider> {
  const map = await getSettingsMap()
  if (providerId === 'groq') {
    const dbGroq = map.get('llm.groq_api_key')
    const groqKey = (dbGroq ? decryptSecret(dbGroq) : '') || process.env.GROQ_API_KEY || ''
    if (!groqKey.trim()) {
      throw new Error('Groq API key is not configured.')
    }
    return { id: 'groq', apiKey: groqKey, model: GROQ_MODEL }
  } else {
    const dbGemini = map.get('llm.gemini_api_key')
    const geminiKey = (dbGemini ? decryptSecret(dbGemini) : '') || process.env.GEMINI_API_KEY || ''
    if (!geminiKey.trim()) {
      throw new Error('Gemini API key is not configured.')
    }
    return { id: 'gemini', apiKey: geminiKey, model: GEMINI_MODEL }
  }
}

// -----------------------------------------------------------------------------
// Admin Updates & Health Tracking
// -----------------------------------------------------------------------------
export interface LLMConfigUpdates {
  primaryProvider?: LLMProviderId
  geminiApiKey?: string
  groqApiKey?: string
  geminiEnabled?: boolean
  groqEnabled?: boolean
}

export async function updateAdminAIConfig(
  updates: LLMConfigUpdates,
  userId?: number,
  username?: string
): Promise<AdminAIConfigResponse> {
  const operations: Promise<void>[] = []

  if (updates.primaryProvider && (updates.primaryProvider === 'gemini' || updates.primaryProvider === 'groq')) {
    operations.push(setSetting('llm.primary_provider', updates.primaryProvider))
    operations.push(setSetting('llm.default_provider', updates.primaryProvider))
  }

  if (typeof updates.geminiEnabled === 'boolean') {
    operations.push(setSetting('llm.gemini_enabled', updates.geminiEnabled ? 'true' : 'false'))
  }

  if (typeof updates.groqEnabled === 'boolean') {
    operations.push(setSetting('llm.groq_enabled', updates.groqEnabled ? 'true' : 'false'))
  }

  // Update Gemini API key if non-empty and not masked
  if (updates.geminiApiKey && typeof updates.geminiApiKey === 'string') {
    const trimmed = updates.geminiApiKey.trim()
    if (trimmed && !isMaskedPlaceholder(trimmed)) {
      const encrypted = encryptSecret(trimmed)
      operations.push(setSetting('llm.gemini_api_key', encrypted))
    }
  }

  // Update Groq API key if non-empty and not masked
  if (updates.groqApiKey && typeof updates.groqApiKey === 'string') {
    const trimmed = updates.groqApiKey.trim()
    if (trimmed && !isMaskedPlaceholder(trimmed)) {
      const encrypted = encryptSecret(trimmed)
      operations.push(setSetting('llm.groq_api_key', encrypted))
    }
  }

  await Promise.all(operations)

  // Audit log update (Never log actual keys)
  if (userId) {
    const { createAuditLog } = await import('@/lib/audit-log')
    createAuditLog({
      userId,
      username,
      action: 'ADMIN_AI_CONFIG_UPDATED',
      entityType: 'AppSettings',
      metadata: {
        updatedPrimary: updates.primaryProvider,
        updatedGeminiEnabled: updates.geminiEnabled,
        updatedGroqEnabled: updates.groqEnabled,
        updatedGeminiKey: updates.geminiApiKey ? !isMaskedPlaceholder(updates.geminiApiKey) : false,
        updatedGroqKey: updates.groqApiKey ? !isMaskedPlaceholder(updates.groqApiKey) : false,
      },
    })
  }

  return getAdminAIConfig()
}

/**
 * Sanitizes technical error messages for Admin display (prevents leaking keys or sensitive paths).
 */
export function sanitizeProviderError(rawError: unknown): string {
  if (!rawError) return 'Unknown error'
  const message = rawError instanceof Error ? rawError.message : String(rawError)
  const lower = message.toLowerCase()

  if (lower.includes('401') || lower.includes('invalid api key') || lower.includes('api key not valid')) {
    return 'Authentication failure: Invalid or revoked API key (HTTP 401)'
  }
  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('quota') || lower.includes('resource_exhausted')) {
    return 'Rate limit / quota exceeded (HTTP 429)'
  }
  if (lower.includes('503') || lower.includes('overloaded') || lower.includes('service unavailable')) {
    return 'Provider service temporarily unavailable (HTTP 503)'
  }
  if (lower.includes('500') || lower.includes('internal error')) {
    return 'Provider internal server error (HTTP 500)'
  }
  if (lower.includes('timeout') || lower.includes('etimedout') || lower.includes('abort')) {
    return 'Request timeout / connection delay'
  }
  if (lower.includes('econnreset') || lower.includes('fetch failed') || lower.includes('network error')) {
    return 'Network connection failure to provider endpoint'
  }

  // Safe truncation of generic message
  const cleaned = message.replace(/https?:\/\/[^\s]+/g, '[REDACTED_URL]')
  return cleaned.length > 120 ? cleaned.slice(0, 120) + '...' : cleaned
}

/**
 * Records outcome of a provider request to AppSettings for Admin health monitoring.
 */
export async function recordProviderOutcome(
  provider: LLMProviderId,
  success: boolean,
  errorDetail?: unknown
): Promise<void> {
  const now = new Date().toISOString()
  const operations: Promise<void>[] = []

  if (success) {
    operations.push(setSetting(`llm.${provider}_last_success`, now))
    // Clear last error on successful request
    operations.push(setSetting(`llm.${provider}_last_error`, ''))
  } else {
    const sanitizedError = sanitizeProviderError(errorDetail)
    operations.push(setSetting(`llm.${provider}_last_failure`, now))
    operations.push(setSetting(`llm.${provider}_last_error`, sanitizedError))
  }

  try {
    await Promise.all(operations)
  } catch (err) {
    console.warn(`[LLM Config] Failed to record outcome for ${provider}:`, err)
  }
}

/**
 * Increments the fallback activation counter in AppSettings.
 */
export async function incrementFallbackCount(): Promise<number> {
  try {
    const map = await getSettingsMap()
    const current = parseInt(map.get('llm.fallback_count') || '0', 10) || 0
    const next = current + 1
    await setSetting('llm.fallback_count', next.toString())
    return next
  } catch (err) {
    console.warn('[LLM Config] Failed to increment fallback count:', err)
    return 0
  }
}

/**
 * Manual test connection for Admin to verify live provider functionality.
 */
export async function testProviderConnection(
  provider: LLMProviderId,
  overrideKey?: string
): Promise<{ success: boolean; latencyMs: number; error?: string }> {
  const t0 = performance.now()
  try {
    let text = ''
    const pingPrompt = 'Respond with only the single word OK.'

    if (provider === 'gemini') {
      const apiKey = overrideKey || (await getProviderRuntime('gemini')).apiKey
      text = await generateGeminiResponse(pingPrompt, apiKey)
    } else {
      const apiKey = overrideKey || (await getProviderRuntime('groq')).apiKey
      text = await generateGroqResponse(pingPrompt, apiKey)
    }

    const latencyMs = Math.round(performance.now() - t0)
    if (text && text.trim().length > 0) {
      await recordProviderOutcome(provider, true)
      return { success: true, latencyMs }
    } else {
      throw new Error('Empty response received during connection test')
    }
  } catch (err) {
    const latencyMs = Math.round(performance.now() - t0)
    const sanitized = sanitizeProviderError(err)
    await recordProviderOutcome(provider, false, err)
    return { success: false, latencyMs, error: sanitized }
  }
}
