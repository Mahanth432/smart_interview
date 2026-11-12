import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { generateLLMResponse } from '@/lib/llm'
import { getValidatedAppSession } from '@/lib/auth-server'
import { verifySameOrigin } from '@/lib/csrf'
import { expireStaleSessions } from '@/lib/interview/lifecycle'
import { refreshRevisionRecommendations } from '@/lib/interview/memory'
import { renderPromptTemplate } from '@/lib/llm/prompts'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

export const maxDuration = 60

const REPORT_GENERATOR_PROMPT = `
You are an expert technical interview assessor. Compile an executive final interview report based on the interview performance, topic breakdown, and knowledge gaps.

Session Info:
- Total Questions: {{totalQuestions}}
- Evaluated Questions: {{evaluatedQuestions}}
- Average Score: {{averageScore}}/100
- Topic Breakdown: {{topicBreakdown}}
- Identified Gaps: {{gaps}}

Respond in strict JSON with these EXACT camelCase keys:
{
  "executiveSummary": "2-4 sentence summary of overall candidate performance, strengths, and readiness.",
  "strengths": ["Concrete strength 1", "Concrete strength 2"],
  "weaknesses": ["Concrete area to improve 1", "Concrete area to improve 2"],
  "improvementPlan": "Actionable study and practice plan for the candidate."
}
`

function toStringList(val: unknown): string[] {
  if (!Array.isArray(val)) return []
  return val.map((item) => String(item).trim()).filter(Boolean)
}

export async function POST(req: NextRequest) {
  let lockedSessionId: string | null = null
  let previousStatus: string = 'active'
  try {
    const csrfError = verifySameOrigin(req)
    if (csrfError) return csrfError

    const res = NextResponse.json({})
    const userSession = await getValidatedAppSession(req, res)
    if (!userSession?.isLoggedIn || !userSession.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const rateLimit = await checkRateLimit({
      key: `interview:end:user:${userSession.userId}`,
      limit: 20,
      windowSeconds: 15 * 60,
    })
    if (!rateLimit.allowed) {
      return rateLimitResponse(
        rateLimit.retryAfterSeconds,
        'Too many end-interview requests. Please wait before trying again.'
      )
    }

    const { sessionId, forceProvider } = await req.json()
    if (!sessionId || typeof sessionId !== 'string') {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
    }

    const session = await prisma.interviewSession.findUnique({
      where: { id: sessionId },
      include: {
        candidate: true,
        questions: { include: { answer: { include: { evaluation: true } } } },
        gaps: true,
        report: true,
      },
    })

    if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const isOwner =
      userSession.role === 'ADMIN' ||
      session.interviewerId === userSession.userId ||
      (session.candidate?.userId !== null && session.candidate?.userId === userSession.userId)

    if (!isOwner) return NextResponse.json({ error: 'Not found or unauthorized' }, { status: 404 })

    await expireStaleSessions().catch(() => {})

    // Idempotency guard: if report already exists, return it cleanly without P2002 or extra LLM calls
    if (session.report) {
      if (session.status !== 'completed') {
        await prisma.interviewSession.update({
          where: { id: session.id },
          data: { status: 'completed', endedAt: session.endedAt ?? new Date() },
        })
      }
      return NextResponse.json({
        success: true,
        alreadyCompleted: true,
        reportId: session.report.id,
        report: session.report,
      })
    }

    if (session.status === 'abandoned') {
      return NextResponse.json(
        { error: 'Cannot finalize an abandoned interview session.' },
        { status: 409 }
      )
    }

    // Atomic concurrency lock: claim session for finalization across serverless workers
    previousStatus = session.status === 'paused' ? 'paused' : 'active'
    const lockClaim = await prisma.interviewSession.updateMany({
      where: {
        id: session.id,
        status: { in: ['active', 'paused'] },
      },
      data: { status: 'finalizing' },
    })
    if (lockClaim.count === 0) {
      return NextResponse.json(
        { error: 'Interview finalization is already in progress.' },
        { status: 409 }
      )
    }
    lockedSessionId = session.id

    const evaluatedQuestions = session.questions.filter((q) => q.answer?.evaluation)
    const avgScore =
      evaluatedQuestions.length > 0
        ? Math.round(
            (evaluatedQuestions.reduce(
              (sum, q) => sum + (q.answer?.evaluation?.score ?? 0),
              0
            ) /
              evaluatedQuestions.length) *
              100
          ) / 100
        : 0

    // Deterministic topic-wise aggregation
    const topicAgg = new Map<string, { sum: number; count: number }>()
    for (const q of evaluatedQuestions) {
      const topic = (q.topic || 'General').trim()
      const score = q.answer?.evaluation?.score ?? 0
      const entry = topicAgg.get(topic) ?? { sum: 0, count: 0 }
      entry.sum += score
      entry.count += 1
      topicAgg.set(topic, entry)
    }

    const topicScores: Record<string, { averageScore: number; questionCount: number }> = {}
    const topicsCovered: string[] = []
    const strongTopics: string[] = []
    const weakTopics: string[] = []

    for (const [topic, { sum, count }] of topicAgg.entries()) {
      const topicAvg = Math.round((sum / count) * 100) / 100
      topicScores[topic] = { averageScore: topicAvg, questionCount: count }
      topicsCovered.push(topic)
      if (topicAvg >= 75) strongTopics.push(topic)
      else if (topicAvg < 60) weakTopics.push(topic)
    }

    const topicBreakdownText =
      Object.entries(topicScores)
        .map(([t, s]) => `${t}: ${s.averageScore}/100 (${s.questionCount} Qs)`)
        .join('; ') || 'No evaluated topics'

    const gapTexts =
      session.gaps.map((g) => `${g.concept} (${g.evidence})`).join('; ') || 'None identified'

    const adminOverride =
      userSession.role === 'ADMIN' &&
      forceProvider &&
      (forceProvider === 'gemini' || forceProvider === 'groq')
        ? forceProvider
        : undefined

    const prompt = renderPromptTemplate(REPORT_GENERATOR_PROMPT, {
      '{{totalQuestions}}': session.questions.length.toString(),
      '{{evaluatedQuestions}}': evaluatedQuestions.length.toString(),
      '{{averageScore}}': avgScore.toFixed(2),
      '{{topicBreakdown}}': topicBreakdownText,
      '{{gaps}}': gapTexts,
    })

    const { text: reportRes } = await generateLLMResponse(
      prompt + '\n\nOutput JSON only.',
      adminOverride
    )

    let reportJson: Record<string, unknown> = {}
    try {
      reportJson = JSON.parse(reportRes)
    } catch {
      let cleaned = reportRes.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim()
      cleaned = cleaned.replace(/,\s*([\}\]])/g, '$1')
      try {
        reportJson = JSON.parse(cleaned)
      } catch {
        console.error('Failed to parse report JSON:', cleaned)
        reportJson = {
          executiveSummary: `Interview completed with an average score of ${avgScore.toFixed(1)}/100 across ${evaluatedQuestions.length} evaluated question(s).`,
          strengths: strongTopics,
          weaknesses: weakTopics.length > 0 ? weakTopics : session.gaps.map((g) => g.concept),
          improvementPlan:
            weakTopics.length > 0
              ? `Focus revision on: ${weakTopics.join(', ')}.`
              : 'Review session feedback and deepen core technical explanations.',
        }
      }
    }

    const strengths = toStringList(reportJson.strengths ?? reportJson.strong_topics)
    const weaknesses = toStringList(reportJson.weaknesses ?? reportJson.weak_topics)
    const executiveSummary =
      String(reportJson.executiveSummary ?? reportJson.executive_summary ?? '').trim() ||
      `Interview completed with an average score of ${avgScore.toFixed(1)}/100.`
    const improvementPlan =
      String(reportJson.improvementPlan ?? reportJson.recommended_study ?? '').trim() ||
      'Review feedback for each question and revisit highlighted knowledge gaps.'

    const report = await prisma.$transaction(async (tx) => {
      const upsertedReport = await tx.interviewReport.upsert({
        where: { sessionId: session.id },
        update: {},
        create: {
          sessionId: session.id,
          overallScore: avgScore,
          topicScores,
          strengths,
          weaknesses,
          executiveSummary,
          improvementPlan,
          aiExecutiveSummary: executiveSummary,
          aiStrengths: strengths,
          aiWeaknesses: weaknesses,
          aiImprovementPlan: improvementPlan,
        },
      })

      await tx.interviewSession.update({
        where: { id: session.id },
        data: {
          status: 'completed',
          endedAt: session.endedAt ?? new Date(),
          score: avgScore,
          topicsCovered,
          strongTopics,
          weakTopics,
          pendingSuggestions: Prisma.DbNull,
        },
      })

      return upsertedReport
    })

    await refreshRevisionRecommendations(session.candidateId, session.interviewerId).catch((err) =>
      console.warn('Revision refresh warning:', err)
    )

    const { createAuditLog } = await import('@/lib/audit-log')
    createAuditLog({
      userId: userSession.userId,
      username: userSession.username,
      action: 'INTERVIEW_COMPLETED',
      entityType: 'InterviewSession',
      entityId: sessionId,
      metadata: { overallScore: avgScore, reportId: report.id },
    })

    return NextResponse.json({ success: true, reportId: report.id, report })
  } catch (error: unknown) {
    if (lockedSessionId) {
      await prisma.interviewSession
        .updateMany({
          where: { id: lockedSessionId, status: 'finalizing' },
          data: { status: previousStatus },
        })
        .catch(() => {})
    }
    console.error('End interview error:', error)
    const { handleLLMError } = await import('@/lib/llm')
    return handleLLMError(error)
  }
}
