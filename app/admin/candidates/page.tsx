'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Icon from '@/components/Icon'

interface CandidateItem {
  id: string
  name: string
  email: string | null
  createdAt: string
  _count: {
    sessions: number
  }
  sessions: Array<{
    id: string
    startedAt: string
    endedAt: string | null
    status: string
    interviewType: string
    score: number | null
    report: {
      overallScore: number
    } | null
  }>
}

export default function AdminCandidatesPage() {
  const [candidates, setCandidates] = useState<CandidateItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalCandidates, setTotalCandidates] = useState(0)

  const fetchCandidates = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      params.set('page', page.toString())
      params.set('limit', '15')

      const res = await fetch(`/api/admin/candidates?${params.toString()}`)
      if (res.ok) {
        const data = await res.json()
        setCandidates(data.candidates || [])
        setTotalPages(data.totalPages || 1)
        setTotalCandidates(data.total || 0)
      }
    } catch (err) {
      console.error('Failed to load candidates:', err)
    } finally {
      setLoading(false)
    }
  }, [search, page])

  useEffect(() => {
    fetchCandidates()
  }, [fetchCandidates])

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value)
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
            <h1 className="zentra-page-title">Candidates</h1>
            <span className="zentra-link-bubble" title="Candidate Profiles">
              <Icon name="link" size={16} />
            </span>
          </div>
          <p className="zentra-page-subtitle">Candidate profiles, cumulative evaluations, and historic session scores.</p>
        </div>

        <div className="zentra-header-actions">
          <div className="zentra-date-pill">
            <Icon name="person_search" size={16} style={{ color: 'var(--zentra-text-muted)' }} />
            <span>Total Candidates: <strong>{totalCandidates}</strong></span>
          </div>
        </div>
      </div>

      {/* Toolbar Filter Card */}
      <div className="zentra-card" style={{ padding: '1rem 1.25rem', marginBottom: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: '240px', position: 'relative' }}>
          <input
            type="text"
            placeholder="Search candidate name or email..."
            value={search}
            onChange={handleSearchChange}
            className="zentra-input"
            style={{ paddingLeft: '2.5rem' }}
          />
          <div style={{ position: 'absolute', left: '0.9rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--zentra-text-muted)', pointerEvents: 'none' }}>
            <Icon name="search" size={17} />
          </div>
        </div>

        <button
          onClick={fetchCandidates}
          className="zentra-btn zentra-btn-secondary"
          title="Reload candidates"
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
                <th>Candidate</th>
                <th>Email</th>
                <th>Total Interviews</th>
                <th>Latest Interview</th>
                <th>Latest Score</th>
                <th>Registered Date</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ padding: '3.5rem', textAlign: 'center', color: 'var(--zentra-text-muted)' }}>
                    Loading candidate directory...
                  </td>
                </tr>
              ) : candidates.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '3.5rem', textAlign: 'center', color: 'var(--zentra-text-muted)' }}>
                    No candidates match your search query.
                  </td>
                </tr>
              ) : (
                candidates.map((cand) => {
                  const latestSession = cand.sessions && cand.sessions.length > 0 ? cand.sessions[0] : null
                  const latestScore = latestSession ? (latestSession.score ?? latestSession.report?.overallScore) : null

                  return (
                    <tr key={cand.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <div style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: '50%',
                            background: 'linear-gradient(135deg, #10b981, #059669)',
                            color: '#ffffff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 700,
                            fontSize: '0.85rem',
                          }}>
                            {cand.name ? cand.name.charAt(0).toUpperCase() : 'C'}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, color: 'var(--zentra-text-primary)' }}>{cand.name}</div>
                            <div style={{ fontSize: '0.725rem', color: 'var(--zentra-text-muted)', fontFamily: 'monospace' }}>
                              ID: {cand.id.substring(0, 8)}...
                            </div>
                          </div>
                        </div>
                      </td>
                      <td style={{ color: 'var(--zentra-text-secondary)', fontSize: '0.85rem' }}>
                        {cand.email || <span style={{ color: 'var(--zentra-text-muted)', fontStyle: 'italic' }}>None</span>}
                      </td>
                      <td>
                        <span className="zentra-pill-tag">
                          {cand._count.sessions} session{cand._count.sessions !== 1 ? 's' : ''}
                        </span>
                      </td>
                      <td>
                        {latestSession ? (
                          <div>
                            <span style={{ fontWeight: 500, color: 'var(--zentra-text-primary)', textTransform: 'capitalize' }}>
                              {latestSession.interviewType}
                            </span>
                            <div style={{ fontSize: '0.75rem', color: 'var(--zentra-text-muted)' }}>
                              {new Date(latestSession.startedAt).toLocaleDateString()}
                            </div>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--zentra-text-muted)', fontStyle: 'italic', fontSize: '0.8rem' }}>None yet</span>
                        )}
                      </td>
                      <td>
                        {getScoreBadge(latestScore)}
                      </td>
                      <td style={{ color: 'var(--zentra-text-muted)', fontSize: '0.825rem' }}>
                        {new Date(cand.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
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
