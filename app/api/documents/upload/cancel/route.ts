import { NextResponse } from 'next/server'
import { getAppSession } from '@/lib/auth'
import { cancelDirectDocumentUpload } from '@/lib/knowledge-base/documentHandlers'

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
