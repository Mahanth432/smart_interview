export const dynamic = 'force-dynamic'

import React from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import prisma from '@/lib/db'
import { getAppSession } from '@/lib/auth'
import Icon from '@/components/Icon'
import { ReportsListClient, ReportItem } from '@/components/report/ReportsListClient'

export default async function ReportIndexPage() {
  const session = await getAppSession()

  if (!session.isLoggedIn || !session.userId) {
    redirect('/api/auth/logout')
  }

  const userId = session.userId
  const isCandidate = session.role === 'CANDIDATE'
  const isAdmin = session.role === 'ADMIN'

  const whereCondition = isCandidate
    ? { candidate: { userId }, report: { isNot: null } }
    : isAdmin
      ? { report: { isNot: null } }
      : { interviewerId: userId, report: { isNot: null } }

  let sessions: Array<{
    id: string
    startedAt: Date
    endedAt: Date | null
    interviewType: string
    difficulty: string
    status: string
    score: number | null
    candidate: { id: string; name: string; email: string | null }
    interviewer: { id: number; username: string; email: string | null } | null
    report: {
      id: string
      overallScore: number
      executiveSummary: string
      strengths: string[]
      weaknesses: string[]
      createdAt: Date
    } | null
    _count: { questions: number }
  }> = []

  let totalCount = 0
  let scoreAgg: { _avg: { score: number | null }; _max: { score: number | null } } = {
    _avg: { score: null },
    _max: { score: null },
  }

  try {
    const [fetchedSessions, count, agg] = await Promise.all([
      prisma.interviewSession.findMany({
        where: whereCondition,
        orderBy: { startedAt: 'desc' },
        take: 100,
        select: {
          id: true,
          startedAt: true,
          endedAt: true,
          interviewType: true,
          difficulty: true,
          status: true,
          score: true,
          candidate: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          interviewer: {
            select: {
              id: true,
              username: true,
              email: true,
            },
          },
          report: {
            select: {
              id: true,
              overallScore: true,
              executiveSummary: true,
              strengths: true,
              weaknesses: true,
              createdAt: true,
            },
          },
          _count: {
            select: {
              questions: true,
            },
          },
        },
      }),
      prisma.interviewSession.count({ where: whereCondition }),
      prisma.interviewSession.aggregate({
        where: { ...whereCondition, score: { not: null } },
        _avg: { score: true },
        _max: { score: true },
      }),
    ])

    sessions = fetchedSessions
    totalCount = count
    scoreAgg = agg
  } catch (err) {
    console.error('Failed to load reports from database:', err)
    return (
      <div className="zentra-page-container">
        <div className="zentra-card" style={{ padding: '3.5rem 2rem', textAlign: 'center' }}>
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '50%',
              background: 'rgba(239, 68, 68, 0.1)',
              color: '#ef4444',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1rem auto',
            }}
          >
            <Icon name="error_outline" size={26} />
          </div>
          <h2 style={{ fontSize: '1.35rem', fontWeight: 600, color: 'var(--zentra-text-primary)', margin: '0 0 0.5rem 0' }}>
            Report Database Retrieval Error
          </h2>
          <p style={{ color: 'var(--zentra-text-muted)', fontSize: '0.9rem', maxWidth: '480px', margin: '0 auto 1.25rem auto', lineHeight: 1.6 }}>
            We encountered an unexpected error while querying your interview evaluation reports. Please try refreshing the page.
          </p>
          <Link href="/dashboard" className="zentra-btn zentra-btn-primary">
            Return to Dashboard
          </Link>
        </div>
      </div>
    )
  }

  const avgScore = scoreAgg._avg.score !== null ? Math.round(scoreAgg._avg.score * 10) / 10 : null
  const maxScore = scoreAgg._max.score !== null ? Math.round(scoreAgg._max.score * 10) / 10 : null
  const completedCount = sessions.filter((s) => s.status === 'completed').length

  const formattedReports: ReportItem[] = sessions.map((s) => ({
    id: s.id,
    startedAt: s.startedAt.toISOString(),
    endedAt: s.endedAt ? s.endedAt.toISOString() : null,
    interviewType: s.interviewType,
    difficulty: s.difficulty,
    status: s.status,
    score: s.score,
    candidate: s.candidate,
    interviewer: s.interviewer,
    report: s.report
      ? {
          id: s.report.id,
          overallScore: s.report.overallScore,
          executiveSummary: s.report.executiveSummary,
          strengths: s.report.strengths,
          weaknesses: s.report.weaknesses,
          createdAt: s.report.createdAt.toISOString(),
        }
      : null,
    questionCount: s._count.questions,
  }))

  return (
    <div className="zentra-page-container">
      {/* Top Header */}
      <div className="zentra-page-header">
        <div>
          <div className="zentra-title-row">
            <h1 className="zentra-page-title">
              {isCandidate ? 'My Evaluation Reports' : 'Interview Reports'}
            </h1>
            <span className="zentra-link-bubble" title="Reports Directory">
              <Icon name="analytics" size={16} />
            </span>
          </div>
          <p className="zentra-page-subtitle">
            {isCandidate
              ? 'Complete archive of your technical evaluations, AI feedback summaries, and competency scores.'
              : 'Detailed performance evaluations, AI scoring breakdowns, and candidate assessment records.'}
          </p>
        </div>

        <div className="zentra-header-actions">
          <div className="zentra-date-pill">
            <Icon name="calendar_today" size={15} style={{ color: 'var(--zentra-text-muted)' }} />
            <span>Archive</span>
            <span className="zentra-compare-label">{totalCount} total</span>
          </div>
          {isCandidate ? (
            <Link href="/candidate" className="zentra-btn zentra-btn-secondary">
              <Icon name="dashboard" size={16} />
              <span>My Portal</span>
            </Link>
          ) : (
            <Link href="/interview" className="zentra-btn zentra-btn-primary">
              <Icon name="add" size={16} />
              <span>New Session</span>
            </Link>
          )}
        </div>
      </div>

      {/* 4 Metric Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem', marginBottom: '1.75rem' }}>
        {/* Total Evaluated */}
        <div className="zentra-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <span className="zentra-metric-label">Evaluated Reports</span>
            <span className="zentra-dot-menu" style={{ color: 'var(--zentra-accent-blue)' }}>
              <Icon name="description" size={18} />
            </span>
          </div>
          <div className="zentra-metric-value" style={{ color: 'var(--zentra-text-primary)' }}>
            {totalCount}
          </div>
          <span className="zentra-metric-subtext">Total recorded reports</span>
        </div>

        {/* Average Score */}
        <div className="zentra-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <span className="zentra-metric-label">Average Score</span>
            <span className="zentra-dot-menu" style={{ color: '#10b981' }}>
              <Icon name="trending_up" size={18} />
            </span>
          </div>
          <div className="zentra-metric-value" style={{ color: avgScore !== null && avgScore >= 60 ? '#10b981' : '#f59e0b' }}>
            {avgScore !== null ? `${avgScore}%` : 'N/A'}
          </div>
          <span className="zentra-metric-subtext">Mean technical competency</span>
        </div>

        {/* Highest Score */}
        <div className="zentra-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <span className="zentra-metric-label">Top Performance</span>
            <span className="zentra-dot-menu" style={{ color: '#8b5cf6' }}>
              <Icon name="emoji_events" size={18} />
            </span>
          </div>
          <div className="zentra-metric-value" style={{ color: maxScore !== null ? 'var(--zentra-text-primary)' : 'var(--zentra-text-muted)' }}>
            {maxScore !== null ? `${maxScore}%` : 'N/A'}
          </div>
          <span className="zentra-metric-subtext">Peak candidate result</span>
        </div>

        {/* Completed Interviews */}
        <div className="zentra-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <span className="zentra-metric-label">Completed Sessions</span>
            <span className="zentra-dot-menu" style={{ color: '#06b6d4' }}>
              <Icon name="check_circle" size={18} />
            </span>
          </div>
          <div className="zentra-metric-value" style={{ color: 'var(--zentra-text-primary)' }}>
            {completedCount}
          </div>
          <span className="zentra-metric-subtext">Finalized interviews</span>
        </div>
      </div>

      {/* Main Content Area: Reports List or Useful Empty State */}
      {sessions.length === 0 ? (
        <div style={{ padding: '2rem 1rem', maxWidth: '640px', margin: '0 auto', textAlign: 'center' }}>
          <div className="zentra-card" style={{ padding: '3.5rem 2.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.25rem' }}>
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                background: 'var(--zentra-bg-muted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--zentra-text-muted)',
              }}
            >
              <Icon name="description" size={32} />
            </div>

            <div>
              <h2 style={{ fontSize: '1.4rem', fontWeight: 600, color: 'var(--zentra-text-primary)', margin: '0 0 0.5rem 0' }}>
                No Reports Available
              </h2>
              <p style={{ color: 'var(--zentra-text-muted)', lineHeight: 1.6, fontSize: '0.9rem', margin: 0 }}>
                {isCandidate
                  ? 'You do not have any completed interview evaluation reports yet. Once your interviewer finishes evaluating your session, your complete analysis and scores will be accessible here.'
                  : 'No completed interview evaluation reports found for your account. Conduct an interview to generate candidate evaluation reports.'}
              </p>
            </div>

            {isCandidate ? (
              <Link
                href="/candidate"
                className="zentra-btn zentra-btn-primary"
                style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}
              >
                <Icon name="person" size={16} /> Go to Candidate Portal
              </Link>
            ) : (
              <Link
                href="/interview"
                className="zentra-btn zentra-btn-primary"
                style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}
              >
                <Icon name="play_arrow" size={16} /> Conduct Live Interview
              </Link>
            )}
          </div>
        </div>
      ) : (
        <ReportsListClient reports={formattedReports} role={session.role} />
      )}
    </div>
  )
}
