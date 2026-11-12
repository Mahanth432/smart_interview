import prisma from '@/lib/db'
import {
  clearSessionFields,
  DEFAULT_SESSION_TTL_SECONDS,
  getAppSession,
  getServerInstanceId,
  type SessionData,
} from '@/lib/auth'
import type { IronSession } from 'iron-session'

const DEFAULT_TIMEOUT_HOURS = Math.floor(DEFAULT_SESSION_TTL_SECONDS / 3600)

export async function getConfiguredSessionTimeoutHours(): Promise<number> {
  try {
    const setting = await prisma.appSettings.findUnique({
      where: { key: 'auth.session_timeout_hours' },
      select: { value: true },
    })
    const parsed = setting ? Number(setting.value) : NaN
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 336) {
      return parsed
    }
  } catch {
    // Fall back safely if settings cannot be queried
  }
  return DEFAULT_TIMEOUT_HOURS
}

export async function establishUserSession(
  req: Request,
  res: Response,
  user: { id: number; username: string; role: string; tokenVersion?: number }
): Promise<IronSession<SessionData>> {
  const timeoutHours = await getConfiguredSessionTimeoutHours()
  const ttlSeconds = Math.round(timeoutHours * 3600)
  const session = await getAppSession(req, res, ttlSeconds)

  session.userId = user.id
  session.username = user.username
  session.role = user.role
  session.tokenVersion = user.tokenVersion ?? 1
  session.expiresAt = Date.now() + ttlSeconds * 1000
  session.instanceId = getServerInstanceId()
  session.isLoggedIn = true
  await session.save()

  return session
}

/**
 * Validates the current cookie session against live database user state
 * (user existence, tokenVersion for password-reset/role-change revocation, role sync, and verification).
 */
export async function getValidatedAppSession(
  req?: Request | null,
  res?: Response | null
): Promise<IronSession<SessionData>> {
  const session = await getAppSession(req, res)
  if (!session.isLoggedIn || !session.userId) {
    return session
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      username: true,
      role: true,
      tokenVersion: true,
      emailVerified: true,
    },
  })

  const tokenMismatch =
    !dbUser ||
    session.tokenVersion !== dbUser.tokenVersion ||
    session.role !== dbUser.role ||
    (dbUser.role !== 'ADMIN' && !dbUser.emailVerified)

  if (tokenMismatch) {
    clearSessionFields(session)
    if (req && res) {
      await session.save()
    }
    return session
  }

  return session
}
