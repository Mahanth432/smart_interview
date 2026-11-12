import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { generateLLMResponse, handleLLMError } from '@/lib/llm'
import {
  ANSWER_EVALUATOR_PROMPT,
  QUESTION_GENERATOR_PROMPT,
  renderPromptTemplate,
  sanitizeUntrustedText,
} from '@/lib/llm/prompts'
import { determineNextQuestionParams, updateSessionState } from '@/lib/interview/engine'
import { expireStaleSessions } from '@/lib/interview/lifecycle'
import { parseEvaluationScore } from '@/lib/interview/difficulty'
import {
  buildAnonymizedMemoryContext,
  deduplicateQuestionSuggestions,
  recordEvaluationToCandidateMemory,
} from '@/lib/interview/memory'
import { formatRagContextWithCitations, searchChunks } from '@/lib/knowledge-base/searchChunks'
import { getValidatedAppSession } from '@/lib/auth-server'
import { verifySameOrigin } from '@/lib/csrf'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

export const maxDuration = 60

function toStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return []
  return val.map((item) => String(item).trim()).filter(Boolean)
}

export async function POST(req: NextRequest) {
  let claimedAnswerId: string | null = null
  try {
    const csrfError = verifySameOrigin(req)
    if (csrfError) return csrfError

    const res = NextResponse.json({})
    const userSession = await getValidatedAppSession(req, res)
    if (!userSession?.isLoggedIn || !userSession.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const rateLimit = await checkRateLimit({
      key: `interview:evaluate:user:${userSession.userId}`,
      limit: 60,
      windowSeconds: 15 * 60,
    })
    if (!rateLimit.allowed) {
      return rateLimitResponse(
        rateLimit.retryAfterSeconds,
        'Too many answer evaluation requests. Please wait before submitting again.'
      )
    }

    const { sessionId, questionId, transcript, forceProvider } = await req.json()

    if (!sessionId || !questionId || !transcript) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const question = await prisma.question.findUnique({
      where: { id: questionId },
      include: { session: { include: { candidate: true } } },
    })

    if (!question || question.sessionId !== sessionId) {
      return NextResponse.json({ error: 'Question not found' }, { status: 404 })
    }

    const isOwner =
      userSession.role === 'ADMIN' ||
      question.session.interviewerId === userSession.userId ||
      (question.session.candidate?.userId !== null &&
        question.session.candidate?.userId === userSession.userId)

    if (!isOwner) {
      return NextResponse.json({ error: 'Question not found or unauthorized' }, { status: 404 })
    }

    await expireStaleSessions().catch(() => {})

    if (question.session.status !== 'active') {
      return NextResponse.json(
        { error: `Cannot evaluate answers on a ${question.session.status} session.` },
        { status: 409 }
      )
    }

    let answer = await prisma.answer.findUnique({
      where: { questionId: question.id },
    })

    let evalJson: Record<string, unknown> | null = null

    if (answer) {
      const existingEval = await prisma.answerEvaluation.findUnique({
        where: { answerId: answer.id },
      })
      const nextQuestion = await prisma.question.findFirst({
        where: { sessionId, questionNumber: question.questionNumber + 1 },
      })

      if (existingEval) {
        return NextResponse.json({
          success: true,
          alreadyProcessed: true,
          evaluation: existingEval,
          ...(nextQuestion
            ? {
                nextQuestion: {
                  id: nextQuestion.id,
                  content: nextQuestion.content,
                  questionNumber: nextQuestion.questionNumber,
                },
              }
            : {}),
        })
      }

      if (Date.now() - answer.answeredAt.getTime() < 45_000) {
        return NextResponse.json(
          { error: 'Evaluation is already in progress for this question. Please wait.' },
          { status: 409 }
        )
      }
      claimedAnswerId = answer.id
    }

    if (!answer) {
      try {
        answer = await prisma.answer.create({
          data: {
            questionId: question.id,
            transcript,
          },
        })
        claimedAnswerId = answer.id
      } catch (err: unknown) {
        if (
          err &&
          typeof err === 'object' &&
          'code' in err &&
          (err as { code: string }).code === 'P2002'
        ) {
          const racedAnswer = await prisma.answer.findUnique({ where: { questionId: question.id } })
          if (racedAnswer) {
            const racedEval = await prisma.answerEvaluation.findUnique({
              where: { answerId: racedAnswer.id },
            })
            if (racedEval) {
              return NextResponse.json({
                success: true,
                alreadyProcessed: true,
                evaluation: racedEval,
              })
            }
          }
          return NextResponse.json(
            { error: 'Evaluation is already in progress for this question. Please wait.' },
            { status: 409 }
          )
        } else {
          throw err
        }
      }
    }

    // Critical ownership rule: always search chunks owned by the session's interviewer
    const ragOwnerUserId = question.session.interviewerId ?? userSession.userId

    const scope = (question.session?.scope as Record<string, unknown>) || {}
    const mode = (scope.mode as string) || 'standard'
    const setupData = (scope.setupData as string) || ''
    const isKnowledgeMode = mode === 'knowledge' || mode === 'knowledge-base'
    let selectedDocIds: number[] | undefined = undefined

    const adminOverride =
      userSession.role === 'ADMIN' &&
      forceProvider &&
      (forceProvider === 'gemini' || forceProvider === 'groq')
        ? forceProvider
        : undefined

    if (isKnowledgeMode) {
      if (Array.isArray(scope.selectedDocumentIds)) {
        selectedDocIds = (scope.selectedDocumentIds as unknown[])
          .map(Number)
          .filter((id) => !isNaN(id))
      } else if (typeof setupData === 'string' && setupData.trim()) {
        try {
          const parsed = JSON.parse(setupData)
          if (Array.isArray(parsed)) {
            selectedDocIds = parsed.map(Number).filter((id) => !isNaN(id))
          }
        } catch {
          // ignore parse error
        }
      }
    }

    const existingEvalRecord = answer
      ? await prisma.answerEvaluation.findUnique({ where: { answerId: answer.id } })
      : null

    if (!existingEvalRecord) {
      let searchResults: Awaited<ReturnType<typeof searchChunks>> = []
      if (isKnowledgeMode) {
        searchResults = await searchChunks(
          question.content + ' ' + transcript,
          ragOwnerUserId,
          undefined,
          selectedDocIds
        )
      } else if (mode === 'keywords') {
        searchResults = await searchChunks(
          `[${scope.subject || ''}] ${setupData} ${question.content}`,
          ragOwnerUserId
        )
      } else {
        searchResults = await searchChunks(question.content + ' ' + transcript, ragOwnerUserId)
      }
      const { contextText } = formatRagContextWithCitations(searchResults)

      const evaluatorPrompt = renderPromptTemplate(ANSWER_EVALUATOR_PROMPT, {
        '{{question}}': sanitizeUntrustedText(question.content, 2000),
        '{{expected_answer}}': sanitizeUntrustedText(question.expectedAnswer || '', 2000),
        '{{required_keywords}}': question.requiredKeywords.join(', '),
        '{{candidate_answer}}': sanitizeUntrustedText(transcript, 6000),
        '{{context}}': sanitizeUntrustedText(contextText, 6000),
      })

      const { text: evaluationResponse } = await generateLLMResponse(
        evaluatorPrompt + '\n\nReply in strict JSON format.',
        adminOverride
      )

      try {
        evalJson = JSON.parse(evaluationResponse)
      } catch {
        let cleaned = evaluationResponse.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim()
        cleaned = cleaned.replace(/,\s*([\}\]])/g, '$1')
        try {
          evalJson = JSON.parse(cleaned)
        } catch {
          console.error('Failed to parse eval JSON cleanly')
          if (claimedAnswerId) {
            await prisma.answer.delete({ where: { id: claimedAnswerId } }).catch(() => {})
            claimedAnswerId = null
          }
          return NextResponse.json(
            { error: 'AI evaluation returned an invalid response. Please retry submitting your answer.' },
            { status: 502 }
          )
        }
      }

      const rawScoreVal = evalJson?.score
      const hasNumericScore =
        typeof rawScoreVal === 'number'
          ? Number.isFinite(rawScoreVal)
          : typeof rawScoreVal === 'string' && rawScoreVal.trim() !== '' && Number.isFinite(Number(rawScoreVal))
      if (!hasNumericScore) {
        if (claimedAnswerId) {
          await prisma.answer.delete({ where: { id: claimedAnswerId } }).catch(() => {})
          claimedAnswerId = null
        }
        return NextResponse.json(
          { error: 'AI evaluation did not include a valid score. Please retry submitting your answer.' },
          { status: 502 }
        )
      }

      const safeScore = parseEvaluationScore(rawScoreVal, 0)
      const commRaw = evalJson?.communication_score ?? evalJson?.communicationScore
      const commScore =
        commRaw !== undefined && commRaw !== null ? parseEvaluationScore(commRaw, safeScore) : null
      const commFeedback = String(
        evalJson?.communication_feedback ?? evalJson?.communicationFeedback ?? ''
      )
      const correctConcepts = toStringArray(evalJson?.correct_concepts ?? evalJson?.correctConcepts)
      const missingConceptsEval = toStringArray(evalJson?.missing_concepts ?? evalJson?.missingConcepts)
      const incorrectConceptsEval = toStringArray(
        evalJson?.incorrect_concepts ?? evalJson?.incorrectConcepts
      )
      const reasoningQuality = String(
        evalJson?.reasoning_quality ?? evalJson?.reasoningQuality ?? ''
      )
      const mentionedKeywords = toStringArray(
        evalJson?.mentioned_keywords ?? evalJson?.mentionedKeywords
      )
      const missingKeywords = toStringArray(
        evalJson?.missing_keywords ?? evalJson?.missingKeywords
      )

      await prisma.answerEvaluation.upsert({
        where: { answerId: answer.id },
        update: {
          score: safeScore,
          correctness: String(evalJson?.correctness || ''),
          completeness: String(evalJson?.completeness || ''),
          relevance: String(evalJson?.relevance || ''),
          technicalAccuracy: String(
            evalJson?.technical_accuracy ?? evalJson?.technicalAccuracy ?? ''
          ),
          mentionedKeywords,
          missingKeywords,
          correctConcepts,
          missingConcepts: missingConceptsEval,
          incorrectConcepts: incorrectConceptsEval,
          reasoningQuality,
          communicationScore: commScore,
          communicationFeedback: commFeedback,
          feedback: String(evalJson?.feedback || ''),
        },
        create: {
          answerId: answer.id,
          score: safeScore,
          correctness: String(evalJson?.correctness || ''),
          completeness: String(evalJson?.completeness || ''),
          relevance: String(evalJson?.relevance || ''),
          technicalAccuracy: String(
            evalJson?.technical_accuracy ?? evalJson?.technicalAccuracy ?? ''
          ),
          mentionedKeywords,
          missingKeywords,
          correctConcepts,
          missingConcepts: missingConceptsEval,
          incorrectConcepts: incorrectConceptsEval,
          reasoningQuality,
          communicationScore: commScore,
          communicationFeedback: commFeedback,
          feedback: String(evalJson?.feedback || ''),
        },
      })

      const recordedGaps: Array<{ concept: string }> = []
      if (Array.isArray(evalJson?.knowledge_gap)) {
        const existingSessionGaps = await prisma.knowledgeGap.findMany({
          where: { sessionId },
          select: { concept: true },
        })
        const seenGapConcepts = new Set(
          existingSessionGaps.map((g) => g.concept.trim().toLowerCase())
        )
        for (const gap of evalJson.knowledge_gap as Array<{
          concept: string
          confidence: string
          evidence: string
        }>) {
          const conceptName = typeof gap?.concept === 'string' ? gap.concept.trim() : ''
          if (conceptName && !seenGapConcepts.has(conceptName.toLowerCase())) {
            seenGapConcepts.add(conceptName.toLowerCase())
            recordedGaps.push({ concept: conceptName })
            await prisma.knowledgeGap.create({
              data: {
                sessionId,
                concept: conceptName,
                confidence: String(gap.confidence || 'Medium'),
                evidence: String(gap.evidence || ''),
              },
            })
          }
        }
      }

      await updateSessionState(sessionId)

      await recordEvaluationToCandidateMemory({
        candidateId: question.session.candidateId,
        subject: (scope.subject as string) || 'General Technical',
        topic: question.topic,
        coreConcepts: question.coreConcepts,
        score: safeScore,
        communicationScore: commScore,
        reasoningQuality,
        correctConcepts,
        missingConcepts: missingConceptsEval,
        incorrectConcepts: incorrectConceptsEval,
        knowledgeGaps: recordedGaps,
        sourceReferences:
          (question.sourceReferences as unknown as Awaited<
            ReturnType<typeof formatRagContextWithCitations>
          >['sources']) || [],
      }).catch((memErr) => console.warn('Candidate memory update warning:', memErr))

      const { createAuditLog } = await import('@/lib/audit-log')
      createAuditLog({
        userId: userSession.userId,
        username: userSession.username,
        action: 'INTERVIEW_EVALUATED',
        entityType: 'Question',
        entityId: questionId,
        metadata: { score: safeScore, sessionId },
      })
    }

    const nextParams = await determineNextQuestionParams(sessionId)

    if (!evalJson && answer) {
      evalJson = (await prisma.answerEvaluation.findUnique({
        where: { answerId: answer.id },
      })) as unknown as Record<string, unknown> | null
    }

    const evalScore = parseEvaluationScore(evalJson?.score, 70)
    const evalCorrectness = String(evalJson?.correctness || 'Not evaluated')
    const evalCompleteness = String(evalJson?.completeness || 'Not evaluated')
    const evalTechAccuracy = String(
      evalJson?.technical_accuracy ?? evalJson?.technicalAccuracy ?? 'Not evaluated'
    )

    let missingConcepts = toStringArray(evalJson?.missing_concepts ?? evalJson?.missingConcepts)
    if (missingConcepts.length === 0) {
      missingConcepts = toStringArray(evalJson?.missingKeywords ?? evalJson?.missing_keywords)
    }

    const incorrectConcepts = toStringArray(
      evalJson?.incorrect_concepts ?? evalJson?.incorrectConcepts
    )

    const evalFeedback = String(evalJson?.feedback || 'No feedback provided')

    const evaluationSummary = [
      `- Score: ${evalScore}/100`,
      `- Correctness: ${evalCorrectness}`,
      `- Completeness: ${evalCompleteness}`,
      `- Technical Accuracy: ${evalTechAccuracy}`,
      `- Missing Concepts: ${missingConcepts.length > 0 ? missingConcepts.join(', ') : 'None identified'}`,
      `- Misconceptions / Incorrect Concepts: ${incorrectConcepts.length > 0 ? incorrectConcepts.join(', ') : 'None identified'}`,
      `- Evaluator Feedback: ${evalFeedback}`,
    ].join('\n')

    const focusTerms = Array.from(
      new Set([...missingConcepts, ...incorrectConcepts, ...nextParams.weakConcepts])
    ).filter((t) => typeof t === 'string' && t.trim().length > 0)

    const candidateTranscript = transcript || answer?.transcript || ''
    const answerSnippet = candidateTranscript.slice(0, 150).replace(/\s+/g, ' ').trim()

    let adaptiveRAGQuery = ''
    if (focusTerms.length > 0) {
      adaptiveRAGQuery = `${question.content} ${focusTerms.slice(0, 5).join(' ')} ${answerSnippet}`.trim()
    } else {
      adaptiveRAGQuery = `${question.content} ${answerSnippet}`.trim()
    }

    if (!adaptiveRAGQuery) {
      adaptiveRAGQuery = question.content || (scope.subject as string) || 'General Knowledge'
    }

    let contextTextNext = ''
    let nextSourceReferences: ReturnType<typeof formatRagContextWithCitations>['sources'] = []
    try {
      if (mode === 'keywords') {
        const searchResultsNext = await searchChunks(
          `[${scope.subject || ''}] ${setupData} ${adaptiveRAGQuery}`,
          ragOwnerUserId,
          3
        )
        const formattedNext = formatRagContextWithCitations(searchResultsNext)
        nextSourceReferences = formattedNext.sources
        contextTextNext =
          'FOCUS STRICTLY ON THESE KEYWORDS: ' +
          setupData +
          (formattedNext.contextText ? '\n\n' + formattedNext.contextText : '')
      } else if (isKnowledgeMode) {
        const searchResultsNext = await searchChunks(
          adaptiveRAGQuery,
          ragOwnerUserId,
          10,
          selectedDocIds
        )
        const formattedNext = formatRagContextWithCitations(searchResultsNext)
        nextSourceReferences = formattedNext.sources
        contextTextNext = formattedNext.contextText
          ? 'RESTRICT ALL QUESTIONS STRICTLY TO THE FOLLOWING KNOWLEDGE BASE MATERIAL ONLY. DO NOT ASK ANYTHING OUTSIDE THIS MATERIAL:\n\n' +
            formattedNext.contextText
          : 'RESTRICT ALL QUESTIONS STRICTLY TO THE CONFIGURED KNOWLEDGE BASE MATERIAL.'
      } else {
        const searchResultsNext = await searchChunks(adaptiveRAGQuery, ragOwnerUserId, 3)
        const formattedNext = formatRagContextWithCitations(searchResultsNext)
        nextSourceReferences = formattedNext.sources
        contextTextNext = formattedNext.contextText
      }
    } catch (ragErr) {
      console.warn(
        'RAG retrieval for follow-up question generation encountered an error; proceeding with fallback context:',
        ragErr
      )
      contextTextNext = ''
    }

    const previousQuestionsFormatted =
      nextParams.previousQuestions.length > 0
        ? nextParams.previousQuestions.map((q, idx) => `${idx + 1}. ${q}`).join('\n')
        : 'None'

    const memoryContextNext = await buildAnonymizedMemoryContext(question.session.candidateId).catch(
      () => 'No prior cross-interview memory recorded yet.'
    )
    const multiSubjects = Array.isArray(scope.subjects)
      ? (scope.subjects as string[]).join(', ')
      : (scope.subject as string) || 'Configured Subject'

    const generatorPrompt = renderPromptTemplate(QUESTION_GENERATOR_PROMPT, {
      '{{subject}}': (scope.subject as string) || 'Configured Subject',
      '{{multi_subjects}}': multiSubjects,
      '{{topic}}': question.topic || 'Adaptive Topic',
      '{{difficulty}}': nextParams.difficulty,
      '{{context}}': sanitizeUntrustedText(contextTextNext, 6000),
      '{{candidate_memory_context}}': memoryContextNext,
      '{{previous_question}}': sanitizeUntrustedText(question.content, 2000),
      '{{candidate_answer}}': sanitizeUntrustedText(candidateTranscript || 'No answer recorded', 4000),
      '{{evaluation_summary}}': evaluationSummary,
      '{{previous_questions}}': sanitizeUntrustedText(previousQuestionsFormatted, 3000),
      '{{earlier_context}}': sanitizeUntrustedText(
        nextParams.earlierContextText || 'None (First completed question)',
        3000
      ),
      '{{weak_concepts}}': nextParams.weakConcepts.join(', ') || 'None',
      '{{remaining_concepts}}': missingConcepts.join(', ') || 'None',
    })

    const { text: nextQResponse } = await generateLLMResponse(
      generatorPrompt + '\n\nReply in strict JSON format.',
      adminOverride
    )
    let nextQJson
    try {
      nextQJson = JSON.parse(nextQResponse)
    } catch {
      let cleaned = nextQResponse.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim()
      cleaned = cleaned.replace(/,\s*([\}\]])/g, '$1')
      try {
        nextQJson = JSON.parse(cleaned)
      } catch {
        console.error('Failed to parse nextQ JSON:', cleaned)
        nextQJson = {
          suggestions: [
            {
              question: 'Can you elaborate further on that concept?',
              type: 'Conceptual',
              difficulty: nextParams.difficulty,
              topic: question.topic || 'Follow-up',
            },
          ],
        }
      }
    }

    const savedEval = await prisma.answerEvaluation.findUnique({ where: { answerId: answer.id } })
    const dedupedRaw = deduplicateQuestionSuggestions(
      Array.isArray(nextQJson.suggestions) ? nextQJson.suggestions : [nextQJson],
      nextParams.previousQuestions
    )
    const rawSuggestions = dedupedRaw.map((s: Record<string, unknown>) => ({
      ...s,
      sourceReferences: nextSourceReferences,
    }))

    // Persist pending follow-up suggestions so page reloads preserve them cleanly
    await prisma.interviewSession.update({
      where: { id: sessionId },
      data: {
        pendingSuggestions: {
          forQuestionNumber: question.questionNumber,
          suggestions: rawSuggestions,
          sourceReferences: nextSourceReferences,
        } as unknown as Prisma.InputJsonValue,
      },
    })

    return NextResponse.json({
      success: true,
      evaluation: savedEval || evalJson,
      suggestedQuestions: rawSuggestions,
      sourceReferences: nextSourceReferences,
      currentDifficulty: nextParams.difficulty,
    })
  } catch (error: unknown) {
    if (claimedAnswerId) {
      const hasSavedEval = await prisma.answerEvaluation
        .findUnique({ where: { answerId: claimedAnswerId }, select: { id: true } })
        .catch(() => null)
      if (!hasSavedEval) {
        await prisma.answer.delete({ where: { id: claimedAnswerId } }).catch(() => {})
      }
    }
    return handleLLMError(error)
  }
}
