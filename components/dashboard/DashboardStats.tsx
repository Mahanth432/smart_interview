import React from 'react'
import Icon from '@/components/Icon'

interface DashboardStatsProps {
  totalSessions: number
  completedSessions: number
  activeSession: { candidate?: { name?: string } } | null
  averageScore?: number | null
}

export const DashboardStats = ({ totalSessions, completedSessions, activeSession, averageScore }: DashboardStatsProps) => {
  const completionRate = totalSessions > 0 ? Math.round((completedSessions / totalSessions) * 100) : 0

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem', marginBottom: '1.75rem' }}>
      {/* Total Sessions */}
      <div className="zentra-card">
        <div className="zentra-card-header" style={{ marginBottom: '0.75rem' }}>
          <span className="zentra-metric-label">Conducted Sessions</span>
          <span className="zentra-pill-tag blue">
            <Icon name="assignment" size={13} /> Evaluated
          </span>
        </div>
        <div className="zentra-metric-num">{totalSessions}</div>
        <div className="zentra-metric-sub">{completedSessions} completed sessions</div>
      </div>

      {/* Completed Sessions */}
      <div className="zentra-card">
        <div className="zentra-card-header" style={{ marginBottom: '0.75rem' }}>
          <span className="zentra-metric-label">Completed Sessions</span>
          <span className="zentra-pill-tag green">
            <Icon name="trending_up" size={13} /> {completionRate}% rate
          </span>
        </div>
        <div className="zentra-metric-num" style={{ color: '#10b981' }}>{completedSessions}</div>
        <div className="zentra-metric-sub">Full reports generated</div>
      </div>

      {/* Average Score */}
      <div className="zentra-card">
        <div className="zentra-card-header" style={{ marginBottom: '0.75rem' }}>
          <span className="zentra-metric-label">Average Score</span>
          <span className="zentra-pill-tag">
            {averageScore && averageScore >= 70 ? 'Satisfactory' : 'Adaptive'}
          </span>
        </div>
        <div className="zentra-metric-num">
          {averageScore !== undefined && averageScore !== null ? `${Math.round(averageScore)}%` : '—'}
        </div>
        <div className="zentra-metric-sub">Mean score of candidates</div>
      </div>

      {/* Live / In-Progress */}
      <div className="zentra-card" style={{ borderColor: activeSession ? 'rgba(245, 158, 11, 0.4)' : undefined }}>
        <div className="zentra-card-header" style={{ marginBottom: '0.75rem' }}>
          <span className="zentra-metric-label">Live Active Sessions</span>
          <span className={`zentra-pill-tag ${activeSession ? 'green' : ''}`}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: activeSession ? '#10b981' : '#94a3b8', display: 'inline-block' }}></span>
            {activeSession ? 'In Progress' : 'Idle'}
          </span>
        </div>
        <div className="zentra-metric-num" style={{ color: activeSession ? '#f59e0b' : 'var(--zentra-text-primary)' }}>
          {activeSession ? 1 : 0}
        </div>
        <div className="zentra-metric-sub">
          {activeSession ? `Active candidate: ${activeSession.candidate?.name || 'In Progress'}` : 'No active sessions'}
        </div>
      </div>
    </div>
  )
}
