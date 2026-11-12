'use client'

import React, { useEffect, useState, useCallback } from 'react'
import Icon from '@/components/Icon'

type SystemInfo = {
  nodeVersion: string
  platform: string
  env: string
  geminiConfigured: boolean
  groqConfigured: boolean
  databaseConfigured: boolean
}

const defaultSettings: Record<string, string> = {
  'app.name': 'SmartInterview',
  'interview.default_difficulty': 'medium',
  'interview.default_type': 'technical',
  'rag.enabled': 'true',
  'rag.top_k': '5',
  'rag.chunk_size': '1200',
  'rag.chunk_overlap': '200',
  'rag.min_similarity': '0.25',
  'auth.session_timeout_hours': '24',
  'llm.default_provider': 'gemini',
}

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>(defaultSettings)
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle')

  const fetchSettings = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/settings', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setSettings({ ...defaultSettings, ...data.settings })
        setSystemInfo(data.systemInfo)
      }
    } catch (err) {
      console.error('Failed to load settings:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchSettings() }, [fetchSettings])

  const handleSave = async () => {
    setSaving(true)
    setSaveStatus('idle')
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ settings }),
      })
      if (res.ok) {
        setSaveStatus('success')
        setTimeout(() => setSaveStatus('idle'), 3000)
      } else {
        setSaveStatus('error')
      }
    } catch {
      setSaveStatus('error')
    } finally {
      setSaving(false)
    }
  }

  const set = (key: string, value: string) => {
    setSettings(prev => ({ ...prev, [key]: value }))
  }

  const sectionHeader = (icon: string, title: string, subtitle: string) => (
    <div style={{ marginBottom: '1.25rem', paddingBottom: '0.85rem', borderBottom: '1px solid var(--zentra-border-subtle)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
        <Icon name={icon} size={20} style={{ color: '#2563eb' }} />
        <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, color: 'var(--zentra-text-primary)' }}>{title}</h2>
      </div>
      <p style={{ fontSize: '0.825rem', color: 'var(--zentra-text-muted)', margin: '0.25rem 0 0 0' }}>{subtitle}</p>
    </div>
  )

  const settingRow = (label: string, desc: string, children: React.ReactNode) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 0', borderBottom: '1px solid var(--zentra-border-subtle)', gap: '1.5rem', flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: '220px' }}>
        <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--zentra-text-primary)' }}>{label}</div>
        <div style={{ fontSize: '0.8rem', color: 'var(--zentra-text-muted)', marginTop: '0.2rem' }}>{desc}</div>
      </div>
      <div>{children}</div>
    </div>
  )

  if (loading) {
    return (
      <div className="zentra-page-container">
        <div className="zentra-card" style={{ padding: '4rem', textAlign: 'center', color: 'var(--zentra-text-muted)' }}>
          <Icon name="settings" size={32} style={{ marginBottom: '0.75rem', color: '#2563eb' }} />
          <div>Loading platform configuration...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="zentra-page-container" style={{ maxWidth: '1000px' }}>
      {/* Header */}
      <div className="zentra-page-header">
        <div>
          <div className="zentra-title-row">
            <h1 className="zentra-page-title">Admin Settings</h1>
            <span className="zentra-link-bubble" title="System Configuration">
              <Icon name="link" size={16} />
            </span>
          </div>
          <p className="zentra-page-subtitle">Global parameters, session security, RAG hyperparameters, and diagnostic health.</p>
        </div>

        <div className="zentra-header-actions">
          {saveStatus === 'success' && <span className="zentra-badge success">✓ Saved</span>}
          {saveStatus === 'error' && <span className="zentra-badge danger">✗ Save error</span>}
          <button
            onClick={handleSave}
            disabled={saving}
            className="zentra-btn zentra-btn-primary"
          >
            <Icon name="save" size={16} />
            <span>{saving ? 'Saving...' : 'Save Settings'}</span>
          </button>
        </div>
      </div>

      {/* Section 1: Application Settings */}
      <div className="zentra-card" style={{ marginBottom: '1.5rem' }}>
        {sectionHeader('tune', 'General Platform Settings', 'Branding and application identity')}
        {settingRow('Platform Name', 'Application name presented in emails and page titles', (
          <input
            type="text"
            value={settings['app.name'] || 'SmartInterview'}
            onChange={e => set('app.name', e.target.value)}
            className="zentra-input"
            style={{ width: '220px' }}
          />
        ))}
      </div>

      {/* Section 2: Security & Session */}
      <div className="zentra-card" style={{ marginBottom: '1.5rem' }}>
        {sectionHeader('security', 'Session & Authentication Security', 'Session timeouts and credential policies')}
        {settingRow('Session Timeout (Hours)', 'Duration an authenticated session remains active before token rotation', (
          <input
            type="number"
            min={1}
            max={168}
            value={settings['auth.session_timeout_hours'] || '24'}
            onChange={e => set('auth.session_timeout_hours', e.target.value)}
            className="zentra-input"
            style={{ width: '100px', textAlign: 'right' }}
          />
        ))}
        {settingRow('Session Encryption Secret', 'Protected server-side variable SESSION_SECRET', (
          <span style={{ fontSize: '0.85rem', color: 'var(--zentra-text-muted)', fontFamily: 'monospace' }}>••••••••••••••••</span>
        ))}
      </div>

      {/* Section 3: Interview Defaults */}
      <div className="zentra-card" style={{ marginBottom: '1.5rem' }}>
        {sectionHeader('assignment', 'Interview Defaults', 'Base difficulty and mode presets for live sessions')}
        {settingRow('Default Difficulty', 'Default tier pre-selected in new interviewer workspaces', (
          <select
            value={settings['interview.default_difficulty']}
            onChange={e => set('interview.default_difficulty', e.target.value)}
            className="zentra-select"
            style={{ width: '180px' }}
          >
            <option value="beginner">Beginner</option>
            <option value="medium">Medium</option>
            <option value="advanced">Advanced</option>
          </select>
        ))}
        {settingRow('Default Interview Type', 'Pre-selected assessment mode', (
          <select
            value={settings['interview.default_type']}
            onChange={e => set('interview.default_type', e.target.value)}
            className="zentra-select"
            style={{ width: '180px' }}
          >
            <option value="technical">Technical</option>
            <option value="behavioral">Behavioral</option>
            <option value="mixed">Mixed</option>
          </select>
        ))}
      </div>

      {/* Section 4: RAG Hyperparameters */}
      <div className="zentra-card" style={{ marginBottom: '1.5rem' }}>
        {sectionHeader('memory', 'RAG & Vector Retrieval Hyperparameters', 'Fine-tune document chunking and pgvector search')}
        {settingRow('RAG Engine State', 'Enable or suspend vector semantic retrieval globally', (
          <select
            value={settings['rag.enabled']}
            onChange={e => set('rag.enabled', e.target.value)}
            className="zentra-select"
            style={{ width: '180px' }}
          >
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </select>
        ))}
        {settingRow('Top-K Nearest Chunks', 'Number of relevant chunks passed to LLM context (1-20)', (
          <input
            type="number"
            min={1}
            max={20}
            value={settings['rag.top_k'] || '5'}
            onChange={e => set('rag.top_k', e.target.value)}
            className="zentra-input"
            style={{ width: '100px', textAlign: 'right' }}
          />
        ))}
        {settingRow('Chunk Size (Characters)', 'Document text segment target token length', (
          <input
            type="number"
            min={200}
            max={4000}
            step={100}
            value={settings['rag.chunk_size'] || '1200'}
            onChange={e => set('rag.chunk_size', e.target.value)}
            className="zentra-input"
            style={{ width: '100px', textAlign: 'right' }}
          />
        ))}
        {settingRow('Chunk Overlap (Characters)', 'Contextual overlap margin between contiguous chunks', (
          <input
            type="number"
            min={0}
            max={800}
            step={50}
            value={settings['rag.chunk_overlap'] || '200'}
            onChange={e => set('rag.chunk_overlap', e.target.value)}
            className="zentra-input"
            style={{ width: '100px', textAlign: 'right' }}
          />
        ))}
        {settingRow('Minimum Cosine Similarity', 'Minimum semantic similarity threshold (0.00-0.95)', (
          <input
            type="number"
            min={0}
            max={0.95}
            step={0.05}
            value={settings['rag.min_similarity'] || '0.25'}
            onChange={e => set('rag.min_similarity', e.target.value)}
            className="zentra-input"
            style={{ width: '100px', textAlign: 'right' }}
          />
        ))}
      </div>

      {/* Section 5: LLM Defaults */}
      <div className="zentra-card" style={{ marginBottom: '1.5rem' }}>
        {sectionHeader('smart_toy', 'AI Provider & LLM Engine', 'Core primary model provider and automatic failover')}
        {settingRow('Primary Engine', 'Primary language model provider (auto-fallback uses the other enabled provider)', (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <select
              value={settings['llm.primary_provider'] || settings['llm.default_provider'] || 'gemini'}
              onChange={e => {
                set('llm.default_provider', e.target.value)
                set('llm.primary_provider', e.target.value)
              }}
              className="zentra-select"
              style={{ width: '160px' }}
            >
              <option value="gemini">Gemini</option>
              <option value="groq">Groq</option>
            </select>
            <a
              href="/admin/ai"
              className="zentra-btn zentra-btn-secondary"
              style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem', textDecoration: 'none' }}
            >
              Configure Keys &amp; Failover &rarr;
            </a>
          </div>
        ))}
      </div>

      {/* Section 6: Diagnostics */}
      {systemInfo && (
        <div className="zentra-card" style={{ marginBottom: '2rem' }}>
          {sectionHeader('info', 'System Diagnostics & Environment', 'Runtime server specifications and API connectivity')}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
            {[
              { label: 'Node.js Engine', value: systemInfo.nodeVersion },
              { label: 'Host Platform', value: systemInfo.platform },
              { label: 'Environment Mode', value: systemInfo.env },
              { label: 'Database (Prisma)', value: systemInfo.databaseConfigured ? 'Connected' : 'Offline', ok: systemInfo.databaseConfigured },
              { label: 'Gemini Provider', value: systemInfo.geminiConfigured ? 'Configured' : 'Missing Key', ok: systemInfo.geminiConfigured },
              { label: 'Groq Provider', value: systemInfo.groqConfigured ? 'Configured' : 'Missing Key', ok: systemInfo.groqConfigured },
            ].map(({ label, value, ok }) => (
              <div key={label} style={{ background: 'var(--zentra-bg-muted)', borderRadius: '12px', padding: '1rem', border: '1px solid var(--zentra-border)' }}>
                <div style={{ fontSize: '0.725rem', color: 'var(--zentra-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
                  {label}
                </div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600, color: ok !== undefined ? (ok ? '#10b981' : '#dc2626') : 'var(--zentra-text-primary)', marginTop: '0.25rem', fontFamily: 'monospace' }}>
                  {value}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
