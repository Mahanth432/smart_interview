'use client'

import React from 'react'
import Link from 'next/link'
import { useInterviewState } from '@/components/providers/InterviewStateProvider'
import { useTheme } from '@/components/providers/ThemeProvider'
import { useToast } from '@/components/providers/ToastProvider'
import Icon from '@/components/Icon'
import { type CanonicalDifficulty, normalizeDifficulty } from '@/lib/interview/difficulty'

interface SettingsClientProps {
  initialRole?: string
}

export const PREFS_STORAGE_KEY = 'smartinterview-prefs'

interface UserPreferences {
  defaultDifficulty: CanonicalDifficulty
  voiceRecordingDefault: boolean
  compactTranscriptPreview: boolean
}

const DEFAULT_PREFS: UserPreferences = {
  defaultDifficulty: 'medium',
  voiceRecordingDefault: false,
  compactTranscriptPreview: false,
}

function readStoredPrefs(): UserPreferences {
  if (typeof window === 'undefined') return DEFAULT_PREFS
  try {
    const raw = window.localStorage.getItem(PREFS_STORAGE_KEY)
    if (!raw) return DEFAULT_PREFS
    const parsed = JSON.parse(raw) as Partial<UserPreferences>
    return {
      defaultDifficulty: normalizeDifficulty(parsed.defaultDifficulty, 'medium'),
      voiceRecordingDefault: Boolean(parsed.voiceRecordingDefault),
      compactTranscriptPreview: Boolean(parsed.compactTranscriptPreview),
    }
  } catch {
    return DEFAULT_PREFS
  }
}

export function SettingsClient({ initialRole }: SettingsClientProps) {
  const { setState } = useInterviewState()
  const { isDark, toggleTheme } = useTheme()
  const { showToast } = useToast()

  const [prefs, setPrefs] = React.useState<UserPreferences>(DEFAULT_PREFS)
  const [hydrated, setHydrated] = React.useState(false)

  React.useEffect(() => {
    const loaded = readStoredPrefs()
    setPrefs(loaded)
    setHydrated(true)
  }, [])

  const persistPrefs = (next: UserPreferences, feedbackMessage?: string) => {
    setPrefs(next)
    setState((prev) => ({
      ...prev,
      difficulty: next.defaultDifficulty,
      isVoiceActive: next.voiceRecordingDefault,
    }))
    try {
      window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(next))
      if (feedbackMessage) showToast(feedbackMessage, 'success')
    } catch {
      showToast('Unable to write browser preferences to localStorage.', 'error')
    }
  }

  const handleSave = () => {
    persistPrefs(prefs, 'Preferences saved to your browser profile.')
  }

  const handleReset = () => {
    persistPrefs(DEFAULT_PREFS, 'Preferences reset to defaults.')
  }

  const isCandidate = initialRole === 'CANDIDATE'

  const toggleRow = (
    title: string,
    desc: string,
    checked: boolean,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void,
    iconName?: string
  ) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '1.25rem', borderBottom: '1px solid var(--color-border-subtle)', gap: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
        {iconName && (
          <div style={{ color: 'var(--color-text-muted)', marginTop: '2px' }}>
            <Icon name={iconName} size={18} />
          </div>
        )}
        <div>
          <div style={{ fontSize: '0.9rem', color: 'var(--color-text-primary)', fontWeight: 600, marginBottom: '0.2rem' }}>
            {title}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', lineHeight: 1.4, maxWidth: '420px' }}>
            {desc}
          </div>
        </div>
      </div>
      <label className="switch">
        <input type="checkbox" checked={checked} onChange={onChange} />
        <span className="slider round"></span>
      </label>
    </div>
  )

  const selectStyle: React.CSSProperties = {
    background: 'var(--color-bg-secondary)',
    color: 'var(--color-text-primary)',
    border: '1px solid var(--color-border-subtle)',
    borderRadius: '12px',
    padding: '0.65rem 1rem',
    fontSize: '0.875rem',
    width: '100%',
    marginTop: '0.5rem',
    outline: 'none',
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '1280px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.35rem' }}>
            <h1 className="zentra-page-title" style={{ margin: 0 }}>
              {isCandidate ? 'Preferences' : 'Workspace & AI Preferences'}
            </h1>
            <span className="zentra-badge zentra-badge-neutral">
              {isCandidate ? 'Candidate' : initialRole === 'ADMIN' ? 'Admin' : 'Interviewer'}
            </span>
          </div>
          <p className="zentra-page-subtitle" style={{ margin: 0 }}>
            {isCandidate
              ? 'Customize your appearance and display preferences.'
              : 'Configure workspace defaults for live interviews and display theme.'}
          </p>
        </div>
      </div>

      {isCandidate ? (
        <div style={{ maxWidth: '680px' }}>
          <div className="zentra-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: '1px solid var(--color-border-subtle)' }}>
              <Icon name="tune" size={20} style={{ color: '#6366f1' }} />
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                Display Preferences
              </h3>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {toggleRow(
                'Dark Mode Theme',
                isDark
                  ? 'Dark theme is active. Toggle to switch to light SaaS view.'
                  : 'Light theme is active. Toggle to switch to dark view.',
                isDark,
                () => toggleTheme(),
                'palette'
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="settings-two-col-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))', gap: '1.5rem' }}>
          {/* AI Configuration & Platform Governance */}
          <div className="zentra-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: '1px solid var(--color-border-subtle)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Icon name="psychology" size={20} style={{ color: '#6366f1' }} />
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                  AI Engine &amp; Interview Defaults
                </h3>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {initialRole === 'ADMIN' ? (
                <div style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-subtle)', borderRadius: '12px', padding: '1rem' }}>
                  <div style={{ fontSize: '0.9rem', color: 'var(--color-text-primary)', fontWeight: 600, marginBottom: '0.35rem' }}>
                    AI Provider, RAG Thresholds &amp; Failover
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                    API credentials, primary engine, RAG retrieval parameters, and automatic failover are controlled centrally in the Admin AI portal.
                  </div>
                  <div style={{ marginTop: '0.75rem' }}>
                    <Link
                      href="/admin/ai"
                      className="zentra-btn zentra-btn-primary"
                      style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}
                    >
                      <Icon name="smart_toy" size={16} />
                      <span>Manage AI Providers in Admin Portal</span>
                    </Link>
                  </div>
                </div>
              ) : (
                <div style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-subtle)', borderRadius: '12px', padding: '0.85rem 1rem' }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--color-text-primary)', fontWeight: 600, marginBottom: '0.2rem' }}>
                    Central AI &amp; RAG Policy
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                    Adaptive difficulty progression and RAG knowledge-base injection are governed by your organization&apos;s Admin AI configuration.
                  </div>
                </div>
              )}

              <div>
                <label htmlFor="default-difficulty-select" style={{ fontSize: '0.85rem', color: 'var(--color-text-primary)', fontWeight: 600 }}>
                  Default Starting Difficulty
                </label>
                <select
                  id="default-difficulty-select"
                  style={selectStyle}
                  value={prefs.defaultDifficulty}
                  disabled={!hydrated}
                  onChange={(e) =>
                    setPrefs((prev) => ({
                      ...prev,
                      defaultDifficulty: normalizeDifficulty(e.target.value, 'medium'),
                    }))
                  }
                >
                  <option value="easy">Easy (Foundational / Junior)</option>
                  <option value="medium">Medium (Core / Mid-Level)</option>
                  <option value="hard">Hard (System Design / Senior)</option>
                  <option value="expert">Expert (Staff / Principal)</option>
                </select>
                <p style={{ margin: '0.45rem 0 0 0', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                  Pre-selected automatically whenever you open a new live interview setup.
                </p>
              </div>
            </div>
          </div>

          {/* Workspace Preferences */}
          <div className="zentra-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: '1px solid var(--color-border-subtle)' }}>
                <Icon name="tune" size={20} style={{ color: '#10b981' }} />
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                  Display &amp; Audio Preferences
                </h3>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {toggleRow(
                  'Prefer Voice Input Highlight',
                  'Remember your preference to surface microphone transcription hints first during live interviews.',
                  prefs.voiceRecordingDefault,
                  (e) => setPrefs((prev) => ({ ...prev, voiceRecordingDefault: e.target.checked })),
                  'mic'
                )}

                {toggleRow(
                  'Compact Side History Panel',
                  'Keep previous Q&A summaries compact in the interview workspace sidebar.',
                  prefs.compactTranscriptPreview,
                  (e) => setPrefs((prev) => ({ ...prev, compactTranscriptPreview: e.target.checked })),
                  'view_sidebar'
                )}

                {toggleRow(
                  'Dark Mode Theme',
                  isDark
                    ? 'Dark theme is active. Toggle for light dashboard.'
                    : 'Light theme is active. Toggle for dark dashboard.',
                  isDark,
                  () => toggleTheme(),
                  'palette'
                )}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '2rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={handleSave}
                className="zentra-btn zentra-btn-primary"
                style={{ flex: 1 }}
              >
                Save Preferences
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="zentra-btn zentra-btn-secondary"
                style={{ flex: 1 }}
              >
                Reset Defaults
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
