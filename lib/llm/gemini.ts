/**
 * Gemini LLM helper — SERVER SIDE ONLY
 *
 * Uses @google/generative-ai (official Google GenAI JS SDK).
 * GEMINI_API_KEY is read from server configuration or process.env.
 * The key is never exposed to the browser or logged.
 */
import { GoogleGenerativeAI } from '@google/generative-ai'

// Lazily-initialized default client and model cached across requests
declare const globalThis: {
  _geminiAI?: GoogleGenerativeAI | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _geminiModel?: any
} & typeof global

let _genAI: GoogleGenerativeAI | null = globalThis._geminiAI ?? null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _geminiModel: any = globalThis._geminiModel ?? null

export function getGenAI(customApiKey?: string): GoogleGenerativeAI {
  if (customApiKey) {
    return new GoogleGenerativeAI(customApiKey)
  }
  if (!_genAI) {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      throw new Error(
        '[gemini] GEMINI_API_KEY is not set in environment or database configuration.'
      )
    }
    _genAI = new GoogleGenerativeAI(apiKey)
    if (process.env.NODE_ENV !== 'production') {
      globalThis._geminiAI = _genAI
    }
  }
  return _genAI
}

/**
 * The Gemini model to use.
 */
export const GEMINI_MODEL = 'gemini-3.6-flash'

export function getGeminiModel(customApiKey?: string) {
  if (customApiKey) {
    const genAI = getGenAI(customApiKey)
    return genAI.getGenerativeModel({ model: GEMINI_MODEL })
  }
  if (!_geminiModel) {
    const genAI = getGenAI()
    _geminiModel = genAI.getGenerativeModel({ model: GEMINI_MODEL })
    if (process.env.NODE_ENV !== 'production') {
      globalThis._geminiModel = _geminiModel
    }
  }
  return _geminiModel
}

/**
 * Generate a text response from Gemini given a prompt string.
 *
 * @param prompt Full prompt including any context/instructions
 * @param customApiKey Optional explicit API key
 * @returns Generated text response
 */
export async function generateGeminiResponse(prompt: string, customApiKey?: string): Promise<string> {
  if (!prompt || prompt.trim().length === 0) {
    throw new Error('[gemini] Prompt cannot be empty')
  }

  const model = getGeminiModel(customApiKey)

  // Bounded timeout (25 seconds) to prevent hanging
  const TIMEOUT_MS = 25000
  let timer: NodeJS.Timeout | null = null

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const timeoutErr = Object.assign(new Error('[gemini] Request timed out after 25s'), {
        code: 'ETIMEDOUT',
        adapterTimeout: true,
        provider: 'gemini',
        isProviderError: true,
      })
      reject(timeoutErr)
    }, TIMEOUT_MS)
  })

  try {
    const executePromise = (async () => {
      const result = await model.generateContent(prompt)
      const response = result.response
      const text = response.text()
      if (!text) {
        throw new Error('[gemini] Empty response received from Gemini API')
      }
      return text
    })()

    return await Promise.race([executePromise, timeoutPromise])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
