import { NextResponse } from 'next/server'
import { getAppSession } from '@/lib/auth'
import { reconcileStorage } from '@/lib/knowledge-base/storageReconciliation'
import { scheduleDocumentProcessing } from '@/lib/knowledge-base/documentHandlers'

export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const response = NextResponse.json({})
    const session = await getAppSession(request, response)

    if (!session?.isLoggedIn || !session.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden — Admin only' }, { status: 403 })
    }

    const body = (await request.json().catch(() => ({}))) as { scope?: string } | null
    const scopeKind = body?.scope === 'admin' ? 'admin' : 'all'

    const syncStatus = await reconcileStorage(
      { kind: scopeKind },
      {
        userId: session.userId,
        username: session.username,
        reason: scopeKind === 'admin' ? 'manual_admin_sync' : 'manual_admin_full_sync',
      }
    )

    for (const docId of syncStatus.restoredChangedDocIds) {
      scheduleDocumentProcessing(docId, {
        userId: session.userId,
        username: session.username,
        force: true,
      })
    }

    return NextResponse.json({ syncStatus })
  } catch (err) {
    console.error('Admin storage sync error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
