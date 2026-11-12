import { NextRequest, NextResponse } from 'next/server'
import { getValidatedAppSession } from '@/lib/auth-server'
import { verifySameOrigin } from '@/lib/csrf'
import { transitionSessionLifecycle } from '@/lib/interview/lifecycle'
import { enforceRateLimit } from '@/lib/rate-limit'

export async function POST(req: NextRequest) {
  try {
    const csrfError = verifySameOrigin(req)
    if (csrfError) return csrfError
    const res = NextResponse.json({})
    const userSession = await getValidatedAppSession(req, res)
    if (!userSession?.isLoggedIn || !userSession.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const rlError = await enforceRateLimit(
      {
        key: `interview:pause:user:${userSession.userId}`,
        limit: 40,
        windowSeconds: 15 * 60,
      },
      'Too many pause requests. Please wait before trying again.'
    )
    if (rlError) return rlError

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
