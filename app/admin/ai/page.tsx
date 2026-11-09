'use client'

import React, { useEffect, useState, useCallback } from 'react'
import Icon from '@/components/Icon'

interface ProviderConfig {
  id: 'gemini' | 'groq'
  name: string
  model: string
  configured: boolean
  enabled: boolean
  isPrimary: boolean
  isFallback: boolean
  status: 'available' | 'unavailable' | 'disabled' | 'not_configured'
  maskedKey: string
  lastSuccess: string | null
  lastFailure: string | null
  lastError: string | null
}

interface RAGConfig {
  enabled: boolean
  embeddingModel: string
  vectorStore: string
  chunkSize: number
  chunkOverlap: number
  topK: number
}

interface AIConfigResponse {
  primaryProvider: 'gemini' | 'groq'
  fallbackProvider: 'gemini' | 'groq' | null
  fallbackEnabled: boolean
  fallbackCount: number
  providers: ProviderConfig[]
  hasConfigError: boolean
  configErrorMessage: string | null
  rag: RAGConfig
}

export default function AdminAIPage() {
  const [config, setConfig] = useState<AIConfigResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Form states for Admin configuration
  const [primaryChoice, setPrimaryChoice] = useState<'gemini' | 'groq'>('gemini')
  const [geminiEnabled, setGeminiEnabled] = useState(true)
  const [groqEnabled, setGroqEnabled] = useState(true)
  const [geminiKeyInput, setGeminiKeyInput] = useState('')
  const [groqKeyInput, setGroqKeyInput] = useState('')

  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Testing connection state
  const [testingProvider, setTestingProvider] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ provider: string; success: boolean; message: string } | null>(null)

  const fetchConfig = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/ai-config', { credentials: 'include' })
      if (res.ok) {
        const data: AIConfigResponse = await res.json()
        setConfig(data)
        setPrimaryChoice(data.primaryProvider)

        const gemini = data.providers.find((p) => p.id === 'gemini')
        const groq = data.providers.find((p) => p.id === 'groq')

        if (gemini) setGeminiEnabled(gemini.enabled)
        if (groq) setGroqEnabled(groq.enabled)
      } else {
        const errData = await res.json().catch(() => ({}))
        setError(errData.error || 'Failed to load AI configuration')
      }
    } catch {
      setError('Network error while loading AI configuration')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  const handleSave = async () => {
    setSaving(true)
    setSaveStatus(null)
    try {
      const res = await fetch('/api/admin/ai-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          primaryProvider: primaryChoice,
          geminiEnabled,
          groqEnabled,
          geminiApiKey: geminiKeyInput.trim() || undefined,
          groqApiKey: groqKeyInput.trim() || undefined,
        }),
      })

      if (res.ok) {
        setSaveStatus({ type: 'success', message: 'AI Provider configuration updated successfully.' })
        setGeminiKeyInput('')
        setGroqKeyInput('')
        await fetchConfig()
        setTimeout(() => setSaveStatus(null), 4000)
      } else {
        const err = await res.json().catch(() => ({}))
        setSaveStatus({ type: 'error', message: err.error || 'Failed to save configuration.' })
      }
    } catch {
      setSaveStatus({ type: 'error', message: 'Failed to communicate with server.' })
    } finally {
      setSaving(false)
    }
  }

  const handleTestConnection = async (provider: 'gemini' | 'groq') => {
    setTestingProvider(provider)
    setTestResult(null)
    try {
      const res = await fetch('/api/admin/ai-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          action: 'test',
          provider,
        }),
      })

      const data = await res.json()
      if (res.ok && data.success) {
        setTestResult({
          provider,
          success: true,
          message: `Connected successfully (${data.latencyMs}ms latency)`,
        })
        await fetchConfig()
      } else {
        setTestResult({
          provider,
          success: false,
          message: data.error || 'Connection failed: Provider did not return valid output.',
        })
        await fetchConfig()
      }
    } catch {
      setTestResult({
        provider,
        success: false,
        message: 'Network request error during connection test.',
      })
    } finally {
      setTestingProvider(null)
    }
  }

  const formatDate = (isoString: string | null) => {
    if (!isoString) return 'Never'
    try {
      const d = new Date(isoString)
      return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    } catch {
      return isoString
    }
  }

  if (loading && !config) {
    return (
      <div className="zentra-page-container">
        <div className="zentra-card" style={{ padding: '4rem', textAlign: 'center', color: 'var(--zentra-text-muted)' }}>
          <Icon name="smart_toy" size={36} style={{ marginBottom: '0.75rem', color: '#2563eb' }} />
          <div style={{ fontSize: '1rem', fontWeight: 600 }}>Loading AI Provider Infrastructure...</div>
          <div style={{ fontSize: '0.825rem', marginTop: '0.25rem' }}>Inspecting Gemini & Groq dual engine status and pgvector embeddings</div>
        </div>
      </div>
    )
  }

  if (error && !config) {
    return (
      <div className="zentra-page-container">
        <div className="zentra-card" style={{ padding: '3rem', textAlign: 'center', borderColor: 'rgba(239,68,68,0.2)' }}>
          <div style={{ color: '#dc2626', marginBottom: '1rem', fontWeight: 600 }}>{error}</div>
          <button onClick={fetchConfig} className="zentra-btn zentra-btn-primary">
            Retry Connection
          </button>
        </div>
      </div>
    )
  }

  const gemini = config?.providers.find((p) => p.id === 'gemini')
  const groq = config?.providers.find((p) => p.id === 'groq')

  return (
    <div className="zentra-page-container" style={{ maxWidth: '1200px' }}>
      {/* Header */}
      <div className="zentra-page-header">
        <div>
          <div className="zentra-title-row">
            <h1 className="zentra-page-title">AI Provider &amp; Automatic Failover</h1>
            <span className="zentra-link-bubble" title="AI Centralized Engine">
              <Icon name="hub" size={16} />
            </span>
          </div>
          <p className="zentra-page-subtitle">
            Centrally manage Gemini &amp; Groq keys, designate primary and automatic fallback roles, and monitor live provider health.
          </p>
        </div>

        <div className="zentra-header-actions" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          {saveStatus && (
            <span
              className={`zentra-badge ${saveStatus.type === 'success' ? 'success' : 'danger'}`}
              style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
            >
              {saveStatus.message}
            </span>
          )}

          <button onClick={fetchConfig} disabled={loading} className="zentra-btn zentra-btn-secondary" title="Refresh Provider Telemetry">
            <Icon name="refresh" size={16} />
            <span>Refresh Status</span>
          </button>

          <button onClick={handleSave} disabled={saving} className="zentra-btn zentra-btn-primary">
            <Icon name="save" size={16} />
            <span>{saving ? 'Saving...' : 'Save Configuration'}</span>
          </button>
        </div>
      </div>

      {/* Critical Configuration Warning if neither provider is usable */}
      {config?.hasConfigError && (
        <div
          className="zentra-card"
          style={{
            padding: '1.25rem 1.5rem',
            marginBottom: '1.75rem',
            background: 'rgba(239, 68, 68, 0.08)',
            borderColor: 'rgba(239, 68, 68, 0.3)',
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
          }}
        >
          <Icon name="error" size={28} style={{ color: '#dc2626', flexShrink: 0 }} />
          <div>
            <div style={{ color: '#dc2626', fontWeight: 700, fontSize: '0.95rem' }}>
              Action Required: No Usable AI Provider Configured
            </div>
            <div style={{ color: 'var(--zentra-text-secondary)', fontSize: '0.85rem', marginTop: '0.2rem' }}>
              {config.configErrorMessage} Interview generation and candidate evaluation are suspended until at least one provider has a valid key and is enabled.
            </div>
          </div>
        </div>
      )}

      {/* Security & Isolation Policy */}
      <div
        className="zentra-card"
        style={{
          padding: '1rem 1.25rem',
          marginBottom: '1.75rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.85rem',
          background: 'rgba(16, 185, 129, 0.04)',
          borderColor: 'rgba(16, 185, 129, 0.2)',
        }}
      >
        <Icon name="shield" size={22} style={{ color: '#059669', flexShrink: 0 }} />
        <span style={{ fontSize: '0.85rem', color: 'var(--zentra-text-secondary)', lineHeight: 1.5 }}>
          <strong style={{ color: 'var(--zentra-text-primary)' }}>Admin-Exclusive Zero-Leak Policy:</strong> API keys are encrypted at rest with AES-256-GCM. Interviewers and candidates cannot choose providers or see provider failure messages. Failovers occur automatically and invisibly on the server.
        </span>
      </div>

      {/* Test Result Toast Alert */}
      {testResult && (
        <div
          className="zentra-card"
          style={{
            padding: '0.85rem 1.25rem',
            marginBottom: '1.5rem',
            background: testResult.success ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
            borderColor: testResult.success ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <Icon
              name={testResult.success ? 'check_circle' : 'warning'}
              size={20}
              style={{ color: testResult.success ? '#10b981' : '#dc2626' }}
            />
            <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--zentra-text-primary)' }}>
              [{testResult.provider.toUpperCase()}] {testResult.message}
            </span>
          </div>
          <button
            onClick={() => setTestResult(null)}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--zentra-text-muted)' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Provider Configuration Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '1.5rem', marginBottom: '1.75rem' }}>
        {/* Gemini Card */}
        <div
          className="zentra-card"
          style={{
            border: primaryChoice === 'gemini' ? '2px solid #2563eb' : '1px solid var(--zentra-border)',
            borderRadius: '16px',
            padding: '1.5rem',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: '1.25rem',
            position: 'relative',
          }}
        >
          <div>
            {/* Header row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0, color: 'var(--zentra-text-primary)' }}>
                    Google Gemini
                  </h2>
                  <span style={{ fontSize: '0.75rem', color: 'var(--zentra-text-muted)', fontFamily: 'monospace' }}>
                    ({gemini?.model || 'gemini-3.6-flash'})
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.35rem' }}>
                  {primaryChoice === 'gemini' ? (
                    <span className="zentra-badge primary">Primary Provider</span>
                  ) : groqEnabled && config?.fallbackEnabled ? (
                    <span className="zentra-badge neutral">Fallback Provider</span>
                  ) : (
                    <span className="zentra-badge warning">Standby / Inactive</span>
                  )}

                  <span
                    className={`zentra-badge ${
                      gemini?.status === 'available'
                        ? 'success'
                        : gemini?.status === 'disabled'
                        ? 'neutral'
                        : 'danger'
                    }`}
                  >
                    ● {gemini?.status === 'available' ? 'Available' : gemini?.status === 'disabled' ? 'Disabled' : gemini?.status === 'not_configured' ? 'Not Configured' : 'Unavailable'}
                  </span>
                </div>
              </div>

              {/* Primary selector button */}
              <button
                type="button"
                onClick={() => setPrimaryChoice('gemini')}
                className={`zentra-btn ${primaryChoice === 'gemini' ? 'zentra-btn-primary' : 'zentra-btn-secondary'}`}
                style={{ fontSize: '0.8rem', padding: '0.45rem 0.85rem' }}
              >
                {primaryChoice === 'gemini' ? '✓ Primary' : 'Set as Primary'}
              </button>
            </div>

            {/* Enable/Disable Toggle */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 0', borderTop: '1px solid var(--zentra-border-subtle)', borderBottom: '1px solid var(--zentra-border-subtle)', marginBottom: '1rem' }}>
              <div>
                <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--zentra-text-primary)' }}>
                  Enable Gemini
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--zentra-text-muted)' }}>
                  Include Gemini in the execution &amp; failover pool
                </div>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={geminiEnabled}
                  onChange={(e) => setGeminiEnabled(e.target.checked)}
                />
                <span className="slider round"></span>
              </label>
            </div>

            {/* API Key Configuration */}
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                <label style={{ fontSize: '0.825rem', fontWeight: 600, color: 'var(--zentra-text-primary)' }}>
                  Gemini API Key
                </label>
                {gemini?.configured && (
                  <span style={{ fontSize: '0.75rem', color: '#10b981', fontFamily: 'monospace' }}>
                    Active: {gemini.maskedKey}
                  </span>
                )}
              </div>
              <input
                type="password"
                placeholder={gemini?.configured ? '•••••••••••••••• (Leave blank to keep current key)' : 'Enter GEMINI_API_KEY'}
                value={geminiKeyInput}
                onChange={(e) => setGeminiKeyInput(e.target.value)}
                className="zentra-input"
                style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.85rem' }}
              />
              <div style={{ fontSize: '0.725rem', color: 'var(--zentra-text-muted)', marginTop: '0.3rem' }}>
                Stored encrypted on server. Enter a new key to update or replace.
              </div>
            </div>

            {/* Health Telemetry */}
            <div style={{ background: 'var(--zentra-bg-muted)', borderRadius: '12px', padding: '0.85rem 1rem', fontSize: '0.8rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                <span style={{ color: 'var(--zentra-text-muted)' }}>Last Successful Request:</span>
                <span style={{ color: 'var(--zentra-text-primary)', fontWeight: 500 }}>{formatDate(gemini?.lastSuccess || null)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                <span style={{ color: 'var(--zentra-text-muted)' }}>Last Failure:</span>
                <span style={{ color: gemini?.lastFailure ? '#dc2626' : 'var(--zentra-text-primary)', fontWeight: 500 }}>
                  {formatDate(gemini?.lastFailure || null)}
                </span>
              </div>
              {gemini?.lastError && (
                <div style={{ marginTop: '0.4rem', paddingTop: '0.4rem', borderTop: '1px solid var(--zentra-border-subtle)', color: '#dc2626', fontSize: '0.75rem', lineHeight: 1.4 }}>
                  <strong>Error:</strong> {gemini.lastError}
                </div>
              )}
            </div>
          </div>

          {/* Test Connection Button */}
          <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => handleTestConnection('gemini')}
              disabled={testingProvider === 'gemini' || !gemini?.configured}
              className="zentra-btn zentra-btn-secondary"
              style={{ width: '100%', justifyContent: 'center' }}
            >
              <Icon name="bolt" size={16} />
              <span>{testingProvider === 'gemini' ? 'Testing Gemini...' : 'Test Connection'}</span>
            </button>
          </div>
        </div>

        {/* Groq Card */}
        <div
          className="zentra-card"
          style={{
            border: primaryChoice === 'groq' ? '2px solid #2563eb' : '1px solid var(--zentra-border)',
            borderRadius: '16px',
            padding: '1.5rem',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: '1.25rem',
            position: 'relative',
          }}
        >
          <div>
            {/* Header row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0, color: 'var(--zentra-text-primary)' }}>
                    Groq
                  </h2>
                  <span style={{ fontSize: '0.75rem', color: 'var(--zentra-text-muted)', fontFamily: 'monospace' }}>
                    ({groq?.model || 'openai/gpt-oss-20b'})
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.35rem' }}>
                  {primaryChoice === 'groq' ? (
                    <span className="zentra-badge primary">Primary Provider</span>
                  ) : geminiEnabled && config?.fallbackEnabled ? (
                    <span className="zentra-badge neutral">Fallback Provider</span>
                  ) : (
                    <span className="zentra-badge warning">Standby / Inactive</span>
                  )}

                  <span
                    className={`zentra-badge ${
                      groq?.status === 'available'
                        ? 'success'
                        : groq?.status === 'disabled'
                        ? 'neutral'
                        : 'danger'
                    }`}
                  >
                    ● {groq?.status === 'available' ? 'Available' : groq?.status === 'disabled' ? 'Disabled' : groq?.status === 'not_configured' ? 'Not Configured' : 'Unavailable'}
                  </span>
                </div>
              </div>

              {/* Primary selector button */}
              <button
                type="button"
                onClick={() => setPrimaryChoice('groq')}
                className={`zentra-btn ${primaryChoice === 'groq' ? 'zentra-btn-primary' : 'zentra-btn-secondary'}`}
                style={{ fontSize: '0.8rem', padding: '0.45rem 0.85rem' }}
              >
                {primaryChoice === 'groq' ? '✓ Primary' : 'Set as Primary'}
              </button>
            </div>

            {/* Enable/Disable Toggle */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 0', borderTop: '1px solid var(--zentra-border-subtle)', borderBottom: '1px solid var(--zentra-border-subtle)', marginBottom: '1rem' }}>
              <div>
                <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--zentra-text-primary)' }}>
                  Enable Groq
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--zentra-text-muted)' }}>
                  Include Groq in the execution &amp; failover pool
                </div>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={groqEnabled}
                  onChange={(e) => setGroqEnabled(e.target.checked)}
                />
                <span className="slider round"></span>
              </label>
            </div>

            {/* API Key Configuration */}
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                <label style={{ fontSize: '0.825rem', fontWeight: 600, color: 'var(--zentra-text-primary)' }}>
                  Groq API Key
                </label>
                {groq?.configured && (
                  <span style={{ fontSize: '0.75rem', color: '#10b981', fontFamily: 'monospace' }}>
                    Active: {groq.maskedKey}
                  </span>
                )}
              </div>
              <input
                type="password"
                placeholder={groq?.configured ? '•••••••••••••••• (Leave blank to keep current key)' : 'Enter GROQ_API_KEY'}
                value={groqKeyInput}
                onChange={(e) => setGroqKeyInput(e.target.value)}
                className="zentra-input"
                style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.85rem' }}
              />
              <div style={{ fontSize: '0.725rem', color: 'var(--zentra-text-muted)', marginTop: '0.3rem' }}>
                Stored encrypted on server. Enter a new key to update or replace.
              </div>
            </div>

            {/* Health Telemetry */}
            <div style={{ background: 'var(--zentra-bg-muted)', borderRadius: '12px', padding: '0.85rem 1rem', fontSize: '0.8rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                <span style={{ color: 'var(--zentra-text-muted)' }}>Last Successful Request:</span>
                <span style={{ color: 'var(--zentra-text-primary)', fontWeight: 500 }}>{formatDate(groq?.lastSuccess || null)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                <span style={{ color: 'var(--zentra-text-muted)' }}>Last Failure:</span>
                <span style={{ color: groq?.lastFailure ? '#dc2626' : 'var(--zentra-text-primary)', fontWeight: 500 }}>
                  {formatDate(groq?.lastFailure || null)}
                </span>
              </div>
              {groq?.lastError && (
                <div style={{ marginTop: '0.4rem', paddingTop: '0.4rem', borderTop: '1px solid var(--zentra-border-subtle)', color: '#dc2626', fontSize: '0.75rem', lineHeight: 1.4 }}>
                  <strong>Error:</strong> {groq.lastError}
                </div>
              )}
            </div>
          </div>

          {/* Test Connection Button */}
          <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => handleTestConnection('groq')}
              disabled={testingProvider === 'groq' || !groq?.configured}
              className="zentra-btn zentra-btn-secondary"
              style={{ width: '100%', justifyContent: 'center' }}
            >
              <Icon name="bolt" size={16} />
              <span>{testingProvider === 'groq' ? 'Testing Groq...' : 'Test Connection'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Automatic Failover Topology & Operational Status Table */}
      <div className="zentra-card" style={{ marginBottom: '1.75rem' }}>
        <div className="zentra-card-header">
          <div>
            <h2 className="zentra-card-title">Live Provider Operational Status &amp; Failover Roles</h2>
            <span style={{ fontSize: '0.8rem', color: 'var(--zentra-text-muted)' }}>
              Summary of active routing roles, calculated from recorded live request outcomes
            </span>
          </div>
          <span className="zentra-badge neutral">
            Failover Activations: {config?.fallbackCount || 0}
          </span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="zentra-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--zentra-border)', textAlign: 'left' }}>
                <th style={{ padding: '0.75rem 1rem' }}>Provider</th>
                <th style={{ padding: '0.75rem 1rem' }}>Role</th>
                <th style={{ padding: '0.75rem 1rem' }}>Status</th>
                <th style={{ padding: '0.75rem 1rem' }}>Last Success</th>
                <th style={{ padding: '0.75rem 1rem' }}>Last Failure</th>
                <th style={{ padding: '0.75rem 1rem' }}>Failure Reason (Safe)</th>
              </tr>
            </thead>
            <tbody>
              {config?.providers.map((p) => {
                const isPrimary = p.id === config.primaryProvider
                const isFallback = p.id === config.fallbackProvider

                return (
                  <tr key={p.id} style={{ borderBottom: '1px solid var(--zentra-border-subtle)' }}>
                    <td style={{ padding: '0.85rem 1rem', fontWeight: 600 }}>
                      <div style={{ color: 'var(--zentra-text-primary)' }}>{p.name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--zentra-text-muted)', fontFamily: 'monospace' }}>
                        {p.model}
                      </div>
                    </td>
                    <td style={{ padding: '0.85rem 1rem' }}>
                      {isPrimary ? (
                        <span className="zentra-badge primary">Primary</span>
                      ) : isFallback ? (
                        <span className="zentra-badge neutral">Fallback</span>
                      ) : (
                        <span className="zentra-badge warning">Standby</span>
                      )}
                    </td>
                    <td style={{ padding: '0.85rem 1rem' }}>
                      <span
                        className={`zentra-badge ${
                          p.status === 'available'
                            ? 'success'
                            : p.status === 'disabled'
                            ? 'neutral'
                            : 'danger'
                        }`}
                      >
                        ● {p.status === 'available' ? 'Available' : p.status === 'disabled' ? 'Disabled' : p.status === 'not_configured' ? 'Not Configured' : 'Unavailable'}
                      </span>
                    </td>
                    <td style={{ padding: '0.85rem 1rem', color: 'var(--zentra-text-secondary)', fontFamily: 'monospace', fontSize: '0.775rem' }}>
                      {formatDate(p.lastSuccess)}
                    </td>
                    <td style={{ padding: '0.85rem 1rem', color: p.lastFailure ? '#dc2626' : 'var(--zentra-text-muted)', fontFamily: 'monospace', fontSize: '0.775rem' }}>
                      {formatDate(p.lastFailure)}
                    </td>
                    <td style={{ padding: '0.85rem 1rem', color: p.lastError ? '#dc2626' : 'var(--zentra-text-muted)', fontSize: '0.8rem' }}>
                      {p.lastError || 'None'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Failover Logic Indicator */}
        <div style={{ marginTop: '1.25rem', padding: '1rem', background: 'var(--zentra-bg-muted)', borderRadius: '12px', border: '1px solid var(--zentra-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '0.35rem' }}>
            <Icon name="swap_horiz" size={18} style={{ color: '#2563eb' }} />
            <strong style={{ fontSize: '0.85rem', color: 'var(--zentra-text-primary)' }}>
              Automatic Failover Topology:
            </strong>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--zentra-text-secondary)', lineHeight: 1.5 }}>
            Active requests first dispatch to <strong>{config?.primaryProvider?.toUpperCase()}</strong>. If an eligible error occurs (HTTP 429 rate limit, quota exhaustion, 5xx server error, timeout, or invalid key), the backend automatically and seamlessly retries using{' '}
            <strong>{config?.fallbackProvider ? config.fallbackProvider.toUpperCase() : 'NO FALLBACK (Single provider mode)'}</strong> with bounded 25s timeout and exact context preservation. Candidates and Interviewers experience no interruptions or technical error messages.
          </div>
        </div>
      </div>

      {/* RAG & Embeddings Architecture */}
      <div className="zentra-card" style={{ marginBottom: '1.75rem' }}>
        <div className="zentra-card-header">
          <div>
            <h2 className="zentra-card-title">RAG Vector Pipeline Configuration</h2>
            <span style={{ fontSize: '0.8rem', color: 'var(--zentra-text-muted)' }}>Retrieval Augmented Generation parameters</span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
          {[
            { label: 'RAG Pipeline Status', value: config?.rag?.enabled ? 'Active' : 'Disabled', color: config?.rag?.enabled ? '#10b981' : '#dc2626' },
            { label: 'Embedding Architecture', value: config?.rag?.embeddingModel || '—', color: 'var(--zentra-text-primary)' },
            { label: 'Vector Store Engine', value: config?.rag?.vectorStore || '—', color: 'var(--zentra-text-primary)' },
            { label: 'Chunk Token Boundary', value: `${config?.rag?.chunkSize || 1200} chars`, color: 'var(--zentra-text-primary)' },
            { label: 'Overlap Context Margin', value: `${config?.rag?.chunkOverlap || 200} chars`, color: 'var(--zentra-text-primary)' },
            { label: 'Top-K Nearest Chunks', value: `${config?.rag?.topK || 5} chunks`, color: 'var(--zentra-text-primary)' },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ background: 'var(--zentra-bg-muted)', borderRadius: '12px', padding: '1rem', border: '1px solid var(--zentra-border)' }}>
              <div style={{ fontSize: '0.725rem', color: 'var(--zentra-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
                {label}
              </div>
              <div style={{ fontSize: '0.95rem', fontWeight: 600, color, marginTop: '0.35rem', fontFamily: 'monospace' }}>
                {value}
              </div>
            </div>
          ))}
        </div>

        <div style={{ background: 'var(--zentra-bg-muted)', border: '1px solid var(--zentra-border)', borderRadius: '12px', padding: '1rem 1.25rem' }}>
          <div style={{ fontSize: '0.825rem', color: 'var(--zentra-text-secondary)', lineHeight: 1.6 }}>
            <strong style={{ color: 'var(--zentra-text-primary)' }}>RAG Pipeline Flow:</strong> Uploaded syllabus and knowledge base documents are converted into vector chunks using pgvector with Cosine Similarity index. During interviews, adaptive prompt injection retrieves semantic context based on candidate performance.
          </div>
        </div>
      </div>
    </div>
  )
}
