import { NextResponse } from 'next/server'
import { getValidatedAppSession } from '@/lib/auth-server'
import { Prisma } from '@prisma/client'
import prisma, { withDbRetry } from '@/lib/db'
import { formatInterviewerName } from '@/lib/formatters'

export const maxDuration = 60

export async function GET(request: Request) {
  try {
    const response = NextResponse.json({})
    const session = await getValidatedAppSession(request, response)

    if (!session?.isLoggedIn || !session.userId) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })
    }

    if (session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Date calculations for 30-day activity trend
    const now = new Date()
    const thirtyDaysAgo = new Date(now)
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29)
    thirtyDaysAgo.setHours(0, 0, 0, 0)

    // Run parallel database queries
    const [
      totalInterviews,
      completedInterviews,
      activeInterviews,
      totalCandidates,
      totalInterviewers,
      scoreStats,
      statusGroups,
      typeGroups,
      difficultyGroups,
      dailySessionCounts,
      interviewers
    ] = await withDbRetry(() => Promise.all([
      prisma.interviewSession.count(),
      prisma.interviewSession.count({ where: { status: 'completed' } }),
      prisma.interviewSession.count({ where: { status: 'active' } }),
      prisma.candidate.count(),
      prisma.user.count({ where: { role: 'INTERVIEWER' } }),
      prisma.interviewSession.aggregate({
        _avg: { score: true },
        _min: { score: true },
        _max: { score: true },
        _count: { score: true },
        where: { score: { not: null } },
      }),
      prisma.interviewSession.groupBy({
        by: ['status'],
        _count: { id: true },
      }),
      prisma.interviewSession.groupBy({
        by: ['interviewType'],
        _count: { id: true },
      }),
      prisma.interviewSession.groupBy({
        by: ['difficulty'],
        _count: { id: true },
      }),
      prisma.$queryRaw<Array<{ day: string; total: bigint; completed: bigint }>>`
        SELECT
          TO_CHAR("startedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
          COUNT(*)::bigint AS total,
          COUNT(*) FILTER (WHERE status = 'completed')::bigint AS completed
        FROM "InterviewSession"
        WHERE "startedAt" >= ${thirtyDaysAgo}
        GROUP BY 1
      `,
      prisma.user.findMany({
        where: { role: 'INTERVIEWER' },
        select: {
          id: true,
          username: true,
          email: true,
          candidate: { select: { name: true } },
          createdAt: true,
          _count: {
            select: { sessions: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]))

    const interviewerIds = interviewers.map((u) => u.id)
    const interviewerMetrics =
      interviewerIds.length > 0
        ? await withDbRetry(() =>
            prisma.$queryRaw<Array<{ interviewerId: number; completedCount: bigint; avgScore: number | null }>>`
              SELECT
                "interviewerId",
                COUNT(*) FILTER (WHERE status = 'completed')::bigint AS "completedCount",
                AVG(score) FILTER (WHERE score IS NOT NULL)::float8 AS "avgScore"
              FROM "InterviewSession"
              WHERE "interviewerId" IN (${Prisma.join(interviewerIds)})
              GROUP BY "interviewerId"
            `
          )
        : []
    const metricsByInterviewer = new Map(interviewerMetrics.map((m) => [m.interviewerId, m]))

    // Completion Rate calculation
    const completionRate = totalInterviews > 0
      ? Math.round((completedInterviews / totalInterviews) * 1000) / 10
      : 0

    // Score calculations
    const scoredCount = scoreStats._count.score || 0
    const averageScore = scoredCount > 0 && scoreStats._avg.score !== null
      ? Math.round(scoreStats._avg.score * 10) / 10
      : null
    const highestScore = scoredCount > 0 && scoreStats._max.score !== null
      ? scoreStats._max.score
      : null
    const lowestScore = scoredCount > 0 && scoreStats._min.score !== null
      ? scoreStats._min.score
      : null

    // Status Breakdown with percentages
    const statusBreakdown = statusGroups.map((g) => ({
      status: g.status,
      count: g._count.id,
      percentage: totalInterviews > 0
        ? Math.round((g._count.id / totalInterviews) * 1000) / 10
        : 0,
    }))

    // Type Breakdown
    const typeBreakdown = typeGroups.map((g) => ({
      type: g.interviewType,
      count: g._count.id,
      percentage: totalInterviews > 0
        ? Math.round((g._count.id / totalInterviews) * 1000) / 10
        : 0,
    }))

    // Difficulty Breakdown
    const difficultyBreakdown = difficultyGroups.map((g) => ({
      difficulty: g.difficulty,
      count: g._count.id,
      percentage: totalInterviews > 0
        ? Math.round((g._count.id / totalInterviews) * 1000) / 10
        : 0,
    }))

    // Build complete 30-day activity map
    const activityMap: Record<string, { total: number; completed: number }> = {}
    for (let i = 0; i < 30; i++) {
      const d = new Date(thirtyDaysAgo)
      d.setDate(d.getDate() + i)
      const dateStr = d.toISOString().split('T')[0]
      activityMap[dateStr] = { total: 0, completed: 0 }
    }

    dailySessionCounts.forEach((row) => {
      if (activityMap[row.day]) {
        activityMap[row.day].total = Number(row.total)
        activityMap[row.day].completed = Number(row.completed)
      }
    })

    const activityTrend = Object.keys(activityMap)
      .sort()
      .map((date) => ({
        date,
        count: activityMap[date].total,
        completedCount: activityMap[date].completed,
      }))

    // Interviewer activity calculation
    const interviewerPerformance = interviewers.map((user) => {
      const totalSess = user._count.sessions
      const metric = metricsByInterviewer.get(user.id)
      const compSess = metric ? Number(metric.completedCount) : 0
      const avgSc =
        metric && metric.avgScore !== null
          ? Math.round(metric.avgScore * 10) / 10
          : null

      return {
        id: user.id,
        username: formatInterviewerName(user),
        totalInterviews: totalSess,
        completedInterviews: compSess,
        averageScore: avgSc,
      }
    })

    return NextResponse.json({
      metrics: {
        totalInterviews,
        completedInterviews,
        activeInterviews,
        totalCandidates,
        totalInterviewers,
        completionRate,
      },
      scores: {
        averageScore,
        highestScore,
        lowestScore,
        scoredInterviewsCount: scoredCount,
      },
      statusBreakdown,
      typeBreakdown,
      difficultyBreakdown,
      activityTrend,
      interviewerPerformance,
    })
  } catch (err) {
    console.error('Fetch admin analytics error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
