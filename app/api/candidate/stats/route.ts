import { NextResponse } from 'next/server'
import { getValidatedAppSession } from '@/lib/auth-server'
import prisma from '@/lib/db'

export async function GET(request: Request) {
  try {
    const response = NextResponse.json({})
    const session = await getValidatedAppSession(request, response)

    if (!session?.isLoggedIn || !session.userId) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })
    }

    if (session.role !== 'CANDIDATE') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Locate candidate record for authenticated user
    const candidate = await prisma.candidate.findUnique({
      where: { userId: session.userId },
      select: { id: true }
    })

    if (!candidate) {
      return NextResponse.json({
        total: 0,
        completed: 0,
        active: 0,
        averageScore: null,
        bestScore: null
      })
    }

    const [total, completed, active, scoreAgg] = await Promise.all([
      prisma.interviewSession.count({
        where: { candidateId: candidate.id }
      }),
      prisma.interviewSession.count({
        where: { candidateId: candidate.id, status: 'completed' }
      }),
      prisma.interviewSession.count({
        where: { candidateId: candidate.id, status: 'active' }
      }),
      prisma.interviewSession.aggregate({
        where: { candidateId: candidate.id, score: { not: null } },
        _avg: { score: true },
        _max: { score: true }
      })
    ])

    const averageScore = scoreAgg._avg.score !== null ? Number(scoreAgg._avg.score.toFixed(1)) : null
    const bestScore = scoreAgg._max.score !== null ? Number(scoreAgg._max.score.toFixed(1)) : null

    return NextResponse.json({
      total,
      completed,
      active,
      averageScore,
      bestScore
    })
  } catch (err) {
    console.error('Candidate stats API error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
