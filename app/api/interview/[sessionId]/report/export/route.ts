import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getValidatedAppSession } from '@/lib/auth-server'
import { formatInterviewerName } from '@/lib/formatters'
import { csvEscape, sanitizeReportForRole } from '@/lib/report-privacy'

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ sessionId: string }> }
) {
  try {
    const res = NextResponse.json({})
    const userSession = await getValidatedAppSession(req, res)
    if (!userSession?.isLoggedIn || !userSession.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { sessionId } = await context.params
    const format = (new URL(req.url).searchParams.get('format') || 'json').toLowerCase()

    const session = await prisma.interviewSession.findUnique({
      where: { id: sessionId },
      include: {
        candidate: true,
        interviewer: { select: { username: true, email: true, candidate: { select: { name: true } } } },
        report: true,
        gaps: true,
        questions: {
          orderBy: { askedAt: 'asc' },
          include: { answer: { include: { evaluation: true } } },
        },
      },
    })

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const isOwner =
      userSession.role === 'ADMIN' ||
      session.interviewerId === userSession.userId ||
      (session.candidate?.userId !== null && session.candidate?.userId === userSession.userId)

    if (!isOwner) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (userSession.role === 'CANDIDATE' && session.status !== 'completed') {
      return NextResponse.json(
        { error: 'Report export is available only after the interview is completed.' },
        { status: 403 }
      )
    }

    const safeReport = sanitizeReportForRole(session.report, userSession.role)

    const scope = session.scope as { subject?: string; subjects?: string[]; mode?: string } | null
    const interviewerName = formatInterviewerName(session.interviewer)

    if (format === 'csv') {
      const rows: string[][] = [
        ['Section', 'Field / Q#', 'Topic', 'Difficulty', 'Score', 'Details / Transcript', 'Feedback / Concepts'],
        ['Session', 'Candidate', scope?.subject || 'General', session.difficulty, String(session.score ?? session.report?.overallScore ?? ''), session.candidate.name, session.status],
        ['Session', 'Interviewer', '', '', '', interviewerName, session.startedAt.toISOString()],
      ]

      if (session.report) {
        rows.push(['Report', 'Executive Summary', '', '', String(session.report.overallScore), session.report.executiveSummary, session.report.improvementPlan])
        rows.push(['Report', 'Strengths & Weaknesses', '', '', '', session.report.strengths.join('; '), session.report.weaknesses.join('; ')])
      }

      for (const q of session.questions) {
        const ev = q.answer?.evaluation
        rows.push([
          'Question',
          `Q${q.questionNumber}`,
          q.topic || '',
          q.difficulty,
          ev ? String(ev.score) : '',
          `${q.content} || Answer: ${q.answer?.transcript || ''}`,
          ev
            ? `Feedback: ${ev.feedback} | Reasoning: ${ev.reasoningQuality || ''} | Comm: ${ev.communicationScore ?? ''} ${ev.communicationFeedback || ''}`
            : 'Not evaluated',
        ])
      }

      const csvBody = rows.map((r) => r.map(csvEscape).join(',')).join('\r\n')
      return new NextResponse(csvBody, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="smartinterview-report-${session.id}.csv"`,
        },
      })
    }

    const payload = {
      exportedAt: new Date().toISOString(),
      session: {
        id: session.id,
        status: session.status,
        difficulty: session.difficulty,
        subject: scope?.subject || 'General Technical',
        subjects: scope?.subjects || [scope?.subject || 'General Technical'],
        mode: scope?.mode || 'standard',
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        overallScore: session.score ?? session.report?.overallScore ?? null,
        topicsCovered: session.topicsCovered,
        strongTopics: session.strongTopics,
        weakTopics: session.weakTopics,
      },
      candidate: {
        id: session.candidate.id,
        name: session.candidate.name,
        email: session.candidate.email,
      },
      interviewer: interviewerName,
      report: safeReport,
      knowledgeGaps: session.gaps,
      questions: session.questions.map((q) => ({
        questionNumber: q.questionNumber,
        content: q.content,
        topic: q.topic,
        difficulty: q.difficulty,
        type: q.type,
        sourceReferences: q.sourceReferences,
        answer: q.answer
          ? {
              transcript: q.answer.transcript,
              answeredAt: q.answer.answeredAt,
              evaluation: q.answer.evaluation,
            }
          : null,
      })),
    }

    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="smartinterview-report-${session.id}.json"`,
      },
    })
  } catch (err) {
    console.error('Export report error:', err)
    return NextResponse.json({ error: 'Failed to export report' }, { status: 500 })
  }
}
