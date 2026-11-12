import prisma from '@/lib/db'
import {
  generateSecureOtp,
  hashOtp,
  OTP_COOLDOWN_SECONDS,
  OTP_EXPIRATION_MINUTES,
  OTP_MAX_ATTEMPTS,
  verifyOtpHash,
} from '@/lib/otp'

export type OtpPurpose = 'EMAIL_VERIFICATION' | 'PASSWORD_RESET' | 'PASSWORD_SETUP'

export async function checkEmailOtpQuota(email: string, purpose: OtpPurpose): Promise<{
  allowed: boolean
  reason?: 'cooldown' | 'hourly_limit'
  retryAfterSeconds?: number
}> {
  const recentOtp = await prisma.otpVerification.findFirst({
    where: {
      email,
      purpose,
      createdAt: { gt: new Date(Date.now() - OTP_COOLDOWN_SECONDS * 1000) },
    },
    orderBy: { createdAt: 'desc' },
  })

  if (recentOtp) {
    const remainingSeconds = Math.max(
      1,
      Math.ceil((recentOtp.createdAt.getTime() + OTP_COOLDOWN_SECONDS * 1000 - Date.now()) / 1000)
    )
    return { allowed: false, reason: 'cooldown', retryAfterSeconds: remainingSeconds }
  }

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
  const hourlyCount = await prisma.otpVerification.count({
    where: {
      email,
      purpose,
      createdAt: { gt: oneHourAgo },
    },
  })

  if (hourlyCount >= 5) {
    return { allowed: false, reason: 'hourly_limit', retryAfterSeconds: 3600 }
  }

  return { allowed: true }
}

export async function issueOtpForEmail(params: {
  userId?: number | null
  email: string
  purpose: OtpPurpose
}): Promise<{ otp: string; expiresAt: Date }> {
  const otp = generateSecureOtp()
  const otpHash = hashOtp(otp)
  const expiresAt = new Date(Date.now() + OTP_EXPIRATION_MINUTES * 60 * 1000)

  await prisma.$transaction([
    prisma.otpVerification.updateMany({
      where: { email: params.email, usedAt: null, purpose: params.purpose },
      data: { usedAt: new Date() },
    }),
    prisma.otpVerification.create({
      data: {
        userId: params.userId ?? null,
        email: params.email,
        otpHash,
        purpose: params.purpose,
        expiresAt,
        attempts: 0,
      },
    }),
  ])

  return { otp, expiresAt }
}

export type VerifyOtpResult =
  | { ok: true; otpRecordId: string; userId: number | null }
  | {
      ok: false
      reason: 'not_found' | 'expired' | 'max_attempts' | 'invalid_code' | 'already_used'
      error: string
      attempts?: number
      userId?: number | null
    }

/**
 * Atomically checks and consumes an OTP (or increments failure attempts atomically),
 * eliminating TOCTOU race conditions across concurrent requests.
 */
export async function verifyAndConsumeOtp(params: {
  email: string
  otp: string
  purpose: OtpPurpose
}): Promise<VerifyOtpResult> {
  const now = new Date()
  const otpRecord = await prisma.otpVerification.findFirst({
    where: {
      email: params.email,
      purpose: params.purpose,
      usedAt: null,
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      userId: true,
      otpHash: true,
      expiresAt: true,
      attempts: true,
    },
  })

  if (!otpRecord) {
    return {
      ok: false,
      reason: 'not_found',
      error: 'No active verification code found for this request. Please request a new code.',
    }
  }

  if (otpRecord.expiresAt <= now) {
    await prisma.otpVerification.updateMany({
      where: { id: otpRecord.id, usedAt: null },
      data: { usedAt: now },
    })
    return {
      ok: false,
      reason: 'expired',
      userId: otpRecord.userId,
      error: 'This verification code has expired. Please request a new code.',
    }
  }

  if (otpRecord.attempts >= OTP_MAX_ATTEMPTS) {
    await prisma.otpVerification.updateMany({
      where: { id: otpRecord.id, usedAt: null },
      data: { usedAt: now },
    })
    return {
      ok: false,
      reason: 'max_attempts',
      userId: otpRecord.userId,
      error: 'Too many incorrect attempts. This code has been invalidated. Please request a new code.',
    }
  }

  const isValid = verifyOtpHash(params.otp, otpRecord.otpHash)
  if (!isValid) {
    const updatedRows = await prisma.$queryRaw<Array<{ attempts: number; usedAt: Date | null }>>`
      UPDATE "OtpVerification"
      SET "attempts" = "attempts" + 1,
          "usedAt" = CASE WHEN "attempts" + 1 >= ${OTP_MAX_ATTEMPTS} THEN NOW() ELSE "usedAt" END
      WHERE "id" = ${otpRecord.id}
        AND "usedAt" IS NULL
        AND "attempts" < ${OTP_MAX_ATTEMPTS}
      RETURNING "attempts", "usedAt"
    `

    const updated = updatedRows[0]
    const attempts = updated ? Number(updated.attempts) : OTP_MAX_ATTEMPTS
    const remaining = Math.max(0, OTP_MAX_ATTEMPTS - attempts)

    if (!updated || remaining === 0) {
      return {
        ok: false,
        reason: 'max_attempts',
        attempts,
        userId: otpRecord.userId,
        error: 'Too many incorrect attempts. This code has been invalidated. Please request a new code.',
      }
    }

    return {
      ok: false,
      reason: 'invalid_code',
      attempts,
      userId: otpRecord.userId,
      error: `Incorrect verification code. ${remaining} attempt(s) remaining.`,
    }
  }

  // Atomic consumption guard: prevents parallel double-spend of the same OTP
  const consumed = await prisma.otpVerification.updateMany({
    where: {
      id: otpRecord.id,
      usedAt: null,
      expiresAt: { gt: new Date() },
      attempts: { lt: OTP_MAX_ATTEMPTS },
    },
    data: { usedAt: new Date() },
  })

  if (consumed.count !== 1) {
    return {
      ok: false,
      reason: 'already_used',
      userId: otpRecord.userId,
      error: 'This verification code has already been used or expired. Please request a new code.',
    }
  }

  return {
    ok: true,
    otpRecordId: otpRecord.id,
    userId: otpRecord.userId,
  }
}
