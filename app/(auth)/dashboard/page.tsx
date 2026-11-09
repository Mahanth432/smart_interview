import React from 'react'
import { DashboardStats } from '@/components/dashboard/DashboardStats'
import { RecentInterviews } from '@/components/dashboard/RecentInterviews'
import { ScoreChartWrapper } from '@/components/dashboard/ScoreChartWrapper'
import Icon from '@/components/Icon'
import prisma from '@/lib/db'
import { getAppSession } from '@/lib/auth'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const t0 = performance.now()
  const session = await getAppSession()
  const tSession = performance.now()
  const userId = session.userId

  if (!userId) {
    return <div style={{ padding: '2rem', color: 'var(--zentra-text-primary)' }}>Unauthorized</div>
  }

  // Fetch real interviewer data from DB in parallel
  const tQuery0 = performance.now()
  const [totalSessions, completedSessions, activeSession, recentSessions, scoreAgg] = await Promise.all([
    prisma.interviewSession.count({ where: { interviewerId: userId } }),
    prisma.interviewSession.count({ where: { status: 'completed', interviewerId: userId } }),
    prisma.interviewSession.findFirst({
      where: { status: 'active', interviewerId: userId },
      select: {
        id: true,
        candidate: { select: { name: true } },
      },
    }),
    prisma.interviewSession.findMany({
      where: { interviewerId: userId },
      orderBy: { startedAt: 'desc' },
      take: 6,
      select: {
        id: true,
        interviewType: true,
        startedAt: true,
        score: true,
        status: true,
        candidate: { select: { name: true } },
      },
    }),
    prisma.interviewSession.aggregate({
      where: { interviewerId: userId, score: { not: null } },
      _avg: { score: true },
    }),
  ])
  const tQueryEnd = performance.now()

  const avgScore = scoreAgg._avg.score !== null ? Math.round(scoreAgg._avg.score * 10) / 10 : null

  if (process.env.NODE_ENV === 'development') {
    console.log(`[DEV TIMING] DashboardPage: session=${(tSession - t0).toFixed(1)}ms, queries=${(tQueryEnd - tQuery0).toFixed(1)}ms, total=${(performance.now() - t0).toFixed(1)}ms`)
  }

  return (
    <div className="zentra-page-container">
      {/* Header: Overview 🔗 + Date pill + New Session button */}
      <div className="zentra-page-header">
        <div>
          <div className="zentra-title-row">
            <h1 className="zentra-page-title">Overview</h1>
            <span className="zentra-link-bubble" title="Interviewer Hub">
              <Icon name="link" size={16} />
            </span>
          </div>
          <p className="zentra-page-subtitle">Your candidate evaluation velocity, scoring distributions, and active interviews.</p>
        </div>

        <div className="zentra-header-actions">
          <div className="zentra-date-pill">
            <Icon name="calendar_today" size={15} style={{ color: 'var(--zentra-text-muted)' }} />
            <span>Real-time Workspace</span>
            <span className="zentra-compare-label">live DB</span>
          </div>
          <Link href="/interview" className="zentra-btn zentra-btn-primary">
            <Icon name="add" size={16} />
            <span>New Session</span>
          </Link>
        </div>
      </div>

      {/* Top 4 Stats Cards */}
      <DashboardStats
        totalSessions={totalSessions}
        completedSessions={completedSessions}
        activeSession={activeSession}
        averageScore={avgScore}
      />

      {/* Main Grid: Score Trend on Left + Recent Interviews on Right */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '1.5rem', marginBottom: '1.75rem' }}>
        {/* Left: Score Trend Chart & AI Prompt Bar */}
        <div className="zentra-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div className="zentra-card-header">
              <div>
                <h2 className="zentra-card-title">Candidate Evaluation Trend</h2>
                <span style={{ fontSize: '0.8rem', color: 'var(--zentra-text-muted)' }}>Average technical competency performance</span>
              </div>
              <span className="zentra-dot-menu">&bull;&bull;&bull;</span>
            </div>

            <div style={{ minHeight: '280px', width: '100%' }}>
              <ScoreChartWrapper />
            </div>
          </div>

          {/* Zentra Assistant Exploration Bar */}
          <div className="zentra-prompt-bar">
            <div className="zentra-prompt-title">
              <Icon name="smart_toy" size={16} />
              <span>What would you like to explore next?</span>
            </div>
            <div className="zentra-prompt-input-box">
              <span style={{ color: 'var(--zentra-text-dim)' }}>&gt;</span>
              <span>Generate customized Python &amp; System Design questions from synced syllabus</span>
            </div>
          </div>
        </div>

        {/* Right: Recent Interviews List */}
        <div>
          <RecentInterviews sessions={recentSessions} />
        </div>
      </div>
    </div>
  )
}
