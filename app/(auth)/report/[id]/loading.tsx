import React from 'react'

export default function ReportDetailLoading() {
  return (
    <div style={{ padding: '2rem', maxWidth: '1280px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.75rem', opacity: 0.7, pointerEvents: 'none' }}>
      {/* Top Header Skeleton */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ width: '280px', height: '32px', background: 'var(--zentra-bg-muted)', borderRadius: '8px', marginBottom: '8px' }} />
          <div style={{ width: '360px', height: '16px', background: 'var(--zentra-bg-muted)', borderRadius: '6px' }} />
        </div>
        <div style={{ width: '130px', height: '36px', background: 'var(--zentra-bg-muted)', borderRadius: '9999px' }} />
      </div>

      {/* 5 Metadata Card Skeletons */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="zentra-card" style={{ height: '95px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div style={{ width: '80px', height: '12px', background: 'var(--zentra-bg-muted)', borderRadius: '4px' }} />
            <div style={{ width: '120px', height: '24px', background: 'var(--zentra-bg-muted)', borderRadius: '6px' }} />
            <div style={{ width: '90px', height: '10px', background: 'var(--zentra-bg-muted)', borderRadius: '4px' }} />
          </div>
        ))}
      </div>

      {/* Summary Cards Skeleton */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1.25rem' }}>
        <div className="zentra-card" style={{ height: '160px', background: 'var(--zentra-bg-surface)' }} />
        <div className="zentra-card" style={{ height: '160px', background: 'var(--zentra-bg-surface)' }} />
      </div>

      {/* Q&A Breakdown Skeleton */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ width: '220px', height: '24px', background: 'var(--zentra-bg-muted)', borderRadius: '6px' }} />
        <div className="zentra-card" style={{ height: '220px', background: 'var(--zentra-bg-surface)' }} />
        <div className="zentra-card" style={{ height: '220px', background: 'var(--zentra-bg-surface)' }} />
      </div>
    </div>
  )
}
