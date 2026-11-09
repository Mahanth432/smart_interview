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

export const ScoreChart = () => {
  const chartRef = useRef<ChartJS<'line'>>(null)

  const data = {
    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    datasets: [
      {
        label: 'Candidate Score',
        data: [72, 75, 78, 85, 82, 88, 89],
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
        tension: 0.4,
      },
    ],
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        backgroundColor: '#0f172a',
        titleColor: '#ffffff',
        bodyColor: '#cbd5e1',
        padding: 10,
        cornerRadius: 8,
        displayColors: false,
        callbacks: {
          label: function(context: { parsed: { y: number | null } }) {
            return `Score: ${context.parsed.y ?? 0}%`;
          },
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        max: 100,
        border: { dash: [4, 4] },
        grid: {
          color: 'rgba(226, 232, 240, 0.6)',
        },
        ticks: {
          color: '#94a3b8',
          stepSize: 20,
          font: { size: 11, family: 'Inter' },
        },
      },
      x: {
        grid: {
          display: false,
        },
        ticks: {
          color: '#94a3b8',
          font: { size: 11, family: 'Inter' },
        },
      },
    },
    interaction: {
      intersect: false,
      mode: 'index' as const,
    },
  }

  return (
    <div style={{ height: '100%', width: '100%' }}>
      <Line ref={chartRef} data={data} options={options} />
    </div>
  )
}
