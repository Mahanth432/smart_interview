'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Icon from '@/components/Icon'
import Link from 'next/link'

interface InterviewItem {
  id: string
  status: string
  difficulty: string
  interviewType: string
  score: number | null
  startedAt: string
  endedAt: string | null
  candidate: {
    id: string
    name: string
    email: string | null
  }
  interviewer: {
    id: number
    username: string
    displayName?: string
    role: string
  } | null
  report: {
    id: string
    overallScore: number
  } | null
  _count: {
    questions: number
  }
}

export default function AdminInterviewsPage() {
  const [interviews, setInterviews] = useState<InterviewItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('ALL')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalInterviews, setTotalInterviews] = useState(0)

  const fetchInterviews = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (status !== 'ALL') params.set('status', status)
      params.set('page', page.toString())
      params.set('limit', '15')

      const res = await fetch(`/api/admin/interviews?${params.toString()}`)
      if (res.ok) {
        const data = await res.json()
        setInterviews(data.interviews || [])
        setTotalPages(data.totalPages || 1)
        setTotalInterviews(data.total || 0)
      }
    } catch (err) {
      console.error('Failed to load interviews:', err)
    } finally {
      setLoading(false)
    }
  }, [search, status, page])

  useEffect(() => {
    fetchInterviews()
  }, [fetchInterviews])

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value)
    setPage(1)
  }

  const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setStatus(e.target.value)
    setPage(1)
  }

  const getScoreBadge = (score: number | null | undefined) => {
    if (score === null || score === undefined || typeof score !== 'number' || !isFinite(score)) {
      return <span style={{ color: 'var(--zentra-text-muted)', fontSize: '0.85rem' }}>—</span>
    }
    const percent = Math.round(score * 10) / 10
    const badgeType = percent >= 75 ? 'success' : percent >= 50 ? 'warning' : 'danger'

    return (
      <span className={`zentra-badge ${badgeType}`}>
        {percent}%
      </span>
    )
  }

  return (
    <div className="zentra-page-container">
      {/* Header */}
      <div className="zentra-page-header">
        <div>
          <div className="zentra-title-row">
            <h1 className="zentra-page-title">Interviews</h1>
            <span className="zentra-link-bubble" title="All Sessions">
              <Icon name="link" size={16} />
            </span>
          </div>
          <p className="zentra-page-subtitle">Monitor and review interview sessions across all interviewers and candidates.</p>
        </div>

        <div className="zentra-header-actions">
          <div className="zentra-date-pill">
            <Icon name="question_answer" size={16} style={{ color: 'var(--zentra-text-muted)' }} />
            <span>Total Sessions: <strong>{totalInterviews}</strong></span>
          </div>
        </div>
      </div>

      {/* Toolbar Filter Card */}
      <div className="zentra-card" style={{ padding: '1rem 1.25rem', marginBottom: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: '240px', position: 'relative' }}>
          <input
            type="text"
            placeholder="Search candidate, interviewer, or type..."
            value={search}
            onChange={handleSearchChange}
            className="zentra-input"
            style={{ paddingLeft: '2.5rem' }}
          />
          <div style={{ position: 'absolute', left: '0.9rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--zentra-text-muted)', pointerEvents: 'none' }}>
            <Icon name="search" size={17} />
          </div>
        </div>

        <div style={{ minWidth: '160px' }}>
          <select
            value={status}
            onChange={handleStatusChange}
            className="zentra-select"
          >
            <option value="ALL">All Statuses</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
          </select>
        </div>

        <button
          onClick={fetchInterviews}
          className="zentra-btn zentra-btn-secondary"
          title="Reload interviews"
        >
          <Icon name="refresh" size={16} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Table Card */}
      <div className="zentra-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="zentra-table">
            <thead>
              <tr>
                <th style={{ width: '110px' }}>Session ID</th>
                <th>Candidate</th>
                <th>Interviewer</th>
                <th>Mode &amp; Level</th>
                <th>Status</th>
                <th>Score</th>
                <th>Started</th>
                <th style={{ textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} style={{ padding: '3.5rem', textAlign: 'center', color: 'var(--zentra-text-muted)' }}>
                    Loading interview sessions...
                  </td>
                </tr>
              ) : interviews.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: '3.5rem', textAlign: 'center', color: 'var(--zentra-text-muted)' }}>
                    No interviews match your filter criteria.
                  </td>
                </tr>
              ) : (
                interviews.map((item) => {
                  const isCompleted = item.status === 'completed'
                  const scoreVal = item.score ?? item.report?.overallScore
                  return (
                    <tr key={item.id}>
                      <td style={{ color: 'var(--zentra-text-muted)', fontSize: '0.775rem', fontFamily: 'monospace' }}>
                        {item.id.substring(0, 8)}...
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                          <div style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '50%',
                            background: 'var(--zentra-bg-muted)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 700,
                            fontSize: '0.8rem',
                            color: 'var(--zentra-text-primary)',
                            border: '1px solid var(--zentra-border)',
                          }}>
                            {item.candidate?.name?.[0] || 'C'}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, color: 'var(--zentra-text-primary)' }}>{item.candidate?.name || 'Unknown'}</div>
                            {item.candidate?.email && (
                              <div style={{ fontSize: '0.75rem', color: 'var(--zentra-text-muted)' }}>{item.candidate.email}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        <span style={{ fontSize: '0.85rem', color: 'var(--zentra-text-secondary)', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                          <Icon name="person" size={15} style={{ color: 'var(--zentra-text-muted)' }} />
                          {item.interviewer?.displayName || item.interviewer?.username || 'Unassigned'}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                          <span style={{ fontWeight: 500, color: 'var(--zentra-text-primary)', textTransform: 'capitalize' }}>
                            {item.interviewType}
                          </span>
                          <span style={{ fontSize: '0.725rem', color: 'var(--zentra-text-muted)', textTransform: 'capitalize' }}>
                            Level: {item.difficulty}
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className={`zentra-badge ${isCompleted ? 'success' : item.status === 'active' ? 'warning' : 'neutral'}`} style={{ textTransform: 'capitalize' }}>
                          {item.status}
                        </span>
                      </td>
                      <td>
                        {getScoreBadge(scoreVal)}
                      </td>
                      <td>
                        <span style={{ color: 'var(--zentra-text-muted)', fontSize: '0.8rem' }}>
                          {new Date(item.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <Link
                          href={`/report/${item.id}`}
                          className="zentra-btn zentra-btn-secondary"
                          style={{ padding: '0.35rem 0.85rem', fontSize: '0.775rem' }}
                        >
                          <Icon name="visibility" size={15} />
                          <span>Report</span>
                        </Link>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem', borderTop: '1px solid var(--zentra-border)' }}>
            <span style={{ fontSize: '0.825rem', color: 'var(--zentra-text-muted)' }}>
              Page {page} of {totalPages}
            </span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="zentra-btn zentra-btn-secondary"
                style={{ padding: '0.35rem 0.85rem', fontSize: '0.8rem' }}
              >
                Previous
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="zentra-btn zentra-btn-secondary"
                style={{ padding: '0.35rem 0.85rem', fontSize: '0.8rem' }}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
