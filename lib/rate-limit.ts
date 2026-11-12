import { NextResponse } from 'next/server'
import prisma from '@/lib/db'

export interface RateLimitOptions {
  key: string
  limit: number
  windowSeconds: number
}

export interface RateLimitResult {
  allowed: boolean
  count: number
  limit: number
  remaining: number
  retryAfterSeconds: number
  resetAt: Date
}

export function extractClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first.slice(0, 64)
  }
  const realIp = request.headers.get('x-real-ip')?.trim()
  if (realIp) return realIp.slice(0, 64)
  return 'unknown'
}

/**
 * Atomic PostgreSQL-backed fixed-window rate limiter.
 * Safe under concurrent multi-instance requests (single atomic UPSERT RETURNING statement).
 */
export async function checkRateLimit({
  key,
  limit,
  windowSeconds,
}: RateLimitOptions): Promise<RateLimitResult> {
  const safeLimit = Math.max(1, Math.floor(limit))
  const safeWindow = Math.max(1, Math.floor(windowSeconds))
  const nextResetAt = new Date(Date.now() + safeWindow * 1000)

  const rows = await prisma.$queryRaw<Array<{ count: number; resetAt: Date }>>`
    INSERT INTO "RateLimit" ("key", "count", "resetAt", "updatedAt")
    VALUES (${key}, 1, ${nextResetAt}, NOW())
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "RateLimit"."resetAt" <= NOW() THEN 1
        ELSE "RateLimit"."count" + 1
      END,
      "resetAt" = CASE
        WHEN "RateLimit"."resetAt" <= NOW() THEN ${nextResetAt}
        ELSE "RateLimit"."resetAt"
      END,
      "updatedAt" = NOW()
    RETURNING "count", "resetAt"
  `

  const row = rows[0] ?? { count: 1, resetAt: nextResetAt }
  const count = Number(row.count)
  const resetAt = row.resetAt instanceof Date ? row.resetAt : new Date(row.resetAt)
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000))
  const allowed = count <= safeLimit

  return {
    allowed,
    count,
    limit: safeLimit,
    remaining: Math.max(0, safeLimit - count),
    retryAfterSeconds,
    resetAt,
  }
}

export function rateLimitResponse(
  retryAfterSeconds: number,
  message = 'Too many requests. Please wait before trying again.'
) {
  return NextResponse.json(
    { error: message, retryAfterSeconds },
    {
      status: 429,
      headers: {
        'Retry-After': String(Math.max(1, retryAfterSeconds)),
      },
    }
  )
}
