'use client'

import React from 'react'
import dynamic from 'next/dynamic'

// Dynamically import ScoreChart with SSR disabled and smooth skeleton
const ScoreChart = dynamic(
  () => import('@/components/ScoreChart').then((mod) => mod.ScoreChart),
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          height: '260px',
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--zentra-text-muted)',
          fontSize: '0.85rem',
          background: 'var(--zentra-bg-muted)',
          borderRadius: '12px',
        }}
      >
        <span>Loading chart visualization...</span>
      </div>
    ),
  }
)

export const ScoreChartWrapper = () => {
  return <ScoreChart />
}
