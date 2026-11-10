'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Icon from '@/components/Icon'

interface UserItem {
  id: number
  username: string
  email: string | null
  name: string | null
  role: string
  emailVerified: boolean
  createdAt: string
  _count: {
    sessions: number
    documents: number
  }
  candidate?: {
    _count: {
      sessions: number
    }
  } | null
}

interface DeletionPreview {
  user: {
    id: number
    username: string
    email: string | null
    name: string | null
    role: string
  }
  impact: {
    documentCount: number
    privateDocumentCount: number
    syncedDocumentCount: number
    adminMasterDocumentCount: number
    totalChunks: number
    candidateSessionCount: number
    interviewerSessionCount: number
    deletableB2ObjectCount: number
    preservedSharedB2ObjectCount: number
  }
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserItem[]>([])
  const [currentUserId, setCurrentUserId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [role, setRole] = useState('ALL')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalUsers, setTotalUsers] = useState(0)

  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Delete confirmation modal state
  const [deleteTarget, setDeleteTarget] = useState<UserItem | null>(null)
  const [deletePreview, setDeletePreview] = useState<DeletionPreview | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [retryableFailure, setRetryableFailure] = useState(false)

  // Create modal state
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({
    username: '',
    email: '',
    name: '',
    password: '',
    role: 'INTERVIEWER',
  })
  const [createError, setCreateError] = useState('')
  const [creating, setCreating] = useState(false)

  // Edit modal state
  const [editTarget, setEditTarget] = useState<UserItem | null>(null)
  const [editForm, setEditForm] = useState({
    username: '',
    email: '',
    name: '',
    role: 'INTERVIEWER',
  })
  const [editError, setEditError] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

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
        setCurrentUserId(data.currentUserId ?? null)
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

  const openDeleteModal = async (user: UserItem) => {
    setDeleteTarget(user)
    setDeletePreview(null)
    setDeleteError('')
    setRetryableFailure(false)
    setLoadingPreview(true)
    try {
      const res = await fetch(`/api/admin/users/${user.id}`)
      const data = await res.json()
      if (!res.ok) {
        setDeleteError(data.error || 'Failed to load deletion impact summary.')
      } else {
        setDeletePreview(data)
      }
    } catch {
      setDeleteError('Network error while checking user documents.')
    } finally {
      setLoadingPreview(false)
    }
  }

  const closeDeleteModal = () => {
    if (deleting) return
    setDeleteTarget(null)
    setDeletePreview(null)
    setDeleteError('')
    setRetryableFailure(false)
  }

  const confirmDeleteUser = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError('')
    try {
      const res = await fetch(`/api/admin/users/${deleteTarget.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) {
        setRetryableFailure(Boolean(data.retryable))
        setDeleteError(data.message || data.error || 'Failed to delete user.')
        if (data.partialFailure) {
          fetchUsers()
        }
        return
      }

      const docsRemoved = data.deletedDocuments ?? 0
      const b2Removed = Array.isArray(data.deletedB2Keys) ? data.deletedB2Keys.length : 0
      const sharedKept = Array.isArray(data.preservedSharedKeys) ? data.preservedSharedKeys.length : 0
      setBanner({
        type: 'success',
        text: `${data.message} Removed ${docsRemoved} document(s) and ${b2Removed} private B2 object(s)${sharedKept > 0 ? ` (preserved ${sharedKept} shared object(s))` : ''}.`,
      })
      setDeleteTarget(null)
      setDeletePreview(null)
      fetchUsers()
    } catch {
      setDeleteError('Network error while deleting user.')
    } finally {
      setDeleting(false)
    }
  }

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateError('')
    setCreating(true)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: createForm.username.trim(),
          email: createForm.email.trim().toLowerCase(),
          name: createForm.name.trim(),
          password: createForm.password,
          role: createForm.role,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setCreateError(data.error || 'Failed to create user.')
        return
      }
      setShowCreate(false)
      setCreateForm({ username: '', email: '', name: '', password: '', role: 'INTERVIEWER' })
      setBanner({ type: 'success', text: `Created user "${data.user.username}" (${data.user.role}).` })
      fetchUsers()
    } catch {
      setCreateError('Network error while creating user.')
    } finally {
      setCreating(false)
    }
  }

  const openEditModal = (user: UserItem) => {
    setEditTarget(user)
    setEditForm({
      username: user.username,
      email: user.email || '',
      name: user.name || '',
      role: user.role,
    })
    setEditError('')
  }

  const handleEditUser = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editTarget) return
    setEditError('')
    setSavingEdit(true)
    try {
      const res = await fetch(`/api/admin/users/${editTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: editForm.username.trim(),
          email: editForm.email.trim().toLowerCase(),
          name: editForm.name.trim(),
          role: editForm.role,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setEditError(data.error || 'Failed to update user.')
        return
      }
      setEditTarget(null)
      setBanner({ type: 'success', text: `Updated user "${data.user.username}".` })
      fetchUsers()
    } catch {
      setEditError('Network error while updating user.')
    } finally {
      setSavingEdit(false)
    }
  }

  const modalOverlayStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.65)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '1rem',
  }

  const modalCardStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: '480px',
    padding: '1.5rem',
    borderRadius: '14px',
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

        <div className="zentra-header-actions" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <div className="zentra-date-pill">
            <Icon name="people" size={16} style={{ color: 'var(--zentra-text-muted)' }} />
            <span>Total Accounts: <strong>{totalUsers}</strong></span>
          </div>
          <button
            type="button"
            onClick={() => { setCreateError(''); setShowCreate(true) }}
            className="zentra-btn zentra-btn-primary"
          >
            <Icon name="person_add" size={16} />
            <span>Create User</span>
          </button>
        </div>
      </div>

      {banner && (
        <div
          className="zentra-card"
          style={{
            padding: '0.85rem 1.15rem',
            marginBottom: '1rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderColor: banner.type === 'success' ? '#10b981' : '#ef4444',
            color: banner.type === 'success' ? '#10b981' : '#ef4444',
          }}
        >
          <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{banner.text}</span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}

      {/* Toolbar Filter Card */}
      <div className="zentra-card" style={{ padding: '1rem 1.25rem', marginBottom: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: '240px', position: 'relative' }}>
          <input
            type="text"
            placeholder="Search by username, email, or name..."
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
            <option value="CANDIDATE">CANDIDATE</option>
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
                <th style={{ width: '70px' }}>ID</th>
                <th>User</th>
                <th>Email</th>
                <th>Role</th>
                <th>Sessions</th>
                <th>Documents</th>
                <th>Joined Date</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} style={{ padding: '3.5rem', textAlign: 'center', color: 'var(--zentra-text-muted)' }}>
                    Loading platform users...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: '3.5rem', textAlign: 'center', color: 'var(--zentra-text-muted)' }}>
                    No users match your search criteria.
                  </td>
                </tr>
              ) : (
                users.map((user) => {
                  const isAdmin = user.role === 'ADMIN'
                  const isSelf = currentUserId === user.id
                  const totalSessions = user._count.sessions + (user.candidate?._count.sessions ?? 0)
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
                            background: isAdmin
                              ? 'linear-gradient(135deg, #ef4444, #f97316)'
                              : user.role === 'CANDIDATE'
                                ? 'linear-gradient(135deg, #059669, #10b981)'
                                : 'linear-gradient(135deg, #4f46e5, #3b82f6)',
                            color: '#ffffff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '0.85rem',
                            fontWeight: 700,
                            flexShrink: 0,
                          }}>
                            {user.username.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, color: 'var(--zentra-text-primary)' }}>
                              {user.username}
                              {user.username.includes('@') && (
                                <span
                                  title="Legacy email-format username"
                                  style={{
                                    marginLeft: '0.4rem',
                                    fontSize: '0.7rem',
                                    color: '#f59e0b',
                                    fontWeight: 500,
                                  }}
                                >
                                  (legacy)
                                </span>
                              )}
                            </div>
                            {user.name && (
                              <div style={{ fontSize: '0.76rem', color: 'var(--zentra-text-muted)' }}>
                                {user.name}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        <div style={{ fontSize: '0.825rem', color: 'var(--zentra-text-secondary)' }}>
                          {user.email || <span style={{ color: 'var(--zentra-text-muted)' }}>—</span>}
                        </div>
                      </td>
                      <td>
                        <span className={`zentra-badge ${isAdmin ? 'danger' : user.role === 'CANDIDATE' ? 'success' : 'info'}`}>
                          {user.role}
                        </span>
                      </td>
                      <td>
                        <span className="zentra-pill-tag">
                          {totalSessions} sessions
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
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '0.4rem' }}>
                          <button
                            type="button"
                            onClick={() => openEditModal(user)}
                            className="zentra-btn zentra-btn-secondary"
                            style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem' }}
                            title="Edit user"
                          >
                            <Icon name="edit" size={14} />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            disabled={isSelf}
                            onClick={() => openDeleteModal(user)}
                            className="zentra-btn zentra-btn-secondary"
                            style={{
                              padding: '0.3rem 0.65rem',
                              fontSize: '0.78rem',
                              color: isSelf ? 'var(--zentra-text-muted)' : '#ef4444',
                              borderColor: isSelf ? undefined : 'rgba(239,68,68,0.35)',
                            }}
                            title={isSelf ? 'Cannot delete your own account' : 'Delete user and owned documents'}
                          >
                            <Icon name="delete" size={14} />
                            <span>Delete</span>
                          </button>
                        </div>
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

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div style={modalOverlayStyle}>
          <div className="zentra-card" style={modalCardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '0.75rem', color: '#ef4444' }}>
              <Icon name="warning" size={22} />
              <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Confirm User Deletion</h2>
            </div>

            <p style={{ fontSize: '0.875rem', color: 'var(--zentra-text-secondary)', margin: '0 0 1rem 0', lineHeight: 1.5 }}>
              You are about to permanently delete user <strong>{deleteTarget.username}</strong> (#{deleteTarget.id},{' '}
              {deleteTarget.role}
              {deleteTarget.email ? `, ${deleteTarget.email}` : ''}).
            </p>

            {loadingPreview ? (
              <div style={{ padding: '0.9rem', borderRadius: '8px', background: 'rgba(148,163,184,0.08)', fontSize: '0.84rem', marginBottom: '1rem' }}>
                Inspecting owned documents and storage references...
              </div>
            ) : deletePreview ? (
              <div style={{ padding: '0.9rem 1rem', borderRadius: '8px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', fontSize: '0.84rem', marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                <div>
                  <strong>Documents to delete:</strong> {deletePreview.impact.documentCount} document(s) ({deletePreview.impact.totalChunks} chunk(s))
                </div>
                {deletePreview.impact.documentCount > 0 && (
                  <div style={{ color: 'var(--zentra-text-muted)', fontSize: '0.78rem' }}>
                    Private: {deletePreview.impact.privateDocumentCount} · Synced from Admin: {deletePreview.impact.syncedDocumentCount} · Admin Master: {deletePreview.impact.adminMasterDocumentCount}
                  </div>
                )}
                <div style={{ color: 'var(--zentra-text-muted)', fontSize: '0.78rem' }}>
                  Private B2 files removed: {deletePreview.impact.deletableB2ObjectCount} · Shared B2 objects preserved: {deletePreview.impact.preservedSharedB2ObjectCount}
                </div>
                {(deletePreview.impact.candidateSessionCount > 0 || deletePreview.impact.interviewerSessionCount > 0) && (
                  <div style={{ color: 'var(--zentra-text-muted)', fontSize: '0.78rem' }}>
                    Historical interview sessions preserved: {deletePreview.impact.candidateSessionCount + deletePreview.impact.interviewerSessionCount}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ padding: '0.9rem', borderRadius: '8px', background: 'rgba(239,68,68,0.08)', fontSize: '0.84rem', marginBottom: '1rem' }}>
                Documents to delete: <strong>{deleteTarget._count.documents}</strong>
              </div>
            )}

            {deleteError && (
              <div style={{ padding: '0.75rem', borderRadius: '8px', background: 'rgba(239,68,68,0.12)', color: '#ef4444', fontSize: '0.82rem', marginBottom: '1rem' }}>
                {deleteError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.65rem' }}>
              <button
                type="button"
                disabled={deleting}
                onClick={closeDeleteModal}
                className="zentra-btn zentra-btn-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting || loadingPreview}
                onClick={confirmDeleteUser}
                className="zentra-btn"
                style={{ background: '#ef4444', color: '#ffffff', borderColor: '#ef4444' }}
              >
                {deleting
                  ? 'Deleting…'
                  : retryableFailure
                    ? 'Retry B2 Cleanup'
                    : `Delete User (${deletePreview?.impact.documentCount ?? deleteTarget._count.documents} docs)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create User Modal */}
      {showCreate && (
        <div style={modalOverlayStyle}>
          <div className="zentra-card" style={modalCardStyle}>
            <h2 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', fontWeight: 700 }}>Create User</h2>
            <form onSubmit={handleCreateUser} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.3rem', fontWeight: 600 }}>Username</label>
                <input
                  type="text"
                  required
                  className="zentra-input"
                  placeholder="e.g. alex_johnson"
                  value={createForm.username}
                  onChange={(e) => setCreateForm((f) => ({ ...f, username: e.target.value }))}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.3rem', fontWeight: 600 }}>Email Address</label>
                <input
                  type="email"
                  required={createForm.role !== 'ADMIN'}
                  className="zentra-input"
                  placeholder="e.g. alex@example.com"
                  value={createForm.email}
                  onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.3rem', fontWeight: 600 }}>Full Name</label>
                <input
                  type="text"
                  className="zentra-input"
                  placeholder="Optional display name"
                  value={createForm.name}
                  onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.3rem', fontWeight: 600 }}>Role</label>
                <select
                  className="zentra-select"
                  value={createForm.role}
                  onChange={(e) => setCreateForm((f) => ({ ...f, role: e.target.value }))}
                >
                  <option value="INTERVIEWER">INTERVIEWER</option>
                  <option value="CANDIDATE">CANDIDATE</option>
                  <option value="ADMIN">ADMIN</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.3rem', fontWeight: 600 }}>Password</label>
                <input
                  type="password"
                  required
                  className="zentra-input"
                  placeholder="Min 8 chars, include a number or symbol"
                  value={createForm.password}
                  onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
                />
              </div>

              {createError && (
                <div style={{ padding: '0.65rem', borderRadius: '8px', background: 'rgba(239,68,68,0.12)', color: '#ef4444', fontSize: '0.82rem' }}>
                  {createError}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.65rem', marginTop: '0.35rem' }}>
                <button type="button" disabled={creating} onClick={() => setShowCreate(false)} className="zentra-btn zentra-btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={creating} className="zentra-btn zentra-btn-primary">
                  {creating ? 'Creating…' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editTarget && (
        <div style={modalOverlayStyle}>
          <div className="zentra-card" style={modalCardStyle}>
            <h2 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', fontWeight: 700 }}>Edit User #{editTarget.id}</h2>
            <form onSubmit={handleEditUser} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.3rem', fontWeight: 600 }}>Username</label>
                <input
                  type="text"
                  required
                  className="zentra-input"
                  value={editForm.username}
                  onChange={(e) => setEditForm((f) => ({ ...f, username: e.target.value }))}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.3rem', fontWeight: 600 }}>Email Address</label>
                <input
                  type="email"
                  required={editForm.role !== 'ADMIN'}
                  className="zentra-input"
                  value={editForm.email}
                  onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.3rem', fontWeight: 600 }}>Full Name</label>
                <input
                  type="text"
                  className="zentra-input"
                  value={editForm.name}
                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.3rem', fontWeight: 600 }}>Role</label>
                <select
                  className="zentra-select"
                  value={editForm.role}
                  onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value }))}
                >
                  <option value="INTERVIEWER">INTERVIEWER</option>
                  <option value="CANDIDATE">CANDIDATE</option>
                  <option value="ADMIN">ADMIN</option>
                </select>
              </div>

              {editError && (
                <div style={{ padding: '0.65rem', borderRadius: '8px', background: 'rgba(239,68,68,0.12)', color: '#ef4444', fontSize: '0.82rem' }}>
                  {editError}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.65rem', marginTop: '0.35rem' }}>
                <button type="button" disabled={savingEdit} onClick={() => setEditTarget(null)} className="zentra-btn zentra-btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={savingEdit} className="zentra-btn zentra-btn-primary">
                  {savingEdit ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
