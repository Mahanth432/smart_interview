import React from 'react'
import Icon from '@/components/Icon'
import Link from 'next/link'

interface SessionItem {
  id: string
  candidate?: { name?: string }
  interviewType?: string
  startedAt: string | Date
  score: number | null
  status: string
}

export const RecentInterviews = ({ sessions }: { sessions: SessionItem[] }) => {
  return (
    <div className="zentra-card" style={{ padding: 0, overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--zentra-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 className="zentra-card-title">Recent Activity</h3>
          <span style={{ fontSize: '0.8rem', color: 'var(--zentra-text-muted)' }}>Latest sessions conducted by you</span>
        </div>
        <Link href="/report" className="zentra-btn zentra-btn-secondary" style={{ padding: '0.35rem 0.85rem', fontSize: '0.75rem' }}>
          View Reports
        </Link>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
        {sessions.map((session, idx) => {
          const isCompleted = session.status === 'completed'
          const scorePercent = session.score ? Math.round(session.score) : null

          return (
            <div
              key={session.id}
              style={{
                padding: '1rem 1.5rem',
                borderBottom: idx !== sessions.length - 1 ? '1px solid var(--zentra-border-subtle)' : 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                transition: 'background-color 0.15s ease',
              }}
              className="recent-interview-item"
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  background: 'var(--zentra-bg-muted)',
                  border: '1px solid var(--zentra-border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--zentra-text-primary)',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                }}>
                  {session.candidate?.name?.[0] || 'C'}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                  <span style={{ color: 'var(--zentra-text-primary)', fontWeight: 600, fontSize: '0.9rem' }}>
                    {session.candidate?.name || 'Unknown Candidate'}
                  </span>
                  <span style={{ color: 'var(--zentra-text-muted)', fontSize: '0.75rem' }}>
                    {session.interviewType || 'Technical Interview'} &bull; {new Date(session.startedAt).toLocaleDateString()}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.1rem' }}>
                  <span style={{ color: 'var(--zentra-text-muted)', fontSize: '0.7rem' }}>Score</span>
                  <span style={{
                    fontWeight: 700,
                    fontSize: '0.95rem',
                    color: scorePercent ? (scorePercent >= 70 ? '#059669' : scorePercent >= 50 ? '#d97706' : '#dc2626') : 'var(--zentra-text-muted)',
                  }}>
                    {scorePercent !== null ? `${scorePercent}%` : '—'}
                  </span>
                </div>

                <span className={`zentra-badge ${isCompleted ? 'success' : 'warning'}`} style={{ textTransform: 'capitalize' }}>
                  {session.status}
                </span>

                <Link
                  href={`/report/${session.id}`}
                  className="zentra-btn zentra-btn-secondary"
                  style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem' }}
                >
                  <Icon name="chevron_right" size={15} />
                </Link>
              </div>
            </div>
          )
        })}

        {sessions.length === 0 && (
          <div style={{ padding: '3rem 1.5rem', textAlign: 'center', color: 'var(--zentra-text-muted)', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="history" size={28} style={{ opacity: 0.4, marginBottom: '0.5rem' }} />
            <div>No interview sessions recorded yet.</div>
            <Link href="/interview" className="zentra-btn zentra-btn-primary" style={{ marginTop: '1rem', fontSize: '0.8rem' }}>
              Start Live Interview
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
