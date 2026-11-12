import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { getValidatedAppSession } from '@/lib/auth-server'
import { normalizeDifficulty } from '@/lib/interview/difficulty'

export async function POST(req: Request) {
  try {
    const res = NextResponse.json({})
    const userSession = await getValidatedAppSession(req, res)
    if (!userSession?.isLoggedIn || !userSession.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { sessionId, questionNumber, suggestion, sourceReferences } = await req.json()

    if (!sessionId || !questionNumber || !suggestion) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const session = await prisma.interviewSession.findUnique({
      where: { id: sessionId },
      include: { candidate: true },
    })

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const isOwner =
      userSession.role === 'ADMIN' ||
      session.interviewerId === userSession.userId ||
      (session.candidate?.userId !== null && session.candidate?.userId === userSession.userId)

    if (!isOwner) {
      return NextResponse.json({ error: 'Session not found or unauthorized' }, { status: 404 })
    }

    const existingQuestion = await prisma.question.findFirst({
      where: { sessionId, questionNumber },
    })

    if (existingQuestion) {
      return NextResponse.json(
        { message: 'Question already generated', question: existingQuestion },
        { status: 200 }
      )
    }

    const pendingMeta = session.pendingSuggestions as
      | { sourceReferences?: unknown[] }
      | null
    const resolvedSources = sourceReferences ?? suggestion.sourceReferences ?? pendingMeta?.sourceReferences ?? null

    const nextQuestion = await prisma.$transaction(async (tx) => {
      const created = await tx.question.create({
        data: {
          sessionId,
          questionNumber,
          content: suggestion.question,
          type: suggestion.type || 'Conceptual',
          difficulty: normalizeDifficulty(suggestion.difficulty, normalizeDifficulty(session.difficulty)),
          topic: suggestion.topic || 'General',
          expectedAnswer: suggestion.expected_answer || '',
          coreConcepts: suggestion.concepts || [],
          requiredKeywords: suggestion.required_keywords || [],
          sourceReferences:
            resolvedSources !== null ? (resolvedSources as Prisma.InputJsonValue) : undefined,
        },
      })

      await tx.interviewSession.update({
        where: { id: sessionId },
        data: { pendingSuggestions: Prisma.DbNull },
      })

      return created
    })

    return NextResponse.json({ question: nextQuestion })
  } catch (error: unknown) {
    console.error('Select question error:', error)
    return NextResponse.json({ error: 'Failed to save selected question' }, { status: 500 })
  }
}
