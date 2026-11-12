import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { sendOtpEmail } from '@/lib/mail'
import { createAuditLog } from '@/lib/audit-log'
import { verifySameOrigin } from '@/lib/csrf'
import { checkEmailOtpQuota, issueOtpForEmail, type OtpPurpose } from '@/lib/otp-store'
import { checkRateLimit, extractClientIp, rateLimitResponse } from '@/lib/rate-limit'

function resolvePurpose(raw: unknown): OtpPurpose {
  if (raw === 'PASSWORD_RESET') return 'PASSWORD_RESET'
  if (raw === 'PASSWORD_SETUP') return 'PASSWORD_SETUP'
  return 'EMAIL_VERIFICATION'
}

export async function POST(req: NextRequest) {
  try {
    const csrfError = verifySameOrigin(req)
    if (csrfError) return csrfError

    const clientIp = extractClientIp(req)
    const ipLimit = await checkRateLimit({
      key: `request-otp:ip:${clientIp}`,
      limit: 15,
      windowSeconds: 15 * 60,
    })
    if (!ipLimit.allowed) {
      return rateLimitResponse(
        ipLimit.retryAfterSeconds,
        'Too many verification code requests. Please wait before trying again.'
      )
    }

    const body = await req.json()
    const { email, role, purpose } = body

    if (!email) {
      return NextResponse.json({ error: 'Email is required.' }, { status: 400 })
    }

    const normalizedEmail = String(email).trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
    }

    const otpPurpose = resolvePurpose(purpose)

    const quota = await checkEmailOtpQuota(normalizedEmail, otpPurpose)
    if (!quota.allowed) {
      if (quota.reason === 'cooldown') {
        return rateLimitResponse(
          quota.retryAfterSeconds || 60,
          `Please wait ${quota.retryAfterSeconds || 60} seconds before requesting another code.`
        )
      }
      return rateLimitResponse(
        quota.retryAfterSeconds || 3600,
        'Too many requests for this email. Please try again in an hour.'
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
      include: { candidate: true },
    })

    const genericSuccess = {
      success: true,
      message: 'If an eligible account exists with this email, a verification code has been sent.',
    }

    if (otpPurpose === 'PASSWORD_RESET') {
      if (!user) {
        return NextResponse.json(genericSuccess)
      }

      const { otp } = await issueOtpForEmail({
        userId: user.id,
        email: normalizedEmail,
        purpose: 'PASSWORD_RESET',
      })

      const sent = await sendOtpEmail({
        email: normalizedEmail,
        otp,
        role: user.role,
        purpose: 'PASSWORD_RESET',
      })
      if (!sent && process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: 'Email delivery service unavailable.' }, { status: 500 })
      }

      createAuditLog({
        userId: user.id,
        username: user.username,
        action: 'PASSWORD_RESET_OTP_REQUESTED',
        status: 'SUCCESS',
        metadata: { email: normalizedEmail },
      })

      return NextResponse.json(genericSuccess)
    }

    if (otpPurpose === 'PASSWORD_SETUP') {
      if (!user || user.passwordHash !== null) {
        return NextResponse.json(genericSuccess)
      }

      const { otp } = await issueOtpForEmail({
        userId: user.id,
        email: normalizedEmail,
        purpose: 'PASSWORD_SETUP',
      })

      const sent = await sendOtpEmail({
        email: normalizedEmail,
        otp,
        role: user.role,
        purpose: 'EMAIL_VERIFICATION',
      })
      if (!sent && process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: 'Email delivery service unavailable.' }, { status: 500 })
      }

      createAuditLog({
        userId: user.id,
        username: user.username,
        action: 'PASSWORD_SETUP_OTP_REQUESTED',
        status: 'SUCCESS',
        metadata: { email: normalizedEmail },
      })

      return NextResponse.json(genericSuccess)
    }

    // EMAIL_VERIFICATION flow: never leak admin existence/role differences
    if (!user || user.role === 'ADMIN' || (role && user.role !== role)) {
      return NextResponse.json(genericSuccess)
    }

    const { otp } = await issueOtpForEmail({
      userId: user.id,
      email: normalizedEmail,
      purpose: 'EMAIL_VERIFICATION',
    })

    const sent = await sendOtpEmail({
      email: normalizedEmail,
      otp,
      role: user.role,
      purpose: 'EMAIL_VERIFICATION',
    })
    if (!sent && process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Failed to send verification email.' }, { status: 500 })
    }

    createAuditLog({
      userId: user.id,
      username: user.username,
      action: 'EMAIL_VERIFICATION_OTP_REQUESTED',
      status: 'SUCCESS',
      metadata: { email: normalizedEmail, role: user.role },
    })

    return NextResponse.json(genericSuccess)
  } catch (err) {
    console.error('request-otp error:', err)
    return NextResponse.json({ error: 'Failed to process OTP request.' }, { status: 500 })
  }
}
