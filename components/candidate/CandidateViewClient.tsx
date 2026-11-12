'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import Icon from '@/components/Icon'
import { formatInterviewerName } from '@/lib/formatters'
import { ScoreChartWrapper } from '@/components/dashboard/ScoreChartWrapper'

export interface CandidateSession {
  id: string
  startedAt: Date | string
  status: string
  interviewType?: string | null
  score?: number | null
  scope?: unknown
  interviewer?: {
    username: string
    email?: string | null
    candidate?: { name: string } | null
  } | null
  report?: {
    id: string
    overallScore: number
    executiveSummary?: string | null
    strengths: string[]
    weaknesses: string[]
  } | null
  questions: Array<{
    answer?: { id: string } | null
  }>
}

interface CandidateViewClientProps {
  initialTab?: string
  totalInterviews: number
  completedInterviews: number
  avgScore: number | null
  bestScore: number | null
  sessions: CandidateSession[]
}

interface CandidateMemorySnapshot {
  profile?: {
    answeringStyle?: string
    reasoningPattern?: string
    technicalStrengths?: string[]
    communicationTraits?: string[]
    learningPreferences?: string[]
    totalEvaluations?: number
    averageScore?: number | null
  } | null
  recurringWeaknesses?: Array<{
    id: string
    conceptName: string
    subject: string
    masteryScore: number
    weaknessCount: number
    forgettingRisk: number
  }>
  forgettingPredictions?: Array<{
    id: string
    conceptName: string
    subject: string
    masteryScore: number
    forgettingRisk: number
    daysSinceTested: number
    stabilityDays: number
    riskLabel: 'low' | 'moderate' | 'high'
  }>
  revisions?: Array<{
    id: string
    conceptName: string
    subject: string
    priorityScore: number
    forgettingRisk: number
    reason: string
    linkedDocumentName?: string | null
    status: string
  }>
  topicProgression?: Record<string, Array<{ date: string; score: number }>>
}

export function CandidateViewClient({
  initialTab = 'results',
  totalInterviews,
  completedInterviews,
  avgScore,
  bestScore,
  sessions,
}: CandidateViewClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const currentUrlTab = searchParams.get('tab')
  const [activeTab, setActiveTab] = useState<'results' | 'performance' | 'learning'>(() => {
    if (currentUrlTab === 'performance' || initialTab === 'performance') return 'performance'
    if (currentUrlTab === 'learning' || initialTab === 'learning') return 'learning'
    return 'results'
  })
  const [memory, setMemory] = useState<CandidateMemorySnapshot | null>(null)
  const [loadingMemory, setLoadingMemory] = useState(false)

  useEffect(() => {
    const tabFromUrl = searchParams.get('tab')
    if (tabFromUrl === 'performance') {
      setActiveTab('performance')
    } else if (tabFromUrl === 'learning') {
      setActiveTab('learning')
    } else {
      setActiveTab('results')
    }
  }, [searchParams])

  const loadMemory = React.useCallback(async () => {
    setLoadingMemory(true)
    try {
      const res = await fetch('/api/candidate/memory', { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setMemory(data)
      }
    } catch {
      // ignore non-fatal
    } finally {
      setLoadingMemory(false)
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'learning' && !memory) {
      loadMemory()
    }
  }, [activeTab, memory, loadMemory])

  const handleRevisionAction = async (revisionId: string, status: 'completed' | 'dismissed') => {
    try {
      const res = await fetch('/api/candidate/memory', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revisionId, status }),
      })
      if (res.ok) {
        loadMemory()
      }
    } catch {
      // ignore
    }
  }

  const handleRefreshRevisions = async () => {
    setLoadingMemory(true)
    try {
      await fetch('/api/candidate/memory', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refresh' }),
      })
      await loadMemory()
    } finally {
      setLoadingMemory(false)
    }
  }

  const handleTabClick = (tab: 'results' | 'performance' | 'learning', e: React.MouseEvent) => {
    e.preventDefault()
    setActiveTab(tab)
    if (tab === 'performance') {
      router.push('/candidate?tab=performance', { scroll: false })
    } else if (tab === 'learning') {
      router.push('/candidate?tab=learning', { scroll: false })
    } else {
      router.push('/candidate', { scroll: false })
    }
  }

  const completedSessionsList = sessions.filter(
    (s) => s.status === 'completed' || s.report !== null
  )

  return (
    <div className="zentra-page-container">
      {/* Header: Overview + Tabs */}
      <div className="zentra-page-header">
        <div>
          <div className="zentra-title-row">
            <h1 className="zentra-page-title">My Interview Results</h1>
            <span className="zentra-link-bubble" title="Candidate Portal">
              <Icon name="link" size={16} />
            </span>
          </div>
          <p className="zentra-page-subtitle">
            Your interviewer creates and conducts live interviews. Review your generated reports and evaluation metrics here.
          </p>
        </div>

        {/* Zentra Pill Tabs Navigation */}
        <div
          role="tablist"
          aria-label="Candidate Navigation Tabs"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
            background: 'var(--zentra-bg-surface)',
            border: '1px solid var(--zentra-border)',
            borderRadius: '9999px',
            padding: '0.35rem',
            boxShadow: '0 1px 3px rgba(15,23,42,0.03)',
          }}
        >
          <a
            href="/candidate"
            role="tab"
            aria-selected={activeTab !== 'performance'}
            onClick={(e) => handleTabClick('results', e)}
            style={{
              padding: '0.45rem 1.15rem',
              borderRadius: '9999px',
              fontSize: '0.825rem',
              fontWeight: 600,
              textDecoration: 'none',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              background: activeTab !== 'performance' ? 'var(--zentra-pill-active-bg)' : 'transparent',
              color: activeTab !== 'performance' ? 'var(--zentra-pill-active-text)' : 'var(--zentra-pill-inactive-text)',
              boxShadow: activeTab !== 'performance' ? '0 2px 8px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            My Results
          </a>
          <a
            href="/candidate?tab=performance"
            role="tab"
            aria-selected={activeTab === 'performance'}
            onClick={(e) => handleTabClick('performance', e)}
            style={{
              padding: '0.45rem 1.15rem',
              borderRadius: '9999px',
              fontSize: '0.825rem',
              fontWeight: 600,
              textDecoration: 'none',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              background: activeTab === 'performance' ? 'var(--zentra-pill-active-bg)' : 'transparent',
              color: activeTab === 'performance' ? 'var(--zentra-pill-active-text)' : 'var(--zentra-pill-inactive-text)',
              boxShadow: activeTab === 'performance' ? '0 2px 8px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            Performance
          </a>
          <a
            href="/candidate?tab=learning"
            role="tab"
            aria-selected={activeTab === 'learning'}
            onClick={(e) => handleTabClick('learning', e)}
            style={{
              padding: '0.45rem 1.15rem',
              borderRadius: '9999px',
              fontSize: '0.825rem',
              fontWeight: 600,
              textDecoration: 'none',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              background: activeTab === 'learning' ? 'var(--zentra-pill-active-bg)' : 'transparent',
              color: activeTab === 'learning' ? 'var(--zentra-pill-active-text)' : 'var(--zentra-pill-inactive-text)',
              boxShadow: activeTab === 'learning' ? '0 2px 8px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            Learning &amp; Revisions
          </a>
        </div>
      </div>

      {/* Real DB Metrics Row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: '1.25rem',
          marginBottom: '1.75rem',
        }}
      >
        <div className="zentra-card">
          <div className="zentra-card-header" style={{ marginBottom: '0.75rem' }}>
            <span className="zentra-metric-label">Total Interviews</span>
            <span className="zentra-pill-tag">History</span>
          </div>
          <div className="zentra-metric-num">{totalInterviews}</div>
          <div className="zentra-metric-sub">Conducted sessions</div>
        </div>

        <div className="zentra-card">
          <div className="zentra-card-header" style={{ marginBottom: '0.75rem' }}>
            <span className="zentra-metric-label">Completed Sessions</span>
            <span className="zentra-pill-tag green">Reports Ready</span>
          </div>
          <div className="zentra-metric-num" style={{ color: '#10b981' }}>
            {completedInterviews}
          </div>
          <div className="zentra-metric-sub">Finalized by recruiter</div>
        </div>

        <div className="zentra-card">
          <div className="zentra-card-header" style={{ marginBottom: '0.75rem' }}>
            <span className="zentra-metric-label">Average Score</span>
            <span className="zentra-pill-tag blue">Overall</span>
          </div>
          <div className="zentra-metric-num">
            {avgScore !== null ? `${avgScore}%` : '—'}
          </div>
          <div className="zentra-metric-sub">Across all completed interviews</div>
        </div>

        <div className="zentra-card">
          <div className="zentra-card-header" style={{ marginBottom: '0.75rem' }}>
            <span className="zentra-metric-label">Peak Evaluation</span>
            <span className="zentra-pill-tag green">Top Score</span>
          </div>
          <div className="zentra-metric-num" style={{ color: '#059669' }}>
            {bestScore !== null ? `${bestScore}%` : '—'}
          </div>
          <div className="zentra-metric-sub">Highest performance achieved</div>
        </div>
      </div>

      {activeTab === 'learning' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="zentra-card">
            <div className="zentra-card-header" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
              <div>
                <h2 className="zentra-card-title">Cognitive &amp; Answering Style Profile</h2>
                <span style={{ fontSize: '0.8rem', color: 'var(--zentra-text-muted)' }}>
                  Synthesized across all completed evaluations
                </span>
              </div>
              <button
                type="button"
                onClick={handleRefreshRevisions}
                disabled={loadingMemory}
                className="zentra-btn zentra-btn-secondary"
              >
                <Icon name="refresh" size={16} />
                <span>{loadingMemory ? 'Analyzing...' : 'Refresh Recommendations'}</span>
              </button>
            </div>

            {!memory?.profile ? (
              <p style={{ margin: 0, color: 'var(--zentra-text-muted)', fontSize: '0.875rem' }}>
                {loadingMemory
                  ? 'Loading candidate learning memory...'
                  : 'Complete interview questions to build your personalized reasoning and answering profile.'}
              </p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
                <div style={{ background: 'var(--zentra-bg-muted)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--zentra-border)' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--zentra-text-muted)' }}>Answering Style</div>
                  <div style={{ marginTop: '0.35rem', fontWeight: 600, color: 'var(--zentra-text-primary)' }}>
                    {memory.profile.answeringStyle || 'Balanced responder'}
                  </div>
                </div>
                <div style={{ background: 'var(--zentra-bg-muted)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--zentra-border)' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--zentra-text-muted)' }}>Reasoning Pattern</div>
                  <div style={{ marginTop: '0.35rem', fontSize: '0.85rem', color: 'var(--zentra-text-primary)' }}>
                    {memory.profile.reasoningPattern || 'Consistent analytical explanations'}
                  </div>
                </div>
                <div style={{ background: 'var(--zentra-bg-muted)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--zentra-border)' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--zentra-text-muted)' }}>Technical Strengths</div>
                  <div style={{ marginTop: '0.45rem', display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                    {(memory.profile.technicalStrengths || []).length > 0
                      ? memory.profile.technicalStrengths!.slice(0, 6).map((s, idx) => (
                          <span key={idx} className="zentra-badge success">{s}</span>
                        ))
                      : <span style={{ fontSize: '0.8rem', color: 'var(--zentra-text-muted)' }}>Evaluating...</span>}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.25rem' }}>
            {/* Recurring Weaknesses */}
            <div className="zentra-card">
              <h3 className="zentra-card-title" style={{ marginBottom: '0.75rem' }}>Recurring Weaknesses</h3>
              {(memory?.recurringWeaknesses || []).length === 0 ? (
                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--zentra-text-muted)' }}>No recurring concept gaps detected yet.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                  {memory!.recurringWeaknesses!.slice(0, 6).map((w) => (
                    <div key={w.id} style={{ background: 'var(--zentra-bg-muted)', padding: '0.75rem', borderRadius: '10px', border: '1px solid var(--zentra-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--zentra-text-primary)' }}>{w.conceptName}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--zentra-text-muted)' }}>{w.subject} &bull; Flagged {w.weaknessCount}x</div>
                      </div>
                      <span className="zentra-badge danger">{Math.round(w.masteryScore)}% mastery</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Forgetting Risk Predictions */}
            <div className="zentra-card">
              <h3 className="zentra-card-title" style={{ marginBottom: '0.75rem' }}>Forgetting-Risk Predictions</h3>
              {(memory?.forgettingPredictions || []).length === 0 ? (
                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--zentra-text-muted)' }}>All tested concepts currently have strong retention stability.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                  {memory!.forgettingPredictions!.slice(0, 6).map((fp) => (
                    <div key={fp.id} style={{ background: 'var(--zentra-bg-muted)', padding: '0.75rem', borderRadius: '10px', border: '1px solid var(--zentra-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--zentra-text-primary)' }}>{fp.conceptName}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--zentra-text-muted)' }}>{fp.daysSinceTested}d since tested &bull; Stability {fp.stabilityDays}d</div>
                      </div>
                      <span className={`zentra-badge ${fp.riskLabel === 'high' ? 'danger' : 'warning'}`}>
                        {Math.round(fp.forgettingRisk * 100)}% risk
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Personalized Revision Recommendations */}
          <div className="zentra-card">
            <h3 className="zentra-card-title" style={{ marginBottom: '0.75rem' }}>Recommended Revision Queue</h3>
            {(memory?.revisions || []).length === 0 ? (
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--zentra-text-muted)' }}>No pending revision sessions queued.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {memory!.revisions!.map((rec) => (
                  <div key={rec.id} style={{ background: 'var(--zentra-bg-muted)', padding: '0.9rem 1rem', borderRadius: '12px', border: '1px solid var(--zentra-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                    <div>
                      <div style={{ fontWeight: 600, color: 'var(--zentra-text-primary)' }}>
                        {rec.conceptName} <span className="zentra-badge info" style={{ marginLeft: '0.4rem' }}>{rec.subject}</span>
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--zentra-text-muted)', marginTop: '0.2rem' }}>{rec.reason}</div>
                      {rec.linkedDocumentName && (
                        <div style={{ fontSize: '0.75rem', color: '#2563eb', marginTop: '0.2rem' }}>
                          Study Material: {rec.linkedDocumentName}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        type="button"
                        onClick={() => handleRevisionAction(rec.id, 'completed')}
                        className="zentra-btn zentra-btn-primary"
                        style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem' }}
                      >
                        Mark Reviewed
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRevisionAction(rec.id, 'dismissed')}
                        className="zentra-btn zentra-btn-secondary"
                        style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem' }}
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : activeTab === 'performance' ? (
        /* Performance Tab View */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Performance Summary Cards */}
          <div className="zentra-card">
            <div className="zentra-card-header">
              <div>
                <h2 className="zentra-card-title">Performance &amp; Evaluation Analysis</h2>
                <span style={{ fontSize: '0.8rem', color: 'var(--zentra-text-muted)' }}>
                  Summary metrics aggregated from your evaluations
                </span>
              </div>
              <span className="zentra-dot-menu">&bull;&bull;&bull;</span>
            </div>

            {completedInterviews === 0 ? (
              <div style={{ padding: '3.5rem 1rem', textAlign: 'center', color: 'var(--zentra-text-muted)' }}>
                <Icon name="analytics" size={40} style={{ opacity: 0.4, marginBottom: '0.75rem' }} />
                <div style={{ fontWeight: 600, color: 'var(--zentra-text-primary)', marginBottom: '0.35rem' }}>
                  No Performance Records Yet
                </div>
                <p style={{ fontSize: '0.85rem', margin: 0, color: 'var(--zentra-text-secondary)' }}>
                  Once your interviewer completes an evaluation, your score metrics and strengths analysis will appear here.
                </p>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem' }}>
                <div style={{ background: 'var(--zentra-bg-muted)', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--zentra-border)' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--zentra-text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                    Average Score
                  </div>
                  <div style={{ fontSize: '2.25rem', fontWeight: 700, color: '#10b981', marginTop: '0.35rem' }}>
                    {avgScore}%
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--zentra-text-secondary)', marginTop: '0.35rem' }}>
                    Across {completedInterviews} completed evaluation(s)
                  </div>
                </div>

                <div style={{ background: 'var(--zentra-bg-muted)', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--zentra-border)' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--zentra-text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                    Peak Evaluation
                  </div>
                  <div style={{ fontSize: '2.25rem', fontWeight: 700, color: '#2563eb', marginTop: '0.35rem' }}>
                    {bestScore}%
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--zentra-text-secondary)', marginTop: '0.35rem' }}>
                    Your highest score recorded
                  </div>
                </div>

                <div style={{ background: 'var(--zentra-bg-muted)', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--zentra-border)' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--zentra-text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                    Reports Ready
                  </div>
                  <div style={{ fontSize: '2.25rem', fontWeight: 700, color: 'var(--zentra-text-primary)', marginTop: '0.35rem' }}>
                    {completedInterviews}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--zentra-text-secondary)', marginTop: '0.35rem' }}>
                    Full transcripts available
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Performance Evaluation Trend Chart */}
          <div className="zentra-card">
            <div className="zentra-card-header">
              <div>
                <h3 className="zentra-card-title">Candidate Evaluation Trend</h3>
                <span style={{ fontSize: '0.8rem', color: 'var(--zentra-text-muted)' }}>
                  Performance scoring progression across evaluation sessions
                </span>
              </div>
              <span className="zentra-dot-menu">&bull;&bull;&bull;</span>
            </div>
            <div style={{ minHeight: '260px', width: '100%' }}>
              <ScoreChartWrapper
                data={[...sessions]
                  .filter((s) => typeof (s.score ?? s.report?.overallScore) === 'number')
                  .reverse()
                  .map((s, idx) => ({
                    label: `${new Date(s.startedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} (#${idx + 1})`,
                    score: Number(s.score ?? s.report?.overallScore ?? 0),
                  }))}
              />
            </div>
          </div>

          {/* Completed Reports List */}
          {completedSessionsList.length > 0 && (
            <div className="zentra-card">
              <div className="zentra-card-header">
                <h3 className="zentra-card-title">Completed Reports &amp; Feedback</h3>
                <span className="zentra-dot-menu">&bull;&bull;&bull;</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {completedSessionsList.map((s) => {
                  const scope = s.scope as { subject?: string; mode?: string } | null
                  const subject = scope?.subject || s.interviewType || 'Technical Interview'
                  const score = s.score ?? s.report?.overallScore ?? 0

                  return (
                    <div
                      key={s.id}
                      style={{
                        background: 'var(--zentra-bg-muted)',
                        border: '1px solid var(--zentra-border)',
                        borderRadius: '16px',
                        padding: '1.25rem 1.5rem',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '1rem',
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--zentra-text-primary)' }}>
                          {subject}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--zentra-text-muted)', marginTop: '0.2rem' }}>
                          Interviewer: {formatInterviewerName(s.interviewer)} &bull; Date:{' '}
                          {new Date(s.startedAt).toLocaleDateString()}
                        </div>
                        {s.report?.executiveSummary && (
                          <p
                            style={{
                              fontSize: '0.825rem',
                              color: 'var(--zentra-text-secondary)',
                              margin: '0.4rem 0 0 0',
                              maxWidth: '750px',
                            }}
                          >
                            {s.report.executiveSummary}
                          </p>
                        )}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                        <span
                          style={{
                            fontSize: '1.35rem',
                            fontWeight: 700,
                            color: score >= 75 ? '#10b981' : score >= 50 ? '#d97706' : '#dc2626',
                          }}
                        >
                          {score.toFixed(1)}%
                        </span>
                        <Link
                          href={`/report/${s.id}`}
                          className="zentra-btn zentra-btn-secondary"
                          style={{ padding: '0.45rem 1rem', fontSize: '0.8rem' }}
                        >
                          <Icon name="visibility" size={15} />
                          <span>View Report</span>
                        </Link>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Main Results Table */
        <div className="zentra-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div
            style={{
              padding: '1.25rem 1.5rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderBottom: '1px solid var(--zentra-border)',
            }}
          >
            <div>
              <h3 className="zentra-card-title">Interview Sessions &amp; Records</h3>
              <span style={{ fontSize: '0.8rem', color: 'var(--zentra-text-muted)' }}>
                Showing {sessions.length} session(s)
              </span>
            </div>
          </div>

          {sessions.length === 0 ? (
            <div style={{ padding: '4rem 1rem', textAlign: 'center', color: 'var(--zentra-text-muted)' }}>
              <Icon name="inbox" size={40} style={{ opacity: 0.4, marginBottom: '0.75rem' }} />
              <div style={{ fontWeight: 600, color: 'var(--zentra-text-primary)', marginBottom: '0.35rem' }}>
                No Interview Results Yet
              </div>
              <p
                style={{
                  fontSize: '0.85rem',
                  margin: 0,
                  color: 'var(--zentra-text-secondary)',
                  maxWidth: '450px',
                  marginLeft: 'auto',
                  marginRight: 'auto',
                }}
              >
                Your interviewer conducts the live interview. Once completed, your generated evaluation report and full
                Q&amp;A transcript will appear here.
              </p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="zentra-table">
                <thead>
                  <tr>
                    <th>Assessment / Mode</th>
                    <th>Interviewer</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th>Score</th>
                    <th style={{ textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((sess) => {
                    const scope = sess.scope as { subject?: string; mode?: string } | null
                    const subject = scope?.subject || sess.interviewType || 'Adaptive Interview'
                    const mode = scope?.mode || 'standard'
                    const displayScore =
                      sess.score !== null && sess.score !== undefined
                        ? `${sess.score.toFixed(1)}%`
                        : sess.report?.overallScore !== undefined
                        ? `${sess.report.overallScore.toFixed(1)}%`
                        : '—'
                    const isCompleted = sess.status === 'completed' || sess.report !== null
                    const isActive = sess.status === 'active'
                    const hasAnswers = sess.questions.some((q) => q.answer !== null)
                    const interviewerName = formatInterviewerName(sess.interviewer)

                    const statusLabel = isCompleted
                      ? 'Completed'
                      : isActive
                      ? hasAnswers
                        ? 'In Progress'
                        : 'Scheduled'
                      : 'Pending'

                    return (
                      <tr key={sess.id}>
                        <td>
                          <div>
                            <div style={{ fontWeight: 600, color: 'var(--zentra-text-primary)' }}>{subject}</div>
                            <div
                              style={{
                                fontSize: '0.75rem',
                                color: 'var(--zentra-text-muted)',
                                textTransform: 'capitalize',
                              }}
                            >
                              Mode: {mode}
                            </div>
                          </div>
                        </td>
                        <td>
                          <span style={{ color: 'var(--zentra-text-secondary)', fontSize: '0.85rem' }}>
                            {interviewerName}
                          </span>
                        </td>
                        <td style={{ color: 'var(--zentra-text-muted)', fontSize: '0.825rem' }}>
                          {new Date(sess.startedAt).toLocaleDateString(undefined, {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </td>
                        <td>
                          <span
                            className={`zentra-badge ${isCompleted ? 'success' : isActive ? 'warning' : 'neutral'}`}
                          >
                            {statusLabel}
                          </span>
                        </td>
                        <td>
                          <span
                            style={{
                              fontWeight: 700,
                              color: isCompleted ? '#10b981' : 'var(--zentra-text-muted)',
                            }}
                          >
                            {displayScore}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {isCompleted ? (
                            <Link
                              href={`/report/${sess.id}`}
                              className="zentra-btn zentra-btn-primary"
                              style={{ padding: '0.35rem 0.85rem', fontSize: '0.775rem' }}
                            >
                              <Icon name="visibility" size={14} />
                              <span>View Report</span>
                            </Link>
                          ) : (
                            <span
                              style={{
                                fontSize: '0.75rem',
                                color: 'var(--zentra-text-muted)',
                                fontStyle: 'italic',
                              }}
                            >
                              {isActive ? 'In Progress' : 'Pending'}
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
