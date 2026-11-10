import React from 'react'
import prisma from '@/lib/db'
import Icon from '@/components/Icon'
import Link from 'next/link'
import { AdminChartsWrapper } from '@/components/admin/AdminChartsWrapper'

export const dynamic = 'force-dynamic'

export default async function AdminDashboardPage() {
  const t0 = performance.now()
  const [
    totalUsers,
    totalInterviewers,
    totalCandidates,
    totalInterviews,
    completedInterviews,
    activeInterviews,
    scoreAgg,
    totalDocuments,
    recentSessions,
    technicalCount,
    behavioralCount,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { role: 'INTERVIEWER' } }),
    prisma.candidate.count(),
    prisma.interviewSession.count(),
    prisma.interviewSession.count({ where: { status: 'completed' } }),
    prisma.interviewSession.count({ where: { status: 'active' } }),
    prisma.interviewSession.aggregate({
      where: { score: { not: null } },
      _avg: { score: true },
    }),
    prisma.document.count({ where: { storageStatus: 'AVAILABLE' } }),
    prisma.interviewSession.findMany({
      take: 6,
      orderBy: { startedAt: 'desc' },
      include: {
        candidate: { select: { name: true, email: true } },
        interviewer: { select: { username: true } },
        report: { select: { id: true, overallScore: true } },
      },
    }),
    prisma.interviewSession.count({ where: { interviewType: { contains: 'technical', mode: 'insensitive' } } }),
    prisma.interviewSession.count({ where: { interviewType: { contains: 'behavioral', mode: 'insensitive' } } }),
  ])
  const tQueryEnd = performance.now()

  if (process.env.NODE_ENV === 'development') {
    console.log(`[DEV TIMING] AdminDashboardPage: queries=${(tQueryEnd - t0).toFixed(1)}ms, total=${(performance.now() - t0).toFixed(1)}ms`)
  }

  const avgScore = scoreAgg._avg.score !== null ? Math.round(scoreAgg._avg.score * 10) / 10 : null
  const completionRate = totalInterviews > 0 ? Math.round((completedInterviews / totalInterviews) * 100) : 0
  const otherStatusCount = Math.max(0, totalInterviews - completedInterviews - activeInterviews)

  // Last 7 days activity trend from real database sessions
  const now = new Date()
  const days: { label: string; count: number }[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(now.getDate() - i)
    const dayStr = d.toLocaleDateString('en-US', { weekday: 'short' })
    const dayCount = recentSessions.filter(s => {
      const sDate = new Date(s.startedAt)
      return sDate.toDateString() === d.toDateString()
    }).length
    days.push({ label: dayStr, count: dayCount })
  }

  // Type proportions for striped progress cards
  const techPercent = totalInterviews > 0 ? Math.round((technicalCount / totalInterviews) * 100) : 60
  const behavPercent = totalInterviews > 0 ? Math.round((behavioralCount / totalInterviews) * 100) : 30
  const customPercent = Math.max(5, 100 - techPercent - behavPercent)

  return (
    <div className="zentra-page-container">
      {/* Top Header: Overview 🔗 + Date selector pills matching Zentra */}
      <div className="zentra-page-header">
        <div>
          <div className="zentra-title-row">
            <h1 className="zentra-page-title">Overview</h1>
            <span className="zentra-link-bubble" title="System Dashboard">
              <Icon name="link" size={16} />
            </span>
          </div>
          <p className="zentra-page-subtitle">Platform health, interview throughput, and real-time candidate metrics.</p>
        </div>

        <div className="zentra-header-actions">
          <div className="zentra-date-pill">
            <Icon name="calendar_today" size={15} style={{ color: 'var(--zentra-text-muted)' }} />
            <span>Real-time Data</span>
            <span className="zentra-compare-label">live DB</span>
          </div>
          <Link href="/admin/interviews" className="zentra-btn zentra-btn-primary">
            <Icon name="list" size={16} />
            <span>Manage Sessions</span>
          </Link>
        </div>
      </div>

      {/* 4 Top Metric Cards — Zentra rounded-2xl cards with big numbers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem', marginBottom: '1.75rem' }}>
        {/* Total Interviews */}
        <div className="zentra-card">
          <div className="zentra-card-header" style={{ marginBottom: '0.75rem' }}>
            <span className="zentra-metric-label">Total Interviews</span>
            <span className="zentra-pill-tag green">
              <Icon name="trending_up" size={13} /> {completionRate}% completed
            </span>
          </div>
          <div className="zentra-metric-num">{totalInterviews}</div>
          <div className="zentra-metric-sub">{completedInterviews} completed &bull; {activeInterviews} in progress</div>
        </div>

        {/* Total Candidates */}
        <div className="zentra-card">
          <div className="zentra-card-header" style={{ marginBottom: '0.75rem' }}>
            <span className="zentra-metric-label">Registered Candidates</span>
            <span className="zentra-pill-tag blue">
              <Icon name="group" size={13} /> Active
            </span>
          </div>
          <div className="zentra-metric-num">{totalCandidates}</div>
          <div className="zentra-metric-sub">{totalInterviewers} interviewers &bull; {totalUsers} total users</div>
        </div>

        {/* Average Score */}
        <div className="zentra-card">
          <div className="zentra-card-header" style={{ marginBottom: '0.75rem' }}>
            <span className="zentra-metric-label">Average Score</span>
            <span className="zentra-pill-tag green">
              {avgScore && avgScore >= 70 ? 'Satisfactory' : 'Adaptive'}
            </span>
          </div>
          <div className="zentra-metric-num">{avgScore !== null ? `${avgScore}%` : '—'}</div>
          <div className="zentra-metric-sub">Across all finalized evaluations</div>
        </div>

        {/* Master KB Documents */}
        <div className="zentra-card">
          <div className="zentra-card-header" style={{ marginBottom: '0.75rem' }}>
            <span className="zentra-metric-label">Knowledge Base</span>
            <span className="zentra-pill-tag">
              <Icon name="library_books" size={13} /> Synced
            </span>
          </div>
          <div className="zentra-metric-num">{totalDocuments}</div>
          <div className="zentra-metric-sub">Embedded documents in pgvector</div>
        </div>
      </div>

      {/* Main Feature Cards Grid: Payments-style on Left + Gross Volume-style on Right */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '1.5rem', marginBottom: '1.75rem' }}>
        {/* Left Feature Card: Interview Volume & Stepped Analysis */}
        <div className="zentra-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div className="zentra-card-header">
              <div>
                <h2 className="zentra-card-title">Interview Volume &amp; Conversion</h2>
                <span style={{ fontSize: '0.8rem', color: 'var(--zentra-text-muted)' }}>Funnel across evaluation lifecycle</span>
              </div>
              <span className="zentra-dot-menu">&bull;&bull;&bull;</span>
            </div>

            {/* Micro Columns Row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: '1rem', paddingBottom: '1.25rem', borderBottom: '1px solid var(--zentra-border-subtle)', marginBottom: '1.5rem' }}>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--zentra-text-muted)' }}>Total Sessions</div>
                <div style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--zentra-text-primary)' }}>{totalInterviews}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--zentra-text-muted)' }}>In Progress</div>
                <div style={{ fontSize: '1.35rem', fontWeight: 700, color: '#2563eb' }}>{activeInterviews}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--zentra-text-muted)' }}>Completed</div>
                <div style={{ fontSize: '1.35rem', fontWeight: 700, color: '#10b981' }}>{completedInterviews}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--zentra-text-muted)' }}>Avg Score</div>
                <div style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--zentra-text-primary)' }}>{avgScore !== null ? `${avgScore}%` : '—'}</div>
              </div>
            </div>

            {/* Stepped visual progress representation */}
            <div style={{ padding: '0.5rem 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem', color: 'var(--zentra-text-secondary)', marginBottom: '0.5rem' }}>
                <span>Completion Throughput</span>
                <span style={{ fontWeight: 600 }}>{completionRate}%</span>
              </div>
              <div style={{ height: '14px', borderRadius: '9999px', background: 'var(--zentra-bg-muted)', overflow: 'hidden', display: 'flex' }}>
                <div style={{ width: `${completionRate}%`, background: 'linear-gradient(90deg, #2563eb, #10b981)', borderRadius: '9999px' }}></div>
              </div>
            </div>
          </div>

          {/* Zentra Interactive Prompt Explorer Bar */}
          <div className="zentra-prompt-bar">
            <div className="zentra-prompt-title">
              <Icon name="smart_toy" size={16} />
              <span>What would you like to explore next?</span>
            </div>
            <div className="zentra-prompt-input-box">
              <span style={{ color: 'var(--zentra-text-dim)' }}>&gt;</span>
              <span>Check performance breakdown for recent completed candidate interviews</span>
            </div>
          </div>
        </div>

        {/* Right Feature Card: Platform Breakdown with Striped Bars (Like Zentra Gross Volume) */}
        <div className="zentra-card">
          <div className="zentra-card-header">
            <div>
              <h2 className="zentra-card-title">Interview Distribution</h2>
              <span style={{ fontSize: '0.8rem', color: 'var(--zentra-text-muted)' }}>Assessment modes &amp; completion</span>
            </div>
            <span className="zentra-dot-menu">&bull;&bull;&bull;</span>
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <div className="zentra-metric-num">{completionRate}%</div>
            <div className="zentra-metric-sub">Overall assessment completion efficiency</div>
          </div>

          {/* Striped Progress Bar Items */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.4rem', color: 'var(--zentra-text-primary)' }}>
                <span>Technical Interviews</span>
                <span style={{ color: '#059669', fontWeight: 600 }}>{techPercent}%</span>
              </div>
              <div className="striped-progress-bar striped-bar-green"></div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.4rem', color: 'var(--zentra-text-primary)' }}>
                <span>Behavioral &amp; Culture</span>
                <span style={{ color: '#2563eb', fontWeight: 600 }}>{behavPercent}%</span>
              </div>
              <div className="striped-progress-bar striped-bar-blue"></div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.4rem', color: 'var(--zentra-text-primary)' }}>
                <span>Custom RAG / Document Sessions</span>
                <span style={{ color: '#dc2626', fontWeight: 600 }}>{customPercent}%</span>
              </div>
              <div className="striped-progress-bar striped-bar-rose"></div>
            </div>
          </div>

          <div style={{ marginTop: '1.75rem', paddingTop: '1.25rem', borderTop: '1px solid var(--zentra-border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.825rem', color: 'var(--zentra-text-muted)' }}>Active AI LLM fallback engine</span>
            <span className="zentra-badge success">Groq + Gemini</span>
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div style={{ marginBottom: '2rem' }}>
        <AdminChartsWrapper
          statusBreakdown={{
            completed: completedInterviews,
            active: activeInterviews,
            other: otherStatusCount,
          }}
          activityLabels={days.map(d => d.label)}
          activityData={days.map(d => d.count)}
        />
      </div>

      {/* Recent Activity Table — Clean Zentra SaaS Table */}
      <div className="zentra-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--zentra-border)' }}>
          <div>
            <h3 className="zentra-card-title">Recent Interview Sessions</h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--zentra-text-muted)' }}>Latest sessions across all interviewers</span>
          </div>
          <Link href="/admin/interviews" className="zentra-btn zentra-btn-secondary" style={{ padding: '0.45rem 1rem', fontSize: '0.8rem' }}>
            View All ({totalInterviews})
          </Link>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="zentra-table">
            <thead>
              <tr>
                <th>Candidate</th>
                <th>Interviewer</th>
                <th>Type</th>
                <th>Status</th>
                <th>Score</th>
                <th>Started</th>
                <th style={{ textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {recentSessions.map((session) => {
                const isCompleted = session.status === 'completed'
                const scoreVal = session.score ?? session.report?.overallScore
                return (
                  <tr key={session.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                        <div style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '50%',
                          background: 'var(--zentra-bg-muted)',
                          color: 'var(--zentra-text-primary)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 700,
                          fontSize: '0.8rem',
                          border: '1px solid var(--zentra-border)'
                        }}>
                          {session.candidate?.name?.[0] || 'C'}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--zentra-text-primary)' }}>{session.candidate?.name || 'Unknown'}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--zentra-text-muted)' }}>{session.candidate?.email || 'No email'}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span style={{ color: 'var(--zentra-text-secondary)', fontSize: '0.85rem' }}>
                        {session.interviewer?.username || 'System'}
                      </span>
                    </td>
                    <td>
                      <span className="zentra-badge neutral" style={{ textTransform: 'capitalize' }}>
                        {session.interviewType || 'General'}
                      </span>
                    </td>
                    <td>
                      <span className={`zentra-badge ${isCompleted ? 'success' : session.status === 'active' ? 'warning' : 'neutral'}`} style={{ textTransform: 'capitalize' }}>
                        {session.status}
                      </span>
                    </td>
                    <td>
                      <span style={{
                        fontWeight: 600,
                        color: scoreVal ? (scoreVal >= 70 ? '#059669' : scoreVal >= 50 ? '#d97706' : '#dc2626') : 'var(--zentra-text-muted)'
                      }}>
                        {scoreVal ? `${Math.round(scoreVal)}%` : '—'}
                      </span>
                    </td>
                    <td>
                      <span style={{ color: 'var(--zentra-text-muted)', fontSize: '0.8rem' }}>
                        {new Date(session.startedAt).toLocaleDateString()}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {session.report ? (
                        <Link href={`/report/${session.id}`} className="zentra-btn zentra-btn-secondary" style={{ padding: '0.35rem 0.85rem', fontSize: '0.75rem' }}>
                          Report
                        </Link>
                      ) : (
                        <span style={{ fontSize: '0.75rem', color: 'var(--zentra-text-muted)' }}>Active</span>
                      )}
                    </td>
                  </tr>
                )
              })}
              {recentSessions.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--zentra-text-muted)' }}>
                    No interview sessions recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
