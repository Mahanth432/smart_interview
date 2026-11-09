import React from 'react'

export default function ReportsLoading() {
  return (
    <div className="zentra-page-container" style={{ opacity: 0.7, pointerEvents: 'none' }}>
      {/* Skeleton Header */}
      <div className="zentra-page-header">
        <div>
          <div style={{ width: '220px', height: '32px', background: 'var(--zentra-bg-muted)', borderRadius: '8px', marginBottom: '8px' }} />
          <div style={{ width: '380px', height: '18px', background: 'var(--zentra-bg-muted)', borderRadius: '6px' }} />
        </div>
        <div style={{ width: '140px', height: '38px', background: 'var(--zentra-bg-muted)', borderRadius: '9999px' }} />
      </div>

      {/* Top 4 Metric Skeleton Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem', marginBottom: '1.75rem' }}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="zentra-card" style={{ height: '110px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div style={{ width: '90px', height: '14px', background: 'var(--zentra-bg-muted)', borderRadius: '4px' }} />
            <div style={{ width: '60px', height: '30px', background: 'var(--zentra-bg-muted)', borderRadius: '6px' }} />
            <div style={{ width: '130px', height: '12px', background: 'var(--zentra-bg-muted)', borderRadius: '4px' }} />
          </div>
        ))}
      </div>

      {/* Search Bar Skeleton */}
      <div className="zentra-card" style={{ height: '62px', marginBottom: '1.25rem', background: 'var(--zentra-bg-surface)' }} />

      {/* Table Skeleton */}
      <div className="zentra-card" style={{ height: '380px', background: 'var(--zentra-bg-surface)' }} />
    </div>
  )
}
