import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import Groq from "groq-sdk";
import { GoogleGenerativeAIError } from "@google/generative-ai";

import {
  isEligibleForFailover,
  handleLLMError,
  USER_SAFE_ERROR_MESSAGE,
  generateLLMResponse
} from "../lib/llm";
import * as configModule from "../lib/llm/config";
import * as groqModule from "../lib/llm/groq";
import * as geminiModule from "../lib/llm/gemini";

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, testName: string, details?: string) {
  if (condition) {
    console.log(`  [PASS] ${testName}`);
    passCount++;
  } else {
    console.error(`  [FAIL] ${testName}${details ? ` -> ${details}` : ""}`);
    failCount++;
  }
}

async function runHardenedFailoverTests() {
  console.log("================================================================================");
  console.log("      STRICT LLM FAILOVER HARDENING & DUAL-PROVIDER FAILURE TEST SUITE          ");
  console.log("================================================================================\n");

  // ---------------------------------------------------------------------------
  // SECTION 1: STRICT GROQ TOKEN-EXHAUSTION MATCHING (ISSUE 1)
  // ---------------------------------------------------------------------------
  console.log("--- 1. Strict Groq Token-Exhaustion Matching ---");

  // 1A. Positive: Groq json_validate_failed with 'max completion tokens reached' (structured provider response)
  const groqMaxTokens = Object.assign(
    new Error('Failed to generate JSON. Please adjust your prompt. See \'failed_generation\' for more details. code: json_validate_failed. failed_generation: max completion tokens reached before generating a valid document'),
    { status: 400, provider: 'groq', headers: {} }
  );
  assert(
    isEligibleForFailover(groqMaxTokens) === true,
    "1A: Groq json_validate_failed with 'max completion tokens reached' is ELIGIBLE"
  );

  // 1B. Positive: Equivalent completion token limit reached
  const groqCompletionLimit = Object.assign(
    new Error('Failed to generate JSON. code: json_validate_failed. failed_generation: completion token limit reached'),
    { status: 400, provider: 'groq', headers: {} }
  );
  assert(
    isEligibleForFailover(groqCompletionLimit) === true,
    "1B: Groq json_validate_failed with 'completion token limit reached' is ELIGIBLE"
  );

  // 1C. Negative: json_validate_failed with unrelated token message (e.g. invalid syntax token)
  const groqSyntaxToken = Object.assign(
    new Error('Failed to validate JSON. code: json_validate_failed. failed_generation: Unexpected token < in JSON at position 0'),
    { status: 400, provider: 'groq', headers: {} }
  );
  assert(
    isEligibleForFailover(groqSyntaxToken) === false,
    "1C: Groq json_validate_failed with unrelated token message ('Unexpected token <') is INELIGIBLE"
  );

  // 1D. Negative: json_validate_failed with unrelated JSON-generation error
  const groqJsonGrammarError = Object.assign(
    new Error('Failed to validate JSON. Trailing commas are not allowed. code: json_validate_failed. failed_generation: {"key": 123,}'),
    { status: 400, provider: 'groq', headers: {} }
  );
  assert(
    isEligibleForFailover(groqJsonGrammarError) === false,
    "1D: Groq json_validate_failed with unrelated grammar/schema error is INELIGIBLE"
  );

  // 1E. Negative: Generic HTTP 400 mentioning token_count
  const groqParamToken = Object.assign(
    new Error('Bad Request: Invalid request parameter "token_count". Expected integer between 1 and 4096.'),
    { status: 400, provider: 'groq', headers: {} }
  );
  assert(
    isEligibleForFailover(groqParamToken) === false,
    "1E: Generic HTTP 400 mentioning 'token_count' parameter is INELIGIBLE"
  );

  // 1F. Negative: Generic HTTP 400 mentioning bearer token
  const genericBearerToken = Object.assign(
    new Error('Bad Request: Malformed Authorization header. Expected Bearer token format.'),
    { status: 400, provider: 'groq', headers: {} }
  );
  assert(
    isEligibleForFailover(genericBearerToken) === false,
    "1F: Generic HTTP 400 mentioning 'Bearer token' is INELIGIBLE"
  );

  // 1G. Negative: Gemini-tagged HTTP 400 with exactly the same code and token-exhaustion wording
  const geminiSameTokenMessage = Object.assign(
    new GoogleGenerativeAIError('Failed to generate JSON. code: json_validate_failed. failed_generation: max completion tokens reached before generating a valid document'),
    { status: 400, provider: 'gemini' }
  );
  assert(
    isEligibleForFailover(geminiSameTokenMessage) === false,
    "1G: Gemini-tagged HTTP 400 with identical token exhaustion wording is INELIGIBLE"
  );

  // 1H. Negative: Groq-tagged HTTP 400 with generic JSON/schema validation wording
  const groqGenericSchemaError = Object.assign(
    new Error('Failed to validate JSON. code: json_validate_failed. failed_generation: schema validation failed at #/properties/answer: expected string but found object'),
    { status: 400, provider: 'groq' }
  );
  assert(
    isEligibleForFailover(groqGenericSchemaError) === false,
    "1H: Groq-tagged HTTP 400 with generic JSON/schema validation error is INELIGIBLE"
  );

  // 1I. Negative: Groq-tagged HTTP 400 with generic token wording
  const groqGenericTokenError = Object.assign(
    new Error('Failed to validate JSON. code: json_validate_failed. failed_generation: encountered unexpected token delimiter'),
    { status: 400, provider: 'groq' }
  );
  assert(
    isEligibleForFailover(groqGenericTokenError) === false,
    "1I: Groq-tagged HTTP 400 with generic token wording is INELIGIBLE"
  );

  // 1J. Negative: Untrusted application error containing the same message without provider tag
  const appUntrustedSameMessage = Object.assign(
    new Error('json_validate_failed: max completion tokens reached before generating a valid document'),
    { status: 400 }
  );
  assert(
    isEligibleForFailover(appUntrustedSameMessage) === false,
    "1J: Untrusted application error containing token-exhaustion message without provider tag is INELIGIBLE"
  );

  // ---------------------------------------------------------------------------
  // SECTION 2: RESTRICT TEXT-BASED NETWORK & PROVIDER CLASSIFICATION (ISSUE 2)
  // ---------------------------------------------------------------------------
  console.log("\n--- 2. Restrict Text-Based Network & Provider Classification ---");

  // 2A. Negative: Ordinary application error with word "network"
  const appNetworkError = new Error("Database network connection reset by peer during transaction commit");
  assert(
    isEligibleForFailover(appNetworkError) === false,
    "2A: Application error containing 'network' without socket transport error code is INELIGIBLE"
  );

  // 2B. Negative: Ordinary application error with word "unauthorized"
  const appUnauthorizedError = new Error("User is unauthorized to access this interview session");
  assert(
    isEligibleForFailover(appUnauthorizedError) === false,
    "2B: Application error containing 'unauthorized' without HTTP 401 status is INELIGIBLE"
  );

  // 2C. Negative: Ordinary application error with word "forbidden"
  const appForbiddenError = new Error("Access forbidden for role CANDIDATE on administrative route");
  assert(
    isEligibleForFailover(appForbiddenError) === false,
    "2C: Application error containing 'forbidden' without HTTP 403 status is INELIGIBLE"
  );

  // 2D. Negative: Ordinary application error with word "rate limit"
  const appRateLimitError = new Error("Application rate limit exceeded: 5 OTP verification attempts per minute");
  assert(
    isEligibleForFailover(appRateLimitError) === false,
    "2D: Application error containing 'rate limit' without HTTP 429 status is INELIGIBLE"
  );

  // 2E. Negative: Ordinary application error with word "service unavailable"
  const appServiceError = new Error("Service unavailable: payment system maintenance in progress");
  assert(
    isEligibleForFailover(appServiceError) === false,
    "2E: Application error containing 'service unavailable' without HTTP 503 status is INELIGIBLE"
  );

  // 2F. Negative: Status numbers in message strings MUST NOT trigger failover
  assert(
    isEligibleForFailover(new Error("401 Unauthorized: Invalid session token")) === false,
    "2F.1: Error message containing '401' without structured status is INELIGIBLE"
  );
  assert(
    isEligibleForFailover(new Error("Rate limit 429 reached in application gateway")) === false,
    "2F.2: Error message containing '429' without structured status is INELIGIBLE"
  );
  assert(
    isEligibleForFailover(new Error("503 Service Unavailable in cache layer")) === false,
    "2F.3: Error message containing '503' without structured status is INELIGIBLE"
  );
  assert(
    isEligibleForFailover(Object.assign(new Error("Application auth failure"), { status: 401 })) === false,
    "2F.4: Error with status 401 but without provider/SDK identification is INELIGIBLE"
  );

  // 2G. Negative: Specific weak indicators must NOT qualify as provider evidence
  assert(
    isEligibleForFailover(Object.assign(new Error("Service unavailable in cache"), { status: 503, headers: { 'content-type': 'application/json' } })) === false,
    "2G.1: Application error with status: 503 and generic headers is INELIGIBLE"
  );
  assert(
    isEligibleForFailover(Object.assign(new Error("Local rate limit exceeded"), { status: 429, errorDetails: 'Too many DB connections' })) === false,
    "2G.2: Application error with status: 429 and generic errorDetails is INELIGIBLE"
  );
  assert(
    isEligibleForFailover(Object.assign(new Error("Session unauthorized"), { status: 401, statusText: 'Unauthorized' })) === false,
    "2G.3: Application error with status: 401 and statusText is INELIGIBLE"
  );
  assert(
    isEligibleForFailover(new Error("Failed to load Gemini settings from database")) === false,
    "2G.4: Application error mentioning 'Gemini' in its message is INELIGIBLE"
  );
  assert(
    isEligibleForFailover(Object.assign(new Error("User mentioned Groq in profile"), { status: 401 })) === false,
    "2G.5: Application error with status 401 mentioning 'Groq' without provider SDK/adapter tag is INELIGIBLE"
  );
  assert(
    isEligibleForFailover(new Error("Database transaction request timed out after 25s")) === false,
    "2G.6: Error containing 'request timed out after 25s' without trusted adapter context is INELIGIBLE"
  );
  assert(
    isEligibleForFailover(Object.assign(new Error("User service error"), { name: 'APIError', status: 500 })) === false,
    "2G.7: Application error named 'APIError' with status 500 without provider evidence is INELIGIBLE"
  );
  assert(
    isEligibleForFailover(Object.assign(new Error("Local rate limit"), { name: 'RateLimitError', status: 429 })) === false,
    "2G.8: Application error named 'RateLimitError' with status 429 without provider evidence is INELIGIBLE"
  );
  assert(
    isEligibleForFailover(Object.assign(new Error("Session auth failed"), { name: 'AuthenticationError', status: 401 })) === false,
    "2G.9: Application error named 'AuthenticationError' with status 401 without provider evidence is INELIGIBLE"
  );

  // 2H. Positive: Recognized transport code ETIMEDOUT
  const socketTimeout = { code: 'ETIMEDOUT', message: 'connect ETIMEDOUT 104.18.2.1:443' };
  assert(
    isEligibleForFailover(socketTimeout) === true,
    "2H: Socket transport error with code ETIMEDOUT is ELIGIBLE"
  );

  // 2I. Positive: Recognized transport code ECONNRESET
  const socketReset = { code: 'ECONNRESET', message: 'read ECONNRESET' };
  assert(
    isEligibleForFailover(socketReset) === true,
    "2I: Socket transport error with code ECONNRESET is ELIGIBLE"
  );

  // 2J. Positive: Bounded adapter deadline timeouts with trusted context
  const groqDeadlineTimeout = new Error('[groq] Request timed out after 25s');
  assert(
    isEligibleForFailover(groqDeadlineTimeout) === true,
    "2J.1: Bounded Groq adapter timeout ('[groq] Request timed out after 25s') is ELIGIBLE"
  );
  const geminiDeadlineTimeout = new Error('[gemini] Request timed out after 25s');
  assert(
    isEligibleForFailover(geminiDeadlineTimeout) === true,
    "2J.2: Bounded Gemini adapter timeout ('[gemini] Request timed out after 25s') is ELIGIBLE"
  );

  // 2K. Positive: Genuine Provider HTTP 401/403/429/5xx structured status with trusted provider evidence
  assert(isEligibleForFailover({ status: 401, provider: 'groq' }) === true, "2K.1: Provider HTTP 401 (provider: 'groq') is ELIGIBLE");
  assert(isEligibleForFailover({ status: 403, provider: 'gemini' }) === true, "2K.2: Provider HTTP 403 (provider: 'gemini') is ELIGIBLE");
  assert(isEligibleForFailover({ status: 429, isProviderError: true }) === true, "2K.3: Provider HTTP 429 (isProviderError: true) is ELIGIBLE");
  assert(isEligibleForFailover({ status: 500, provider: 'groq' }) === true, "2K.4: Provider HTTP 500 is ELIGIBLE");
  assert(isEligibleForFailover({ status: 503, provider: 'gemini' }) === true, "2K.5: Provider HTTP 503 is ELIGIBLE");

  // 2L. Positive: Actual Provider SDK Error instances (instanceof checks)
  const genuineGroqApiError = new Groq.APIError(429, { message: 'Groq API rate limit' }, 'Groq API rate limit', new Headers());
  assert(isEligibleForFailover(genuineGroqApiError) === true, "2L.1: Actual Groq.APIError instance (status 429) is ELIGIBLE");

  const genuineGeminiApiError = Object.assign(new GoogleGenerativeAIError('GoogleGenerativeAI service unavailable'), { status: 503 });
  assert(isEligibleForFailover(genuineGeminiApiError) === true, "2L.2: Actual GoogleGenerativeAIError instance (status 503) is ELIGIBLE");

  // 2M. Negative: TypeError and empty prompt
  assert(isEligibleForFailover(new TypeError("Cannot read properties of undefined")) === false, "2M.1: TypeError is INELIGIBLE");
  assert(isEligibleForFailover(new Error("Prompt cannot be empty")) === false, "2M.2: Empty prompt is INELIGIBLE");

  // ---------------------------------------------------------------------------
  // SECTION 3: ACTUAL DUAL-PROVIDER FAILURE DISPATCH TEST (ISSUE 3)
  // ---------------------------------------------------------------------------
  console.log("\n--- 3. Actual Dual-Provider Failure Dispatch Test ---");

  const prevGroqKey = process.env.GROQ_API_KEY;
  const prevGeminiKey = process.env.GEMINI_API_KEY;

  try {
    // 3.1 Provide invalid credentials to induce real provider authentication rejections (HTTP 401/400)
    process.env.GROQ_API_KEY = "gsk_invalid_test_key_for_failover";
    process.env.GEMINI_API_KEY = "invalid_gemini_test_key_for_failover";
    (globalThis as any)._groqClient = null;
    (globalThis as any)._geminiAI = null;
    (globalThis as any)._geminiModel = null;

    // 3.2 Execute actual centralized dispatch
    let caughtError: any = null;
    try {
      await generateLLMResponse("Generate a question on data structures");
    } catch (err: any) {
      caughtError = err;
    }

    assert(caughtError !== null, "3A: Centralized dispatch throws an error when both providers fail");
    assert(
      caughtError?.message === USER_SAFE_ERROR_MESSAGE,
      `3B: Caller receives exact USER_SAFE_ERROR_MESSAGE ("${USER_SAFE_ERROR_MESSAGE}")`
    );

    // 3.3 Confirm NO internal stack trace, API key, provider names, or URLs are leaked to caller
    const msg = caughtError?.message || "";
    const leaksApiKey = msg.includes("gsk_") || msg.includes("AIza") || msg.includes("api_key") || msg.includes("secret");
    const leaksProviderNames = msg.toLowerCase().includes("groq") || msg.toLowerCase().includes("gemini") || msg.toLowerCase().includes("google") || msg.toLowerCase().includes("openai");
    const leaksUrls = msg.includes("http://") || msg.includes("https://") || msg.includes(".com");
    const leaksStackTrace = /\bat\s+[A-Za-z0-9_]+\s*\(/.test(msg) || msg.includes(".ts:") || msg.includes(".js:");

    assert(
      !leaksApiKey && !leaksProviderNames && !leaksUrls && !leaksStackTrace,
      "3C: No internal API keys, provider names, endpoints, or stack traces exposed to the caller"
    );

    // 3.4 Confirm handleLLMError returns HTTP 503 with safe JSON
    const errorResponse = handleLLMError(caughtError);
    const errorBody = await errorResponse.json();

    assert(errorResponse.status === 503, "3D: handleLLMError returns HTTP 503 status code");
    assert(
      errorBody.success === false && errorBody.error === USER_SAFE_ERROR_MESSAGE,
      "3E: handleLLMError returns sanitized JSON error payload"
    );

  } finally {
    // Restore original environment keys and reset clients
    if (prevGroqKey !== undefined) {
      process.env.GROQ_API_KEY = prevGroqKey;
    } else {
      delete process.env.GROQ_API_KEY;
    }
    if (prevGeminiKey !== undefined) {
      process.env.GEMINI_API_KEY = prevGeminiKey;
    } else {
      delete process.env.GEMINI_API_KEY;
    }
    (globalThis as any)._groqClient = null;
    (globalThis as any)._geminiAI = null;
    (globalThis as any)._geminiModel = null;
  }

  console.log(`\n================================================================================`);
  console.log(`TOTAL TESTS: ${passCount + failCount}`);
  console.log(`PASSED: ${passCount}`);
  console.log(`FAILED: ${failCount}`);
  console.log(`================================================================================\n`);

  if (failCount > 0) {
    process.exit(1);
  }
}

runHardenedFailoverTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
