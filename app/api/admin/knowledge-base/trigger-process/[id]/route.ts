import { NextResponse, NextRequest } from 'next/server'
import { getAppSession } from '@/lib/auth'
import { retryDocumentProcessing } from '@/lib/knowledge-base/documentHandlers'

export const maxDuration = 60

// POST /api/admin/knowledge-base/trigger-process/[id]
// Durable retryable processing for ADMIN_MASTER documents.
// Executes synchronously by default (returning 200 PROCESSED / 409 conflict / 500 FAILED),
// or schedules via after() when ?async=true is supplied.
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
    if (session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden — Admin only' }, { status: 403 })
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
      role: session.role,
      requireAdminMaster: true,
      sync: !asyncMode,
    })
  } catch (err) {
    console.error('Admin KB trigger-process error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
