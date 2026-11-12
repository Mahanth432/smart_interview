'use client'

import React, { useRef } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Filler,
  Legend,
} from 'chart.js'
import { Line } from 'react-chartjs-2'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Filler,
  Legend
)

export interface ScoreChartPoint {
  label: string
  score: number
}

export const ScoreChart = ({ data: points = [] }: { data?: ScoreChartPoint[] }) => {
  const chartRef = useRef<ChartJS<'line'>>(null)

  if (!points || points.length === 0) {
    return (
      <div
        style={{
          height: '260px',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.4rem',
          background: 'var(--zentra-bg-muted)',
          borderRadius: '14px',
          border: '1px dashed var(--zentra-border)',
          color: 'var(--zentra-text-muted)',
          fontSize: '0.85rem',
          padding: '1.5rem',
          textAlign: 'center',
        }}
      >
        <strong style={{ color: 'var(--zentra-text-secondary)', fontWeight: 600 }}>
          No scored evaluations yet
        </strong>
        <span>Complete at least one interview evaluation to display score progression.</span>
      </div>
    )
  }

  const data = {
    labels: points.map((p) => p.label),
    datasets: [
      {
        label: 'Evaluation Score',
        data: points.map((p) => Math.round(p.score * 10) / 10),
        borderColor: '#2563eb',
        backgroundColor: (context: { chart: { ctx: CanvasRenderingContext2D } }) => {
          const ctx = context.chart.ctx
          const gradient = ctx.createLinearGradient(0, 0, 0, 240)
          gradient.addColorStop(0, 'rgba(37, 99, 235, 0.22)')
          gradient.addColorStop(1, 'rgba(37, 99, 235, 0.0)')
          return gradient
        },
        borderWidth: 2.5,
        pointBackgroundColor: '#2563eb',
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6,
        fill: true,
        tension: 0.35,
      },
    ],
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#0f172a',
        titleColor: '#ffffff',
        bodyColor: '#cbd5e1',
        padding: 10,
        cornerRadius: 8,
        displayColors: false,
        callbacks: {
          label: function (context: { parsed: { y: number | null } }) {
            return `Score: ${context.parsed.y ?? 0}%`
          },
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        max: 100,
        border: { dash: [4, 4] },
        grid: { color: 'rgba(226, 232, 240, 0.6)' },
        ticks: { color: '#94a3b8', stepSize: 20, font: { size: 11, family: 'Inter' } },
      },
      x: {
        grid: { display: false },
        ticks: { color: '#94a3b8', font: { size: 11, family: 'Inter' } },
      },
    },
    interaction: { intersect: false, mode: 'index' as const },
  }

  return (
    <div style={{ height: '260px', width: '100%' }}>
      <Line ref={chartRef} data={data} options={options} />
    </div>
  )
}
