import { NextResponse } from 'next/server'
import { getValidatedAppSession } from '@/lib/auth-server'
import { verifySameOrigin } from '@/lib/csrf'
import { enforceRateLimit } from '@/lib/rate-limit'
import { reconcileStorage } from '@/lib/knowledge-base/storageReconciliation'
import { scheduleDocumentProcessing } from '@/lib/knowledge-base/documentHandlers'

export const maxDuration = 60

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

    const rlError = await enforceRateLimit(
      {
        key: `documents:sync:user:${session.userId}`,
        limit: 10,
        windowSeconds: 15 * 60,
      },
      'Too many storage synchronization requests. Please wait before trying again.'
    )
    if (rlError) return rlError

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
