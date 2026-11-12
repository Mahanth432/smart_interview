import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import prisma from '@/lib/db'
import { hashToken } from '@/lib/otp'
import { verifyAndConsumeOtp, type OtpPurpose } from '@/lib/otp-store'
import { establishUserSession } from '@/lib/auth-server'
import { createAuditLog } from '@/lib/audit-log'
import { verifySameOrigin } from '@/lib/csrf'
import { checkRateLimit, extractClientIp, rateLimitResponse } from '@/lib/rate-limit'

export async function POST(req: NextRequest) {
  try {
    const csrfError = verifySameOrigin(req)
    if (csrfError) return csrfError

    const clientIp = extractClientIp(req)
    const ipLimit = await checkRateLimit({
      key: `verify-otp:ip:${clientIp}`,
      limit: 20,
      windowSeconds: 15 * 60,
    })
    if (!ipLimit.allowed) {
      return rateLimitResponse(
        ipLimit.retryAfterSeconds,
        'Too many verification attempts. Please wait before trying again.'
      )
    }

    const body = await req.json()
    const { email, otp, role, purpose = 'EMAIL_VERIFICATION' } = body

    if (!email || !otp) {
      return NextResponse.json({ error: 'Email and verification code are required.' }, { status: 400 })
    }

    const normalizedEmail = String(email).trim().toLowerCase()
    const cleanOtp = String(otp).trim()
    const targetPurpose: OtpPurpose =
      purpose === 'PASSWORD_RESET' ? 'PASSWORD_RESET' : 'EMAIL_VERIFICATION'

    if (!/^\d{6}$/.test(cleanOtp)) {
      return NextResponse.json({ error: 'Verification code must be a 6-digit number.' }, { status: 400 })
    }

    const result = await verifyAndConsumeOtp({
      email: normalizedEmail,
      otp: cleanOtp,
      purpose: targetPurpose,
    })

    if (!result.ok) {
      createAuditLog({
        userId: result.userId ?? undefined,
        action: targetPurpose === 'PASSWORD_RESET' ? 'PASSWORD_RESET_OTP_FAILED' : 'EMAIL_VERIFICATION_FAILED',
        status: 'FAILURE',
        metadata: { email: normalizedEmail, reason: result.reason, attempts: result.attempts, purpose: targetPurpose },
      })
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    let user = result.userId
      ? await prisma.user.findUnique({ where: { id: result.userId } })
      : null

    if (!user) {
      user = await prisma.user.findFirst({
        where: {
          OR: [
            { email: normalizedEmail },
            { username: normalizedEmail },
            { candidate: { email: normalizedEmail } },
          ],
        },
        orderBy: { id: 'asc' },
      })
    }

    if (!user) {
      return NextResponse.json({ error: 'Invalid or expired verification code.' }, { status: 400 })
    }

    // --- FLOW: PASSWORD RESET ---
    if (targetPurpose === 'PASSWORD_RESET') {
      const resetToken = crypto.randomBytes(32).toString('hex')
      const tokenHash = hashToken(resetToken)
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

      await prisma.$transaction([
        // Opportunistic cleanup of expired tokens + invalidate prior unused reset tokens for user
        prisma.passwordResetToken.deleteMany({
          where: {
            OR: [{ expiresAt: { lt: new Date() } }, { userId: user.id, usedAt: null }],
          },
        }),
        prisma.passwordResetToken.create({
          data: {
            tokenHash,
            userId: user.id,
            email: normalizedEmail,
            expiresAt,
          },
        }),
      ])

      createAuditLog({
        userId: user.id,
        username: user.username,
        action: 'PASSWORD_RESET_OTP_VERIFIED',
        status: 'SUCCESS',
        metadata: { email: normalizedEmail },
      })

      return NextResponse.json({
        success: true,
        resetToken,
        message: 'Verification code confirmed. You can now set a new password.',
      })
    }

    // --- FLOW: EMAIL VERIFICATION ---
    if (role && user.role !== role) {
      return NextResponse.json({ error: 'Account role mismatch.' }, { status: 403 })
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { emailVerified: true },
      })

      if (user.role === 'CANDIDATE') {
        const existingCandidate = await tx.candidate.findUnique({
          where: { userId: user.id },
        })
        if (!existingCandidate) {
          await tx.candidate.create({
            data: {
              userId: user.id,
              name: user.name || user.username,
              email: normalizedEmail,
            },
          })
        }
      }
    })

    const redirectMap: Record<string, string> = {
      ADMIN: '/admin',
      INTERVIEWER: '/dashboard',
      CANDIDATE: '/candidate',
    }
    const redirectUrl = redirectMap[user.role] || '/dashboard'
    const response = NextResponse.json({ success: true, redirect: redirectUrl })
    await establishUserSession(req, response, user)

    createAuditLog({
      userId: user.id,
      username: user.username,
      action: 'USER_EMAIL_VERIFIED',
      status: 'SUCCESS',
      metadata: { role: user.role, email: normalizedEmail },
    })

    return response
  } catch (err) {
    console.error('verify-otp error:', err)
    return NextResponse.json({ error: 'Failed to verify code.' }, { status: 500 })
  }
}
