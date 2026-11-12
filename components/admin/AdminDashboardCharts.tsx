'use client'

import React from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'
import { Line, Doughnut } from 'react-chartjs-2'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
)

interface AdminChartsProps {
  statusBreakdown: { completed: number; active: number; other: number }
  activityLabels: string[]
  activityData: number[]
}

export function AdminDashboardCharts({ statusBreakdown, activityLabels, activityData }: AdminChartsProps) {
  const lineData = {
    labels: activityLabels.length > 0 ? activityLabels : ['6d ago', '5d ago', '4d ago', '3d ago', '2d ago', 'Yesterday', 'Today'],
    datasets: [
      {
        label: 'Sessions',
        data: activityData.length > 0 ? activityData : [0, 0, 0, 0, 0, 0, 0],
        borderColor: '#2563eb',
        backgroundColor: (context: { chart: { ctx: CanvasRenderingContext2D } }) => {
          const ctx = context.chart.ctx
          const gradient = ctx.createLinearGradient(0, 0, 0, 240)
          gradient.addColorStop(0, 'rgba(37, 99, 235, 0.28)')
          gradient.addColorStop(1, 'rgba(37, 99, 235, 0.0)')
          return gradient
        },
        fill: true,
        tension: 0.4,
        pointBackgroundColor: '#2563eb',
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6,
      },
    ],
  }

  const lineOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#0f172a',
        titleColor: '#ffffff',
        bodyColor: '#e2e8f0',
        padding: 10,
        cornerRadius: 10,
        displayColors: false,
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: '#94a3b8', font: { size: 11, family: 'Inter' } },
      },
      y: {
        border: { dash: [4, 4] },
        grid: { color: 'rgba(226, 232, 240, 0.6)' },
        ticks: { color: '#94a3b8', font: { size: 11, family: 'Inter' }, precision: 0 },
        beginAtZero: true,
      },
    },
  }

  const doughnutData = {
    labels: ['Completed', 'In Progress', 'Pending/Other'],
    datasets: [
      {
        data: [
          statusBreakdown.completed,
          statusBreakdown.active,
          statusBreakdown.other,
        ],
        backgroundColor: ['#10b981', '#3b82f6', '#f59e0b'],
        borderWidth: 0,
        hoverOffset: 4,
      },
    ],
  }

  const doughnutOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom' as const,
        labels: {
          usePointStyle: true,
          boxWidth: 8,
          font: { size: 11, family: 'Inter' },
          color: '#64748b',
          padding: 14,
        },
      },
      tooltip: {
        backgroundColor: '#0f172a',
        cornerRadius: 8,
      },
    },
    cutout: '72%',
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem', width: '100%' }}>
      {/* Activity Timeline Chart */}
      <div className="zentra-card" style={{ padding: '1.5rem', minHeight: '340px', display: 'flex', flexDirection: 'column' }}>
        <div className="zentra-card-header" style={{ marginBottom: '1rem' }}>
          <div>
            <h3 className="zentra-card-title">Interview Activity Timeline</h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--zentra-text-muted)' }}>Session volume and completions</span>
          </div>
          <span className="zentra-dot-menu">&bull;&bull;&bull;</span>
        </div>
        <div style={{ flex: 1, minHeight: '220px', position: 'relative' }}>
          <Line data={lineData} options={lineOptions} />
        </div>
      </div>

      {/* Status Doughnut Chart */}
      <div className="zentra-card" style={{ padding: '1.5rem', minHeight: '340px', display: 'flex', flexDirection: 'column' }}>
        <div className="zentra-card-header" style={{ marginBottom: '1rem' }}>
          <div>
            <h3 className="zentra-card-title">Session Status Distribution</h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--zentra-text-muted)' }}>Real-time session states</span>
          </div>
          <span className="zentra-dot-menu">&bull;&bull;&bull;</span>
        </div>
        <div style={{ flex: 1, minHeight: '220px', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Doughnut data={doughnutData} options={doughnutOptions} />
        </div>
      </div>
    </div>
  )
}
