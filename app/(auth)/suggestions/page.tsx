import React from 'react'
import prisma from '@/lib/db'
import { getValidatedAppSession } from '@/lib/auth-server'
import Icon from '@/components/Icon'

export default async function SuggestionsPage() {
  const session = await getValidatedAppSession()
  const userId = session.userId

  if (!userId) {
    return (
      <div style={{ padding: '2rem', color: 'var(--color-text-primary)' }}>
        Unauthorized access
      </div>
    )
  }

  const allQuestions = await prisma.question.findMany({
    where: { session: { interviewerId: userId } },
    orderBy: { askedAt: 'desc' },
    include: {
      session: {
        select: {
          id: true,
          candidate: { select: { name: true } },
        },
      },
      answer: {
        select: {
          transcript: true,
          evaluation: {
            select: {
              score: true,
              correctness: true,
              missingKeywords: true,
            },
          },
        },
      },
    },
    take: 30,
  })

  const diffBadgeClass = (diff: string) => {
    switch (diff.toLowerCase()) {
      case 'easy':
        return 'zentra-badge-success'
      case 'medium':
        return 'zentra-badge-info'
      case 'hard':
        return 'zentra-badge-warning'
      case 'expert':
        return 'zentra-badge-error'
      default:
        return 'zentra-badge-neutral'
    }
  }

  const answeredCount = allQuestions.filter(q => q.answer !== null).length
  const avgScore = answeredCount > 0
    ? Math.round(allQuestions.reduce((acc, q) => acc + (q.answer?.evaluation?.score || 0), 0) / answeredCount)
    : 0

  return (
    <div style={{ padding: '2rem', maxWidth: '1440px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.35rem' }}>
            <h1 className="zentra-page-title" style={{ margin: 0 }}>Adaptive Question Bank</h1>
            <span className="zentra-badge zentra-badge-neutral">Dynamic AI</span>
          </div>
          <p className="zentra-page-subtitle" style={{ margin: 0 }}>
            Archive of LLM-generated interview questions and candidate performance evaluations across your sessions.
          </p>
        </div>
      </div>

      {/* Summary Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
        <div className="zentra-card zentra-metric-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="zentra-metric-label">Total Questions</span>
            <span style={{ color: 'var(--color-text-muted)' }}><Icon name="help_outline" size={18} /></span>
          </div>
          <div className="zentra-metric-value">{allQuestions.length}</div>
          <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>Latest 30 recorded questions</span>
        </div>

        <div className="zentra-card zentra-metric-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="zentra-metric-label">Answered</span>
            <span style={{ color: '#10b981' }}><Icon name="check_circle" size={18} /></span>
          </div>
          <div className="zentra-metric-value">{answeredCount}</div>
          <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
            {allQuestions.length > 0 ? Math.round((answeredCount / allQuestions.length) * 100) : 0}% response rate
          </span>
        </div>

        <div className="zentra-card zentra-metric-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="zentra-metric-label">Average Score</span>
            <span style={{ color: avgScore >= 70 ? '#10b981' : '#f59e0b' }}><Icon name="speed" size={18} /></span>
          </div>
          <div className="zentra-metric-value">{avgScore}%</div>
          <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>Across answered evaluations</span>
        </div>
      </div>

      {/* Questions Table */}
      <div className="zentra-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '1.25rem 1.75rem', borderBottom: '1px solid var(--color-border-subtle)' }}>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 600, margin: 0, color: 'var(--color-text-primary)' }}>
            Generated Questions &amp; Answers ({allQuestions.length})
          </h2>
          <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
            Click &ldquo;View Candidate Answer&rdquo; to review voice transcriptions and AI scoring feedback
          </p>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="zentra-table">
            <thead>
              <tr>
                <th style={{ width: '42%' }}>Question Content</th>
                <th>Topic Domain</th>
                <th>Difficulty</th>
                <th>Candidate &amp; Session</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              {allQuestions.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: '3.5rem 1.5rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                      <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'var(--color-bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)' }}>
                        <Icon name="help_outline" size={24} />
                      </div>
                      <div style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>No questions generated yet</div>
                      <div style={{ fontSize: '0.85rem' }}>Start an interview session to generate real-time adaptive questions.</div>
                    </div>
                  </td>
                </tr>
              ) : (
                allQuestions.map(q => {
                  const evalScore = q.answer?.evaluation?.score
                  return (
                    <tr key={q.id}>
                      <td style={{ verticalAlign: 'top', paddingTop: '1.1rem', paddingBottom: '1.1rem' }}>
                        <div style={{ fontWeight: 500, color: 'var(--color-text-primary)', fontSize: '0.9rem', lineHeight: 1.5, marginBottom: '0.6rem' }}>
                          {q.content}
                        </div>
                        {q.answer ? (
                          <details style={{ background: 'var(--color-bg-secondary)', padding: '0.75rem 1rem', borderRadius: '10px', fontSize: '0.8rem', border: '1px solid var(--color-border-subtle)' }}>
                            <summary style={{ cursor: 'pointer', color: '#6366f1', fontWeight: 600 }}>
                              View Candidate Answer &amp; Feedback
                            </summary>
                            <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                              <div>
                                <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>Transcript: </span>
                                <span style={{ color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>{q.answer.transcript}</span>
                              </div>
                              {q.answer.evaluation && (
                                <>
                                  <div>
                                    <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>Score: </span>
                                    <span style={{ fontWeight: 700, color: (evalScore || 0) >= 70 ? '#10b981' : '#f59e0b' }}>
                                      {evalScore}%
                                    </span>
                                  </div>
                                  <div>
                                    <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>Correctness Feedback: </span>
                                    <span style={{ color: 'var(--color-text-secondary)' }}>{q.answer.evaluation.correctness}</span>
                                  </div>
                                  {q.answer.evaluation.missingKeywords && q.answer.evaluation.missingKeywords.length > 0 && (
                                    <div style={{ color: '#ef4444' }}>
                                      <span style={{ fontWeight: 600 }}>Missing Keywords: </span>
                                      {q.answer.evaluation.missingKeywords.join(', ')}
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          </details>
                        ) : (
                          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                            No answer recorded
                          </span>
                        )}
                      </td>
                      <td style={{ verticalAlign: 'top', paddingTop: '1.1rem' }}>
                        <span className="zentra-badge zentra-badge-neutral">
                          {q.topic || 'General'}
                        </span>
                      </td>
                      <td style={{ verticalAlign: 'top', paddingTop: '1.1rem' }}>
                        <span className={`zentra-badge ${diffBadgeClass(q.difficulty)}`}>
                          {q.difficulty}
                        </span>
                      </td>
                      <td style={{ verticalAlign: 'top', paddingTop: '1.1rem' }}>
                        <div style={{ fontWeight: 600, color: 'var(--color-text-primary)', fontSize: '0.85rem' }}>
                          {q.session.candidate?.name || 'Unknown Candidate'}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontFamily: 'monospace', marginTop: '2px' }}>
                          {q.sessionId.substring(0, 8)}...
                        </div>
                      </td>
                      <td style={{ verticalAlign: 'top', paddingTop: '1.1rem' }}>
                        {evalScore !== undefined && evalScore !== null ? (
                          <span className={`zentra-badge ${evalScore >= 70 ? 'zentra-badge-success' : evalScore >= 50 ? 'zentra-badge-warning' : 'zentra-badge-error'}`} style={{ fontWeight: 700 }}>
                            {evalScore}%
                          </span>
                        ) : (
                          <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>—</span>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
