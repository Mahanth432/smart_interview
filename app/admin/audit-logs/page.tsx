'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Icon from '@/components/Icon'

interface AuditLogItem {
  id: string
  userId: number | null
  username: string
  action: string
  entityType: string | null
  entityId: string | null
  status: string
  metadata: Record<string, unknown> | null
  ipAddress: string | null
  userAgent: string | null
  createdAt: string
}

export default function AdminAuditLogsPage() {
  const [logs, setLogs] = useState<AuditLogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [actionFilter, setActionFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalLogs, setTotalLogs] = useState(0)
  const [selectedLog, setSelectedLog] = useState<AuditLogItem | null>(null)

  const fetchAuditLogs = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (actionFilter !== 'ALL') params.set('action', actionFilter)
      if (statusFilter !== 'ALL') params.set('status', statusFilter)
      params.set('page', page.toString())
      params.set('limit', '25')

      const res = await fetch(`/api/admin/audit-logs?${params.toString()}`)
      if (res.ok) {
        const data = await res.json()
        setLogs(data.auditLogs || [])
        setTotalPages(data.totalPages || 1)
        setTotalLogs(data.total || 0)
      }
    } catch (err) {
      console.error('Failed to load audit logs:', err)
    } finally {
      setLoading(false)
    }
  }, [search, actionFilter, statusFilter, page])

  useEffect(() => {
    fetchAuditLogs()
  }, [fetchAuditLogs])

  const getActionBadge = (action: string, status: string) => {
    let badgeClass = 'info'
    let icon = 'info'

    if (action.startsWith('AUTH_LOGIN_SUCCESS')) {
      badgeClass = 'success'
      icon = 'check_circle'
    } else if (action.startsWith('AUTH_LOGIN_FAILURE') || status === 'FAILURE') {
      badgeClass = 'danger'
      icon = 'error'
    } else if (action.startsWith('AUTH_LOGOUT')) {
      badgeClass = 'neutral'
      icon = 'logout'
    } else if (action.startsWith('INTERVIEW_')) {
      badgeClass = 'info'
      icon = 'question_answer'
    } else if (action.startsWith('KNOWLEDGE_')) {
      badgeClass = 'neutral'
      icon = 'description'
    } else if (action.startsWith('LLM_')) {
      badgeClass = 'warning'
      icon = 'smart_toy'
    }

    return (
      <span className={`zentra-badge ${badgeClass}`}>
        <Icon name={icon} size={13} />
        <span>{action}</span>
      </span>
    )
  }

  return (
    <div className="zentra-page-container">
      {/* Header */}
      <div className="zentra-page-header">
        <div>
          <div className="zentra-title-row">
            <h1 className="zentra-page-title">Audit Logs</h1>
            <span className="zentra-link-bubble" title="System Audit Records">
              <Icon name="link" size={16} />
            </span>
          </div>
          <p className="zentra-page-subtitle">Security events, authentication attempts, interview actions, and document mutations.</p>
        </div>

        <div className="zentra-header-actions">
          <div className="zentra-date-pill">
            <Icon name="history" size={16} style={{ color: 'var(--zentra-text-muted)' }} />
            <span>Total Log Records: <strong>{totalLogs}</strong></span>
          </div>
        </div>
      </div>

      {/* Toolbar Filter Card */}
      <div className="zentra-card" style={{ padding: '1rem 1.25rem', marginBottom: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: '220px', position: 'relative' }}>
          <input
            type="text"
            placeholder="Search action, username, entity..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="zentra-input"
            style={{ paddingLeft: '2.5rem' }}
          />
          <div style={{ position: 'absolute', left: '0.9rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--zentra-text-muted)', pointerEvents: 'none' }}>
            <Icon name="search" size={17} />
          </div>
        </div>

        <div style={{ minWidth: '170px' }}>
          <select
            value={actionFilter}
            onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
            className="zentra-select"
          >
            <option value="ALL">All Actions</option>
            <option value="AUTH_LOGIN_SUCCESS">AUTH: Login Success</option>
            <option value="AUTH_LOGIN_FAILURE">AUTH: Login Failure</option>
            <option value="AUTH_LOGOUT">AUTH: Logout</option>
            <option value="INTERVIEW_STARTED">INTERVIEW: Started</option>
            <option value="INTERVIEW_ENDED">INTERVIEW: Completed</option>
            <option value="KNOWLEDGE_BASE_UPLOAD">KB: Upload</option>
            <option value="KNOWLEDGE_BASE_DELETE">KB: Delete</option>
          </select>
        </div>

        <div style={{ minWidth: '140px' }}>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="zentra-select"
          >
            <option value="ALL">All Statuses</option>
            <option value="SUCCESS">Success</option>
            <option value="FAILURE">Failure</option>
          </select>
        </div>

        <button
          onClick={fetchAuditLogs}
          className="zentra-btn zentra-btn-secondary"
          title="Reload logs"
        >
          <Icon name="refresh" size={16} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Table Card */}
      <div className="zentra-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="zentra-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Action</th>
                <th>User</th>
                <th>Status</th>
                <th>Target Entity</th>
                <th>IP / Origin</th>
                <th style={{ textAlign: 'right' }}>Metadata</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ padding: '3.5rem', textAlign: 'center', color: 'var(--zentra-text-muted)' }}>
                    Loading audit trail...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '3.5rem', textAlign: 'center', color: 'var(--zentra-text-muted)' }}>
                    No audit records found matching your filters.
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const isSuccess = log.status === 'SUCCESS'
                  return (
                    <tr key={log.id}>
                      <td style={{ color: 'var(--zentra-text-muted)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                        {new Date(log.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td>
                        {getActionBadge(log.action, log.status)}
                      </td>
                      <td>
                        <span style={{ fontWeight: 600, color: 'var(--zentra-text-primary)' }}>
                          {log.username || 'System'}
                        </span>
                      </td>
                      <td>
                        <span className={`zentra-badge ${isSuccess ? 'success' : 'danger'}`}>
                          {log.status}
                        </span>
                      </td>
                      <td>
                        {log.entityType ? (
                          <span style={{ fontSize: '0.8rem', color: 'var(--zentra-text-secondary)', fontFamily: 'monospace' }}>
                            {log.entityType} {log.entityId ? `(#${log.entityId.substring(0, 6)})` : ''}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--zentra-text-muted)', fontSize: '0.8rem' }}>—</span>
                        )}
                      </td>
                      <td>
                        <span style={{ color: 'var(--zentra-text-muted)', fontSize: '0.775rem', fontFamily: 'monospace' }}>
                          {log.ipAddress || 'Internal'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {log.metadata && Object.keys(log.metadata).length > 0 ? (
                          <button
                            onClick={() => setSelectedLog(log)}
                            className="zentra-btn zentra-btn-secondary"
                            style={{ padding: '0.3rem 0.75rem', fontSize: '0.75rem' }}
                          >
                            <Icon name="description" size={14} />
                            <span>Details</span>
                          </button>
                        ) : (
                          <span style={{ color: 'var(--zentra-text-muted)', fontSize: '0.75rem' }}>—</span>
                        )}
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

      {/* Metadata Detail Modal Dialog */}
      {selectedLog && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.65)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '1rem',
          backdropFilter: 'blur(4px)',
        }}>
          <div className="zentra-card" style={{
            maxWidth: '620px',
            width: '100%',
            padding: '1.75rem',
            boxShadow: 'var(--zentra-shadow-card-hover)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 className="zentra-card-title">
                Audit Event Metadata
              </h3>
              <button
                onClick={() => setSelectedLog(null)}
                style={{ background: 'none', border: 'none', color: 'var(--zentra-text-muted)', cursor: 'pointer', fontSize: '1.25rem' }}
              >
                ✕
              </button>
            </div>

            <div style={{ marginBottom: '1rem', fontSize: '0.825rem', color: 'var(--zentra-text-secondary)', display: 'flex', gap: '1rem' }}>
              <div>Action: <strong style={{ color: 'var(--zentra-text-primary)' }}>{selectedLog.action}</strong></div>
              <div>User: <strong style={{ color: 'var(--zentra-text-primary)' }}>{selectedLog.username}</strong></div>
            </div>

            <pre style={{
              background: 'var(--zentra-bg-muted)',
              border: '1px solid var(--zentra-border)',
              borderRadius: '12px',
              padding: '1rem',
              color: 'var(--zentra-text-primary)',
              fontSize: '0.8rem',
              maxHeight: '340px',
              overflowY: 'auto',
              fontFamily: 'monospace',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}>
              {JSON.stringify(selectedLog.metadata, null, 2)}
            </pre>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
              <button
                onClick={() => setSelectedLog(null)}
                className="zentra-btn zentra-btn-secondary"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
