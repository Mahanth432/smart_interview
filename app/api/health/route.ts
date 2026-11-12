import { NextResponse } from 'next/server'
import prisma, { withDbRetry } from '@/lib/db'
import { isB2Configured } from '@/lib/storage/b2'

export const dynamic = 'force-dynamic'

/**
 * GET /api/health
 * Public health probe reporting DB connectivity and safe non-secret subsystem status.
 */
export async function GET() {
  const startedAt = performance.now()
  let dbOk = false
  let dbLatencyMs: number | null = null

  try {
    await withDbRetry(() => prisma.$queryRaw`SELECT 1`)
    dbOk = true
    dbLatencyMs = Math.round((performance.now() - startedAt) * 10) / 10
  } catch (err) {
    console.error('[Health] Database probe failed:', err instanceof Error ? err.message : 'error')
  }

  const sessionSecretConfigured =
    typeof process.env.SESSION_SECRET === 'string' && process.env.SESSION_SECRET.trim().length >= 32
  const storageConfigured = isB2Configured()
  const llmEnvConfigured = Boolean(
    process.env.GEMINI_API_KEY?.trim() || process.env.GROQ_API_KEY?.trim()
  )

  const status = dbOk ? 'ok' : 'degraded'

  return NextResponse.json(
    {
      status,
      database: {
        ok: dbOk,
        latencyMs: dbLatencyMs,
      },
      subsystems: {
        storageConfigured,
        llmEnvConfigured,
        sessionSecretConfigured,
        smtpConfigured: Boolean(
          (process.env.SMTP_USER || process.env.SMTP_EMAIL) &&
            (process.env.SMTP_PASS || process.env.SMTP_PASSWORD)
        ),
      },
      timestamp: new Date().toISOString(),
    },
    { status: dbOk ? 200 : 503 }
  )
}
