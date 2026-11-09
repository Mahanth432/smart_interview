import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import prisma from '@/lib/db'
import { getAppSession, getServerInstanceId } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit-log'

export async function POST(request: Request) {
  try {
    if (!process.env.DATABASE_URL) {
      console.error('Missing DATABASE_URL environment variable')
      return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
    }

    const { username, password } = await request.json()

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username/email and password are required' },
        { status: 400 }
      )
    }

    const trimmedInput = username.trim()
    const normalizedInput = trimmedInput.toLowerCase()

    // Look up user by username OR email (case-insensitive for email)
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { username: trimmedInput },
          { username: normalizedInput },
          { email: normalizedInput },
        ],
      },
    })

    // Generic error for non-existent user to prevent account enumeration
    if (!user) {
      createAuditLog({
        username: trimmedInput,
        action: 'AUTH_LOGIN_FAILURE',
        status: 'FAILURE',
        metadata: { reason: 'User not found' },
      })
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      )
    }

    // Legacy account without password
    if (!user.passwordHash) {
      return NextResponse.json(
        {
          requiresPasswordSetup: true,
          email: user.email || user.username,
          message: 'Your account requires a password to be set before signing in.',
        },
        { status: 403 }
      )
    }

    // Validate password
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash)
    if (!isPasswordValid) {
      createAuditLog({
        userId: user.id,
        username: user.username,
        action: 'AUTH_LOGIN_FAILURE',
        status: 'FAILURE',
        metadata: { reason: 'Incorrect password', role: user.role },
      })
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      )
    }

    // For non-admin accounts, require email verification
    if (user.role !== 'ADMIN' && !user.emailVerified) {
      createAuditLog({
        userId: user.id,
        username: user.username,
        action: 'AUTH_LOGIN_FAILURE',
        status: 'FAILURE',
        metadata: { reason: 'Email not verified', role: user.role },
      })
      return NextResponse.json(
        { error: 'Your email address has not been verified. Please complete registration or contact support.' },
        { status: 403 }
      )
    }

    // Determine redirect based on database role
    const redirectMap: Record<string, string> = {
      ADMIN: '/admin',
      INTERVIEWER: '/dashboard',
      CANDIDATE: '/candidate',
    }
    const redirect = redirectMap[user.role] || '/dashboard'

    // Create authenticated session
    const response = NextResponse.json({ success: true, redirect })
    const session = await getAppSession(request, response)
    session.userId = user.id
    session.username = user.username
    session.role = user.role
    session.instanceId = getServerInstanceId()
    session.isLoggedIn = true
    await session.save()

    createAuditLog({
      userId: user.id,
      username: user.username,
      action: 'AUTH_LOGIN_SUCCESS',
      status: 'SUCCESS',
      metadata: { role: user.role },
    })

    return response
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
