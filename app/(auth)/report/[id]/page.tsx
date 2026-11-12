export const dynamic = 'force-dynamic'

import React from 'react'
import prisma from '@/lib/db'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getValidatedAppSession } from '@/lib/auth-server'
import Icon from '@/components/Icon'
import { formatInterviewerName } from '@/lib/formatters'
import { ReportActionsClient } from '@/components/report/ReportActionsClient'

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params

  const userSession = await getValidatedAppSession()
  const userId = userSession.isLoggedIn ? userSession.userId : undefined

  if (!userId) {
    return (
      <div style={{ padding: '2rem', color: 'var(--zentra-text-primary)' }}>
        Unauthorized access. Please log in.
      </div>
    )
  }

  const session = await prisma.interviewSession.findUnique({
    where: { id: resolvedParams.id },
    include: {
      candidate: true,
      interviewer: {
        select: {
          username: true,
          email: true,
          candidate: { select: { name: true } },
        },
      },
      report: true,
      questions: {
        include: {
          answer: {
            include: {
              evaluation: true,
            },
          },
        },
        orderBy: { askedAt: 'asc' },
      },
      gaps: true,
    },
  })

  if (!session) return notFound()

  const isOwner =
    userSession.role === 'ADMIN' ||
    session.interviewerId === userId ||
    (session.candidate?.userId !== null && session.candidate?.userId === userId)

  if (!isOwner) return notFound()

  if (userSession.role === 'CANDIDATE' && session.status !== 'completed') {
    return notFound()
  }

  if (userSession.role === 'CANDIDATE') {
    const { createAuditLog } = await import('@/lib/audit-log')
    createAuditLog({
      userId,
      username: userSession.username,
      action: 'CANDIDATE_REPORT_VIEWED',
      entityType: 'InterviewSession',
      entityId: session.id,
      metadata: { candidateId: session.candidateId },
    })
  }

  // Historical comparison against prior sessions for this candidate (scoped safely)
  const priorSessions = await prisma.interviewSession.findMany({
    where: {
      candidateId: session.candidateId,
      id: { not: session.id },
      startedAt: { lt: session.startedAt },
      score: { not: null },
      ...(userSession.role === 'INTERVIEWER' ? { interviewerId: userId } : {}),
    },
    orderBy: { startedAt: 'desc' },
    take: 5,
    select: {
      id: true,
      startedAt: true,
      score: true,
      difficulty: true,
      scope: true,
    },
  })

  const scope = session.scope as { subject?: string; subjects?: string[]; mode?: string } | null
  const subject = scope?.subject || session.interviewType || 'Technical Interview'
  const mode = scope?.mode || 'standard'
  const interviewerName = formatInterviewerName(session.interviewer)
  const isCompleted = session.status === 'completed'
  const scoreNum = session.score !== null ? session.score : session.report?.overallScore ?? null
  const displayScore = scoreNum !== null ? `${scoreNum.toFixed(1)}%` : 'In Progress'

  const priorAvg =
    priorSessions.length > 0
      ? Math.round(
          (priorSessions.reduce((acc, s) => acc + (s.score ?? 0), 0) / priorSessions.length) * 10
        ) / 10
      : null
  const scoreDelta =
    scoreNum !== null && priorAvg !== null ? Math.round((scoreNum - priorAvg) * 10) / 10 : null

  const topicScores = (session.report?.topicScores ?? {}) as Record<
    string,
    { averageScore?: number; questionCount?: number } | number
  >
  const topicEntries = Object.entries(topicScores)

  const canEdit = userSession.role === 'ADMIN' || session.interviewerId === userId
  const backHref =
    userSession.role === 'CANDIDATE'
      ? '/candidate'
      : userSession.role === 'ADMIN'
        ? '/admin/interviews'
        : '/dashboard'

  return (
    <div className="zentra-page-container" style={{ maxWidth: '1280px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
      {/* Top Bar / Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1.25rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
            <h1 className="zentra-page-title" style={{ margin: 0 }}>
              {userSession.role === 'CANDIDATE'
                ? 'My Interview Performance Report'
                : `Interview Report: ${session.candidate.name}`}
            </h1>
            <span
              className={`zentra-badge ${isCompleted ? 'success' : 'warning'}`}
              style={{ textTransform: 'capitalize' }}
            >
              {session.status}
            </span>
          </div>
          <p className="zentra-page-subtitle" style={{ margin: 0 }}>
            {userSession.role === 'CANDIDATE' ? (
              <>
                Interview conducted on{' '}
                <span style={{ fontWeight: 600 }}>
                  {new Date(session.startedAt).toLocaleString(undefined, {
                    dateStyle: 'long',
                    timeStyle: 'short',
                  })}
                </span>
              </>
            ) : (
              <>
                Session ID: <span style={{ fontFamily: 'monospace' }}>{session.id}</span> &bull; Conducted{' '}
                {new Date(session.startedAt).toLocaleString()}
              </>
            )}
          </p>
        </div>

        <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <Link
            href="/report"
            prefetch={true}
            className="zentra-btn zentra-btn-secondary"
            style={{ textDecoration: 'none' }}
          >
            <Icon name="arrow_back" size={16} />
            <span>All Reports</span>
          </Link>
          <Link href={backHref} prefetch={true} className="zentra-btn zentra-btn-secondary" style={{ textDecoration: 'none' }}>
            <span>{userSession.role === 'CANDIDATE' ? 'Candidate Portal' : userSession.role === 'ADMIN' ? 'Interviews' : 'Dashboard'}</span>
          </Link>
        </div>
      </div>

      {/* Export + Edit Actions */}
      <ReportActionsClient
        sessionId={session.id}
        canEdit={canEdit}
        initialReport={
          session.report
            ? {
                executiveSummary: session.report.executiveSummary,
                strengths: session.report.strengths,
                weaknesses: session.report.weaknesses,
                improvementPlan: session.report.improvementPlan,
                interviewerNotes: session.report.interviewerNotes,
              }
            : null
        }
      />

      {/* Overview Metadata Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
        <div className="zentra-card">
          <span className="zentra-metric-label">Candidate</span>
          <div style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--zentra-text-primary)', marginTop: '0.35rem' }}>
            {session.candidate.name}
          </div>
          <span style={{ fontSize: '0.78rem', color: 'var(--zentra-text-muted)' }}>
            {session.candidate.email || 'Email not registered'}
          </span>
        </div>

        <div className="zentra-card">
          <span className="zentra-metric-label">Interviewer</span>
          <div style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--zentra-text-primary)', marginTop: '0.35rem' }}>
            {interviewerName}
          </div>
          <span style={{ fontSize: '0.78rem', color: 'var(--zentra-text-muted)' }}>Lead Evaluator</span>
        </div>

        <div className="zentra-card">
          <span className="zentra-metric-label">Interview Track</span>
          <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--zentra-text-primary)', marginTop: '0.35rem' }}>
            {Array.isArray(scope?.subjects) && scope.subjects.length > 1
              ? scope.subjects.join(' + ')
              : subject}
          </div>
          <span style={{ fontSize: '0.78rem', color: 'var(--zentra-text-muted)', textTransform: 'capitalize' }}>
            Mode: {mode}
          </span>
        </div>

        <div className="zentra-card">
          <span className="zentra-metric-label">Difficulty Level</span>
          <div style={{ marginTop: '0.35rem' }}>
            <span className="zentra-badge info" style={{ textTransform: 'capitalize', fontSize: '0.85rem' }}>
              {session.difficulty}
            </span>
          </div>
          <span style={{ fontSize: '0.78rem', color: 'var(--zentra-text-muted)', marginTop: '0.35rem', display: 'block' }}>
            {session.questions.length} question(s)
          </span>
        </div>

        <div className="zentra-card" style={{ borderColor: isCompleted ? 'rgba(16, 185, 129, 0.35)' : 'rgba(245, 158, 11, 0.35)' }}>
          <span className="zentra-metric-label">Overall Score</span>
          <div className="zentra-metric-num" style={{ color: isCompleted ? '#10b981' : '#f59e0b' }}>
            {displayScore}
          </div>
          {scoreDelta !== null && (
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: scoreDelta >= 0 ? '#10b981' : '#ef4444' }}>
              {scoreDelta >= 0 ? `+${scoreDelta}%` : `${scoreDelta}%`} vs prior avg ({priorAvg}%)
            </span>
          )}
        </div>
      </div>

      {/* Topic-Wise Scores */}
      {topicEntries.length > 0 && (
        <div className="zentra-card">
          <div className="zentra-card-header">
            <div>
              <h3 className="zentra-card-title">Topic-Wise Performance Breakdown</h3>
              <span style={{ fontSize: '0.8rem', color: 'var(--zentra-text-muted)' }}>
                Per-topic evaluation averages from this session
              </span>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
            {topicEntries.map(([topic, raw]) => {
              const avg =
                typeof raw === 'number'
                  ? raw
                  : typeof raw?.averageScore === 'number'
                    ? raw.averageScore
                    : 0
              const count = typeof raw === 'object' && raw !== null ? raw.questionCount ?? 1 : 1
              return (
                <div
                  key={topic}
                  style={{
                    background: 'var(--zentra-bg-muted)',
                    border: '1px solid var(--zentra-border)',
                    borderRadius: '12px',
                    padding: '0.9rem 1rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.45rem' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--zentra-text-primary)' }}>
                      {topic}
                    </span>
                    <span className={`zentra-badge ${avg >= 75 ? 'success' : avg >= 50 ? 'warning' : 'danger'}`}>
                      {Math.round(avg)}%
                    </span>
                  </div>
                  <div className="striped-progress-bar" style={{ height: '6px' }}>
                    <div
                      className="striped-progress-fill"
                      style={{
                        width: `${Math.min(100, Math.max(0, avg))}%`,
                        background: avg >= 75 ? '#10b981' : avg >= 50 ? '#f59e0b' : '#ef4444',
                      }}
                    />
                  </div>
                  <div style={{ marginTop: '0.35rem', fontSize: '0.72rem', color: 'var(--zentra-text-muted)' }}>
                    {count} evaluated question(s)
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Executive Report Summary */}
      {session.report && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {userSession.role !== 'CANDIDATE' && session.report.editedAt && (
            <div className="zentra-card" style={{ borderColor: 'rgba(37, 99, 235, 0.3)', padding: '1rem 1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.825rem', color: 'var(--zentra-text-secondary)' }}>
                  Reviewed &amp; edited by <strong>{session.report.editedByName || 'Interviewer'}</strong> on{' '}
                  {new Date(session.report.editedAt).toLocaleString()}
                </span>
                <span className="zentra-badge info">Human Reviewed</span>
              </div>
              {session.report.interviewerNotes && (
                <p style={{ margin: '0.6rem 0 0 0', fontSize: '0.875rem', color: 'var(--zentra-text-primary)' }}>
                  <strong>Reviewer Notes:</strong> {session.report.interviewerNotes}
                </p>
              )}
              {session.report.aiExecutiveSummary && (
                <details style={{ marginTop: '0.6rem', fontSize: '0.8rem', color: 'var(--zentra-text-muted)' }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                    View Original Preserved AI Evaluation
                  </summary>
                  <div style={{ marginTop: '0.5rem', padding: '0.75rem', borderRadius: '8px', background: 'var(--zentra-bg-muted)' }}>
                    <div><strong>AI Summary:</strong> {session.report.aiExecutiveSummary}</div>
                    {session.report.aiImprovementPlan && (
                      <div style={{ marginTop: '0.35rem' }}>
                        <strong>AI Plan:</strong> {session.report.aiImprovementPlan}
                      </div>
                    )}
                  </div>
                </details>
              )}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem' }}>
            <div className="zentra-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <Icon name="description" size={18} style={{ color: '#6366f1' }} />
                <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0, color: 'var(--zentra-text-primary)' }}>
                  Executive Summary
                </h3>
              </div>
              <p style={{ lineHeight: 1.6, color: 'var(--zentra-text-secondary)', margin: 0, fontSize: '0.92rem' }}>
                {session.report.executiveSummary}
              </p>
            </div>

            <div className="zentra-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <Icon name="trending_up" size={18} style={{ color: '#10b981' }} />
                <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0, color: 'var(--zentra-text-primary)' }}>
                  Improvement Plan
                </h3>
              </div>
              <p style={{ lineHeight: 1.6, color: 'var(--zentra-text-secondary)', margin: 0, fontSize: '0.92rem' }}>
                {session.report.improvementPlan}
              </p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem' }}>
            <div className="zentra-card" style={{ borderLeft: '4px solid #10b981' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <Icon name="check_circle" size={18} style={{ color: '#10b981' }} />
                <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0, color: '#10b981' }}>
                  Demonstrated Strengths
                </h3>
              </div>
              <ul style={{ margin: 0, paddingLeft: '1.25rem', color: 'var(--zentra-text-primary)', fontSize: '0.9rem', lineHeight: 1.6 }}>
                {session.report.strengths.map((s, i) => (
                  <li key={i} style={{ margin: '0.35rem 0' }}>{s}</li>
                ))}
              </ul>
            </div>

            <div className="zentra-card" style={{ borderLeft: '4px solid #ef4444' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <Icon name="warning" size={18} style={{ color: '#ef4444' }} />
                <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0, color: '#ef4444' }}>
                  Identified Weaknesses &amp; Gaps
                </h3>
              </div>
              <ul style={{ margin: 0, paddingLeft: '1.25rem', color: 'var(--zentra-text-primary)', fontSize: '0.9rem', lineHeight: 1.6 }}>
                {session.report.weaknesses.map((w, i) => (
                  <li key={i} style={{ margin: '0.35rem 0' }}>{w}</li>
                ))}
                {session.gaps.map((g, i) => (
                  <li key={`g${i}`} style={{ margin: '0.35rem 0', color: '#ef4444' }}>
                    {g.concept}{' '}
                    <span style={{ fontSize: '0.8rem', color: 'var(--zentra-text-muted)' }}>
                      (Confidence: {g.confidence})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Historical Comparison Table */}
      {priorSessions.length > 0 && (
        <div className="zentra-card">
          <h3 className="zentra-card-title" style={{ marginBottom: '0.85rem' }}>
            Historical Session Comparison
          </h3>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            {priorSessions.map((ps) => {
              const pScope = ps.scope as { subject?: string } | null
              return (
                <Link
                  key={ps.id}
                  href={`/report/${ps.id}`}
                  style={{
                    textDecoration: 'none',
                    padding: '0.7rem 1rem',
                    borderRadius: '12px',
                    background: 'var(--zentra-bg-muted)',
                    border: '1px solid var(--zentra-border)',
                    color: 'var(--zentra-text-primary)',
                    fontSize: '0.825rem',
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{pScope?.subject || 'Interview'}</div>
                  <div style={{ color: 'var(--zentra-text-muted)', fontSize: '0.75rem' }}>
                    {new Date(ps.startedAt).toLocaleDateString()} &bull; Score:{' '}
                    <strong>{Math.round(ps.score ?? 0)}%</strong>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* Detailed Interview Transcript & Q&A History */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--zentra-text-primary)', margin: 0 }}>
              Question &amp; Answer Breakdown
            </h2>
            <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: 'var(--zentra-text-muted)' }}>
              Technical accuracy, communication quality, concept mastery, and RAG sources
            </p>
          </div>
          <span className="zentra-badge neutral">{session.questions.length} question(s)</span>
        </div>

        {session.questions.length === 0 ? (
          <div className="zentra-card" style={{ textAlign: 'center', padding: '3.5rem 1.5rem', color: 'var(--zentra-text-muted)' }}>
            <Icon name="help_outline" size={36} style={{ opacity: 0.5, marginBottom: '0.5rem' }} />
            <p style={{ margin: 0, fontSize: '0.95rem' }}>No questions recorded for this interview session.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {session.questions.map((q) => {
              const hasAnswer = q.answer !== null
              const evalData = q.answer?.evaluation
              const score = evalData?.score
              const sources = Array.isArray(q.sourceReferences)
                ? (q.sourceReferences as Array<{
                    documentName?: string
                    chunkIndex?: number
                    similarity?: number
                  }>)
                : []

              return (
                <div key={q.id} className="zentra-card" style={{ padding: '1.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                      <span className="zentra-badge info" style={{ fontWeight: 700 }}>
                        Question {q.questionNumber}
                      </span>
                      {q.topic && <span className="zentra-badge neutral">{q.topic}</span>}
                      {q.difficulty && (
                        <span className="zentra-badge neutral" style={{ textTransform: 'capitalize' }}>
                          {q.difficulty}
                        </span>
                      )}
                    </div>

                    {score !== undefined && score !== null && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--zentra-text-muted)' }}>Score:</span>
                        <span
                          className={`zentra-badge ${score >= 75 ? 'success' : score >= 50 ? 'warning' : 'danger'}`}
                          style={{ fontWeight: 700, fontSize: '0.85rem' }}
                        >
                          {score} / 100
                        </span>
                      </div>
                    )}
                  </div>

                  <div style={{ marginBottom: '0.85rem' }}>
                    <h4 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600, color: 'var(--zentra-text-primary)', lineHeight: 1.5 }}>
                      {q.content}
                    </h4>
                  </div>

                  {sources.length > 0 && (
                    <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                      {sources.map((src, si) => (
                        <span key={si} className="zentra-badge neutral" style={{ fontSize: '0.72rem' }}>
                          Source: {src.documentName || 'KB Doc'}
                          {typeof src.chunkIndex === 'number' ? ` #${src.chunkIndex + 1}` : ''}
                          {typeof src.similarity === 'number' ? ` (${Math.round(src.similarity * 100)}%)` : ''}
                        </span>
                      ))}
                    </div>
                  )}

                  <div style={{ background: 'var(--zentra-bg-muted)', border: '1px solid var(--zentra-border)', borderRadius: '12px', padding: '1.15rem', marginBottom: '1.25rem' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--zentra-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                      {userSession.role === 'CANDIDATE' ? 'Your Response' : 'Candidate Response'}
                    </div>
                    {hasAnswer ? (
                      <p style={{ margin: 0, color: 'var(--zentra-text-primary)', fontSize: '0.925rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                        {q.answer?.transcript}
                      </p>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#f59e0b', fontSize: '0.875rem', fontStyle: 'italic' }}>
                        <Icon name="hourglass_top" size={16} />
                        <span>Awaiting candidate answer...</span>
                      </div>
                    )}
                  </div>

                  {evalData && (
                    <div style={{ background: 'rgba(99, 102, 241, 0.04)', border: '1px solid rgba(99, 102, 241, 0.14)', borderRadius: '12px', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', fontWeight: 600, color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          <Icon name="rate_review" size={16} /> Evaluation Details
                        </div>
                        {typeof evalData.communicationScore === 'number' && (
                          <span className="zentra-badge info" style={{ fontSize: '0.75rem' }}>
                            Communication: {Math.round(evalData.communicationScore)}%
                          </span>
                        )}
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', fontSize: '0.85rem' }}>
                        {evalData.correctness && (
                          <div style={{ background: 'var(--zentra-bg-surface)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--zentra-border)' }}>
                            <span style={{ color: 'var(--zentra-text-muted)', display: 'block', fontSize: '0.75rem', marginBottom: '2px' }}>Correctness</span>
                            <span style={{ color: 'var(--zentra-text-primary)', fontWeight: 500 }}>{evalData.correctness}</span>
                          </div>
                        )}
                        {evalData.completeness && (
                          <div style={{ background: 'var(--zentra-bg-surface)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--zentra-border)' }}>
                            <span style={{ color: 'var(--zentra-text-muted)', display: 'block', fontSize: '0.75rem', marginBottom: '2px' }}>Completeness</span>
                            <span style={{ color: 'var(--zentra-text-primary)', fontWeight: 500 }}>{evalData.completeness}</span>
                          </div>
                        )}
                        {evalData.technicalAccuracy && (
                          <div style={{ background: 'var(--zentra-bg-surface)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--zentra-border)' }}>
                            <span style={{ color: 'var(--zentra-text-muted)', display: 'block', fontSize: '0.75rem', marginBottom: '2px' }}>Technical Accuracy</span>
                            <span style={{ color: 'var(--zentra-text-primary)', fontWeight: 500 }}>{evalData.technicalAccuracy}</span>
                          </div>
                        )}
                        {evalData.reasoningQuality && (
                          <div style={{ background: 'var(--zentra-bg-surface)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--zentra-border)' }}>
                            <span style={{ color: 'var(--zentra-text-muted)', display: 'block', fontSize: '0.75rem', marginBottom: '2px' }}>Reasoning Pattern</span>
                            <span style={{ color: 'var(--zentra-text-primary)', fontWeight: 500 }}>{evalData.reasoningQuality}</span>
                          </div>
                        )}
                      </div>

                      {evalData.communicationFeedback && (
                        <div style={{ fontSize: '0.875rem', color: 'var(--zentra-text-secondary)', lineHeight: 1.5 }}>
                          <strong style={{ color: 'var(--zentra-text-primary)' }}>Communication Clarity: </strong>
                          {evalData.communicationFeedback}
                        </div>
                      )}

                      {evalData.feedback && (
                        <div style={{ fontSize: '0.9rem', color: 'var(--zentra-text-secondary)', lineHeight: 1.6 }}>
                          <strong style={{ color: 'var(--zentra-text-primary)' }}>Feedback: </strong>
                          {evalData.feedback}
                        </div>
                      )}

                      {evalData.correctConcepts?.length > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.825rem' }}>
                          <span style={{ fontWeight: 600, color: 'var(--zentra-text-secondary)' }}>Mastered Concepts:</span>
                          {evalData.correctConcepts.map((c, ci) => (
                            <span key={ci} className="zentra-badge success" style={{ fontSize: '0.75rem' }}>{c}</span>
                          ))}
                        </div>
                      )}

                      {(evalData.missingConcepts?.length > 0 || evalData.incorrectConcepts?.length > 0) && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.825rem' }}>
                          <span style={{ fontWeight: 600, color: 'var(--zentra-text-secondary)' }}>Gaps / Misconceptions:</span>
                          {evalData.missingConcepts.map((c, ci) => (
                            <span key={`m-${ci}`} className="zentra-badge warning" style={{ fontSize: '0.75rem' }}>Missing: {c}</span>
                          ))}
                          {evalData.incorrectConcepts.map((c, ci) => (
                            <span key={`i-${ci}`} className="zentra-badge danger" style={{ fontSize: '0.75rem' }}>Incorrect: {c}</span>
                          ))}
                        </div>
                      )}

                      {evalData.mentionedKeywords?.length > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.825rem' }}>
                          <span style={{ fontWeight: 600, color: 'var(--zentra-text-secondary)' }}>Mentioned Keywords:</span>
                          {evalData.mentionedKeywords.map((kw, ki) => (
                            <span key={ki} className="zentra-badge success" style={{ fontSize: '0.75rem' }}>{kw}</span>
                          ))}
                        </div>
                      )}

                      {evalData.missingKeywords?.length > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.825rem' }}>
                          <span style={{ fontWeight: 600, color: 'var(--zentra-text-secondary)' }}>Missing Keywords:</span>
                          {evalData.missingKeywords.map((kw, ki) => (
                            <span key={ki} className="zentra-badge danger" style={{ fontSize: '0.75rem' }}>{kw}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
