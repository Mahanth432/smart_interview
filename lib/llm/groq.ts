import Groq from 'groq-sdk'

// Lazily-initialized client cached across requests
declare const globalThis: {
  _groqClient?: Groq | null
} & typeof global

let _groq: Groq | null = globalThis._groqClient ?? null

export function getGroq(customApiKey?: string): Groq {
  if (customApiKey) {
    return new Groq({ apiKey: customApiKey })
  }
  if (!_groq) {
    const apiKey = process.env.GROQ_API_KEY
    if (!apiKey) {
      throw new Error(
        '[groq] GROQ_API_KEY is not set in environment or database configuration.'
      )
    }
    _groq = new Groq({ apiKey })
    if (process.env.NODE_ENV !== 'production') {
      globalThis._groqClient = _groq
    }
  }
  return _groq
}

export const GROQ_MODEL = 'openai/gpt-oss-20b'

export async function generateGroqResponse(prompt: string, customApiKey?: string): Promise<string> {
  if (!prompt || prompt.trim().length === 0) {
    throw new Error('[groq] Prompt cannot be empty')
  }

  const groq = getGroq(customApiKey)

  // Only use json_object if the prompt explicitly asks for JSON
  const isJsonRequest = prompt.toLowerCase().includes('json')

  // Bounded timeout (25 seconds) to prevent hanging
  const TIMEOUT_MS = 25000
  let timer: NodeJS.Timeout | null = null

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const timeoutErr = Object.assign(new Error('[groq] Request timed out after 25s'), {
        code: 'ETIMEDOUT',
        adapterTimeout: true,
        provider: 'groq',
        isProviderError: true,
      })
      reject(timeoutErr)
    }, TIMEOUT_MS)
  })

  try {
    const executePromise = (async () => {
      const completion = await groq.chat.completions.create({
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        model: GROQ_MODEL,
        ...(isJsonRequest ? { response_format: { type: 'json_object' } } : {}),
      })

      const content = completion.choices[0]?.message?.content || ''
      const cleanedContent = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim()

      if (!cleanedContent) {
        throw new Error('[groq] Empty response received from Groq API')
      }

      return cleanedContent
    })()

    return await Promise.race([executePromise, timeoutPromise])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
