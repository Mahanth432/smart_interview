'use client'

import React, { useState, useMemo } from 'react'
import Link from 'next/link'
import Icon from '@/components/Icon'

export interface ReportItem {
  id: string
  startedAt: string
  endedAt: string | null
  interviewType: string
  difficulty: string
  status: string
  score: number | null
  candidate: {
    id: string
    name: string
    email: string | null
  }
  interviewer: {
    id: number
    username: string
    email: string | null
  } | null
  report: {
    id: string
    overallScore: number
    executiveSummary: string
    strengths: string[]
    weaknesses: string[]
    createdAt: string
  } | null
  questionCount: number
}

interface ReportsListClientProps {
  reports: ReportItem[]
  role?: string
}

export function ReportsListClient({ reports, role }: ReportsListClientProps) {
  const [search, setSearch] = useState('')
  const [scoreFilter, setScoreFilter] = useState<'ALL' | 'HIGH' | 'MEDIUM' | 'LOW'>('ALL')
  const [sortBy, setSortBy] = useState<'DATE_DESC' | 'DATE_ASC' | 'SCORE_DESC' | 'SCORE_ASC'>('DATE_DESC')

  const isCandidate = role === 'CANDIDATE'

  const filteredReports = useMemo(() => {
    return reports.filter((item) => {
      const q = search.toLowerCase().trim()
      const matchesSearch =
        !q ||
        item.candidate.name.toLowerCase().includes(q) ||
        (item.candidate.email && item.candidate.email.toLowerCase().includes(q)) ||
        item.interviewType.toLowerCase().includes(q) ||
        (item.interviewer && item.interviewer.username.toLowerCase().includes(q)) ||
        (item.report && item.report.executiveSummary.toLowerCase().includes(q))

      if (!matchesSearch) return false

      const effectiveScore = item.score !== null ? item.score : item.report?.overallScore ?? null

      if (scoreFilter === 'HIGH') {
        return effectiveScore !== null && effectiveScore >= 75
      }
      if (scoreFilter === 'MEDIUM') {
        return effectiveScore !== null && effectiveScore >= 50 && effectiveScore < 75
      }
      if (scoreFilter === 'LOW') {
        return effectiveScore !== null && effectiveScore < 50
      }

      return true
    }).sort((a, b) => {
      if (sortBy === 'DATE_DESC') {
        return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
      }
      if (sortBy === 'DATE_ASC') {
        return new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
      }
      const scoreA = a.score !== null ? a.score : a.report?.overallScore ?? -1
      const scoreB = b.score !== null ? b.score : b.report?.overallScore ?? -1
      if (sortBy === 'SCORE_DESC') {
        return scoreB - scoreA
      }
      if (sortBy === 'SCORE_ASC') {
        return scoreA - scoreB
      }
      return 0
    })
  }, [reports, search, scoreFilter, sortBy])

  const getScoreBadgeClass = (score: number | null) => {
    if (score === null) return 'zentra-badge-neutral'
    if (score >= 75) return 'zentra-badge-success'
    if (score >= 50) return 'zentra-badge-warning'
    return 'zentra-badge-error'
  }

  const getDifficultyBadgeClass = (diff: string) => {
    switch (diff.toLowerCase()) {
      case 'easy':
        return 'zentra-badge-success'
      case 'medium':
      case 'intermediate':
        return 'zentra-badge-info'
      case 'hard':
        return 'zentra-badge-warning'
      default:
        return 'zentra-badge-neutral'
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Search & Filters Bar */}
      <div
        className="zentra-card"
        style={{
          padding: '1rem 1.25rem',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '1rem',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        {/* Search Input */}
        <div style={{ position: 'relative', flex: 1, minWidth: '260px' }}>
          <input
            type="text"
            className="zentra-input"
            style={{ width: '100%', paddingLeft: '2.5rem' }}
            placeholder={isCandidate ? 'Search by track or keywords...' : 'Search by candidate, email, track, or keywords...'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <span
            style={{
              position: 'absolute',
              left: '0.85rem',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--zentra-text-muted)',
              pointerEvents: 'none',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <Icon name="search" size={17} />
          </span>
          {search && (
            <button
              onClick={() => setSearch('')}
              style={{
                position: 'absolute',
                right: '0.85rem',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'transparent',
                border: 'none',
                color: 'var(--zentra-text-muted)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
              aria-label="Clear search"
            >
              <Icon name="close" size={16} />
            </button>
          )}
        </div>

        {/* Filters Group */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          {/* Score Filter Pills */}
          <div style={{ display: 'inline-flex', background: 'var(--zentra-bg-muted)', padding: '3px', borderRadius: '9999px', border: '1px solid var(--zentra-border)' }}>
            {(
              [
                { label: 'All Scores', value: 'ALL' },
                { label: '≥ 75%', value: 'HIGH' },
                { label: '50 - 74%', value: 'MEDIUM' },
                { label: '< 50%', value: 'LOW' },
              ] as const
            ).map((f) => {
              const active = scoreFilter === f.value
              return (
                <button
                  key={f.value}
                  onClick={() => setScoreFilter(f.value)}
                  style={{
                    border: 'none',
                    background: active ? 'var(--zentra-pill-active-bg)' : 'transparent',
                    color: active ? 'var(--zentra-pill-active-text)' : 'var(--zentra-pill-inactive-text)',
                    padding: '0.35rem 0.75rem',
                    borderRadius: '9999px',
                    fontSize: '0.78rem',
                    fontWeight: active ? 600 : 500,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {f.label}
                </button>
              )
            })}
          </div>

          {/* Sort Selector */}
          <select
            className="zentra-input"
            style={{ padding: '0.45rem 0.85rem', fontSize: '0.82rem', width: 'auto', minWidth: '150px' }}
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          >
            <option value="DATE_DESC">Newest First</option>
            <option value="DATE_ASC">Oldest First</option>
            <option value="SCORE_DESC">Highest Score</option>
            <option value="SCORE_ASC">Lowest Score</option>
          </select>
        </div>
      </div>

      {/* Reports Table / Card Container */}
      {filteredReports.length === 0 ? (
        <div className="zentra-card" style={{ padding: '3.5rem 2rem', textAlign: 'center' }}>
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '50%',
              background: 'var(--zentra-bg-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1rem auto',
              color: 'var(--zentra-text-muted)',
            }}
          >
            <Icon name="search_off" size={26} />
          </div>
          <h3 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--zentra-text-primary)', margin: '0 0 0.35rem 0' }}>
            No Matching Reports Found
          </h3>
          <p style={{ color: 'var(--zentra-text-muted)', fontSize: '0.875rem', margin: '0 0 1rem 0' }}>
            {search ? `No evaluation reports matched query "${search}". Try adjusting your filters.` : 'No reports match the selected criteria.'}
          </p>
          {(search || scoreFilter !== 'ALL') && (
            <button
              onClick={() => {
                setSearch('')
                setScoreFilter('ALL')
              }}
              className="zentra-btn zentra-btn-secondary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem' }}
            >
              <Icon name="refresh" size={15} />
              Reset Filters
            </button>
          )}
        </div>
      ) : (
        <div className="zentra-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ background: 'var(--zentra-bg-subtle)', borderBottom: '1px solid var(--zentra-border)', color: 'var(--zentra-text-muted)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <th style={{ padding: '0.9rem 1.25rem' }}>Candidate</th>
                  <th style={{ padding: '0.9rem 1rem' }}>Interview Track</th>
                  {!isCandidate && <th style={{ padding: '0.9rem 1rem' }}>Evaluator</th>}
                  <th style={{ padding: '0.9rem 1rem' }}>Conducted</th>
                  <th style={{ padding: '0.9rem 1rem' }}>Score</th>
                  <th style={{ padding: '0.9rem 1.25rem', textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredReports.map((item, idx) => {
                  const effectiveScore = item.score !== null ? item.score : item.report?.overallScore ?? null
                  const displayScore = effectiveScore !== null ? `${Math.round(effectiveScore * 10) / 10}%` : 'N/A'
                  const formattedDate = new Date(item.startedAt).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })
                  const formattedTime = new Date(item.startedAt).toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })

                  return (
                    <tr
                      key={item.id}
                      style={{
                        borderBottom: idx === filteredReports.length - 1 ? 'none' : '1px solid var(--zentra-border-subtle)',
                        transition: 'background 0.15s ease',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--zentra-bg-subtle)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      {/* Candidate Column */}
                      <td style={{ padding: '1rem 1.25rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <div
                            style={{
                              width: '36px',
                              height: '36px',
                              borderRadius: '10px',
                              background: 'linear-gradient(135deg, rgba(37,99,235,0.1) 0%, rgba(99,102,241,0.15) 100%)',
                              border: '1px solid rgba(99,102,241,0.2)',
                              color: 'var(--zentra-accent-blue)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontWeight: 700,
                              fontSize: '0.9rem',
                            }}
                          >
                            {item.candidate.name ? item.candidate.name.charAt(0).toUpperCase() : 'C'}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, color: 'var(--zentra-text-primary)' }}>
                              {item.candidate.name}
                            </div>
                            {item.candidate.email && (
                              <div style={{ fontSize: '0.75rem', color: 'var(--zentra-text-muted)' }}>
                                {item.candidate.email}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Track Column */}
                      <td style={{ padding: '1rem 1rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 500, color: 'var(--zentra-text-primary)' }}>
                            {item.interviewType}
                          </span>
                          <span className={`zentra-badge ${getDifficultyBadgeClass(item.difficulty)}`} style={{ fontSize: '0.7rem' }}>
                            {item.difficulty}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--zentra-text-muted)', marginTop: '2px' }}>
                          {item.questionCount} questions evaluated
                        </div>
                      </td>

                      {/* Evaluator Column */}
                      {!isCandidate && (
                        <td style={{ padding: '1rem 1rem' }}>
                          <div style={{ fontWeight: 500, color: 'var(--zentra-text-secondary)' }}>
                            {item.interviewer?.username || 'System Lead'}
                          </div>
                          <span style={{ fontSize: '0.725rem', color: 'var(--zentra-text-muted)' }}>Interviewer</span>
                        </td>
                      )}

                      {/* Date Column */}
                      <td style={{ padding: '1rem 1rem' }}>
                        <div style={{ color: 'var(--zentra-text-primary)', fontWeight: 500 }}>
                          {formattedDate}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--zentra-text-muted)' }}>
                          {formattedTime}
                        </div>
                      </td>

                      {/* Score Column */}
                      <td style={{ padding: '1rem 1rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                          <span className={`zentra-badge ${getScoreBadgeClass(effectiveScore)}`} style={{ fontSize: '0.8rem', fontWeight: 700 }}>
                            {displayScore}
                          </span>
                        </div>
                        {effectiveScore !== null && (
                          <div
                            style={{
                              width: '80px',
                              height: '4px',
                              background: 'var(--zentra-bg-muted)',
                              borderRadius: '9999px',
                              overflow: 'hidden',
                              marginTop: '5px',
                            }}
                          >
                            <div
                              style={{
                                width: `${Math.min(100, Math.max(0, effectiveScore))}%`,
                                height: '100%',
                                background: effectiveScore >= 75 ? '#10b981' : effectiveScore >= 50 ? '#f59e0b' : '#ef4444',
                              }}
                            />
                          </div>
                        )}
                      </td>

                      {/* Action Column */}
                      <td style={{ padding: '1rem 1.25rem', textAlign: 'right' }}>
                        <Link
                          href={`/report/${item.id}`}
                          prefetch={true}
                          className="zentra-btn zentra-btn-secondary"
                          style={{
                            padding: '0.4rem 0.9rem',
                            fontSize: '0.78rem',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.4rem',
                            textDecoration: 'none',
                          }}
                        >
                          <span>View Report</span>
                          <Icon name="arrow_forward" size={14} />
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Table Footer Summary */}
          <div
            style={{
              padding: '0.85rem 1.25rem',
              background: 'var(--zentra-bg-subtle)',
              borderTop: '1px solid var(--zentra-border-subtle)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '0.78rem',
              color: 'var(--zentra-text-muted)',
            }}
          >
            <span>
              Showing <strong>{filteredReports.length}</strong> of <strong>{reports.length}</strong> evaluation reports
            </span>
            <span>Click any report to view comprehensive feedback &amp; scoring</span>
          </div>
        </div>
      )}
    </div>
  )
}
