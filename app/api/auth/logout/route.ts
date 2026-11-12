import { NextResponse } from 'next/server'
import { getAppSession, clearSessionFields, getSessionOptions } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit-log'
import { verifySameOrigin } from '@/lib/csrf'
import { enforceRateLimit, extractClientIp } from '@/lib/rate-limit'

export async function POST(request: Request) {
  const csrfError = verifySameOrigin(request)
  if (csrfError) {
    return csrfError
  }

  const response = NextResponse.json({ success: true, redirect: '/login' })
  const session = await getAppSession(request, response)

  const rateLimitKey = session?.userId
    ? `logout:user:${session.userId}`
    : `logout:ip:${extractClientIp(request)}`

  const rlError = await enforceRateLimit(
    {
      key: rateLimitKey,
      limit: 60,
      windowSeconds: 15 * 60,
    },
    'Too many logout requests. Please wait before trying again.'
  )
  if (rlError) return rlError

  if (session?.userId) {
    createAuditLog({
      userId: session.userId,
      username: session.username,
      action: 'AUTH_LOGOUT',
      status: 'SUCCESS',
    })
  }

  clearSessionFields(session)
  session.destroy()

  const opts = getSessionOptions()
  response.cookies.set(opts.cookieName, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 0,
  })

  return response
}
