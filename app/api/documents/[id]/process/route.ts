import { NextResponse, NextRequest } from 'next/server'
import { getValidatedAppSession } from '@/lib/auth-server'
import { verifySameOrigin } from '@/lib/csrf'
import { enforceRateLimit } from '@/lib/rate-limit'
import { retryDocumentProcessing } from '@/lib/knowledge-base/documentHandlers'

export const maxDuration = 60

// POST /api/documents/[id]/process
// Authenticated, ownership-enforced retryable processing endpoint for interviewer documents.
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
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

    const rlError = await enforceRateLimit(
      {
        key: `documents:process:user:${session.userId}`,
        limit: 15,
        windowSeconds: 15 * 60,
      },
      'Too many document processing requests. Please wait before trying again.'
    )
    if (rlError) return rlError

    const { id: idStr } = await context.params
    const id = parseInt(idStr, 10)
    if (Number.isNaN(id) || id <= 0) {
      return NextResponse.json({ error: 'Invalid document ID' }, { status: 400 })
    }

    const asyncMode = new URL(request.url).searchParams.get('async') === 'true'

    return await retryDocumentProcessing({
      docId: id,
      userId: session.userId,
      username: session.username,
      role: session.role || 'INTERVIEWER',
      requireAdminMaster: false,
      sync: !asyncMode,
    })
  } catch (err) {
    console.error('Document retry process error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
