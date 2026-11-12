'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import Icon from '@/components/Icon'
import { useTheme } from '@/components/providers/ThemeProvider'

export default function AdminLayoutClient({
  children,
  username = 'System Admin',
}: {
  children: React.ReactNode
  username?: string
}) {
  const pathname = usePathname()
  const router = useRouter()
  const { isDark, toggleTheme } = useTheme()
  const [collapsed, setCollapsed] = useState(false)

  const handleLogout = async () => {
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' })
      if (!res.ok) {
        window.alert('Unable to sign out cleanly. Please refresh and try again.')
        return
      }
      router.push('/login')
    } catch {
      window.alert('Network error while signing out.')
    }
  }

  const navItems = [
    { name: 'Dashboard', path: '/admin', icon: 'dashboard' },
    { name: 'Users', path: '/admin/users', icon: 'people' },
    { name: 'Interviews', path: '/admin/interviews', icon: 'question_answer' },
    { name: 'Candidates', path: '/admin/candidates', icon: 'person_search' },
    { name: 'Knowledge Base', path: '/admin/knowledge-base', icon: 'library_books' },
    { name: 'Analytics', path: '/admin/analytics', icon: 'analytics' },
    { name: 'AI / LLM', path: '/admin/ai', icon: 'smart_toy' },
    { name: 'Audit Logs', path: '/admin/audit-logs', icon: 'history' },
    { name: 'Settings', path: '/admin/settings', icon: 'settings' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: 'var(--zentra-bg-canvas)', color: 'var(--zentra-text-primary)' }}>
      {/* Zentra Header Bar */}
      <header style={{
        height: '72px',
        backgroundColor: 'var(--zentra-bg-surface)',
        borderBottom: '1px solid var(--zentra-border)',
        padding: '0 2rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        {/* Left: Brand Monogram + Portal Badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link href="/admin" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', textDecoration: 'none' }}>
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
            <span style={{
              fontSize: '1.25rem',
              fontWeight: 800,
              letterSpacing: '-0.03em',
              color: 'var(--zentra-text-primary)',
              fontFamily: 'Inter, sans-serif'
            }}>smartinterview</span>
          </Link>

          <span style={{
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            color: '#dc2626',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            padding: '0.2rem 0.65rem',
            borderRadius: '9999px',
            fontSize: '0.725rem',
            fontWeight: 600,
          }}>
            admin portal
          </span>
        </div>

        {/* Right: Theme Toggle & Admin Profile Pill */}
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
              background: 'linear-gradient(135deg, #ef4444, #f97316)',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: '0.8rem',
            }}>
              {username.charAt(0).toUpperCase()}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', textAlign: 'left', lineHeight: 1.15 }}>
              <span style={{ fontSize: '0.825rem', fontWeight: 600, color: 'var(--zentra-text-primary)' }}>{username}</span>
              <span style={{ fontSize: '0.7rem', color: 'var(--zentra-text-muted)' }}>Administrator</span>
            </div>
          </div>

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

      {/* Main Layout Area */}
      <div className="app-container" style={{ display: 'flex', flex: 1 }}>
        {/* Zentra Pill Sidebar */}
        <aside className="sidebar" style={{
          width: collapsed ? '76px' : '250px',
          backgroundColor: 'var(--zentra-bg-surface)',
          borderRight: '1px solid var(--zentra-border)',
          display: 'flex',
          flexDirection: 'column',
          transition: 'width 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        }}>
          {/* Collapse Toggle */}
          <div className="sidebar-toggle-btn" style={{
            padding: '1rem',
            display: 'flex',
            justifyContent: collapsed ? 'center' : 'flex-end',
            borderBottom: '1px solid var(--zentra-border-subtle)',
          }}>
            <button
              onClick={() => setCollapsed(!collapsed)}
              aria-label="Toggle admin sidebar"
              style={{
                background: 'var(--zentra-bg-muted)',
                border: '1px solid var(--zentra-border)',
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--zentra-text-secondary)',
                cursor: 'pointer',
              }}
            >
              <Icon name={collapsed ? 'chevron_right' : 'chevron_left'} size={18} />
            </button>
          </div>

          <nav className="sidebar-nav admin-sidebar-nav" style={{ flex: 1, padding: '1rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.35rem', overflowY: 'auto' }}>
            {navItems.map((item) => {
              const isActive = pathname === item.path
              return (
                <Link
                  key={item.path}
                  href={item.path}
                  prefetch={true}
                  title={collapsed ? item.name : undefined}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: collapsed ? '0.65rem' : '0.65rem 1.15rem',
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    borderRadius: '9999px',
                    textDecoration: 'none',
                    fontSize: '0.875rem',
                    fontWeight: isActive ? 600 : 500,
                    transition: 'all 0.2s',
                    backgroundColor: isActive ? 'var(--zentra-pill-active-bg)' : 'transparent',
                    color: isActive ? 'var(--zentra-pill-active-text)' : 'var(--zentra-pill-inactive-text)',
                    boxShadow: isActive ? '0 2px 8px rgba(0,0,0,0.08)' : 'none',
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.backgroundColor = 'var(--zentra-pill-hover-bg)'
                      e.currentTarget.style.color = 'var(--zentra-text-primary)'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.backgroundColor = 'transparent'
                      e.currentTarget.style.color = 'var(--zentra-pill-inactive-text)'
                    }
                  }}
                >
                  <Icon name={item.icon} size={19} />
                  {!collapsed && <span className="nav-text">{item.name}</span>}
                </Link>
              )
            })}
          </nav>

          {!collapsed && (
            <div className="sidebar-footer" style={{ padding: '0.85rem 1rem', borderTop: '1px solid var(--zentra-border-subtle)' }}>
              <div style={{
                background: 'var(--zentra-bg-muted)',
                border: '1px solid var(--zentra-border)',
                borderRadius: '16px',
                padding: '0.75rem 1rem',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#10b981', display: 'inline-block', boxShadow: '0 0 6px #10b981' }}></span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--zentra-text-primary)' }}>System Guard</span>
                  </div>
                  <span style={{ fontSize: '0.7rem', color: '#10b981', fontWeight: 600 }}>Active</span>
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--zentra-text-muted)' }}>Admin Access Granted</div>
              </div>
            </div>
          )}
        </aside>

        {/* Main Content Area */}
        <main className="main-content" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
