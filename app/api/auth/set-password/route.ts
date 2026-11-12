import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import prisma from '@/lib/db'
import { sendOtpEmail } from '@/lib/mail'
import { createAuditLog } from '@/lib/audit-log'
import { verifySameOrigin } from '@/lib/csrf'
import { checkEmailOtpQuota, issueOtpForEmail, verifyAndConsumeOtp } from '@/lib/otp-store'
import { checkRateLimit, extractClientIp, rateLimitResponse } from '@/lib/rate-limit'
import { normalizeEmail, validateEmail, validatePasswordStrength } from '@/lib/validation/user'

const GENERIC_OTP_SENT_RESPONSE = {
  success: true,
  otpRequired: true,
  message:
    'If an eligible account requires password setup, a 6-digit verification code has been sent to your email.',
}

export async function POST(request: Request) {
  try {
    const csrfError = verifySameOrigin(request)
    if (csrfError) return csrfError

    const clientIp = extractClientIp(request)
    const ipLimit = await checkRateLimit({
      key: `set-password:ip:${clientIp}`,
      limit: 10,
      windowSeconds: 15 * 60,
    })
    if (!ipLimit.allowed) {
      return rateLimitResponse(
        ipLimit.retryAfterSeconds,
        'Too many password setup attempts. Please wait before trying again.'
      )
    }

    const body = await request.json()
    const { action, email, otp, newPassword } = body

    const normalizedEmail = normalizeEmail(email)
    const emailError = validateEmail(normalizedEmail)
    if (emailError) {
      return NextResponse.json({ error: emailError }, { status: 400 })
    }

    // Mode 1: Request OTP for legacy passwordless account setup (never mutates passwordHash)
    if (action === 'request-otp') {
      const quota = await checkEmailOtpQuota(normalizedEmail, 'PASSWORD_SETUP')
      if (!quota.allowed) {
        if (quota.reason === 'cooldown') {
          return rateLimitResponse(
            quota.retryAfterSeconds || 60,
            `Please wait ${quota.retryAfterSeconds || 60} seconds before requesting another code.`
          )
        }
        return rateLimitResponse(
          quota.retryAfterSeconds || 3600,
          'Too many setup requests for this email. Please try again in an hour.'
        )
      }

      const user = await prisma.user.findFirst({
        where: {
          OR: [
            { email: normalizedEmail },
            { username: normalizedEmail },
            { candidate: { email: normalizedEmail } },
          ],
        },
        orderBy: { id: 'asc' },
      })

      if (user && user.passwordHash === null) {
        const { otp: code } = await issueOtpForEmail({
          userId: user.id,
          email: normalizedEmail,
          purpose: 'PASSWORD_SETUP',
        })

        const sent = await sendOtpEmail({
          email: normalizedEmail,
          otp: code,
          role: user.role,
          purpose: 'EMAIL_VERIFICATION',
        })

        if (!sent && process.env.NODE_ENV === 'production') {
          return NextResponse.json(
            { error: 'Failed to send verification email. Please try again.' },
            { status: 500 }
          )
        }

        createAuditLog({
          userId: user.id,
          username: user.username,
          action: 'PASSWORD_SETUP_OTP_SENT',
          status: 'SUCCESS',
          metadata: { email: normalizedEmail, role: user.role },
        })
      }

      // Uniform non-enumerating response whether user exists, already has password, or needs setup
      return NextResponse.json(GENERIC_OTP_SENT_RESPONSE)
    }

    // Mode 2: Verify OTP BEFORE writing passwordHash
    if (!otp || !newPassword) {
      return NextResponse.json(
        { error: 'Verification code (OTP) and new password are required.' },
        { status: 400 }
      )
    }

    const cleanOtp = String(otp).trim()
    if (!/^\d{6}$/.test(cleanOtp)) {
      return NextResponse.json(
        { error: 'Verification code must be a 6-digit number.' },
        { status: 400 }
      )
    }

    const passwordError = validatePasswordStrength(newPassword)
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 })
    }

    // Consume OTP atomically BEFORE checking or mutating passwordHash
    const otpResult = await verifyAndConsumeOtp({
      email: normalizedEmail,
      otp: cleanOtp,
      purpose: 'PASSWORD_SETUP',
    })

    if (!otpResult.ok) {
      createAuditLog({
        userId: otpResult.userId ?? undefined,
        action: 'PASSWORD_SETUP_OTP_FAILED',
        status: 'FAILURE',
        metadata: { email: normalizedEmail, reason: otpResult.reason },
      })
      return NextResponse.json({ error: otpResult.error }, { status: 400 })
    }

    const passwordHash = await bcrypt.hash(String(newPassword), 12)

    const updatedUser = await prisma.$transaction(async (tx) => {
      const target = otpResult.userId
        ? await tx.user.findUnique({ where: { id: otpResult.userId } })
        : await tx.user.findFirst({
            where: {
              OR: [
                { email: normalizedEmail },
                { username: normalizedEmail },
                { candidate: { email: normalizedEmail } },
              ],
            },
            orderBy: { id: 'asc' },
          })

      if (!target || target.passwordHash !== null) {
        return null
      }

      // Atomic guard: only update if passwordHash is still null
      const claim = await tx.user.updateMany({
        where: { id: target.id, passwordHash: null },
        data: {
          passwordHash,
          emailVerified: true,
          tokenVersion: { increment: 1 },
        },
      })

      if (claim.count !== 1) {
        return null
      }

      await tx.otpVerification.updateMany({
        where: { email: normalizedEmail, usedAt: null },
        data: { usedAt: new Date() },
      })

      return target
    })

    if (!updatedUser) {
      return NextResponse.json(
        { error: 'Invalid setup request or password already configured.' },
        { status: 400 }
      )
    }

    const auditAction =
      updatedUser.role === 'CANDIDATE' ? 'CANDIDATE_PASSWORD_SET' : 'INTERVIEWER_PASSWORD_SET'
    createAuditLog({
      userId: updatedUser.id,
      username: updatedUser.username,
      action: auditAction,
      status: 'SUCCESS',
      metadata: { email: normalizedEmail, role: updatedUser.role },
    })

    return NextResponse.json({
      success: true,
      message: 'Your password has been configured. Please sign in with your new password.',
    })
  } catch (err) {
    console.error('set-password error:', err)
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 })
  }
}
