import { NextResponse } from 'next/server'
import { getValidatedAppSession } from '@/lib/auth-server'
import prisma from '@/lib/db'
import { formatInterviewerName } from '@/lib/formatters'

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
      recentSessions,
      interviewers
    ] = await Promise.all([
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
      prisma.interviewSession.findMany({
        where: {
          startedAt: {
            gte: thirtyDaysAgo,
          },
        },
        select: {
          startedAt: true,
          status: true,
        },
      }),
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
          sessions: {
            select: {
              id: true,
              status: true,
              score: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ])

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

    recentSessions.forEach((s) => {
      const dateStr = s.startedAt.toISOString().split('T')[0]
      if (activityMap[dateStr]) {
        activityMap[dateStr].total += 1
        if (s.status === 'completed') {
          activityMap[dateStr].completed += 1
        }
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
      const compSess = user.sessions.filter((s) => s.status === 'completed').length
      const scoredSess = user.sessions.filter((s) => s.score !== null)
      const avgSc = scoredSess.length > 0
        ? Math.round((scoredSess.reduce((acc, curr) => acc + (curr.score || 0), 0) / scoredSess.length) * 10) / 10
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
