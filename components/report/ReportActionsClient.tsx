'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import Icon from '@/components/Icon'
import { useToast } from '@/components/providers/ToastProvider'

interface ReportActionsClientProps {
  sessionId: string
  canEdit: boolean
  initialReport: {
    executiveSummary: string
    strengths: string[]
    weaknesses: string[]
    improvementPlan: string
    interviewerNotes: string | null
  } | null
}

export function ReportActionsClient({
  sessionId,
  canEdit,
  initialReport,
}: ReportActionsClientProps) {
  const router = useRouter()
  const { showToast } = useToast()

  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [executiveSummary, setExecutiveSummary] = useState(
    initialReport?.executiveSummary ?? ''
  )
  const [improvementPlan, setImprovementPlan] = useState(
    initialReport?.improvementPlan ?? ''
  )
  const [strengthsText, setStrengthsText] = useState(
    (initialReport?.strengths ?? []).join('\n')
  )
  const [weaknessesText, setWeaknessesText] = useState(
    (initialReport?.weaknesses ?? []).join('\n')
  )
  const [interviewerNotes, setInterviewerNotes] = useState(
    initialReport?.interviewerNotes ?? ''
  )

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!initialReport) return
    setSaving(true)
    try {
      const res = await fetch(`/api/interview/${encodeURIComponent(sessionId)}/report`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          executiveSummary,
          improvementPlan,
          strengths: strengthsText
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean),
          weaknesses: weaknessesText
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean),
          interviewerNotes,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(data.error || 'Failed to save report feedback', 'error')
      } else {
        showToast('Report feedback updated (original AI evaluation preserved)', 'success')
        setEditing(false)
        router.refresh()
      }
    } catch {
      showToast('Network error while saving feedback', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="no-print" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <a
          href={`/api/interview/${encodeURIComponent(sessionId)}/report/export?format=csv`}
          className="zentra-btn zentra-btn-secondary"
          style={{ textDecoration: 'none' }}
        >
          <Icon name="cloud_download" size={16} />
          <span>Export CSV</span>
        </a>
        <a
          href={`/api/interview/${encodeURIComponent(sessionId)}/report/export?format=json`}
          className="zentra-btn zentra-btn-secondary"
          style={{ textDecoration: 'none' }}
        >
          <Icon name="description" size={16} />
          <span>Export JSON</span>
        </a>
        <button
          type="button"
          onClick={() => window.print()}
          className="zentra-btn zentra-btn-secondary"
        >
          <Icon name="save" size={16} />
          <span>Print / PDF</span>
        </button>

        {canEdit && initialReport && (
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="zentra-btn zentra-btn-primary"
          >
            <Icon name="rate_review" size={16} />
            <span>{editing ? 'Cancel Editing' : 'Edit Feedback'}</span>
          </button>
        )}
      </div>

      {editing && initialReport && (
        <form
          onSubmit={handleSave}
          className="zentra-card"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
            borderColor: 'rgba(37, 99, 235, 0.35)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--zentra-text-primary)' }}>
              Edit Interviewer Feedback
            </h3>
            <span className="zentra-badge info">AI Original Preserved</span>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem', color: 'var(--zentra-text-secondary)' }}>
              Executive Summary
            </label>
            <textarea
              value={executiveSummary}
              onChange={(e) => setExecutiveSummary(e.target.value)}
              rows={3}
              required
              className="zentra-input"
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem', color: 'var(--zentra-text-secondary)' }}>
                Strengths (one per line)
              </label>
              <textarea
                value={strengthsText}
                onChange={(e) => setStrengthsText(e.target.value)}
                rows={4}
                className="zentra-input"
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem', color: 'var(--zentra-text-secondary)' }}>
                Weaknesses (one per line)
              </label>
              <textarea
                value={weaknessesText}
                onChange={(e) => setWeaknessesText(e.target.value)}
                rows={4}
                className="zentra-input"
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem', color: 'var(--zentra-text-secondary)' }}>
              Improvement Plan / Revision Recommendations
            </label>
            <textarea
              value={improvementPlan}
              onChange={(e) => setImprovementPlan(e.target.value)}
              rows={3}
              required
              className="zentra-input"
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem', color: 'var(--zentra-text-secondary)' }}>
              Interviewer Reviewer Notes
            </label>
            <textarea
              value={interviewerNotes}
              onChange={(e) => setInterviewerNotes(e.target.value)}
              rows={2}
              placeholder="Optional interviewer annotations or hiring bar notes..."
              className="zentra-input"
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="zentra-btn zentra-btn-secondary"
              disabled={saving}
            >
              Cancel
            </button>
            <button type="submit" className="zentra-btn zentra-btn-primary" disabled={saving}>
              <Icon name="save" size={16} />
              <span>{saving ? 'Saving...' : 'Save Edited Report'}</span>
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
