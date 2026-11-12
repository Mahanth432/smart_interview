import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getAppSession } from '@/lib/auth'
import prisma from '@/lib/db'
import { createAuditLog } from '@/lib/audit-log'
import { deleteUserWithCleanup, getUserDeletionPreview } from '@/lib/admin/userDeletion'
import {
  normalizeUsername,
  normalizeEmail,
  validateUsername,
  validateEmail,
} from '@/lib/validation/user'

const ALLOWED_ROLES = new Set(['ADMIN', 'INTERVIEWER', 'CANDIDATE'])

function parseUserId(idStr: string): number | null {
  if (!/^\d+$/.test(idStr)) return null
  const parsed = parseInt(idStr, 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

// GET /api/admin/users/[id] — return user details + deletion impact summary (doc/chunk/session counts)
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const response = NextResponse.json({})
    const session = await getAppSession(request, response)

    if (!session?.isLoggedIn || !session.userId) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })
    }
    if (session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const { id } = await context.params
    const targetUserId = parseUserId(id)
    if (!targetUserId) {
      return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 })
    }

    const preview = await getUserDeletionPreview(targetUserId)
    if (!preview) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    return NextResponse.json(preview)
  } catch (err) {
    console.error('Fetch admin user preview error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/admin/users/[id] — update username, email, name, or role independently
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const response = NextResponse.json({})
    const session = await getAppSession(request, response)

    if (!session?.isLoggedIn || !session.userId) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })
    }
    if (session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const { id } = await context.params
    const targetUserId = parseUserId(id)
    if (!targetUserId) {
      return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 })
    }

    const existing = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, username: true, email: true, name: true, role: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const body = await request.json()
    const updateData: Prisma.UserUpdateInput = {}

    if (body.username !== undefined) {
      const nextUsername = normalizeUsername(body.username)
      const usernameError = validateUsername(nextUsername)
      if (usernameError) {
        return NextResponse.json({ error: usernameError }, { status: 400 })
      }
      const conflict = await prisma.user.findFirst({
        where: {
          username: { equals: nextUsername, mode: 'insensitive' },
          id: { not: targetUserId },
        },
        select: { id: true },
      })
      if (conflict) {
        return NextResponse.json(
          { error: 'This username is already taken. Please choose a different username.' },
          { status: 409 }
        )
      }
      updateData.username = nextUsername
    }

    if (body.email !== undefined) {
      const nextEmail = normalizeEmail(body.email)
      if (nextEmail === '') {
        if (existing.role !== 'ADMIN') {
          return NextResponse.json(
            { error: 'Email address is required for non-admin accounts.' },
            { status: 400 }
          )
        }
        updateData.email = null
      } else {
        const emailError = validateEmail(nextEmail)
        if (emailError) {
          return NextResponse.json({ error: emailError }, { status: 400 })
        }
        const conflict = await prisma.user.findFirst({
          where: {
            OR: [{ email: nextEmail }, { username: nextEmail }],
            id: { not: targetUserId },
          },
          select: { id: true },
        })
        if (conflict) {
          return NextResponse.json(
            { error: 'An account with this email address already exists.' },
            { status: 409 }
          )
        }
        updateData.email = nextEmail
      }
    }

    if (body.name !== undefined) {
      updateData.name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null
    }

    if (body.role !== undefined) {
      const nextRole = typeof body.role === 'string' ? body.role.trim().toUpperCase() : ''
      if (!ALLOWED_ROLES.has(nextRole)) {
        return NextResponse.json({ error: 'Invalid role.' }, { status: 400 })
      }
      if (targetUserId === session.userId && nextRole !== 'ADMIN') {
        return NextResponse.json(
          { error: 'You cannot remove your own administrator role.' },
          { status: 400 }
        )
      }
      if (existing.role === 'ADMIN' && nextRole !== 'ADMIN') {
        const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } })
        if (adminCount <= 1) {
          return NextResponse.json(
            { error: 'Cannot demote the last administrator account.' },
            { status: 400 }
          )
        }
      }
      if (nextRole !== existing.role) {
        updateData.tokenVersion = { increment: 1 }
      }
      updateData.role = nextRole
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No valid fields provided for update.' }, { status: 400 })
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id: targetUserId },
        data: updateData,
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

      // Keep Candidate profile synchronized when editing a CANDIDATE user
      if (u.role === 'CANDIDATE') {
        const displayName = u.name || u.username
        await tx.candidate.upsert({
          where: { userId: u.id },
          update: {
            name: displayName,
            email: u.email,
          },
          create: {
            userId: u.id,
            name: displayName,
            email: u.email,
          },
        })
      }

      return u
    })

    createAuditLog({
      userId: session.userId,
      username: session.username,
      action: 'ADMIN_USER_UPDATED',
      entityType: 'User',
      entityId: String(targetUserId),
      status: 'SUCCESS',
      metadata: {
        previous: { username: existing.username, email: existing.email, role: existing.role },
        updated: { username: updated.username, email: updated.email, role: updated.role },
      },
    })

    return NextResponse.json({ success: true, user: updated })
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
    console.error('Admin update user error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/admin/users/[id] — delete user, owned documents/chunks, and unshared B2 objects
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const response = NextResponse.json({})
    const session = await getAppSession(request, response)

    if (!session?.isLoggedIn || !session.userId) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })
    }
    if (session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const { id } = await context.params
    const targetUserId = parseUserId(id)
    if (!targetUserId) {
      return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 })
    }

    const result = await deleteUserWithCleanup({
      targetUserId,
      actingAdminId: session.userId,
      actingAdminUsername: session.username,
    })

    return NextResponse.json(result.body, { status: result.status })
  } catch (err) {
    console.error('Admin delete user error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
