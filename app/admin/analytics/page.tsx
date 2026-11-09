'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Icon from '@/components/Icon'
import { formatScore } from '@/lib/formatters'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'
import { Line, Doughnut, Bar } from 'react-chartjs-2'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
)

interface AnalyticsData {
  metrics: {
    totalInterviews: number
    completedInterviews: number
    activeInterviews: number
    totalCandidates: number
    totalInterviewers: number
    completionRate: number
  }
  scores: {
    averageScore: number | null
    highestScore: number | null
    lowestScore: number | null
    scoredInterviewsCount: number
  }
  statusBreakdown: Array<{ status: string; count: number; percentage: number }>
  typeBreakdown: Array<{ type: string; count: number; percentage: number }>
  difficultyBreakdown: Array<{ difficulty: string; count: number; percentage: number }>
  activityTrend: Array<{ date: string; count: number; completedCount: number }>
  interviewerPerformance: Array<{
    id: number
    username: string
    totalInterviews: number
    completedInterviews: number
    averageScore: number | null
  }>
}

export default function AdminAnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAnalytics = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/analytics')
      if (res.ok) {
        const json = await res.json()
        setData(json)
      } else {
        setError(`Failed to fetch analytics (HTTP ${res.status})`)
      }
    } catch (err) {
      console.error('Analytics fetch error:', err)
      setError('An error occurred while loading analytics data.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAnalytics()
  }, [fetchAnalytics])

  if (loading) {
    return (
      <div className="zentra-page-container">
        <div className="zentra-card" style={{ padding: '4rem', textAlign: 'center', color: 'var(--zentra-text-muted)' }}>
          <Icon name="analytics" size={32} style={{ marginBottom: '0.75rem', color: '#2563eb' }} />
          <div>Aggregating platform performance metrics...</div>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="zentra-page-container">
        <div className="zentra-card" style={{ padding: '3rem', textAlign: 'center', borderColor: 'rgba(239,68,68,0.2)' }}>
          <div style={{ color: '#dc2626', marginBottom: '1rem', fontWeight: 600 }}>{error || 'Unable to display analytics'}</div>
          <button onClick={fetchAnalytics} className="zentra-btn zentra-btn-primary">
            Retry
          </button>
        </div>
      </div>
    )
  }

  const { metrics, scores, statusBreakdown, difficultyBreakdown, activityTrend, interviewerPerformance } = data

  // Activity chart
  const activityChartData = {
    labels: activityTrend.map((item) => item.date.slice(5)),
    datasets: [
      {
        label: 'Total Sessions',
        data: activityTrend.map((item) => item.count),
        borderColor: '#2563eb',
        backgroundColor: 'rgba(37, 99, 235, 0.12)',
        borderWidth: 2,
        tension: 0.35,
        fill: true,
      },
      {
        label: 'Completed Sessions',
        data: activityTrend.map((item) => item.completedCount),
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        borderWidth: 2,
        tension: 0.35,
        fill: true,
      },
    ],
  }

  const activityChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top' as const,
        labels: { color: '#64748b', font: { size: 12, family: 'Inter' }, usePointStyle: true },
      },
      tooltip: {
        backgroundColor: '#0f172a',
        titleColor: '#fff',
        bodyColor: '#cbd5e1',
        padding: 10,
        cornerRadius: 8,
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: '#94a3b8', maxTicksLimit: 12, font: { size: 11, family: 'Inter' } },
      },
      y: {
        beginAtZero: true,
        ticks: { color: '#94a3b8', precision: 0, font: { size: 11, family: 'Inter' } },
        grid: { color: 'rgba(226, 232, 240, 0.6)' },
      },
    },
  }

  // Status chart
  const statusColors = ['#10b981', '#2563eb', '#f59e0b', '#ef4444', '#8b5cf6']
  const statusChartData = {
    labels: statusBreakdown.map((item) => item.status.toUpperCase()),
    datasets: [
      {
        data: statusBreakdown.map((item) => item.count),
        backgroundColor: statusColors.slice(0, statusBreakdown.length),
        borderWidth: 0,
      },
    ],
  }

  const statusChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '70%',
    plugins: {
      legend: {
        position: 'bottom' as const,
        labels: { color: '#64748b', font: { size: 11, family: 'Inter' }, usePointStyle: true, padding: 12 },
      },
    },
  }

  // Difficulty chart
  const difficultyChartData = {
    labels: difficultyBreakdown.map((item) => item.difficulty.toUpperCase()),
    datasets: [
      {
        label: 'Sessions',
        data: difficultyBreakdown.map((item) => item.count),
        backgroundColor: 'rgba(37, 99, 235, 0.85)',
        borderRadius: 8,
      },
    ],
  }

  const difficultyChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: '#94a3b8', font: { size: 11, family: 'Inter' } },
      },
      y: {
        beginAtZero: true,
        ticks: { color: '#94a3b8', precision: 0, font: { size: 11, family: 'Inter' } },
        grid: { color: 'rgba(226, 232, 240, 0.6)' },
      },
    },
  }

  return (
    <div className="zentra-page-container">
      {/* Header */}
      <div className="zentra-page-header">
        <div>
          <div className="zentra-title-row">
            <h1 className="zentra-page-title">Analytics</h1>
            <span className="zentra-link-bubble" title="System Analytics">
              <Icon name="link" size={16} />
            </span>
          </div>
          <p className="zentra-page-subtitle">Real-time database aggregations, scoring curves, and interviewer velocity.</p>
        </div>

        <div className="zentra-header-actions">
          <div className="zentra-date-pill">
            <Icon name="calendar_today" size={15} style={{ color: 'var(--zentra-text-muted)' }} />
            <span>Last 30 Days</span>
            <span className="zentra-compare-label">live DB</span>
          </div>
          <button onClick={fetchAnalytics} className="zentra-btn zentra-btn-secondary">
            <Icon name="refresh" size={16} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Top Overview Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '1.25rem', marginBottom: '1.75rem' }}>
        <div className="zentra-card">
          <div className="zentra-card-header" style={{ marginBottom: '0.75rem' }}>
            <span className="zentra-metric-label">Total Interviews</span>
            <span className="zentra-pill-tag">System</span>
          </div>
          <div className="zentra-metric-num">{metrics.totalInterviews}</div>
          <div className="zentra-metric-sub">Across all interviewers</div>
        </div>

        <div className="zentra-card">
          <div className="zentra-card-header" style={{ marginBottom: '0.75rem' }}>
            <span className="zentra-metric-label">Completed Sessions</span>
            <span className="zentra-pill-tag green">{metrics.completionRate}% rate</span>
          </div>
          <div className="zentra-metric-num" style={{ color: '#10b981' }}>{metrics.completedInterviews}</div>
          <div className="zentra-metric-sub">{metrics.activeInterviews} currently active</div>
        </div>

        <div className="zentra-card">
          <div className="zentra-card-header" style={{ marginBottom: '0.75rem' }}>
            <span className="zentra-metric-label">Active Candidates</span>
            <span className="zentra-pill-tag blue">Profiles</span>
          </div>
          <div className="zentra-metric-num">{metrics.totalCandidates}</div>
          <div className="zentra-metric-sub">Registered platform pool</div>
        </div>

        <div className="zentra-card">
          <div className="zentra-card-header" style={{ marginBottom: '0.75rem' }}>
            <span className="zentra-metric-label">Interviewers</span>
            <span className="zentra-pill-tag">Recruiters</span>
          </div>
          <div className="zentra-metric-num">{metrics.totalInterviewers}</div>
          <div className="zentra-metric-sub">Conducting interviews</div>
        </div>
      </div>

      {/* Score Analytics Card */}
      <div className="zentra-card" style={{ marginBottom: '1.75rem' }}>
        <div className="zentra-card-header">
          <div>
            <h2 className="zentra-card-title">Candidate Score Analytics</h2>
            <span style={{ fontSize: '0.8rem', color: 'var(--zentra-text-muted)' }}>Distribution across scored evaluations</span>
          </div>
          <span className="zentra-dot-menu">&bull;&bull;&bull;</span>
        </div>

        {scores.scoredInterviewsCount === 0 || scores.averageScore === null ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--zentra-text-muted)' }}>
            No evaluated interview scores available yet.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
            <div style={{ background: 'var(--zentra-bg-muted)', padding: '1.25rem', borderRadius: '16px', border: '1px solid var(--zentra-border)' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--zentra-text-secondary)', fontWeight: 500 }}>Average Score</div>
              <div style={{ fontSize: '2rem', fontWeight: 700, color: '#2563eb', marginTop: '0.25rem' }}>
                {formatScore(scores.averageScore)}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--zentra-text-muted)', marginTop: '0.25rem' }}>All scored sessions</div>
            </div>

            <div style={{ background: 'var(--zentra-bg-muted)', padding: '1.25rem', borderRadius: '16px', border: '1px solid var(--zentra-border)' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--zentra-text-secondary)', fontWeight: 500 }}>Highest Score</div>
              <div style={{ fontSize: '2rem', fontWeight: 700, color: '#10b981', marginTop: '0.25rem' }}>
                {formatScore(scores.highestScore)}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--zentra-text-muted)', marginTop: '0.25rem' }}>Peak evaluation</div>
            </div>

            <div style={{ background: 'var(--zentra-bg-muted)', padding: '1.25rem', borderRadius: '16px', border: '1px solid var(--zentra-border)' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--zentra-text-secondary)', fontWeight: 500 }}>Lowest Score</div>
              <div style={{ fontSize: '2rem', fontWeight: 700, color: '#ef4444', marginTop: '0.25rem' }}>
                {formatScore(scores.lowestScore)}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--zentra-text-muted)', marginTop: '0.25rem' }}>Minimum threshold</div>
            </div>

            <div style={{ background: 'var(--zentra-bg-muted)', padding: '1.25rem', borderRadius: '16px', border: '1px solid var(--zentra-border)' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--zentra-text-secondary)', fontWeight: 500 }}>Scored Sessions</div>
              <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--zentra-text-primary)', marginTop: '0.25rem' }}>
                {scores.scoredInterviewsCount}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--zentra-text-muted)', marginTop: '0.25rem' }}>Evaluated reports</div>
            </div>
          </div>
        )}
      </div>

      {/* Charts Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1.5rem', marginBottom: '1.75rem' }}>
        {/* 30-Day Activity Trend */}
        <div className="zentra-card" style={{ minHeight: '380px', display: 'flex', flexDirection: 'column' }}>
          <div className="zentra-card-header">
            <div>
              <h2 className="zentra-card-title">Interview Activity Trend (30 Days)</h2>
              <span style={{ fontSize: '0.8rem', color: 'var(--zentra-text-muted)' }}>Daily volume and completion rate</span>
            </div>
            <span className="zentra-dot-menu">&bull;&bull;&bull;</span>
          </div>
          <div style={{ flex: 1, minHeight: '270px' }}>
            <Line data={activityChartData} options={activityChartOptions} />
          </div>
        </div>

        {/* Status Distribution Doughnut */}
        <div className="zentra-card" style={{ minHeight: '380px', display: 'flex', flexDirection: 'column' }}>
          <div className="zentra-card-header">
            <div>
              <h2 className="zentra-card-title">Status Breakdown</h2>
              <span style={{ fontSize: '0.8rem', color: 'var(--zentra-text-muted)' }}>Proportion by session state</span>
            </div>
            <span className="zentra-dot-menu">&bull;&bull;&bull;</span>
          </div>
          <div style={{ flex: 1, minHeight: '270px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Doughnut data={statusChartData} options={statusChartOptions} />
          </div>
        </div>
      </div>

      {/* Difficulty & Interviewer Performance */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        {/* Difficulty Distribution Bar */}
        <div className="zentra-card" style={{ minHeight: '340px', display: 'flex', flexDirection: 'column' }}>
          <div className="zentra-card-header">
            <div>
              <h2 className="zentra-card-title">Difficulty Distribution</h2>
              <span style={{ fontSize: '0.8rem', color: 'var(--zentra-text-muted)' }}>Breakdown by level tier</span>
            </div>
            <span className="zentra-dot-menu">&bull;&bull;&bull;</span>
          </div>
          <div style={{ flex: 1, minHeight: '240px' }}>
            <Bar data={difficultyChartData} options={difficultyChartOptions} />
          </div>
        </div>

        {/* Interviewer Performance Table */}
        <div className="zentra-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--zentra-border)' }}>
            <h3 className="zentra-card-title">Interviewer Activity &amp; Velocity</h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--zentra-text-muted)' }}>Conducted evaluations per interviewer</span>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="zentra-table">
              <thead>
                <tr>
                  <th>Interviewer</th>
                  <th>Sessions</th>
                  <th>Completed</th>
                  <th>Avg Score</th>
                </tr>
              </thead>
              <tbody>
                {interviewerPerformance.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--zentra-text-muted)' }}>
                      No interviewer sessions recorded yet.
                    </td>
                  </tr>
                ) : (
                  interviewerPerformance.map((user) => (
                    <tr key={user.id}>
                      <td style={{ fontWeight: 600, color: 'var(--zentra-text-primary)' }}>
                        {user.username}
                      </td>
                      <td>
                        <span className="zentra-pill-tag">
                          {user.totalInterviews} sessions
                        </span>
                      </td>
                      <td style={{ color: '#10b981', fontWeight: 600 }}>
                        {user.completedInterviews}
                      </td>
                      <td>
                        {user.averageScore !== null ? (
                          <span style={{ fontWeight: 600, color: '#2563eb' }}>
                            {formatScore(user.averageScore)}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--zentra-text-muted)' }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
