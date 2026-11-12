import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getValidatedAppSession } from '@/lib/auth-server'
import { verifySameOrigin } from '@/lib/csrf'
import { enforceRateLimit } from '@/lib/rate-limit'
import {
  getCandidateLearningSnapshot,
  refreshRevisionRecommendations,
} from '@/lib/interview/memory'

export async function GET(request: Request) {
  try {
    const response = NextResponse.json({})
    const session = await getValidatedAppSession(request, response)

    if (!session?.isLoggedIn || !session.userId) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })
    }
    if (session.role !== 'CANDIDATE') {
      return NextResponse.json({ error: 'Forbidden: Candidates only' }, { status: 403 })
    }

    const candidate = await prisma.candidate.findUnique({
      where: { userId: session.userId },
      select: { id: true, name: true },
    })

    if (!candidate) {
      return NextResponse.json({
        profile: null,
        conceptMasteries: [],
        recurringWeaknesses: [],
        forgettingPredictions: [],
        revisions: [],
        progression: [],
        topicProgression: {},
      })
    }

    const snapshot = await getCandidateLearningSnapshot(candidate.id)
    return NextResponse.json(snapshot)
  } catch (err) {
    console.error('Candidate memory GET error:', err)
    return NextResponse.json({ error: 'Failed to load learning memory' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const csrfError = verifySameOrigin(request)
    if (csrfError) return csrfError
    const response = NextResponse.json({})
    const session = await getValidatedAppSession(request, response)

    if (!session?.isLoggedIn || !session.userId) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })
    }
    if (session.role !== 'CANDIDATE') {
      return NextResponse.json({ error: 'Forbidden: Candidates only' }, { status: 403 })
    }

    const rlError = await enforceRateLimit(
      {
        key: `candidate:memory:user:${session.userId}`,
        limit: 20,
        windowSeconds: 15 * 60,
      },
      'Too many learning memory refresh requests. Please wait before trying again.'
    )
    if (rlError) return rlError

    const candidate = await prisma.candidate.findUnique({
      where: { userId: session.userId },
      select: { id: true },
    })
    if (!candidate) {
      return NextResponse.json({ error: 'Candidate profile not found' }, { status: 404 })
    }

    const body = await request.json()
    if (body.action === 'refresh') {
      const revisions = await refreshRevisionRecommendations(candidate.id)
      return NextResponse.json({ success: true, revisions })
    }

    const { revisionId, status } = body
    if (!revisionId || !['pending', 'completed', 'dismissed'].includes(status)) {
      return NextResponse.json({ error: 'Invalid revision update payload' }, { status: 400 })
    }

    const updated = await prisma.revisionRecommendation.updateMany({
      where: { id: String(revisionId), candidateId: candidate.id },
      data: { status },
    })

    if (updated.count === 0) {
      return NextResponse.json({ error: 'Revision item not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Candidate memory PATCH error:', err)
    return NextResponse.json({ error: 'Failed to update revision state' }, { status: 500 })
  }
}
