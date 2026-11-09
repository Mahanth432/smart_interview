'use client'

import React from 'react'
import dynamic from 'next/dynamic'

interface AdminChartsWrapperProps {
  statusBreakdown: {
    completed: number
    active: number
    other: number
  }
  activityLabels: string[]
  activityData: number[]
}

const DynamicAdminCharts = dynamic(
  () => import('./AdminDashboardCharts').then((m) => m.AdminDashboardCharts),
  {
    ssr: false,
    loading: () => (
      <div
        className="zentra-card"
        style={{
          padding: '3rem',
          textAlign: 'center',
          color: 'var(--zentra-text-muted)',
          minHeight: '260px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span>Loading analytics charts...</span>
      </div>
    ),
  }
)

export function AdminChartsWrapper(props: AdminChartsWrapperProps) {
  return <DynamicAdminCharts {...props} />
}
