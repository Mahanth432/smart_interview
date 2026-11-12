import { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { createAuditLog } from '@/lib/audit-log'

export const STALE_SESSION_HOURS = 24
export const STALE_FINALIZING_MINUTES = 5

/**
 * Marks untouched active/paused sessions older than threshold as 'abandoned',
 * and recovers stuck 'finalizing' sessions older than 5 minutes back to 'active'.
 */
export async function expireStaleSessions(hoursThreshold = STALE_SESSION_HOURS): Promise<number> {
  const cutoff = new Date(Date.now() - Math.max(1, hoursThreshold) * 60 * 60 * 1000)
  const finalizingCutoff = new Date(Date.now() - STALE_FINALIZING_MINUTES * 60 * 1000)

  // Recover crashed /end finalizations safely
  await prisma.interviewSession
    .updateMany({
      where: {
        status: 'finalizing',
        startedAt: { lt: finalizingCutoff },
        report: { is: null },
      },
      data: { status: 'active' },
    })
    .catch(() => {})

  const stale = await prisma.interviewSession.findMany({
    where: {
      status: { in: ['active', 'paused'] },
      startedAt: { lt: cutoff },
      OR: [{ pausedAt: null }, { pausedAt: { lt: cutoff } }],
      questions: { none: { askedAt: { gte: cutoff } } },
    },
    select: { id: true },
    take: 200,
  })

  if (stale.length === 0) return 0

  const result = await prisma.interviewSession.updateMany({
    where: {
      id: { in: stale.map((s) => s.id) },
      status: { in: ['active', 'paused'] },
    },
    data: {
      status: 'abandoned',
      endedAt: new Date(),
      pendingSuggestions: Prisma.DbNull,
    },
  })

  return result.count
}

export async function transitionSessionLifecycle(params: {
  sessionId: string
  actorUserId: number
  actorUsername?: string | null
  actorRole?: string | null
  action: 'pause' | 'resume' | 'abandon'
}) {
  await expireStaleSessions().catch(() => {})

  const session = await prisma.interviewSession.findUnique({
    where: { id: params.sessionId },
    include: { candidate: { select: { userId: true } } },
  })

  if (!session) {
    return { ok: false as const, status: 404, error: 'Session not found' }
  }

  const isOwner =
    params.actorRole === 'ADMIN' ||
    session.interviewerId === params.actorUserId ||
    (session.candidate?.userId !== null && session.candidate?.userId === params.actorUserId)

  if (!isOwner) {
    return { ok: false as const, status: 403, error: 'Unauthorized access to session' }
  }

  if (session.status === 'completed') {
    return {
      ok: false as const,
      status: 409,
      error: `Cannot ${params.action} a session that is already completed.`,
    }
  }

  if (session.status === 'abandoned') {
    if (params.action === 'abandon') {
      return {
        ok: true as const,
        session: { id: session.id, status: session.status, endedAt: session.endedAt },
      }
    }
    return {
      ok: false as const,
      status: 409,
      error: `Cannot ${params.action} a session that is already abandoned.`,
    }
  }

  if (session.status === 'finalizing') {
    return {
      ok: false as const,
      status: 409,
      error: 'Session finalization is currently in progress.',
    }
  }

  if (params.action === 'pause') {
    if (session.status === 'paused') {
      return {
        ok: true as const,
        session: { id: session.id, status: session.status, pausedAt: session.pausedAt },
      }
    }
    const now = new Date()
    const claim = await prisma.interviewSession.updateMany({
      where: { id: session.id, status: 'active' },
      data: { status: 'paused', pausedAt: now },
    })
    if (claim.count === 0) {
      return { ok: false as const, status: 409, error: 'Session state changed concurrently.' }
    }
    createAuditLog({
      userId: params.actorUserId,
      username: params.actorUsername ?? undefined,
      action: 'INTERVIEW_PAUSED',
      entityType: 'InterviewSession',
      entityId: session.id,
    })
    return { ok: true as const, session: { id: session.id, status: 'paused', pausedAt: now } }
  }

  if (params.action === 'resume') {
    if (session.status === 'active') {
      return {
        ok: true as const,
        session: { id: session.id, status: session.status, pausedAt: session.pausedAt },
      }
    }
    const claim = await prisma.interviewSession.updateMany({
      where: { id: session.id, status: 'paused' },
      data: { status: 'active' },
    })
    if (claim.count === 0) {
      return { ok: false as const, status: 409, error: 'Session state changed concurrently.' }
    }
    return { ok: true as const, session: { id: session.id, status: 'active', pausedAt: session.pausedAt } }
  }

  const now = new Date()
  const claim = await prisma.interviewSession.updateMany({
    where: { id: session.id, status: { in: ['active', 'paused'] } },
    data: { status: 'abandoned', endedAt: now, pendingSuggestions: Prisma.DbNull },
  })
  if (claim.count === 0) {
    return { ok: false as const, status: 409, error: 'Session state changed concurrently.' }
  }
  createAuditLog({
    userId: params.actorUserId,
    username: params.actorUsername ?? undefined,
    action: 'INTERVIEW_ABANDONED',
    entityType: 'InterviewSession',
    entityId: session.id,
  })
  return { ok: true as const, session: { id: session.id, status: 'abandoned', endedAt: now } }
}
