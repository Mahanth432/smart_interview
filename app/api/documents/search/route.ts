import { NextResponse } from 'next/server'

import { getAppSession } from '@/lib/auth'
import { searchChunks } from '@/lib/knowledge-base/searchChunks'

/**
 * POST /api/documents/search
 *
 * Body: { query: string, topK?: number }
 *
 * Performs semantic similarity search across the authenticated user's
 * document chunks using pgvector cosine distance.
 */
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
    const topK = typeof body.topK === 'number' && body.topK > 0 ? Math.min(body.topK, 20) : 5

    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 })
    }

    const results = await searchChunks(query, session.userId, topK)

    return NextResponse.json({
      query,
      topK,
      results,
      count: results.length,
    })
  } catch (err) {
    console.error('Search error:', err)
    const message = err instanceof Error ? err.message : 'Search failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
