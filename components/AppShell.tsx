'use client'

import React from 'react'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { InterviewStateProvider } from './providers/InterviewStateProvider'
import { SystemHealthBadge } from './SystemHealthBadge'

interface AppShellProps {
  children: React.ReactNode
  username?: string
  role?: string
}

export const AppShell = ({ children, username, role }: AppShellProps) => {
  return (
    <InterviewStateProvider>
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--zentra-bg-canvas)' }}>
        <Header username={username} role={role} />
        <div className="app-container" style={{ display: 'flex', flex: 1, minHeight: 'calc(100vh - 72px - 40px)', position: 'relative' }}>
          <Sidebar role={role} />
          <main className="main-content" style={{
            flex: 1,
            minWidth: 0,
            overflowY: 'auto',
            background: 'var(--zentra-bg-canvas)',
            display: 'flex',
            flexDirection: 'column',
          }}>
            {children}
          </main>
        </div>
        <footer className="app-footer no-print" style={{
          height: '40px',
          background: 'var(--zentra-bg-surface)',
          borderTop: '1px solid var(--zentra-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 2rem',
          fontSize: '0.75rem',
          color: 'var(--zentra-text-muted)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>SmartInterview AI Platform &bull; v2.0</span>
          </div>

          {role === 'ADMIN' ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{
                  background: 'rgba(37, 99, 235, 0.08)',
                  color: '#2563eb',
                  padding: '2px 8px',
                  borderRadius: '9999px',
                  fontWeight: 600,
                  fontSize: '0.7rem'
                }}>
                  LLM + RAG Engine
                </span>
              </div>
              <SystemHealthBadge variant="footer" />
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span>&copy; {new Date().getFullYear()} SmartInterview</span>
            </div>
          )}
        </footer>
      </div>
    </InterviewStateProvider>
  )
}
