import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import prisma from '@/lib/db'
import { createAuditLog } from '@/lib/audit-log'
import { verifySameOrigin } from '@/lib/csrf'
import { hashToken } from '@/lib/otp'
import { checkRateLimit, extractClientIp, rateLimitResponse } from '@/lib/rate-limit'
import { validatePasswordStrength } from '@/lib/validation/user'

export async function POST(request: Request) {
  try {
    const csrfError = verifySameOrigin(request)
    if (csrfError) return csrfError

    const clientIp = extractClientIp(request)
    const ipLimit = await checkRateLimit({
      key: `reset-password:ip:${clientIp}`,
      limit: 10,
      windowSeconds: 15 * 60,
    })
    if (!ipLimit.allowed) {
      return rateLimitResponse(
        ipLimit.retryAfterSeconds,
        'Too many password reset attempts. Please wait before trying again.'
      )
    }

    const body = await request.json()
    const { resetToken, newPassword } = body

    if (!resetToken || !newPassword) {
      return NextResponse.json(
        { error: 'Reset token and new password are required.' },
        { status: 400 }
      )
    }

    const passwordError = validatePasswordStrength(newPassword)
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 })
    }

    const tokenHash = hashToken(String(resetToken))
    const passwordHash = await bcrypt.hash(String(newPassword), 12)

    // Atomically consume the reset token, update passwordHash, and increment tokenVersion (revoking active sessions)
    const txResult = await prisma.$transaction(async (tx) => {
      const now = new Date()
      const consumed = await tx.passwordResetToken.updateMany({
        where: {
          tokenHash,
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      })

      if (consumed.count !== 1) {
        return null
      }

      const tokenRecord = await tx.passwordResetToken.findUnique({
        where: { tokenHash },
        include: { user: true },
      })
      if (!tokenRecord || !tokenRecord.user) {
        return null
      }

      const updatedUser = await tx.user.update({
        where: { id: tokenRecord.userId },
        data: {
          passwordHash,
          emailVerified: true,
          tokenVersion: { increment: 1 },
        },
      })

      await tx.otpVerification.updateMany({
        where: {
          email: tokenRecord.email,
          usedAt: null,
        },
        data: { usedAt: now },
      })

      return { user: updatedUser, email: tokenRecord.email }
    })

    if (!txResult) {
      return NextResponse.json(
        { error: 'Invalid or expired password reset authorization. Please request a new code.' },
        { status: 400 }
      )
    }

    createAuditLog({
      userId: txResult.user.id,
      username: txResult.user.username,
      action: 'PASSWORD_RESET_SUCCESS',
      status: 'SUCCESS',
      metadata: { role: txResult.user.role, email: txResult.email },
    })

    return NextResponse.json({
      success: true,
      message: 'Your password has been reset successfully. Please sign in with your new password.',
    })
  } catch (err) {
    console.error('reset-password error:', err)
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 })
  }
}
