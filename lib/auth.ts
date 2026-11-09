import { SessionOptions, getIronSession, IronSession } from 'iron-session'
import { cookies } from 'next/headers'
import { cache } from 'react'

declare global {
  var __SERVER_INSTANCE_ID: string | undefined;
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
}

export const defaultSession: SessionData = {
  isLoggedIn: false,
}

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET || 'complex_password_at_least_32_characters_long',
  cookieName: 'smartinterview_session',
  cookieOptions: {
    // secure: true should be used in production (HTTPS) but can be false for local dev
    secure: process.env.NODE_ENV === 'production',
  },
}

// Per-request memoized session lookup for Server Components (layout + pages in the same request)
const getCachedServerSession = cache(async (): Promise<IronSession<SessionData>> => {
  const t0 = performance.now()
  const cookieStore = await cookies()
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions)

  if (session.isLoggedIn === undefined) {
    session.isLoggedIn = false
  }

  if (process.env.NODE_ENV === 'development' && typeof process !== 'undefined' && process.env.NEXT_RUNTIME !== 'edge') {
    if (session.isLoggedIn && session.instanceId !== getServerInstanceId()) {
      session.isLoggedIn = false
      session.userId = undefined
      session.username = undefined
      session.role = undefined
      session.instanceId = undefined
    }
  }

  if (process.env.NODE_ENV === 'development') {
    console.log(`[DEV TIMING] getCachedServerSession: ${(performance.now() - t0).toFixed(1)}ms (user=${session.username || 'anon'})`)
  }

  return session
})

// A wrapper around getIronSession that enforces the instanceId check.
// If the session's instanceId doesn't match the current SERVER_INSTANCE_ID,
// it treats the session as invalid (clears it) and returns defaultSession.
export async function getAppSession(
  req?: Request | null,
  res?: Response | null
): Promise<IronSession<SessionData>> {
  if (req && res) {
    const session = await getIronSession<SessionData>(req, res, sessionOptions)
    if (session.isLoggedIn === undefined) {
      session.isLoggedIn = false
    }
    if (process.env.NODE_ENV === 'development' && typeof process !== 'undefined' && process.env.NEXT_RUNTIME !== 'edge') {
      if (session.isLoggedIn && session.instanceId !== getServerInstanceId()) {
        session.isLoggedIn = false
        session.userId = undefined
        session.username = undefined
        session.role = undefined
        session.instanceId = undefined
        await session.save()
      }
    }
    return session
  }

  return getCachedServerSession()
}

