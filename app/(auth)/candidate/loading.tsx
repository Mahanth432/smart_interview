import React from 'react'

export default function CandidateLoading() {
  return (
    <div className="zentra-page-container" style={{ opacity: 0.7, pointerEvents: 'none' }}>
      <div className="zentra-page-header">
        <div>
          <div style={{ width: '200px', height: '32px', background: 'var(--zentra-bg-muted)', borderRadius: '8px', marginBottom: '8px' }} />
          <div style={{ width: '380px', height: '18px', background: 'var(--zentra-bg-muted)', borderRadius: '6px' }} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem', marginBottom: '1.75rem' }}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="zentra-card" style={{ height: '110px' }} />
        ))}
      </div>

      <div className="zentra-card" style={{ height: '380px' }} />
    </div>
  )
}
