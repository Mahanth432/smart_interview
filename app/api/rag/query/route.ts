import { NextResponse } from 'next/server'

import { getAppSession } from '@/lib/auth'
import { searchChunks } from '@/lib/knowledge-base/searchChunks'
import { generateLLMResponse } from '@/lib/llm'

export async function POST(request: Request) {
  try {
    const response = NextResponse.json({})
    const session = await getAppSession(request, response)

    if (!session?.isLoggedIn || !session.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (session.role === 'CANDIDATE') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const query = typeof body.query === 'string' ? body.query.trim() : ''

    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 })
    }

    // 1. Search for relevant context using local MiniLM embeddings & pgvector
    const topK = 5
    const results = await searchChunks(query, session.userId, topK)
    
    // 2. Build the context string
    const contextText = results.map(r => `Document: ${r.documentName}\nExcerpt:\n${r.content}`).join('\n\n')

    // 3. Build the prompt for Gemini
    const prompt = `You are a helpful assistant answering questions based on the provided document context.

Instructions:
- Answer the user's question using the retrieved context when relevant.
- Do not invent information that is not supported by the context.
- If the context does not contain enough information, clearly say so.
- Give a concise but useful answer.

Context:
${contextText || '(No relevant context found)'}

Question:
${query}

Answer:
`

    // 4. Send prompt to centrally managed LLM with automatic failover
    // Only ADMIN users can specify a forced provider for controlled testing
    const adminForcedProvider =
      session.role === 'ADMIN' && typeof body.forceProvider === 'string' && (body.forceProvider === 'gemini' || body.forceProvider === 'groq')
        ? body.forceProvider
        : undefined

    const { text: answer } = await generateLLMResponse(prompt, adminForcedProvider)

    return NextResponse.json({
      success: true,
      answer,
      sources: results
    })
  } catch (err) {
    const { handleLLMError } = await import('@/lib/llm')
    return handleLLMError(err)
  }
}


