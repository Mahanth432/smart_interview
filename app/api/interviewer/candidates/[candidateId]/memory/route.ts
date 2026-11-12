import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getValidatedAppSession } from '@/lib/auth-server'
import {
  getCandidateLearningSnapshot,
  refreshRevisionRecommendations,
} from '@/lib/interview/memory'

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ candidateId: string }> }
) {
  try {
    const response = NextResponse.json({})
    const session = await getValidatedAppSession(request, response)

    if (!session?.isLoggedIn || !session.userId) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })
    }
    if (session.role !== 'ADMIN' && session.role !== 'INTERVIEWER') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { candidateId } = await context.params
    const candidate = await prisma.candidate.findUnique({
      where: { id: candidateId },
      include: { sessions: { select: { interviewerId: true } } },
    })

    if (!candidate) {
      return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })
    }

    if (session.role !== 'ADMIN') {
      const hasOwn = candidate.sessions.some((s) => s.interviewerId === session.userId)
      const isUnclaimed = candidate.userId !== null && candidate.sessions.length === 0
      if (!hasOwn && !isUnclaimed) {
        return NextResponse.json(
          { error: 'Forbidden: you do not have access to this candidate.' },
          { status: 403 }
        )
      }
    }

    const shouldRefresh = new URL(request.url).searchParams.get('refresh') === '1'
    if (shouldRefresh) {
      await refreshRevisionRecommendations(candidate.id, session.userId)
    }

    const snapshot = await getCandidateLearningSnapshot(candidate.id)
    return NextResponse.json({
      candidate: { id: candidate.id, name: candidate.name, email: candidate.email },
      ...snapshot,
    })
  } catch (err) {
    console.error('Interviewer candidate memory GET error:', err)
    return NextResponse.json({ error: 'Failed to load candidate memory' }, { status: 500 })
  }
}
