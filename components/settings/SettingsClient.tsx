'use client'

import React from 'react'
import Link from 'next/link'
import { useInterviewState } from '@/components/providers/InterviewStateProvider'
import { useTheme } from '@/components/providers/ThemeProvider'
import Icon from '@/components/Icon'

interface SettingsClientProps {
  initialRole?: string
}

export function SettingsClient({ initialRole }: SettingsClientProps) {
  const { state, setState } = useInterviewState()
  const { isDark, toggleTheme } = useTheme()
  const [saveStatus, setSaveStatus] = React.useState('')

  const handleSave = () => {
    setSaveStatus('✓ Preferences saved')
    setTimeout(() => setSaveStatus(''), 3000)
  }

  const isCandidate = initialRole === 'CANDIDATE'

  const toggleRow = (
    title: string,
    desc: string,
    checked: boolean,
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void,
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
        <input type="checkbox" checked={checked} onChange={onChange ?? (() => {})} />
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
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.35rem' }}>
            <h1 className="zentra-page-title" style={{ margin: 0 }}>
              {isCandidate ? 'Preferences' : 'System & LLM Settings'}
            </h1>
            <span className="zentra-badge zentra-badge-neutral">
              {isCandidate ? 'Candidate' : 'Interviewer'}
            </span>
          </div>
          <p className="zentra-page-subtitle" style={{ margin: 0 }}>
            {isCandidate
              ? 'Customize your appearance and display preferences.'
              : 'Configure AI engine providers, adaptive difficulty thresholds, and audio pipeline settings.'}
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '1.5rem' }}>
          {/* AI Configuration */}
          <div className="zentra-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: '1px solid var(--color-border-subtle)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Icon name="psychology" size={20} style={{ color: '#6366f1' }} />
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                  AI Engine &amp; Hyperparameters
                </h3>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {initialRole === 'ADMIN' ? (
                <div style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-subtle)', borderRadius: '12px', padding: '1rem' }}>
                  <div style={{ fontSize: '0.9rem', color: 'var(--color-text-primary)', fontWeight: 600, marginBottom: '0.35rem' }}>
                    AI Provider &amp; Automatic Failover
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                    Centrally managed: API credentials, primary engine, and dual automatic fallback topologies are controlled exclusively in the Admin AI portal.
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
                  <div style={{ fontSize: '0.85rem', color: 'var(--color-text-primary)', fontWeight: 600, marginBottom: '0.2rem' }}>AI Provider</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                    AI provider configuration is managed centrally by your system administrator.
                  </div>
                </div>
              )}

              <div>
                <label style={{ fontSize: '0.85rem', color: 'var(--color-text-primary)', fontWeight: 600 }}>
                  Default Interview Difficulty
                </label>
                <select
                  style={selectStyle}
                  value={state.difficulty}
                  onChange={(e) => setState({ ...state, difficulty: e.target.value })}
                >
                  <option value="beginner">Beginner (Junior Roles)</option>
                  <option value="intermediate">Intermediate (Mid-Level Roles)</option>
                  <option value="advanced">Advanced (Senior / Staff Architect)</option>
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginTop: '0.5rem' }}>
                {toggleRow(
                  'Dynamic Adaptive Difficulty',
                  'Automatically increases question depth as candidate demonstrates high scores.',
                  true,
                  undefined,
                  'auto_awesome'
                )}
                {toggleRow(
                  'RAG Vector Context Injection',
                  'Retrieve semantic passages from uploaded knowledge base documents to ground questions.',
                  true,
                  undefined,
                  'memory'
                )}
              </div>
            </div>
          </div>

          {/* Audio & Display Preferences */}
          <div className="zentra-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: '1px solid var(--color-border-subtle)' }}>
                <Icon name="tune" size={20} style={{ color: '#10b981' }} />
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                  Preferences &amp; Feedback
                </h3>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {toggleRow(
                  'Voice Recording (Whisper)',
                  'Enable microphone speech-to-text recording during interview sessions.',
                  state.isVoiceActive,
                  (e) => setState({ ...state, isVoiceActive: e.target.checked }),
                  'mic'
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

                {toggleRow(
                  'Email Summary Notifications',
                  'Forward finalized candidate evaluation reports directly to interviewer inbox.',
                  false,
                  undefined,
                  'mail'
                )}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '2rem', flexWrap: 'wrap' }}>
              {saveStatus && (
                <div style={{ width: '100%', color: '#10b981', fontSize: '0.85rem', fontWeight: 600 }}>
                  {saveStatus}
                </div>
              )}
              <button
                onClick={handleSave}
                className="zentra-btn zentra-btn-primary"
                style={{ flex: 1 }}
              >
                Save Configurations
              </button>
              <button
                onClick={() => setState({ ...state, difficulty: 'intermediate' })}
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
