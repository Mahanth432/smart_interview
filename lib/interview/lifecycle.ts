import prisma from '@/lib/db'
import { createAuditLog } from '@/lib/audit-log'

export const STALE_SESSION_HOURS = 24

/**
 * Marks untouched active/paused sessions older than threshold as 'abandoned'
 * so abandoned sessions never remain indefinitely active.
 */
export async function expireStaleSessions(hoursThreshold = STALE_SESSION_HOURS): Promise<number> {
  const cutoff = new Date(Date.now() - Math.max(1, hoursThreshold) * 60 * 60 * 1000)

  const stale = await prisma.interviewSession.findMany({
    where: {
      status: { in: ['active', 'paused'] },
      startedAt: { lt: cutoff },
      OR: [{ pausedAt: null }, { pausedAt: { lt: cutoff } }],
      questions: { none: { askedAt: { gte: cutoff } } },
    },
    select: { id: true },
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

  if (session.status === 'completed' || session.status === 'abandoned') {
    return {
      ok: false as const,
      status: 409,
      error: `Cannot ${params.action} a session that is already ${session.status}.`,
    }
  }

  if (params.action === 'pause') {
    const now = new Date()
    const updated = await prisma.interviewSession.update({
      where: { id: session.id },
      data: { status: 'paused', pausedAt: now },
      select: { id: true, status: true, pausedAt: true },
    })
    createAuditLog({
      userId: params.actorUserId,
      username: params.actorUsername ?? undefined,
      action: 'INTERVIEW_PAUSED',
      entityType: 'InterviewSession',
      entityId: session.id,
    })
    return { ok: true as const, session: updated }
  }

  if (params.action === 'resume') {
    const updated = await prisma.interviewSession.update({
      where: { id: session.id },
      data: { status: 'active' },
      select: { id: true, status: true, pausedAt: true },
    })
    return { ok: true as const, session: updated }
  }

  const now = new Date()
  const updated = await prisma.interviewSession.update({
    where: { id: session.id },
    data: { status: 'abandoned', endedAt: now, pendingSuggestions: undefined },
    select: { id: true, status: true, endedAt: true },
  })
  createAuditLog({
    userId: params.actorUserId,
    username: params.actorUsername ?? undefined,
    action: 'INTERVIEW_ABANDONED',
    entityType: 'InterviewSession',
    entityId: session.id,
  })
  return { ok: true as const, session: updated }
}
