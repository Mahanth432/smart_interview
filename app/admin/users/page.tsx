'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Icon from '@/components/Icon'

interface UserItem {
  id: number
  username: string
  role: string
  createdAt: string
  _count: {
    sessions: number
    documents: number
  }
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [role, setRole] = useState('ALL')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalUsers, setTotalUsers] = useState(0)

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (role !== 'ALL') params.set('role', role)
      params.set('page', page.toString())
      params.set('limit', '15')

      const res = await fetch(`/api/admin/users?${params.toString()}`)
      if (res.ok) {
        const data = await res.json()
        setUsers(data.users || [])
        setTotalPages(data.totalPages || 1)
        setTotalUsers(data.total || 0)
      }
    } catch (err) {
      console.error('Failed to load users:', err)
    } finally {
      setLoading(false)
    }
  }, [search, role, page])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value)
    setPage(1)
  }

  const handleRoleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setRole(e.target.value)
    setPage(1)
  }

  return (
    <div className="zentra-page-container">
      {/* Header */}
      <div className="zentra-page-header">
        <div>
          <div className="zentra-title-row">
            <h1 className="zentra-page-title">Users</h1>
            <span className="zentra-link-bubble" title="User Directory">
              <Icon name="link" size={16} />
            </span>
          </div>
          <p className="zentra-page-subtitle">Platform accounts, role authorizations, and activity metrics.</p>
        </div>

        <div className="zentra-header-actions">
          <div className="zentra-date-pill">
            <Icon name="people" size={16} style={{ color: 'var(--zentra-text-muted)' }} />
            <span>Total Accounts: <strong>{totalUsers}</strong></span>
          </div>
        </div>
      </div>

      {/* Toolbar Filter Card */}
      <div className="zentra-card" style={{ padding: '1rem 1.25rem', marginBottom: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: '240px', position: 'relative' }}>
          <input
            type="text"
            placeholder="Search by username..."
            value={search}
            onChange={handleSearchChange}
            className="zentra-input"
            style={{ paddingLeft: '2.5rem' }}
          />
          <div style={{ position: 'absolute', left: '0.9rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--zentra-text-muted)', pointerEvents: 'none' }}>
            <Icon name="search" size={17} />
          </div>
        </div>

        <div style={{ minWidth: '160px' }}>
          <select
            value={role}
            onChange={handleRoleChange}
            className="zentra-select"
          >
            <option value="ALL">All Roles</option>
            <option value="ADMIN">ADMIN</option>
            <option value="INTERVIEWER">INTERVIEWER</option>
          </select>
        </div>

        <button
          onClick={fetchUsers}
          className="zentra-btn zentra-btn-secondary"
          title="Reload users"
        >
          <Icon name="refresh" size={16} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Users Table Card */}
      <div className="zentra-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="zentra-table">
            <thead>
              <tr>
                <th style={{ width: '80px' }}>ID</th>
                <th>User</th>
                <th>Role</th>
                <th>Sessions</th>
                <th>Documents</th>
                <th>Joined Date</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ padding: '3.5rem', textAlign: 'center', color: 'var(--zentra-text-muted)' }}>
                    Loading platform users...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '3.5rem', textAlign: 'center', color: 'var(--zentra-text-muted)' }}>
                    No users match your search criteria.
                  </td>
                </tr>
              ) : (
                users.map((user) => {
                  const isAdmin = user.role === 'ADMIN'
                  return (
                    <tr key={user.id}>
                      <td style={{ color: 'var(--zentra-text-muted)', fontSize: '0.8rem', fontWeight: 600 }}>
                        #{user.id}
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <div style={{
                            width: '34px',
                            height: '34px',
                            borderRadius: '50%',
                            background: isAdmin ? 'linear-gradient(135deg, #ef4444, #f97316)' : 'linear-gradient(135deg, #4f46e5, #3b82f6)',
                            color: '#ffffff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '0.85rem',
                            fontWeight: 700,
                          }}>
                            {user.username.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <span style={{ fontWeight: 600, color: 'var(--zentra-text-primary)' }}>{user.username}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`zentra-badge ${isAdmin ? 'danger' : 'info'}`}>
                          {user.role}
                        </span>
                      </td>
                      <td>
                        <span className="zentra-pill-tag">
                          {user._count.sessions} sessions
                        </span>
                      </td>
                      <td>
                        <span className="zentra-pill-tag">
                          {user._count.documents} docs
                        </span>
                      </td>
                      <td>
                        <span style={{ color: 'var(--zentra-text-muted)', fontSize: '0.825rem' }}>
                          {new Date(user.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                        </span>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem', borderTop: '1px solid var(--zentra-border)' }}>
            <span style={{ fontSize: '0.825rem', color: 'var(--zentra-text-muted)' }}>
              Page {page} of {totalPages}
            </span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="zentra-btn zentra-btn-secondary"
                style={{ padding: '0.35rem 0.85rem', fontSize: '0.8rem' }}
              >
                Previous
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="zentra-btn zentra-btn-secondary"
                style={{ padding: '0.35rem 0.85rem', fontSize: '0.8rem' }}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
