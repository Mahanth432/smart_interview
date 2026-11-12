import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { getValidatedAppSession } from '@/lib/auth-server'
import { verifySameOrigin } from '@/lib/csrf'
import { normalizeDifficulty } from '@/lib/interview/difficulty'
import { expireStaleSessions } from '@/lib/interview/lifecycle'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

interface StoredSuggestion {
  question: string
  type?: string
  difficulty?: string
  topic?: string
  expected_answer?: string
  concepts?: string[]
  required_keywords?: string[]
  sourceReferences?: unknown[]
}

export async function POST(req: Request) {
  try {
    const csrfError = verifySameOrigin(req)
    if (csrfError) return csrfError

    const res = NextResponse.json({})
    const userSession = await getValidatedAppSession(req, res)
    if (!userSession?.isLoggedIn || !userSession.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (userSession.role === 'CANDIDATE') {
      return NextResponse.json(
        { error: 'Forbidden: Only interviewers and administrators can select follow-up questions.' },
        { status: 403 }
      )
    }

    const rateLimit = await checkRateLimit({
      key: `interview:select-question:user:${userSession.userId}`,
      limit: 80,
      windowSeconds: 15 * 60,
    })
    if (!rateLimit.allowed) {
      return rateLimitResponse(rateLimit.retryAfterSeconds, 'Too many question selection requests.')
    }

    const { sessionId, questionNumber, suggestion, sourceReferences } = await req.json()

    if (!sessionId || !questionNumber || !suggestion || typeof suggestion.question !== 'string') {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    await expireStaleSessions().catch(() => {})

    const session = await prisma.interviewSession.findUnique({
      where: { id: sessionId },
      include: { candidate: true },
    })

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const isOwner =
      userSession.role === 'ADMIN' || session.interviewerId === userSession.userId

    if (!isOwner) {
      return NextResponse.json({ error: 'Session not found or unauthorized' }, { status: 404 })
    }

    if (session.status !== 'active') {
      return NextResponse.json(
        { error: `Cannot select a question while session is ${session.status}.` },
        { status: 409 }
      )
    }

    const parsedQuestionNumber = Number(questionNumber)
    if (!Number.isInteger(parsedQuestionNumber) || parsedQuestionNumber < 1) {
      return NextResponse.json({ error: 'Invalid questionNumber' }, { status: 400 })
    }

    const existingQuestion = await prisma.question.findFirst({
      where: { sessionId, questionNumber: parsedQuestionNumber },
    })

    if (existingQuestion) {
      return NextResponse.json(
        { message: 'Question already generated', question: existingQuestion },
        { status: 200 }
      )
    }

    // Validate against server-stored pendingSuggestions whenever present
    const pendingMeta = session.pendingSuggestions as
      | { suggestions?: StoredSuggestion[]; sourceReferences?: unknown[] }
      | null
    const serverSuggestions = Array.isArray(pendingMeta?.suggestions) ? pendingMeta.suggestions : []
    const requestedText = String(suggestion.question).trim()

    let authoritativeSuggestion: StoredSuggestion = suggestion
    if (serverSuggestions.length > 0) {
      const matched = serverSuggestions.find(
        (s) => typeof s?.question === 'string' && s.question.trim() === requestedText
      )
      if (!matched) {
        return NextResponse.json(
          { error: 'Selected question does not match server-generated pending suggestions.' },
          { status: 400 }
        )
      }
      authoritativeSuggestion = matched
    }

    const resolvedSources =
      authoritativeSuggestion.sourceReferences ?? pendingMeta?.sourceReferences ?? sourceReferences ?? null

    try {
      const nextQuestion = await prisma.$transaction(async (tx) => {
        const created = await tx.question.create({
          data: {
            sessionId,
            questionNumber: parsedQuestionNumber,
            content: authoritativeSuggestion.question.trim(),
            type: authoritativeSuggestion.type || 'Conceptual',
            difficulty: normalizeDifficulty(
              authoritativeSuggestion.difficulty,
              normalizeDifficulty(session.difficulty)
            ),
            topic: authoritativeSuggestion.topic || 'General',
            expectedAnswer: authoritativeSuggestion.expected_answer || '',
            coreConcepts: Array.isArray(authoritativeSuggestion.concepts)
              ? authoritativeSuggestion.concepts
              : [],
            requiredKeywords: Array.isArray(authoritativeSuggestion.required_keywords)
              ? authoritativeSuggestion.required_keywords
              : [],
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
    } catch (txErr: unknown) {
      if (
        txErr &&
        typeof txErr === 'object' &&
        'code' in txErr &&
        (txErr as { code: string }).code === 'P2002'
      ) {
        const raced = await prisma.question.findFirst({
          where: { sessionId, questionNumber: parsedQuestionNumber },
        })
        if (raced) {
          return NextResponse.json({ message: 'Question already generated', question: raced }, { status: 200 })
        }
      }
      throw txErr
    }
  } catch (error: unknown) {
    console.error('Select question error:', error)
    return NextResponse.json({ error: 'Failed to save selected question' }, { status: 500 })
  }
}
