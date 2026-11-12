import { NextResponse } from 'next/server'
import { getValidatedAppSession } from '@/lib/auth-server'
import { formatRagContextWithCitations, searchChunks } from '@/lib/knowledge-base/searchChunks'
import { generateLLMResponse } from '@/lib/llm'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const response = NextResponse.json({})
    const session = await getValidatedAppSession(request, response)

    if (!session?.isLoggedIn || !session.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (session.role === 'CANDIDATE') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const rateLimit = await checkRateLimit({
      key: `rag:query:user:${session.userId}`,
      limit: 40,
      windowSeconds: 15 * 60,
    })
    if (!rateLimit.allowed) {
      return rateLimitResponse(rateLimit.retryAfterSeconds)
    }

    const body = await request.json()
    const query = typeof body.query === 'string' ? body.query.trim() : ''

    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 })
    }

    const topK =
      typeof body.topK === 'number' && Number.isFinite(body.topK)
        ? Math.max(1, Math.min(20, Math.floor(body.topK)))
        : undefined
    const results = await searchChunks(query, session.userId, topK)
    const { contextText, sources } = formatRagContextWithCitations(results)

    if (!contextText) {
      return NextResponse.json({
        success: true,
        answer:
          'No sufficiently relevant passages were found in your processed Knowledge Base documents for this query.',
        sources: [],
      })
    }

    const prompt = `You are a helpful assistant answering questions based on the provided document context.

Instructions:
- Answer the user's question using the retrieved context when relevant.
- Cite the relevant document name(s) in your answer when referencing facts.
- Do not invent information that is not supported by the context.
- If the context does not contain enough information, clearly say so.

Context:
${contextText}

Question:
${query}

Answer:
`

    const adminForcedProvider =
      session.role === 'ADMIN' &&
      typeof body.forceProvider === 'string' &&
      (body.forceProvider === 'gemini' || body.forceProvider === 'groq')
        ? body.forceProvider
        : undefined

    const { text: answer } = await generateLLMResponse(prompt, adminForcedProvider)

    return NextResponse.json({
      success: true,
      answer,
      sources,
    })
  } catch (err) {
    const { handleLLMError } = await import('@/lib/llm')
    return handleLLMError(err)
  }
}
