'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import Icon from '@/components/Icon'

interface SidebarProps {
  role?: string
}

export const Sidebar = ({ role = 'INTERVIEWER' }: SidebarProps) => {
  const [collapsed, setCollapsed] = useState(false)
  const pathname = usePathname()

  const navItems = role === 'CANDIDATE' ? [
    { href: '/candidate', icon: 'dashboard', text: 'My Results' },
    { href: '/report', icon: 'description', text: 'My Reports' },
    { href: '/settings', icon: 'settings', text: 'Settings' },
  ] : [
    { href: '/dashboard', icon: 'dashboard', text: 'Overview Hub' },
    { href: '/interview', icon: 'mic', text: 'Live Interview' },
    { href: '/candidate', icon: 'person', text: 'Candidates' },
    { href: '/suggestions', icon: 'lightbulb', text: 'Question Bank' },
    { href: '/report', icon: 'analytics', text: 'Reports' },
    { href: '/knowledge-base', icon: 'library_books', text: 'Knowledge Base' },
    { href: '/settings', icon: 'settings', text: 'Settings' },
  ]

  return (
    <aside
      className={`sidebar ${collapsed ? 'collapsed' : ''}`}
      id="sidebar"
      style={{
        width: collapsed ? '76px' : '250px',
        background: 'var(--zentra-bg-surface)',
        borderRight: '1px solid var(--zentra-border)',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        position: 'relative',
        zIndex: 50,
      }}
    >
      {/* Top Toggle Button */}
      <div style={{
        padding: '1rem',
        display: 'flex',
        justifyContent: collapsed ? 'center' : 'flex-end',
        alignItems: 'center',
        borderBottom: '1px solid var(--zentra-border-subtle)',
      }}>
        <button
          onClick={() => setCollapsed(!collapsed)}
          aria-label="Toggle sidebar"
          className="sidebar-toggle-btn"
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
            transition: 'all 0.2s',
          }}
        >
          <Icon name={collapsed ? 'chevron_right' : 'chevron_left'} size={18} />
        </button>
      </div>

      {/* Pill Navigation List */}
      <nav className="sidebar-nav" style={{ flex: 1, padding: '1rem 0.75rem', overflowY: 'auto' }}>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          {navItems.map((item) => {
            // Strip query string for base path comparison
            const itemBasePath = item.href.split('?')[0]
            // For /report paths, also match /report/[id] sub-pages
            const isActive = pathname === itemBasePath ||
              (itemBasePath === '/report' && pathname.startsWith('/report/'))
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  prefetch={true}
                  title={collapsed ? item.text : undefined}
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
                    transition: 'all 0.2s ease',
                    background: isActive ? 'var(--zentra-pill-active-bg)' : 'transparent',
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
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: isActive ? 'inherit' : 'var(--zentra-text-muted)',
                  }}>
                    <Icon name={item.icon} size={19} />
                  </div>
                  {!collapsed && (
                    <span className="nav-text" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {item.text}
                    </span>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* System Status Footnote Card - Admin / Interviewer internal readiness */}
      {!collapsed && role !== 'CANDIDATE' && (
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
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--zentra-text-primary)' }}>RAG Pipeline</span>
              </div>
              <span style={{ fontSize: '0.7rem', color: '#10b981', fontWeight: 600 }}>Active</span>
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--zentra-text-muted)' }}>Adaptive Engine Ready</div>
          </div>
        </div>
      )}
    </aside>
  )
}
