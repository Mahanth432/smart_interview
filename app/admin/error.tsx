'use client'

import React from 'react'
import Link from 'next/link'
import Icon from '@/components/Icon'

export default function AdminRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
      <div className="zentra-card" style={{ maxWidth: '480px', width: '100%', textAlign: 'center', padding: '2rem' }}>
        <div style={{ display: 'inline-flex', padding: '0.75rem', borderRadius: '12px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', marginBottom: '1rem' }}>
          <Icon name="error_outline" size={28} />
        </div>
        <h2 style={{ margin: '0 0 0.5rem 0', fontSize: '1.25rem', color: 'var(--color-text-primary)' }}>
          Admin Panel Error
        </h2>
        <p style={{ margin: '0 0 1.25rem 0', fontSize: '0.875rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
          {error.message || 'An unexpected error occurred in the administration portal.'}
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button type="button" onClick={reset} className="zentra-btn zentra-btn-primary">
            Retry View
          </button>
          <Link href="/admin" className="zentra-btn zentra-btn-secondary" style={{ textDecoration: 'none' }}>
            Admin Overview
          </Link>
        </div>
      </div>
    </div>
  )
}
