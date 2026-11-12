import { PrismaClient } from '@prisma/client'

function buildNormalizedDatabaseUrl(): string | undefined {
  const raw = process.env.DATABASE_URL?.trim()
  if (!raw) return undefined

  try {
    const parsed = new URL(raw)
    if (parsed.hostname.includes('neon')) {
      if (!parsed.searchParams.has('connect_timeout')) {
        parsed.searchParams.set('connect_timeout', '30')
      }
      if (!parsed.searchParams.has('pool_timeout')) {
        parsed.searchParams.set('pool_timeout', '30')
      }
      if (!parsed.searchParams.has('connection_limit') && parsed.hostname.includes('-pooler.')) {
        parsed.searchParams.set('connection_limit', '5')
      }
    }
    return parsed.toString()
  } catch {
    return raw
  }
}

const prismaClientSingleton = () => {
  const url = buildNormalizedDatabaseUrl()
  return url
    ? new PrismaClient({ datasources: { db: { url } } })
    : new PrismaClient()
}

declare const globalThis: {
  prismaGlobal: ReturnType<typeof prismaClientSingleton>;
} & typeof global;

const prisma = globalThis.prismaGlobal ?? prismaClientSingleton()

export default prisma

if (process.env.NODE_ENV !== 'production') globalThis.prismaGlobal = prisma

const TRANSIENT_DB_CODES = new Set(['P1001', 'P1008', 'P1017', 'P2024'])

export function isTransientDbError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const record = error as { code?: unknown; message?: unknown }
  if (typeof record.code === 'string' && TRANSIENT_DB_CODES.has(record.code)) {
    return true
  }
  const msg = typeof record.message === 'string' ? record.message.toLowerCase() : ''
  return (
    msg.includes('connection terminated unexpectedly') ||
    msg.includes("can't reach database server") ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('connection timed out') ||
    msg.includes('server closed the connection unexpectedly')
  )
}

/**
 * Retries idempotent database operations across transient Neon scale-to-zero wakeups.
 */
export async function withDbRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 2,
  baseDelayMs = 200
): Promise<T> {
  let attempt = 0
  while (true) {
    try {
      return await operation()
    } catch (err) {
      if (attempt >= maxRetries || !isTransientDbError(err)) {
        throw err
      }
      const delayMs = baseDelayMs * Math.pow(2, attempt)
      attempt += 1
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
}
