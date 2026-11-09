import { isEligibleForFailover, handleLLMError, USER_SAFE_ERROR_MESSAGE } from "../lib/llm";

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

async function runFailoverClassificationTests() {
  console.log("=== STRICT LLM FAILOVER ERROR CLASSIFICATION TESTS ===\n");

  // 1. Groq json_validate_failed with token exhaustion (structured provider response) -> eligible
  const groqTokenExhaustionError = Object.assign(
    new Error('{"error":{"message":"Failed to generate JSON. Please adjust your prompt. See \'failed_generation\' for more details.","type":"invalid_request_error","code":"json_validate_failed","failed_generation":"max completion tokens reached before generating a valid document"}}'),
    { status: 400, provider: 'groq', headers: {} }
  );
  assert(
    isEligibleForFailover(groqTokenExhaustionError) === true,
    "Test 1: Groq json_validate_failed with max completion tokens reached is ELIGIBLE for failover"
  );

  // 2. Groq HTTP 400 with unrelated invalid-request error -> ineligible
  const groqInvalidParamError = Object.assign(
    new Error('{"error":{"message":"Invalid parameter: max_tokens must be positive integer","type":"invalid_request_error","code":"invalid_parameter"}}'),
    { status: 400, provider: 'groq', headers: {} }
  );
  assert(
    isEligibleForFailover(groqInvalidParamError) === false,
    "Test 2: Groq HTTP 400 with unrelated invalid parameter error is INELIGIBLE for failover"
  );

  // 3. Generic unrecognized HTTP 400 error -> ineligible
  const generic400Error = Object.assign(
    new Error('Bad Request: Malformed payload'),
    { status: 400, provider: 'groq' }
  );
  assert(
    isEligibleForFailover(generic400Error) === false,
    "Test 3: Generic unrecognized HTTP 400 error is INELIGIBLE for failover"
  );

  // 3B. Gemini-tagged HTTP 400 with same message -> ineligible
  const gemini400TokenError = Object.assign(
    new Error('json_validate_failed: max completion tokens reached'),
    { status: 400, provider: 'gemini' }
  );
  assert(
    isEligibleForFailover(gemini400TokenError) === false,
    "Test 3B: Gemini HTTP 400 with token exhaustion wording is INELIGIBLE for failover"
  );

  // 4. Structured Provider HTTP 401/403/429/5xx (supported by reliable provider evidence) -> eligible
  const err401 = Object.assign(new Error('Unauthorized: Invalid API Key'), { status: 401, provider: 'groq' });
  const err403 = Object.assign(new Error('Forbidden: Project access denied'), { status: 403, provider: 'gemini' });
  const err429 = Object.assign(new Error('Too Many Requests: Rate limit reached'), { status: 429, provider: 'groq', isProviderError: true });
  const err500 = Object.assign(new Error('Internal Server Error'), { status: 500, provider: 'groq' });
  const err502 = Object.assign(new Error('Bad Gateway'), { status: 502, provider: 'groq' });
  const err503 = Object.assign(new Error('Service Unavailable'), { status: 503, provider: 'gemini' });
  const err504 = Object.assign(new Error('Gateway Timeout'), { status: 504, provider: 'groq' });

  assert(isEligibleForFailover(err401) === true, "Test 4A: Provider HTTP 401 is ELIGIBLE for failover");
  assert(isEligibleForFailover(err403) === true, "Test 4B: Provider HTTP 403 is ELIGIBLE for failover");
  assert(isEligibleForFailover(err429) === true, "Test 4C: Provider HTTP 429 is ELIGIBLE for failover");
  assert(isEligibleForFailover(err500) === true, "Test 4D: Provider HTTP 500 is ELIGIBLE for failover");
  assert(isEligibleForFailover(err502) === true, "Test 4E: Provider HTTP 502 is ELIGIBLE for failover");
  assert(isEligibleForFailover(err503) === true, "Test 4F: Provider HTTP 503 is ELIGIBLE for failover");
  assert(isEligibleForFailover(err504) === true, "Test 4G: Provider HTTP 504 is ELIGIBLE for failover");

  // Error object with numeric status property from provider
  const statusObject429 = { status: 429, message: "Quota exhausted", provider: "groq" };
  assert(isEligibleForFailover(statusObject429) === true, "Test 4H: Error object with status 429 is ELIGIBLE for failover");

  // 4I. Negative Tests: Untrusted indicators and application errors -> INELIGIBLE
  assert(
    isEligibleForFailover(new Error('401 Unauthorized: Invalid application credentials')) === false,
    "Test 4I.1: Ordinary error with text '401 Unauthorized' is INELIGIBLE for failover"
  );
  assert(
    isEligibleForFailover(new Error('429 Too Many Requests: Local rate limiter')) === false,
    "Test 4I.2: Ordinary error with text '429 Too Many Requests' is INELIGIBLE for failover"
  );
  assert(
    isEligibleForFailover(new Error('503 Service Unavailable: Redis offline')) === false,
    "Test 4I.3: Ordinary error with text '503 Service Unavailable' is INELIGIBLE for failover"
  );
  assert(
    isEligibleForFailover(Object.assign(new Error('Application authorization failed'), { status: 401 })) === false,
    "Test 4I.4: Application error with status 401 without provider identification is INELIGIBLE"
  );
  assert(
    isEligibleForFailover(Object.assign(new Error('Cache service unavailable'), { status: 503, headers: { 'content-type': 'application/json' } })) === false,
    "Test 4I.5: Application error with status 503 and generic headers is INELIGIBLE"
  );
  assert(
    isEligibleForFailover(Object.assign(new Error('Database rate limit exceeded'), { status: 429, errorDetails: 'Too many DB connections' })) === false,
    "Test 4I.6: Application error with status 429 and generic errorDetails is INELIGIBLE"
  );
  assert(
    isEligibleForFailover(Object.assign(new Error('Session invalid'), { status: 401, statusText: 'Unauthorized' })) === false,
    "Test 4I.7: Application error with status 401 and statusText is INELIGIBLE"
  );
  assert(
    isEligibleForFailover(new Error('Failed to load Gemini settings from database')) === false,
    "Test 4I.8: Application error mentioning 'Gemini' in message text is INELIGIBLE"
  );
  assert(
    isEligibleForFailover(new Error('Database transaction request timed out after 25s')) === false,
    "Test 4I.9: Error with 'request timed out after 25s' without adapter context is INELIGIBLE"
  );
  assert(
    isEligibleForFailover(Object.assign(new Error('Application internal API failure'), { name: 'APIError', status: 500 })) === false,
    "Test 4I.10: Application error named 'APIError' with status 500 without provider evidence is INELIGIBLE"
  );
  assert(
    isEligibleForFailover(Object.assign(new Error('Application route rate limit exceeded'), { name: 'RateLimitError', status: 429 })) === false,
    "Test 4I.11: Application error named 'RateLimitError' with status 429 without provider evidence is INELIGIBLE"
  );

  // 4. Network timeout and connection reset -> eligible
  const timeoutErr = new Error('FetchError: connect ETIMEDOUT 104.18.2.1:443');
  const resetErr = new Error('read ECONNRESET');
  const timeoutMsgErr = new Error('[groq] Request timed out after 25s');
  const socketHangupErr = new Error('socket hang up');

  assert(isEligibleForFailover(timeoutErr) === true, "Test 5A: Network ETIMEDOUT is ELIGIBLE for failover");
  assert(isEligibleForFailover(resetErr) === true, "Test 5B: Network ECONNRESET is ELIGIBLE for failover");
  assert(isEligibleForFailover(timeoutMsgErr) === true, "Test 5C: 25s timeout deadline error is ELIGIBLE for failover");
  assert(isEligibleForFailover(socketHangupErr) === true, "Test 5D: Socket hang up is ELIGIBLE for failover");

  // 5. Empty prompt -> ineligible
  const emptyPromptErr = new Error('Prompt cannot be empty');
  const emptyPromptMsg = new Error('[groq] Prompt cannot be empty');
  assert(isEligibleForFailover(emptyPromptErr) === false, "Test 6A: 'Prompt cannot be empty' is INELIGIBLE for failover");
  assert(isEligibleForFailover(emptyPromptMsg) === false, "Test 6B: '[groq] Prompt cannot be empty' is INELIGIBLE for failover");

  // 6. Unexpected TypeError / RangeError -> ineligible
  const typeError = new TypeError("Cannot read properties of undefined (reading 'choices')");
  const rangeError = new RangeError("Invalid array length");
  const refError = new ReferenceError("unresolvedVariable is not defined");

  assert(isEligibleForFailover(typeError) === false, "Test 7A: Unexpected TypeError is INELIGIBLE for failover");
  assert(isEligibleForFailover(rangeError) === false, "Test 7B: Unexpected RangeError is INELIGIBLE for failover");
  assert(isEligibleForFailover(refError) === false, "Test 7C: Unexpected ReferenceError is INELIGIBLE for failover");

  // 7. Both providers failing -> safe HTTP 503 response
  const completeOutageError = new Error(USER_SAFE_ERROR_MESSAGE);
  const response = handleLLMError(completeOutageError);
  const responseBody = await response.json();

  assert(response.status === 503, "Test 8A: handleLLMError returns HTTP 503 status code");
  assert(
    responseBody.success === false && responseBody.error === USER_SAFE_ERROR_MESSAGE,
    "Test 8B: handleLLMError returns safe JSON error message without leaking stack traces or internal keys"
  );

  console.log(`\n========================================`);
  console.log(`TOTAL TESTS: ${passCount + failCount}`);
  console.log(`PASSED: ${passCount}`);
  console.log(`FAILED: ${failCount}`);
  console.log(`========================================\n`);

  if (failCount > 0) {
    process.exit(1);
  }
}

runFailoverClassificationTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
