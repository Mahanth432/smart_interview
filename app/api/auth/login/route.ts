import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import prisma from '@/lib/db'
import { establishUserSession } from '@/lib/auth-server'
import { createAuditLog, extractRequestMetadata } from '@/lib/audit-log'
import { verifySameOrigin } from '@/lib/csrf'
import { checkRateLimit, extractClientIp, rateLimitResponse } from '@/lib/rate-limit'

export async function POST(request: Request) {
  try {
    const csrfError = verifySameOrigin(request)
    if (csrfError) return csrfError
    if (!process.env.DATABASE_URL) {
      console.error('Missing DATABASE_URL environment variable')
      return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
    }

    const reqMeta = extractRequestMetadata(request)
    const clientIp = extractClientIp(request)
    const ipLimit = await checkRateLimit({
      key: `login:ip:${clientIp}`,
      limit: 20,
      windowSeconds: 15 * 60,
    })
    if (!ipLimit.allowed) {
      return rateLimitResponse(
        ipLimit.retryAfterSeconds,
        'Too many login attempts from your network. Please wait before trying again.'
      )
    }

    const { username, password } = await request.json()

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username/email and password are required' },
        { status: 400 }
      )
    }

    const trimmedInput = String(username).trim()
    const normalizedInput = trimmedInput.toLowerCase()

    const userLimit = await checkRateLimit({
      key: `login:acct:${normalizedInput}`,
      limit: 10,
      windowSeconds: 15 * 60,
    })
    if (!userLimit.allowed) {
      return rateLimitResponse(
        userLimit.retryAfterSeconds,
        'Too many login attempts for this account. Please wait before trying again.'
      )
    }

    // Look up user deterministically by username (case-insensitive) OR normalized email
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { username: trimmedInput },
          { username: { equals: trimmedInput, mode: 'insensitive' } },
          { email: normalizedInput },
        ],
      },
      orderBy: { id: 'asc' },
    })

    if (!user) {
      createAuditLog({
        username: trimmedInput,
        action: 'AUTH_LOGIN_FAILURE',
        status: 'FAILURE',
        metadata: { reason: 'User not found' },
        ...reqMeta,
      })
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    if (!user.passwordHash) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const isPasswordValid = await bcrypt.compare(String(password), user.passwordHash)
    if (!isPasswordValid) {
      createAuditLog({
        userId: user.id,
        username: user.username,
        action: 'AUTH_LOGIN_FAILURE',
        status: 'FAILURE',
        metadata: { reason: 'Incorrect password', role: user.role },
        ...reqMeta,
      })
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    if (user.role !== 'ADMIN' && !user.emailVerified) {
      createAuditLog({
        userId: user.id,
        username: user.username,
        action: 'AUTH_LOGIN_FAILURE',
        status: 'FAILURE',
        metadata: { reason: 'Email not verified', role: user.role },
        ...reqMeta,
      })
      return NextResponse.json(
        {
          error:
            'Your email address has not been verified. Please complete registration or contact support.',
        },
        { status: 403 }
      )
    }

    const redirectMap: Record<string, string> = {
      ADMIN: '/admin',
      INTERVIEWER: '/dashboard',
      CANDIDATE: '/candidate',
    }
    const redirect = redirectMap[user.role] || '/dashboard'

    const response = NextResponse.json({ success: true, redirect })
    await establishUserSession(request, response, user)

    createAuditLog({
      userId: user.id,
      username: user.username,
      action: 'AUTH_LOGIN_SUCCESS',
      status: 'SUCCESS',
      metadata: { role: user.role },
      ...reqMeta,
    })

    return response
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
