import { SessionOptions, getIronSession, IronSession } from 'iron-session'
import { cookies } from 'next/headers'
import { cache } from 'react'

export const DEFAULT_SESSION_TTL_SECONDS = 24 * 60 * 60 // 24 hours

declare global {
  var __SERVER_INSTANCE_ID: string | undefined
  var __DEV_EPHEMERAL_SESSION_SECRET: string | undefined
}

/**
 * Resolve the session encryption/signing secret safely across Edge and Node runtimes.
 * Never falls back to a hardcoded static literal in production.
 */
export function getRequiredSessionSecret(purpose = 'session'): string {
  const configured = process.env.SESSION_SECRET?.trim()
  if (configured && configured.length >= 32) {
    return configured
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `[Security] SESSION_SECRET environment variable must be configured (at least 32 characters) for ${purpose}.`
    )
  }

  // Non-production dev/test only: generate a per-process ephemeral secret instead of a static literal
  if (!globalThis.__DEV_EPHEMERAL_SESSION_SECRET) {
    const bytes = new Uint8Array(32)
    globalThis.crypto.getRandomValues(bytes)
    globalThis.__DEV_EPHEMERAL_SESSION_SECRET = Array.from(bytes, (b) =>
      b.toString(16).padStart(2, '0')
    ).join('')
  }
  return globalThis.__DEV_EPHEMERAL_SESSION_SECRET
}

// Generate a unique ID for this Node.js server instance.
// Using globalThis ensures it survives Next.js dev server hot module reloading.
export function getServerInstanceId() {
  if (typeof process !== 'undefined' && process.env.NEXT_RUNTIME !== 'edge') {
    if (!globalThis.__SERVER_INSTANCE_ID) {
      globalThis.__SERVER_INSTANCE_ID = `instance-${Date.now()}-${Math.floor(Math.random() * 1000000)}`
    }
    return globalThis.__SERVER_INSTANCE_ID
  }
  return 'edge-ignored'
}

export interface SessionData {
  userId?: number
  username?: string
  role?: string
  isLoggedIn: boolean
  instanceId?: string
  tokenVersion?: number
  expiresAt?: number
}

export const defaultSession: SessionData = {
  isLoggedIn: false,
}

export function getSessionOptions(ttlSeconds = DEFAULT_SESSION_TTL_SECONDS): SessionOptions {
  const safeTtl =
    Number.isFinite(ttlSeconds) && ttlSeconds >= 60 ? Math.floor(ttlSeconds) : DEFAULT_SESSION_TTL_SECONDS

  return {
    password: getRequiredSessionSecret('iron-session'),
    cookieName: 'smartinterview_session',
    ttl: safeTtl,
    cookieOptions: {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
    },
  }
}

export function clearSessionFields(session: SessionData) {
  session.isLoggedIn = false
  session.userId = undefined
  session.username = undefined
  session.role = undefined
  session.instanceId = undefined
  session.tokenVersion = undefined
  session.expiresAt = undefined
}

function isSessionExpiredOrInvalidInstance(session: SessionData): boolean {
  if (!session.isLoggedIn) return false
  if (typeof session.expiresAt === 'number' && Date.now() > session.expiresAt) {
    return true
  }
  if (
    process.env.NODE_ENV === 'development' &&
    typeof process !== 'undefined' &&
    process.env.NEXT_RUNTIME !== 'edge' &&
    session.instanceId !== getServerInstanceId()
  ) {
    return true
  }
  return false
}

// Per-request memoized session lookup for Server Components (layout + pages in the same request)
const getCachedServerSession = cache(async (): Promise<IronSession<SessionData>> => {
  const cookieStore = await cookies()
  const session = await getIronSession<SessionData>(cookieStore, getSessionOptions())

  if (session.isLoggedIn === undefined) {
    session.isLoggedIn = false
  }

  if (isSessionExpiredOrInvalidInstance(session)) {
    clearSessionFields(session)
  }

  return session
})

// Wrapper around getIronSession enforcing expiration and dev instance checks
export async function getAppSession(
  req?: Request | null,
  res?: Response | null,
  ttlSeconds?: number
): Promise<IronSession<SessionData>> {
  if (req && res) {
    const session = await getIronSession<SessionData>(req, res, getSessionOptions(ttlSeconds))
    if (session.isLoggedIn === undefined) {
      session.isLoggedIn = false
    }
    if (isSessionExpiredOrInvalidInstance(session)) {
      clearSessionFields(session)
      await session.save()
    }
    return session
  }

  return getCachedServerSession()
}
