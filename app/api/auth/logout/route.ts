import { NextResponse } from 'next/server'
import { getAppSession, clearSessionFields, getSessionOptions } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit-log'
import { verifySameOrigin } from '@/lib/csrf'

export async function POST(request: Request) {
  const csrfError = verifySameOrigin(request)
  if (csrfError) {
    return csrfError
  }

  const response = NextResponse.json({ success: true, redirect: '/login' })
  const session = await getAppSession(request, response)

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
