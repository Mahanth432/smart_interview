import prisma from '@/lib/db'

export interface CreateAuditLogParams {
  userId?: number | null
  username?: string | null
  action: string
  entityType?: string | null
  entityId?: string | null
  status?: 'SUCCESS' | 'FAILURE'
  metadata?: Record<string, unknown> | null
  ipAddress?: string | null
  userAgent?: string | null
}

const SENSITIVE_PATTERNS = [
  /password/i,
  /password_?hash/i,
  /passwd/i,
  /secret/i,
  /api_?key/i,
  /access_?token/i,
  /refresh_?token/i,
  /session_?token/i,
  /cookie/i,
  /authorization/i,
  /bearer/i,
  /credential/i,
  /private_?key/i,
]

export function sanitizeMetadata(
  obj: unknown,
  depth = 0
): unknown {
  if (obj === null || obj === undefined || depth > 5) {
    return null
  }

  if (typeof obj === 'string') {
    // Truncate long strings to keep audit logs lightweight
    return obj.length > 300 ? obj.slice(0, 300) + '...[truncated]' : obj
  }

  if (typeof obj === 'number' || typeof obj === 'boolean') {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj
      .slice(0, 20) // Cap array elements
      .map((item) => sanitizeMetadata(item, depth + 1))
  }

  if (typeof obj === 'object') {
    const sanitized: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      // Check if key matches sensitive patterns
      const isSensitive = SENSITIVE_PATTERNS.some((pattern) => pattern.test(key))
      if (isSensitive) {
        sanitized[key] = '[REDACTED_SENSITIVE_DATA]'
      } else {
        sanitized[key] = sanitizeMetadata(value, depth + 1)
      }
    }
    return sanitized
  }

  return String(obj)
}

/**
 * Creates an audit log record safely and asynchronously.
 * Guaranteed best-effort/non-blocking execution (never throws).
 */
export function extractRequestMetadata(request: Request): {
  ipAddress: string | null
  userAgent: string | null
} {
  const forwarded = request.headers.get('x-forwarded-for')
  const firstForwardedIp = forwarded ? forwarded.split(',')[0]?.trim() : ''
  const realIp = request.headers.get('x-real-ip')?.trim() || ''
  const ipAddress = firstForwardedIp || realIp || null

  const rawUa = request.headers.get('user-agent')?.trim() || ''
  const userAgent = rawUa ? rawUa.slice(0, 250) : null

  return { ipAddress, userAgent }
}

export async function createAuditLog(params: CreateAuditLogParams): Promise<void> {
  try {
    const sanitizedMeta = params.metadata ? sanitizeMetadata(params.metadata) : null

    await prisma.auditLog.create({
      data: {
        userId: params.userId ?? null,
        username: params.username ?? null,
        action: params.action,
        entityType: params.entityType ?? null,
        entityId: params.entityId ?? null,
        status: params.status ?? 'SUCCESS',
        metadata: (sanitizedMeta as object) ?? undefined,
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
      },
    })
  } catch (err) {
    // Best effort: Log error to console, but never throw so primary operation continues
    console.warn('Audit log creation warning (non-blocking):', err)
  }
}
