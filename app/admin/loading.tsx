import React from 'react'
import Icon from '@/components/Icon'

export default function AdminLoading() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '60vh',
        width: '100%',
        gap: '1rem',
        color: 'var(--zentra-text-muted)',
      }}
    >
      <div style={{ animation: 'spin 1s linear infinite' }}>
        <Icon name="progress_activity" size={36} />
      </div>
      <div style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--zentra-text-secondary)' }}>
        Loading admin console...
      </div>
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
