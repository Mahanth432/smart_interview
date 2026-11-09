'use client'

import React, { useEffect } from 'react'
import Icon from '@/components/Icon'

export default function ReportsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Reports page error:', error)
  }, [error])

  return (
    <div style={{ padding: '4rem 2rem', maxWidth: '600px', margin: '0 auto', textAlign: 'center' }}>
      <div className="zentra-card" style={{ padding: '3.5rem 2.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.25rem' }}>
        <div
          style={{
            width: '60px',
            height: '60px',
            borderRadius: '50%',
            background: 'rgba(239, 68, 68, 0.1)',
            color: '#ef4444',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="error_outline" size={30} />
        </div>

        <div>
          <h2 style={{ fontSize: '1.35rem', fontWeight: 600, color: 'var(--zentra-text-primary)', margin: '0 0 0.5rem 0' }}>
            Unable to Load Reports
          </h2>
          <p style={{ color: 'var(--zentra-text-muted)', lineHeight: 1.6, fontSize: '0.9rem', margin: 0 }}>
            An unexpected error occurred while retrieving evaluation records. Please try again or refresh the page.
          </p>
        </div>

        <button
          onClick={() => reset()}
          className="zentra-btn zentra-btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}
        >
          <Icon name="refresh" size={16} />
          <span>Retry</span>
        </button>
      </div>
    </div>
  )
}
