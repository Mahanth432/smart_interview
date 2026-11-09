'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useToast } from '@/components/providers/ToastProvider'
import { useTheme } from '@/components/providers/ThemeProvider'
import Icon from '@/components/Icon'
import { formatInterviewerName } from '@/lib/formatters'

interface HeaderProps {
  username?: string
  role?: string
}

export const Header = ({ username = 'User', role = 'INTERVIEWER' }: HeaderProps) => {
  const router = useRouter()
  const { showToast } = useToast()
  const { isDark, toggleTheme } = useTheme()

  const handleLogout = async () => {
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' })
      if (res.ok) {
        router.push('/login')
      } else {
        showToast('Logout failed', 'error')
      }
    } catch (_error) {
      showToast('Logout error', 'error')
    }
  }

  const roleLabel = role === 'CANDIDATE' ? 'Candidate' : role === 'ADMIN' ? 'Administrator' : 'Lead Recruiter'
  const displayName = formatInterviewerName({ username })
  const homeHref = role === 'ADMIN' ? '/admin' : role === 'CANDIDATE' ? '/candidate' : '/dashboard'

  return (
    <header className="app-header no-print" style={{
      height: '72px',
      background: 'var(--zentra-bg-surface)',
      borderBottom: '1px solid var(--zentra-border)',
      padding: '0 1.75rem',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      position: 'sticky',
      top: 0,
      zIndex: 100,
    }}>
      {/* Left: Zentra Brand Monogram + Title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <Link href={homeHref} style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', textDecoration: 'none' }}>
          {/* Zentra orange squircle icon */}
          <div style={{
            width: '32px',
            height: '32px',
            borderRadius: '9px',
            background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(249, 115, 22, 0.3)',
            color: '#ffffff',
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem' }}>
            <span style={{
              fontSize: '1.25rem',
              fontWeight: 800,
              letterSpacing: '-0.03em',
              color: 'var(--zentra-text-primary)',
              fontFamily: 'Inter, sans-serif'
            }}>smartinterview</span>
          </div>
        </Link>

        {/* Portal Badge */}
        <span style={{
          background: role === 'CANDIDATE' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(37, 99, 235, 0.08)',
          color: role === 'CANDIDATE' ? '#059669' : '#2563eb',
          border: `1px solid ${role === 'CANDIDATE' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(37, 99, 235, 0.18)'}`,
          padding: '0.2rem 0.65rem',
          borderRadius: '9999px',
          fontSize: '0.725rem',
          fontWeight: 600,
          textTransform: 'capitalize',
        }}>
          {role.toLowerCase()} portal
        </span>
      </div>

      {/* Spacer to push right-side actions to the end */}
      <div style={{ flex: 1 }} />

      {/* Right: Actions, Theme Toggle, User Profile */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        {/* Theme Toggle — Sun (light) / Moon (dark) */}
        <button
          onClick={toggleTheme}
          title={isDark ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
          aria-label={isDark ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
          data-testid="theme-toggle"
          style={{
            width: '38px',
            height: '38px',
            borderRadius: '50%',
            background: isDark ? 'rgba(255,255,255,0.08)' : 'var(--zentra-bg-muted)',
            border: '1px solid var(--zentra-border)',
            color: isDark ? '#f8fafc' : '#475569',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'background 0.2s, color 0.2s, border-color 0.2s',
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.14)' : 'var(--zentra-bg-hover)'
            e.currentTarget.style.borderColor = 'var(--zentra-border-hover)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.08)' : 'var(--zentra-bg-muted)'
            e.currentTarget.style.borderColor = 'var(--zentra-border)'
          }}
        >
          {isDark ? (
            /* Sun icon – shown in dark mode to switch to light */
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            /* Moon icon – shown in light mode to switch to dark */
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>

        {/* User Pill Capsule */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.65rem',
          padding: '0.35rem 0.75rem 0.35rem 0.4rem',
          borderRadius: '9999px',
          background: 'var(--zentra-bg-surface)',
          border: '1px solid var(--zentra-border)',
          boxShadow: '0 1px 3px rgba(15,23,42,0.03)',
        }}>
          <div style={{
            width: '30px',
            height: '30px',
            borderRadius: '50%',
            background: role === 'CANDIDATE' ? 'linear-gradient(135deg, #10b981, #059669)' : 'linear-gradient(135deg, #4f46e5, #3b82f6)',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: '0.8rem',
          }}>
            {displayName[0] ? displayName[0].toUpperCase() : 'U'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', textAlign: 'left', lineHeight: 1.15 }}>
            <span style={{ fontSize: '0.825rem', fontWeight: 600, color: 'var(--zentra-text-primary)' }}>{displayName}</span>
            <span style={{ fontSize: '0.7rem', color: 'var(--zentra-text-muted)' }}>{roleLabel}</span>
          </div>
        </div>

        {/* Logout Pill */}
        <button
          onClick={handleLogout}
          title="Sign out"
          style={{
            height: '36px',
            padding: '0 0.85rem',
            borderRadius: '9999px',
            background: 'var(--zentra-bg-muted)',
            border: '1px solid var(--zentra-border)',
            color: 'var(--zentra-text-secondary)',
            fontSize: '0.8rem',
            fontWeight: 500,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
        >
          <Icon name="logout" size={16} />
          <span>Exit</span>
        </button>
      </div>
    </header>
  )
}
