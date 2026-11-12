import crypto from 'crypto'
import { getRequiredSessionSecret } from './auth'

export const OTP_EXPIRATION_MINUTES = 5
export const OTP_COOLDOWN_SECONDS = 60
export const OTP_MAX_ATTEMPTS = 5

/**
 * Generate a cryptographically secure 6-digit numeric OTP.
 * Never uses Math.random().
 */
export function generateSecureOtp(): string {
  const num = crypto.randomInt(100000, 1000000)
  return num.toString()
}

/**
 * Hash an OTP using HMAC-SHA256 keyed by the required SESSION_SECRET.
 * Avoids storing plaintext OTPs in the database.
 */
export function hashOtp(otp: string): string {
  const secret = getRequiredSessionSecret('otp-hmac')
  return crypto.createHmac('sha256', secret).update(otp).digest('hex')
}

/**
 * Hash an arbitrary single-use token (e.g., password reset token) for safe DB storage.
 */
export function hashToken(token: string): string {
  const secret = getRequiredSessionSecret('token-hmac')
  return crypto.createHmac('sha256', secret).update(token).digest('hex')
}

/**
 * Verifies an OTP against a stored hash in constant time to prevent timing attacks.
 */
export function verifyOtpHash(otp: string, storedHash: string): boolean {
  if (!otp || !storedHash) return false
  const computed = hashOtp(otp)
  try {
    const a = Buffer.from(computed, 'hex')
    const b = Buffer.from(storedHash, 'hex')
    if (a.length !== b.length) return false
    return crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}
