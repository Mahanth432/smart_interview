import React from 'react'

export default function DashboardLoading() {
  return (
    <div className="zentra-page-container" style={{ opacity: 0.7, pointerEvents: 'none' }}>
      {/* Skeleton Header */}
      <div className="zentra-page-header">
        <div>
          <div style={{ width: '160px', height: '32px', background: 'var(--zentra-bg-muted)', borderRadius: '8px', marginBottom: '8px' }} />
          <div style={{ width: '320px', height: '18px', background: 'var(--zentra-bg-muted)', borderRadius: '6px' }} />
        </div>
      </div>

      {/* Top 4 Stats Skeleton Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem', marginBottom: '1.75rem' }}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="zentra-card" style={{ height: '120px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div style={{ width: '100px', height: '14px', background: 'var(--zentra-bg-muted)', borderRadius: '4px' }} />
            <div style={{ width: '60px', height: '32px', background: 'var(--zentra-bg-muted)', borderRadius: '6px' }} />
            <div style={{ width: '120px', height: '12px', background: 'var(--zentra-bg-muted)', borderRadius: '4px' }} />
          </div>
        ))}
      </div>

      {/* Main Grid Skeleton */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '1.5rem' }}>
        <div className="zentra-card" style={{ height: '340px', background: 'var(--zentra-bg-surface)' }} />
        <div className="zentra-card" style={{ height: '340px', background: 'var(--zentra-bg-surface)' }} />
      </div>
    </div>
  )
}
