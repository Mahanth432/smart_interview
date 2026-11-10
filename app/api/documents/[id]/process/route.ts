import { NextResponse, NextRequest } from 'next/server'
import { getAppSession } from '@/lib/auth'
import { retryDocumentProcessing } from '@/lib/knowledge-base/documentHandlers'

export const maxDuration = 60

// POST /api/documents/[id]/process
// Authenticated, ownership-enforced retryable processing endpoint for interviewer documents.
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const response = NextResponse.json({})
    const session = await getAppSession(request, response)

    if (!session?.isLoggedIn || !session.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (session.role === 'CANDIDATE') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

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
