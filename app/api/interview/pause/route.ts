import { NextRequest, NextResponse } from 'next/server'
import { getValidatedAppSession } from '@/lib/auth-server'
import { transitionSessionLifecycle } from '@/lib/interview/lifecycle'

export async function POST(req: NextRequest) {
  try {
    const res = NextResponse.json({})
    const userSession = await getValidatedAppSession(req, res)
    if (!userSession?.isLoggedIn || !userSession.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { sessionId } = await req.json()
    if (!sessionId || typeof sessionId !== 'string') {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
    }

    const result = await transitionSessionLifecycle({
      sessionId,
      actorUserId: userSession.userId,
      actorUsername: userSession.username,
      actorRole: userSession.role,
      action: 'pause',
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ success: true, session: result.session })
  } catch (err) {
    console.error('Pause interview error:', err)
    return NextResponse.json({ error: 'Failed to pause session' }, { status: 500 })
  }
}
