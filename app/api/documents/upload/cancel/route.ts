import { NextResponse } from 'next/server'
import { getValidatedAppSession } from '@/lib/auth-server'
import { verifySameOrigin } from '@/lib/csrf'
import { enforceRateLimit } from '@/lib/rate-limit'
import { cancelDirectDocumentUpload } from '@/lib/knowledge-base/documentHandlers'

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
        key: `documents:upload-cancel:user:${session.userId}`,
        limit: 30,
        windowSeconds: 15 * 60,
      },
      'Too many upload cancel requests. Please wait before trying again.'
    )
    if (rlError) return rlError

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const uploadIntentId = typeof body.uploadIntentId === 'string' ? body.uploadIntentId : ''
    const reason = typeof body.reason === 'string' ? body.reason : 'cancelled'

    return await cancelDirectDocumentUpload({
      uploadIntentId,
      userId: session.userId,
      reason,
    })
  } catch (err) {
    console.error('Upload cancel error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
