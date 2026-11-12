import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getValidatedAppSession } from '@/lib/auth-server'
import { expireStaleSessions } from '@/lib/interview/lifecycle'

export async function GET(req: NextRequest) {
  try {
    const res = NextResponse.json({})
    const userSession = await getValidatedAppSession(req, res)
    if (!userSession?.isLoggedIn || !userSession.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Automatically expire abandoned stale sessions (>24h inactive)
    await expireStaleSessions().catch(() => {})

    const { searchParams } = new URL(req.url)
    const sessionId = searchParams.get('sessionId')
    const resumePaused = searchParams.get('resumePaused') === '1'

    let session = null

    if (sessionId) {
      session = await prisma.interviewSession.findUnique({
        where: { id: sessionId },
        include: {
          candidate: true,
          questions: {
            include: { answer: { include: { evaluation: true } } },
            orderBy: { askedAt: 'asc' },
          },
        },
      })

      if (!session || !['active', 'paused'].includes(session.status)) {
        return NextResponse.json({ error: 'Session not found or inactive' }, { status: 404 })
      }

      const isOwner =
        userSession.role === 'ADMIN' ||
        session.interviewerId === userSession.userId ||
        (session.candidate?.userId !== null && session.candidate?.userId === userSession.userId)

      if (!isOwner) {
        return NextResponse.json({ error: 'Unauthorized access to session' }, { status: 403 })
      }
    } else {
      if (userSession.role === 'CANDIDATE') {
        session = await prisma.interviewSession.findFirst({
          where: {
            candidate: { userId: userSession.userId },
            status: { in: ['active', 'paused'] },
          },
          orderBy: { startedAt: 'desc' },
          include: {
            candidate: true,
            questions: {
              include: { answer: { include: { evaluation: true } } },
              orderBy: { askedAt: 'asc' },
            },
          },
        })
      } else if (userSession.role === 'INTERVIEWER' || userSession.role === 'ADMIN') {
        session = await prisma.interviewSession.findFirst({
          where: {
            interviewerId: userSession.userId,
            status: { in: ['active', 'paused'] },
          },
          orderBy: { startedAt: 'desc' },
          include: {
            candidate: true,
            questions: {
              include: { answer: { include: { evaluation: true } } },
              orderBy: { askedAt: 'asc' },
            },
          },
        })
      }
    }

    if (!session || !['active', 'paused'].includes(session.status)) {
      return NextResponse.json({
        activeSession: false,
        userRole: userSession.role,
        message: 'No active interview session',
      })
    }

    // If caller explicitly requests resuming a paused session, transition back to active
    if (resumePaused && session.status === 'paused') {
      await prisma.interviewSession.update({
        where: { id: session.id },
        data: { status: 'active' },
      })
      session.status = 'active'
    }

    const currentQuestion =
      session.questions.length > 0 ? session.questions[session.questions.length - 1] : null

    const evaluations = session.questions
      .filter((q) => q.answer?.evaluation)
      .map((q) => ({
        questionNumber: q.questionNumber,
        question: q.content,
        topic: q.topic,
        answer: q.answer!.transcript,
        feedback: q.answer!.evaluation,
      }))

    // Restore pending follow-up suggestions when reload happens right after evaluating currentQuestion
    const rawPending = session.pendingSuggestions as
      | { suggestions?: unknown[]; forQuestionNumber?: number; sourceReferences?: unknown[] }
      | null
    const pendingSuggestions =
      rawPending &&
      currentQuestion &&
      rawPending.forQuestionNumber === currentQuestion.questionNumber &&
      Array.isArray(rawPending.suggestions)
        ? rawPending.suggestions
        : []

    return NextResponse.json({
      activeSession: true,
      sessionId: session.id,
      userRole: userSession.role,
      session: {
        id: session.id,
        candidateId: session.candidateId,
        status: session.status,
        pausedAt: session.pausedAt,
        difficulty: session.difficulty,
        interviewType: session.interviewType,
        scope: session.scope,
        startedAt: session.startedAt,
      },
      candidate: session.candidate,
      currentQuestion: currentQuestion
        ? {
            id: currentQuestion.id,
            content: currentQuestion.content,
            questionNumber: currentQuestion.questionNumber,
            type: currentQuestion.type,
            difficulty: currentQuestion.difficulty,
            topic: currentQuestion.topic,
            sourceReferences: currentQuestion.sourceReferences ?? null,
          }
        : null,
      questions: session.questions.map((q) => ({
        id: q.id,
        questionNumber: q.questionNumber,
        content: q.content,
        type: q.type,
        difficulty: q.difficulty,
        topic: q.topic,
        sourceReferences: q.sourceReferences ?? null,
        hasAnswer: !!q.answer,
      })),
      evaluations,
      pendingSuggestions,
    })
  } catch (error: unknown) {
    console.error('Resume interview error:', error)
    return NextResponse.json({ error: 'Failed to resume interview session' }, { status: 500 })
  }
}
