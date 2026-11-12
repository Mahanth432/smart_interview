'use client'

import React, { useState } from 'react'
import Icon from '@/components/Icon'
import { useToast } from '@/components/providers/ToastProvider'

interface CandidateCompareOption {
  id: string
  name: string
  email: string | null
}

interface ComparisonRow {
  candidateId: string
  name: string
  email: string | null
  sessionCount: number
  completedCount: number
  averageScore: number | null
  bestScore: number | null
  answeringStyle: string
  technicalStrengths: string[]
  recurringWeaknesses: Array<{ conceptName: string; masteryScore: number; weaknessCount: number }>
  topicAverages: Record<string, number>
}

export function CandidateCompareClient({ candidates }: { candidates: CandidateCompareOption[] }) {
  const { showToast } = useToast()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [comparison, setComparison] = useState<ComparisonRow[] | null>(null)

  if (candidates.length < 2) return null

  const toggleId = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length >= 6
          ? prev
          : [...prev, id]
    )
  }

  const runCompare = async () => {
    if (selectedIds.length < 2) {
      showToast('Select at least 2 candidates to compare.', 'error')
      return
    }
    setLoading(true)
    try {
      const res = await fetch(
        `/api/interviewer/compare?candidateIds=${encodeURIComponent(selectedIds.join(','))}`
      )
      const data = await res.json()
      if (!res.ok) {
        showToast(data.error || 'Comparison failed', 'error')
      } else {
        setComparison(data.comparison || [])
      }
    } catch {
      showToast('Failed to compare candidates', 'error')
    } finally {
      setLoading(false)
    }
  }

  const allTopics = comparison
    ? Array.from(new Set(comparison.flatMap((c) => Object.keys(c.topicAverages))))
    : []

  return (
    <div className="zentra-card" style={{ marginBottom: '1.5rem' }}>
      <div className="zentra-card-header" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h3 className="zentra-card-title">Side-by-Side Candidate Comparison</h3>
          <span style={{ fontSize: '0.8rem', color: 'var(--zentra-text-muted)' }}>
            Select 2–6 authorized candidates to compare scores, answering styles, and recurring gaps
          </span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {comparison && (
            <button
              type="button"
              onClick={() => setComparison(null)}
              className="zentra-btn zentra-btn-secondary"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={runCompare}
            disabled={loading || selectedIds.length < 2}
            className="zentra-btn zentra-btn-primary"
          >
            <Icon name="analytics" size={16} />
            <span>{loading ? 'Comparing...' : `Compare (${selectedIds.length})`}</span>
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: comparison ? '1.25rem' : 0 }}>
        {candidates.map((c) => {
          const checked = selectedIds.includes(c.id)
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => toggleId(c.id)}
              style={{
                padding: '0.35rem 0.85rem',
                borderRadius: '9999px',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer',
                border: `1px solid ${checked ? '#2563eb' : 'var(--zentra-border)'}`,
                background: checked ? 'rgba(37, 99, 235, 0.12)' : 'var(--zentra-bg-muted)',
                color: checked ? '#2563eb' : 'var(--zentra-text-secondary)',
              }}
            >
              {checked ? '✓ ' : ''}
              {c.name}
            </button>
          )
        })}
      </div>

      {comparison && comparison.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="zentra-table" style={{ width: '100%', fontSize: '0.84rem' }}>
            <thead>
              <tr>
                <th>Metric</th>
                {comparison.map((row) => (
                  <th key={row.candidateId}>{row.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ fontWeight: 600 }}>Average Score</td>
                {comparison.map((row) => (
                  <td key={row.candidateId}>
                    <strong>{row.averageScore !== null ? `${row.averageScore}%` : '—'}</strong>
                  </td>
                ))}
              </tr>
              <tr>
                <td style={{ fontWeight: 600 }}>Best Score</td>
                {comparison.map((row) => (
                  <td key={row.candidateId}>{row.bestScore !== null ? `${row.bestScore}%` : '—'}</td>
                ))}
              </tr>
              <tr>
                <td style={{ fontWeight: 600 }}>Completed / Total</td>
                {comparison.map((row) => (
                  <td key={row.candidateId}>
                    {row.completedCount} / {row.sessionCount}
                  </td>
                ))}
              </tr>
              <tr>
                <td style={{ fontWeight: 600 }}>Answering Style</td>
                {comparison.map((row) => (
                  <td key={row.candidateId}>{row.answeringStyle}</td>
                ))}
              </tr>
              <tr>
                <td style={{ fontWeight: 600 }}>Recurring Weaknesses</td>
                {comparison.map((row) => (
                  <td key={row.candidateId}>
                    {row.recurringWeaknesses.length > 0
                      ? row.recurringWeaknesses
                          .slice(0, 3)
                          .map((w) => `${w.conceptName} (${Math.round(w.masteryScore)}%)`)
                          .join(', ')
                      : 'None recorded'}
                  </td>
                ))}
              </tr>
              {allTopics.map((topic) => (
                <tr key={topic}>
                  <td style={{ fontWeight: 600 }}>Topic: {topic}</td>
                  {comparison.map((row) => (
                    <td key={row.candidateId}>
                      {typeof row.topicAverages[topic] === 'number' ? `${row.topicAverages[topic]}%` : '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
