'use client'

import React, { useEffect, useState } from 'react'

interface HealthSnapshot {
  status: 'ok' | 'degraded'
  database: { ok: boolean; latencyMs: number | null }
  subsystems: {
    storageConfigured: boolean
    llmEnvConfigured: boolean
    sessionSecretConfigured: boolean
    smtpConfigured: boolean
  }
}

let cachedHealth: HealthSnapshot | null = null
let cachedAt = 0
let inFlightPromise: Promise<HealthSnapshot | null> | null = null
const CACHE_TTL_MS = 60_000

async function fetchHealthOnce(): Promise<HealthSnapshot | null> {
  const now = Date.now()
  if (cachedHealth && now - cachedAt < CACHE_TTL_MS) {
    return cachedHealth
  }
  if (inFlightPromise) {
    return inFlightPromise
  }
  inFlightPromise = fetch('/api/health', { cache: 'no-store' })
    .then(async (res) => {
      const data = (await res.json().catch(() => null)) as HealthSnapshot | null
      if (data && (data.status === 'ok' || data.status === 'degraded')) {
        cachedHealth = data
        cachedAt = Date.now()
        return data
      }
      return null
    })
    .catch(() => null)
    .finally(() => {
      inFlightPromise = null
    })
  return inFlightPromise
}

export function SystemHealthBadge({ variant }: { variant: 'footer' | 'sidebar' }) {
  const [health, setHealth] = useState<HealthSnapshot | null>(cachedHealth)
  const [checked, setChecked] = useState(Boolean(cachedHealth))

  useEffect(() => {
    let active = true
    fetchHealthOnce().then((res) => {
      if (!active) return
      setHealth(res)
      setChecked(true)
    })
    return () => {
      active = false
    }
  }, [])

  if (variant === 'footer') {
    const isOk = health?.status === 'ok'
    const dotColor = !checked ? '#94a3b8' : isOk ? '#10b981' : '#ef4444'
    const label = !checked
      ? 'Checking system health…'
      : isOk
        ? `Systems operational${health?.database.latencyMs !== null ? ` (${health.database.latencyMs}ms)` : ''}`
        : 'System degraded (check DB)'
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: dotColor, display: 'inline-block' }} />
        <span>{label}</span>
      </div>
    )
  }

  const dbOk = health?.database?.ok ?? false
  const llmOk = health?.subsystems?.llmEnvConfigured ?? false
  const dotColor = !checked ? '#94a3b8' : dbOk && llmOk ? '#10b981' : dbOk ? '#f59e0b' : '#ef4444'
  const statusText = !checked ? 'Checking…' : dbOk ? 'Connected' : 'Degraded'
  const statusColor = !checked ? 'var(--zentra-text-muted)' : dbOk ? '#10b981' : '#ef4444'
  const subText = !checked
    ? 'Verifying RAG & LLM services'
    : !dbOk
      ? 'Database connection unavailable'
      : llmOk
        ? 'RAG + Adaptive LLM Ready'
        : 'LLM API key not configured'

  return (
    <div style={{
      background: 'var(--zentra-bg-muted)',
      border: '1px solid var(--zentra-border)',
      borderRadius: '16px',
      padding: '0.75rem 1rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: dotColor, display: 'inline-block', boxShadow: `0 0 6px ${dotColor}` }} />
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--zentra-text-primary)' }}>RAG Pipeline</span>
        </div>
        <span style={{ fontSize: '0.7rem', color: statusColor, fontWeight: 600 }}>{statusText}</span>
      </div>
      <div style={{ fontSize: '0.7rem', color: 'var(--zentra-text-muted)' }}>{subText}</div>
    </div>
  )
}
