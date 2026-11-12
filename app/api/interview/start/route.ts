import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { generateLLMResponse } from '@/lib/llm'
import { QUESTION_GENERATOR_PROMPT, renderPromptTemplate, sanitizeUntrustedText } from '@/lib/llm/prompts'
import { formatRagContextWithCitations, searchChunks } from '@/lib/knowledge-base/searchChunks'
import { createAuditLog } from '@/lib/audit-log'
import { getValidatedAppSession } from '@/lib/auth-server'
import { verifySameOrigin } from '@/lib/csrf'
import { normalizeDifficulty } from '@/lib/interview/difficulty'
import { buildAnonymizedMemoryContext } from '@/lib/interview/memory'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const csrfError = verifySameOrigin(req)
    if (csrfError) return csrfError

    const res = NextResponse.json({})
    const ironSession = await getValidatedAppSession(req, res)
    const userId = ironSession?.isLoggedIn ? ironSession.userId ?? null : null
    const username = ironSession?.username ?? null
    const userRole = ironSession?.role ?? null

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (userRole === 'CANDIDATE') {
      return NextResponse.json(
        { error: 'Candidates cannot create interviews. Please join an assigned interview.' },
        { status: 403 }
      )
    }

    const rateLimit = await checkRateLimit({
      key: `interview:start:user:${userId}`,
      limit: 30,
      windowSeconds: 15 * 60,
    })
    if (!rateLimit.allowed) {
      return rateLimitResponse(
        rateLimit.retryAfterSeconds,
        'Too many interview start requests. Please wait before starting another session.'
      )
    }

    const {
      candidateId,
      candidateName,
      subject: inputSubject,
      subjects: inputSubjects,
      difficulty,
      mode,
      setupData,
      forceProvider,
    } = await req.json()

    if (!candidateName && !candidateId) {
      return NextResponse.json({ error: 'Missing candidate identifier' }, { status: 400 })
    }

    const isKnowledgeMode = mode === 'knowledge' || mode === 'knowledge-base'
    const parsedSubjects = Array.isArray(inputSubjects)
      ? inputSubjects.map((s) => String(s).trim()).filter(Boolean)
      : typeof inputSubject === 'string' && inputSubject.includes(',')
        ? inputSubject.split(',').map((s) => s.trim()).filter(Boolean)
        : []
    const subject =
      (typeof inputSubject === 'string' && inputSubject.trim()) ||
      parsedSubjects[0] ||
      (isKnowledgeMode ? 'Knowledge Base' : 'General Technical')
    const multiSubjectsList = Array.from(new Set([subject, ...parsedSubjects].filter(Boolean)))
    const sessionDifficulty = normalizeDifficulty(difficulty, 'medium')

    let selectedDocIds: number[] | undefined = undefined

    if (isKnowledgeMode) {
      try {
        if (typeof setupData === 'string' && setupData.trim()) {
          const parsed = JSON.parse(setupData)
          if (Array.isArray(parsed)) {
            selectedDocIds = parsed.map((id) => Number(id)).filter((id) => !isNaN(id))
          }
        } else if (Array.isArray(setupData)) {
          selectedDocIds = setupData.map((id) => Number(id)).filter((id) => !isNaN(id))
        }
      } catch {
        // ignore JSON parse error
      }

      if (!selectedDocIds || selectedDocIds.length === 0) {
        return NextResponse.json(
          { error: 'Please select at least one document for Knowledge Base mode.' },
          { status: 400 }
        )
      }

      const existingDocs = await prisma.document.findMany({
        where: {
          id: { in: selectedDocIds },
          userId: userId,
          storageStatus: 'AVAILABLE',
          status: 'PROCESSED',
          chunks: { some: {} },
        },
        select: { id: true },
      })

      if (existingDocs.length === 0) {
        return NextResponse.json(
          {
            error:
              'Selected Knowledge Base documents must be processed with indexed chunks before starting.',
          },
          { status: 400 }
        )
      }

      selectedDocIds = existingDocs.map((d) => d.id)
    }

    let candidate = null
    if (candidateId) {
      const found = await prisma.candidate.findUnique({
        where: { id: String(candidateId) },
        include: {
          sessions: {
            select: { interviewerId: true },
          },
        },
      })
      if (!found) {
        return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })
      }
      if (userRole !== 'ADMIN') {
        const hasOtherInterviewerSessions = found.sessions.some(
          (s) => s.interviewerId !== null && s.interviewerId !== userId
        )
        const hasOwnSessions = found.sessions.some((s) => s.interviewerId === userId)
        const isUnclaimedRegistered = found.userId !== null && found.sessions.length === 0
        if (!hasOwnSessions && !isUnclaimedRegistered && hasOtherInterviewerSessions) {
          return NextResponse.json(
            { error: 'Forbidden: you do not have access to this candidate.' },
            { status: 403 }
          )
        }
        if (hasOtherInterviewerSessions && !hasOwnSessions) {
          return NextResponse.json(
            { error: 'Forbidden: you do not have access to this candidate.' },
            { status: 403 }
          )
        }
      }
      candidate = found
    }

    if (!candidate && candidateName) {
      const trimmedName = String(candidateName).trim()
      if (userRole === 'ADMIN') {
        candidate = await prisma.candidate.findFirst({
          where: { name: { equals: trimmedName, mode: 'insensitive' } },
        })
      } else {
        // Scope name lookup to this interviewer's own candidates or unclaimed registered candidates
        candidate = await prisma.candidate.findFirst({
          where: {
            name: { equals: trimmedName, mode: 'insensitive' },
            OR: [
              { sessions: { some: { interviewerId: userId } } },
              { userId: { not: null }, sessions: { none: {} } },
            ],
          },
        })
      }
    }

    if (!candidate) {
      candidate = await prisma.candidate.create({
        data: { name: (typeof candidateName === 'string' && candidateName.trim()) || 'Candidate' },
      })
    }

    const adminForcedProvider =
      userRole === 'ADMIN' && forceProvider && (forceProvider === 'gemini' || forceProvider === 'groq')
        ? forceProvider
        : undefined

    let contextText = ''
    let topicToStart = 'Fundamentals'
    let sourceReferences: ReturnType<typeof formatRagContextWithCitations>['sources'] = []

    const memoryContext = await buildAnonymizedMemoryContext(candidate.id).catch(
      () => 'No prior cross-interview memory recorded yet.'
    )

    if (mode === 'revision') {
      const searchResults = await searchChunks(
        `[${multiSubjectsList.join(' ')}] ${setupData || memoryContext}`,
        userId
      )
      const formatted = formatRagContextWithCitations(searchResults)
      sourceReferences = formatted.sources
      contextText =
        'TARGETED REVISION SESSION — Prioritize recurring weaknesses and forgetting-risk concepts:\n' +
        memoryContext +
        (formatted.contextText ? '\n\n' + formatted.contextText : '')
      topicToStart = 'Targeted Revision'
    } else if (mode === 'keywords' && setupData) {
      const searchResults = await searchChunks(`[${subject}] ${setupData}`, userId)
      const formatted = formatRagContextWithCitations(searchResults)
      sourceReferences = formatted.sources
      contextText =
        'FOCUS STRICTLY ON THESE KEYWORDS: ' +
        setupData +
        (formatted.contextText ? '\n\n' + formatted.contextText : '')
      topicToStart = 'Keyword Focused'
    } else if (isKnowledgeMode) {
      const searchResults = await searchChunks(`[${subject}]`, userId, 12, selectedDocIds)
      const formatted = formatRagContextWithCitations(searchResults)
      sourceReferences = formatted.sources
      contextText = formatted.contextText
        ? 'RESTRICT ALL QUESTIONS STRICTLY TO THE FOLLOWING KNOWLEDGE BASE MATERIAL ONLY. DO NOT ASK ANYTHING OUTSIDE THIS MATERIAL:\n\n' +
          formatted.contextText
        : 'No matching chunks crossed the similarity threshold; generate a grounded foundational question strictly scoped to the selected documents/subject.'
      topicToStart = 'Knowledge Base Based'
    } else {
      const searchResults = await searchChunks(
        `[${subject}] basics introduction definition core concepts`,
        userId
      )
      const formatted = formatRagContextWithCitations(searchResults)
      sourceReferences = formatted.sources
      contextText = formatted.contextText
    }

    const generatorPrompt = renderPromptTemplate(QUESTION_GENERATOR_PROMPT, {
      '{{subject}}': subject,
      '{{multi_subjects}}': multiSubjectsList.join(', ') || subject,
      '{{topic}}': topicToStart,
      '{{difficulty}}': sessionDifficulty,
      '{{context}}': sanitizeUntrustedText(contextText, 6000),
      '{{candidate_memory_context}}': memoryContext,
      '{{previous_question}}': 'None - Starting Interview',
      '{{candidate_answer}}': 'None - Starting Interview',
      '{{evaluation_summary}}': 'None - Initial Question Generation',
      '{{previous_questions}}': 'None',
      '{{earlier_context}}': 'None - Interview Just Started',
      '{{weak_concepts}}': 'None',
      '{{remaining_concepts}}': 'All',
    })

    const { text: nextQResponse } = await generateLLMResponse(
      generatorPrompt + '\n\nReply in strict JSON format.',
      adminForcedProvider
    )

    let nextQJson: Record<string, unknown> | null = null
    try {
      nextQJson = JSON.parse(nextQResponse)
    } catch {
      const cleaned = nextQResponse.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim()
      try {
        nextQJson = JSON.parse(cleaned)
      } catch {
        return NextResponse.json(
          { error: 'AI provider returned an invalid question payload. Please try starting again.' },
          { status: 502 }
        )
      }
    }

    const suggestionsArr = Array.isArray(nextQJson?.suggestions)
      ? (nextQJson.suggestions as Array<Record<string, unknown>>)
      : []
    const suggestion = suggestionsArr[0] || nextQJson
    const generatedQuestionText =
      typeof suggestion?.question === 'string' ? suggestion.question.trim() : ''

    if (!generatedQuestionText) {
      return NextResponse.json(
        { error: 'AI provider failed to generate an opening question. Please try again.' },
        { status: 502 }
      )
    }

    const { session, firstQuestion } = await prisma.$transaction(async (tx) => {
      const createdSession = await tx.interviewSession.create({
        data: {
          candidateId: candidate.id,
          interviewerId: userId,
          status: 'active',
          difficulty: sessionDifficulty,
          interviewType: 'Adaptive',
          scope: {
            subject,
            subjects: multiSubjectsList,
            mode: mode || 'standard',
            setupData: setupData || '',
            selectedDocumentIds: selectedDocIds || null,
          },
        },
      })

      const createdQuestion = await tx.question.create({
        data: {
          sessionId: createdSession.id,
          questionNumber: 1,
          content: generatedQuestionText,
          type: typeof suggestion?.type === 'string' && suggestion.type ? suggestion.type : 'Conceptual',
          difficulty: normalizeDifficulty(suggestion?.difficulty as string | undefined, sessionDifficulty),
          topic: typeof suggestion?.topic === 'string' && suggestion.topic ? suggestion.topic : 'Fundamentals',
          expectedAnswer: typeof suggestion?.expected_answer === 'string' ? suggestion.expected_answer : '',
          coreConcepts: Array.isArray(suggestion?.concepts) ? suggestion.concepts.map(String) : [],
          requiredKeywords: Array.isArray(suggestion?.required_keywords)
            ? suggestion.required_keywords.map(String)
            : [],
          sourceReferences:
            sourceReferences.length > 0
              ? (sourceReferences as unknown as Prisma.InputJsonValue)
              : undefined,
        },
      })

      return { session: createdSession, firstQuestion: createdQuestion }
    })

    createAuditLog({
      userId,
      username,
      action: 'INTERVIEW_CREATED',
      entityType: 'InterviewSession',
      entityId: session.id,
      metadata: {
        candidateName: candidate.name,
        subject,
        difficulty: sessionDifficulty,
        mode: mode || 'standard',
        selectedDocumentIds: selectedDocIds,
      },
    })

    return NextResponse.json({
      sessionId: session.id,
      difficulty: sessionDifficulty,
      subject,
      candidate: { id: candidate.id, name: candidate.name, email: candidate.email },
      firstQuestion: {
        id: firstQuestion.id,
        content: firstQuestion.content,
        questionNumber: firstQuestion.questionNumber,
        sourceReferences,
      },
    })
  } catch (error: unknown) {
    const { handleLLMError } = await import('@/lib/llm')
    return handleLLMError(error)
  }
}
