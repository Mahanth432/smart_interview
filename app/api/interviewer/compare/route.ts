import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getValidatedAppSession } from '@/lib/auth-server'

export async function GET(request: Request) {
  try {
    const response = NextResponse.json({})
    const session = await getValidatedAppSession(request, response)

    if (!session?.isLoggedIn || !session.userId) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })
    }
    if (session.role !== 'ADMIN' && session.role !== 'INTERVIEWER') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const rawIds = (new URL(request.url).searchParams.get('candidateIds') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    if (rawIds.length === 0) {
      return NextResponse.json({ error: 'candidateIds query parameter is required' }, { status: 400 })
    }

    const uniqueIds = Array.from(new Set(rawIds)).slice(0, 6)
    const isAdmin = session.role === 'ADMIN'

    const candidates = await prisma.candidate.findMany({
      where: {
        id: { in: uniqueIds },
        ...(isAdmin
          ? {}
          : {
              OR: [
                { sessions: { some: { interviewerId: session.userId } } },
                { userId: { not: null }, sessions: { none: {} } },
              ],
            }),
      },
      include: {
        profile: true,
        conceptMastery: {
          orderBy: [{ weaknessCount: 'desc' }, { masteryScore: 'asc' }],
          take: 10,
        },
        sessions: {
          where: isAdmin ? undefined : { interviewerId: session.userId },
          orderBy: { startedAt: 'desc' },
          include: {
            report: { select: { overallScore: true, topicScores: true } },
          },
        },
      },
    })

    const comparison = candidates.map((cand) => {
      const scored = cand.sessions.filter(
        (s) => typeof (s.score ?? s.report?.overallScore) === 'number'
      )
      const scores = scored.map((s) => Number(s.score ?? s.report?.overallScore ?? 0))
      const averageScore =
        scores.length > 0
          ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
          : null
      const bestScore = scores.length > 0 ? Math.max(...scores) : null

      const topicMap = new Map<string, { sum: number; count: number }>()
      for (const s of cand.sessions) {
        const ts = s.report?.topicScores as Record<string, { averageScore?: number }> | null
        if (ts && typeof ts === 'object') {
          for (const [topic, val] of Object.entries(ts)) {
            if (typeof val?.averageScore === 'number') {
              const e = topicMap.get(topic) ?? { sum: 0, count: 0 }
              e.sum += val.averageScore
              e.count += 1
              topicMap.set(topic, e)
            }
          }
        }
      }

      const topicAverages: Record<string, number> = {}
      for (const [topic, { sum, count }] of topicMap.entries()) {
        topicAverages[topic] = Math.round((sum / count) * 10) / 10
      }

      return {
        candidateId: cand.id,
        name: cand.name,
        email: cand.email,
        sessionCount: cand.sessions.length,
        completedCount: cand.sessions.filter((s) => s.status === 'completed').length,
        averageScore,
        bestScore,
        answeringStyle: cand.profile?.answeringStyle || 'Not yet profiled',
        technicalStrengths: cand.profile?.technicalStrengths || [],
        recurringWeaknesses: cand.conceptMastery
          .filter((m) => m.weaknessCount > 0 || m.masteryScore < 60)
          .map((m) => ({
            conceptName: m.conceptName,
            masteryScore: m.masteryScore,
            weaknessCount: m.weaknessCount,
          })),
        topicAverages,
      }
    })

    return NextResponse.json({ comparison })
  } catch (err) {
    console.error('Candidate comparison GET error:', err)
    return NextResponse.json({ error: 'Failed to compare candidates' }, { status: 500 })
  }
}
