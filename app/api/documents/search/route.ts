import { NextResponse } from 'next/server'
import { getValidatedAppSession } from '@/lib/auth-server'
import { verifySameOrigin } from '@/lib/csrf'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { searchChunks } from '@/lib/knowledge-base/searchChunks'

export const maxDuration = 60

/**
 * POST /api/documents/search
 *
 * Body: { query: string, topK?: number, documentIds?: number[] }
 */
export async function POST(request: Request) {
  try {
    const csrfError = verifySameOrigin(request)
    if (csrfError) return csrfError

    const response = NextResponse.json({})
    const session = await getValidatedAppSession(request, response)

    if (!session?.isLoggedIn || !session.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (session.role === 'CANDIDATE') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const rateLimit = await checkRateLimit({
      key: `documents:search:user:${session.userId}`,
      limit: 60,
      windowSeconds: 15 * 60,
    })
    if (!rateLimit.allowed) {
      return rateLimitResponse(rateLimit.retryAfterSeconds, 'Too many document search requests.')
    }

    const body = await request.json()
    const query = typeof body.query === 'string' ? body.query.trim() : ''
    const topK =
      typeof body.topK === 'number' && Number.isFinite(body.topK) && body.topK > 0
        ? Math.min(Math.floor(body.topK), 20)
        : undefined
    const documentIds = Array.isArray(body.documentIds)
      ? body.documentIds.map(Number).filter((id: number) => Number.isInteger(id) && id > 0)
      : undefined

    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 })
    }

    const results = await searchChunks(query, session.userId, topK, documentIds)

    return NextResponse.json({
      query,
      topK: topK ?? results.length,
      results,
      count: results.length,
    })
  } catch (err) {
    console.error('Search error:', err)
    return NextResponse.json({ error: 'Document search failed' }, { status: 500 })
  }
}
