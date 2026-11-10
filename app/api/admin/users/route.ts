import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { Prisma } from '@prisma/client'
import { getAppSession } from '@/lib/auth'
import prisma from '@/lib/db'
import { createAuditLog } from '@/lib/audit-log'
import {
  normalizeUsername,
  normalizeEmail,
  validateUsername,
  validateEmail,
  validatePasswordStrength,
} from '@/lib/validation/user'

const ALLOWED_ROLES = new Set(['ADMIN', 'INTERVIEWER', 'CANDIDATE'])

export async function GET(request: Request) {
  const t0 = performance.now()
  try {
    const response = NextResponse.json({})
    const session = await getAppSession(request, response)

    if (!session?.isLoggedIn || !session.userId) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })
    }

    if (session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const search = (searchParams.get('search') || '').trim()
    const role = searchParams.get('role') || 'ALL'
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const limit = Math.max(1, Math.min(100, parseInt(searchParams.get('limit') || '20', 10)))

    const where: Prisma.UserWhereInput = {}

    if (search) {
      where.OR = [
        { username: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
      ]
    }

    if (role && role !== 'ALL') {
      where.role = role
    }

    const tQuery0 = performance.now()
    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        select: {
          id: true,
          username: true,
          email: true,
          name: true,
          role: true,
          emailVerified: true,
          createdAt: true,
          _count: {
            select: {
              sessions: true,
              documents: true,
            },
          },
          candidate: {
            select: {
              _count: { select: { sessions: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ])
    const tQueryEnd = performance.now()

    if (process.env.NODE_ENV === 'development') {
      console.log(
        `[DEV TIMING] API GET /api/admin/users: query=${(tQueryEnd - tQuery0).toFixed(1)}ms, total=${(performance.now() - t0).toFixed(1)}ms`
      )
    }

    return NextResponse.json({
      users,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      currentUserId: session.userId,
    })
  } catch (err) {
    console.error('Fetch admin users error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const response = NextResponse.json({})
    const session = await getAppSession(request, response)

    if (!session?.isLoggedIn || !session.userId) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })
    }

    if (session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const body = await request.json()
    const usernameInput = normalizeUsername(body.username)
    const emailInput = normalizeEmail(body.email)
    const nameInput = typeof body.name === 'string' ? body.name.trim() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const role = typeof body.role === 'string' ? body.role.trim().toUpperCase() : 'INTERVIEWER'

    if (!ALLOWED_ROLES.has(role)) {
      return NextResponse.json({ error: 'Invalid role.' }, { status: 400 })
    }

    const usernameError = validateUsername(usernameInput)
    if (usernameError) {
      return NextResponse.json({ error: usernameError }, { status: 400 })
    }

    // Email is required for non-admin accounts and validated whenever supplied
    if (role !== 'ADMIN' || emailInput) {
      const emailError = validateEmail(emailInput)
      if (emailError) {
        return NextResponse.json({ error: emailError }, { status: 400 })
      }
    }

    const passwordError = validatePasswordStrength(password)
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 })
    }

    // Enforce independent uniqueness for username and email
    const [existingByUsername, existingByEmail] = await Promise.all([
      prisma.user.findFirst({
        where: { username: { equals: usernameInput, mode: 'insensitive' } },
        select: { id: true },
      }),
      emailInput
        ? prisma.user.findFirst({
            where: { OR: [{ email: emailInput }, { username: emailInput }] },
            select: { id: true },
          })
        : Promise.resolve(null),
    ])

    if (existingByUsername) {
      return NextResponse.json(
        { error: 'This username is already taken. Please choose a different username.' },
        { status: 409 }
      )
    }

    if (existingByEmail) {
      return NextResponse.json(
        { error: 'An account with this email address already exists.' },
        { status: 409 }
      )
    }

    const passwordHash = await bcrypt.hash(password, 12)

    const createdUser = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username: usernameInput,
          email: emailInput || null,
          name: nameInput || null,
          passwordHash,
          role,
          emailVerified: true,
        },
        select: {
          id: true,
          username: true,
          email: true,
          name: true,
          role: true,
          emailVerified: true,
          createdAt: true,
        },
      })

      if (role === 'CANDIDATE') {
        await tx.candidate.create({
          data: {
            userId: user.id,
            name: nameInput || usernameInput,
            email: emailInput || null,
          },
        })
      }

      return user
    })

    createAuditLog({
      userId: session.userId,
      username: session.username,
      action: 'ADMIN_USER_CREATED',
      entityType: 'User',
      entityId: String(createdUser.id),
      status: 'SUCCESS',
      metadata: {
        createdUsername: createdUser.username,
        createdEmail: createdUser.email,
        createdRole: createdUser.role,
      },
    })

    return NextResponse.json({ success: true, user: createdUser }, { status: 201 })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const target = Array.isArray(err.meta?.target) ? err.meta.target.join(',') : String(err.meta?.target || '')
      if (target.includes('username')) {
        return NextResponse.json({ error: 'This username is already taken.' }, { status: 409 })
      }
      if (target.includes('email')) {
        return NextResponse.json({ error: 'This email address is already in use.' }, { status: 409 })
      }
      return NextResponse.json({ error: 'A user with these details already exists.' }, { status: 409 })
    }
    console.error('Admin create user error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
