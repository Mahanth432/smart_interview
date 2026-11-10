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
    if (session.role === 'CANDIDATE') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const syncStatus = await reconcileStorage(
      { kind: 'user', userId: session.userId },
      {
        userId: session.userId,
        username: session.username,
        reason: 'manual_user_sync',
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
    console.error('User storage sync error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
