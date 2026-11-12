import { NextRequest, NextResponse } from 'next/server'
import { getValidatedAppSession } from '@/lib/auth-server'
import prisma from '@/lib/db'
import { sanitizeReportForRole } from '@/lib/report-privacy'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const res = NextResponse.json({})
    const userSession = await getValidatedAppSession(req as unknown as Request, res as unknown as Response)

    if (!userSession?.isLoggedIn || !userSession?.userId) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })
    }

    if (userSession.role !== 'CANDIDATE') {
      return NextResponse.json({ error: 'Forbidden: Candidates only' }, { status: 403 })
    }

    const resolvedParams = await params
    const sessionId = resolvedParams.sessionId

    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID is required' }, { status: 400 })
    }

    // Locate candidate record for authenticated user
    const candidate = await prisma.candidate.findUnique({
      where: { userId: userSession.userId },
      select: { id: true, name: true, email: true }
    })

    if (!candidate) {
      return NextResponse.json({ error: 'Candidate profile not found' }, { status: 404 })
    }

    // Query interview session scoped strictly to candidateId
    const session = await prisma.interviewSession.findFirst({
      where: {
        id: sessionId,
        candidateId: candidate.id
      },
      include: {
        interviewer: {
          select: { username: true }
        },
        report: true,
        questions: {
          include: {
            answer: {
              include: {
                evaluation: true
              }
            }
          },
          orderBy: { askedAt: 'asc' }
        }
      }
    })

    if (!session) {
      return NextResponse.json({ error: 'Interview session not found or unauthorized' }, { status: 404 })
    }

    const questions = session.questions.map(q => ({
      questionId: q.id,
      questionNumber: q.questionNumber,
      topic: q.topic,
      difficulty: q.difficulty,
      question: q.content,
      type: q.type,
      answer: q.answer?.transcript || null,
      answeredAt: q.answer?.answeredAt || null,
      evaluation: q.answer?.evaluation ? {
        score: q.answer.evaluation.score,
        correctness: q.answer.evaluation.correctness,
        completeness: q.answer.evaluation.completeness,
        technicalAccuracy: q.answer.evaluation.technicalAccuracy,
        feedback: q.answer.evaluation.feedback,
        mentionedKeywords: q.answer.evaluation.mentionedKeywords,
        missingKeywords: q.answer.evaluation.missingKeywords
      } : null
    }))

    return NextResponse.json({
      session: {
        id: session.id,
        status: session.status,
        difficulty: session.difficulty,
        interviewType: session.interviewType,
        scope: session.scope,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        score: session.score
      },
      candidate: {
        id: candidate.id,
        name: candidate.name,
        email: candidate.email
      },
      interviewer: {
        username: session.interviewer?.username || 'System'
      },
      report: session.status === 'completed' ? sanitizeReportForRole(session.report, 'CANDIDATE') : null,
      questions
    })
  } catch (err: unknown) {
    console.error('Candidate session API error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
