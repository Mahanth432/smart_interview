'use client'

import React, { useEffect, useState, useCallback } from 'react'
import Icon from '@/components/Icon'

type Doc = {
  id: number
  name: string
  originalFilename: string
  fileType: string
  fileSize: number
  status: string
  docSource: string
  adminDocId: number | null
  createdAt: string
  updatedAt: string
  chunkCount: number
}

export const KnowledgeBaseClient = () => {
  const [docs, setDocs] = useState<Doc[]>([])
  const [loading, setLoading] = useState(false)
  const [fetchingKB, setFetchingKB] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [adminKBStatus, setAdminKBStatus] = useState<{
    adminDocCount: number
    syncedDocCount: number
    latestAdminUpdate: string | null
  } | null>(null)

  const fetchDocs = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/documents', { cache: 'no-store', credentials: 'include' })
      const data = await res.json()
      if (res.ok) {
        setDocs(data.documents || [])
      } else {
        setError(data.error || 'Failed to fetch documents')
      }
    } catch {
      setError('Failed to fetch documents')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchAdminKBStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/knowledge-base/fetch', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setAdminKBStatus({
          adminDocCount: data.adminDocCount ?? 0,
          syncedDocCount: data.syncedDocCount ?? 0,
          latestAdminUpdate: data.latestAdminUpdate ?? null,
        })
      }
    } catch {
      // Non-critical, ignore
    }
  }, [])

  const fetchedRef = React.useRef(false)

  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true
    fetchDocs()
    fetchAdminKBStatus()
  }, [fetchDocs, fetchAdminKBStatus])

  const handleFetchKB = async () => {
    if (!confirm('This will sync the latest Admin Knowledge Base documents to your account. Your private documents will NOT be affected. Continue?')) return
    setFetchingKB(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch('/api/knowledge-base/fetch', {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json()
      if (res.ok && data.success) {
        setSuccess(data.message)
        await fetchDocs()
        await fetchAdminKBStatus()
      } else {
        setError(data.error || 'Fetch failed')
      }
    } catch {
      setError('Failed to fetch Knowledge Base')
    } finally {
      setFetchingKB(false)
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return

    setError(null)
    setSuccess(null)
    setLoading(true)

    let successCount = 0
    let failCount = 0

    for (const file of files) {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('title', file.name)

      try {
        const res = await fetch('/api/documents', { method: 'POST', body: fd, credentials: 'include' })
        if (res.ok) {
          successCount++
        } else {
          failCount++
        }
      } catch {
        failCount++
      }
    }

    if (successCount === files.length) {
      setSuccess(`Successfully uploaded ${successCount} document(s) — processing in background...`)
    } else if (successCount > 0) {
      setSuccess(`Uploaded ${successCount} document(s), but ${failCount} failed.`)
    } else {
      setError('Upload failed for all documents.')
    }

    e.target.value = ''
    fetchDocs()
    setTimeout(() => fetchDocs(), 2000)
    setTimeout(() => fetchDocs(), 5000)
    setLoading(false)
  }

  const onDelete = async (id: number, docSource: string) => {
    const label = docSource === 'SYNCED_FROM_ADMIN' ? 'Remove this synced admin document from your KB?' : 'Delete this document and all its chunks?'
    if (!confirm(label)) return
    setLoading(true)
    try {
      const res = await fetch(`/api/documents/${id}`, { method: 'DELETE', credentials: 'include' })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Delete failed')
      } else {
        await fetchDocs()
      }
    } catch {
      setError('Delete failed')
    } finally {
      setLoading(false)
    }
  }

  const fmtSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const statusBadge = (status: string) => {
    const map: Record<string, { cls: string; label: string }> = {
      UPLOADED: { cls: 'zentra-badge-info', label: 'Uploaded' },
      PROCESSING: { cls: 'zentra-badge-warning', label: 'Processing' },
      PROCESSED: { cls: 'zentra-badge-success', label: 'Processed' },
      FAILED: { cls: 'zentra-badge-error', label: 'Failed' },
    }
    const item = map[status] || { cls: 'zentra-badge-neutral', label: status }
    return <span className={`zentra-badge ${item.cls}`}>{item.label}</span>
  }

  const sourceBadge = (docSource: string) => {
    if (docSource === 'SYNCED_FROM_ADMIN') {
      return (
        <span className="zentra-badge zentra-badge-info" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          <Icon name="cloud_download" size={13} /> Admin Master
        </span>
      )
    }
    return (
      <span className="zentra-badge zentra-badge-neutral" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
        <Icon name="lock" size={13} /> Private
      </span>
    )
  }

  const privateDocs = docs.filter(d => d.docSource === 'INTERVIEWER_PRIVATE')
  const syncedDocs = docs.filter(d => d.docSource === 'SYNCED_FROM_ADMIN')
  const totalChunks = docs.reduce((acc, doc) => acc + doc.chunkCount, 0)
  const totalSize = privateDocs.reduce((acc, doc) => acc + doc.fileSize, 0)
  const processedDocs = docs.filter(d => d.status === 'PROCESSED').length

  return (
    <div style={{ maxWidth: '1440px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
      {/* Header Section */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1.25rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.35rem' }}>
            <h1 className="zentra-page-title" style={{ margin: 0 }}>Knowledge Base</h1>
            <span className="zentra-badge zentra-badge-neutral">RAG Corpus</span>
          </div>
          <p className="zentra-page-subtitle" style={{ margin: 0 }}>
            Manage private technical documents and sync the Admin Master KB for contextual AI question generation.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          {/* Fetch Knowledge Base pill */}
          <button
            onClick={handleFetchKB}
            disabled={fetchingKB || loading}
            className="zentra-btn zentra-btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', opacity: fetchingKB ? 0.7 : 1 }}
          >
            <Icon name="cloud_download" size={16} />
            {fetchingKB ? 'Syncing...' : 'Fetch Knowledge Base'}
          </button>

          {/* Upload Document pill */}
          <label
            className="zentra-btn zentra-btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', cursor: loading ? 'not-allowed' : 'pointer' }}
          >
            <Icon name="upload" size={16} />
            Upload Private Document(s)
            <input
              type="file"
              multiple
              accept=".pdf,.txt,.md,.doc,.docx"
              style={{ display: 'none' }}
              onChange={handleFileChange}
              disabled={loading}
            />
          </label>
        </div>
      </div>

      {/* Admin KB Status Banner */}
      {adminKBStatus && (
        <div
          className="zentra-card"
          style={{
            padding: '1rem 1.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '1rem',
            background: 'var(--color-bg-secondary)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '10px',
                background: 'rgba(59, 130, 246, 0.1)',
                color: '#3b82f6',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="sync" size={20} />
            </div>
            <div>
              <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                Admin Master KB: {adminKBStatus.adminDocCount} available document{adminKBStatus.adminDocCount !== 1 ? 's' : ''}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                You have {syncedDocs.length} synced locally into your interviewer context
              </div>
            </div>
          </div>

          {adminKBStatus.latestAdminUpdate && (
            <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
              Master KB updated: {new Date(adminKBStatus.latestAdminUpdate).toLocaleDateString()}
            </span>
          )}
        </div>
      )}

      {/* Error & Success Feedback */}
      {error && (
        <div className="zentra-card" style={{ padding: '0.9rem 1.25rem', borderColor: 'rgba(239, 68, 68, 0.25)', background: 'rgba(239, 68, 68, 0.05)', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.875rem' }}>
          <Icon name="error" size={18} />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="zentra-card" style={{ padding: '0.9rem 1.25rem', borderColor: 'rgba(16, 185, 129, 0.25)', background: 'rgba(16, 185, 129, 0.05)', color: '#10b981', display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.875rem' }}>
          <Icon name="check_circle" size={18} />
          <span>{success}</span>
        </div>
      )}

      {/* Stats Cards Section */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
        <div className="zentra-card zentra-metric-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="zentra-metric-label">Private Docs</span>
            <span style={{ color: 'var(--color-text-muted)' }}><Icon name="lock" size={18} /></span>
          </div>
          <div className="zentra-metric-value">{privateDocs.length}</div>
          <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>Your uploaded materials</span>
        </div>

        <div className="zentra-card zentra-metric-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="zentra-metric-label">Synced Admin</span>
            <span style={{ color: '#3b82f6' }}><Icon name="cloud_download" size={18} /></span>
          </div>
          <div className="zentra-metric-value">{syncedDocs.length}</div>
          <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>From Admin Master KB</span>
        </div>

        <div className="zentra-card zentra-metric-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="zentra-metric-label">Total Chunks</span>
            <span style={{ color: '#10b981' }}><Icon name="memory" size={18} /></span>
          </div>
          <div className="zentra-metric-value">{totalChunks}</div>
          <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>Vectorized for RAG</span>
        </div>

        <div className="zentra-card zentra-metric-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="zentra-metric-label">Storage Size</span>
            <span style={{ color: '#f59e0b' }}><Icon name="description" size={18} /></span>
          </div>
          <div className="zentra-metric-value">{fmtSize(totalSize)}</div>
          <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>Private uploads volume</span>
        </div>

        <div className="zentra-card zentra-metric-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="zentra-metric-label">Processed</span>
            <span style={{ color: '#10b981' }}><Icon name="check_circle" size={18} /></span>
          </div>
          <div className="zentra-metric-value">{processedDocs}</div>
          <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>RAG-ready documents</span>
        </div>
      </div>

      {/* Table Section */}
      <div className="zentra-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.25rem 1.75rem', borderBottom: '1px solid var(--color-border-subtle)' }}>
          <div>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 600, margin: 0, color: 'var(--color-text-primary)' }}>
              Knowledge Documents ({docs.length})
            </h2>
            <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
              Documents available for dynamic question generation during live interviews
            </p>
          </div>

          <button
            onClick={fetchDocs}
            disabled={loading}
            className="zentra-btn zentra-btn-ghost"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.825rem' }}
          >
            <Icon name="refresh" size={15} /> Refresh
          </button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="zentra-table">
            <thead>
              <tr>
                <th style={{ width: '30%' }}>File Name</th>
                <th>Source</th>
                <th>Type</th>
                <th>Size</th>
                <th>Chunks</th>
                <th>Uploaded</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {docs.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: '3.5rem 1.5rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                      <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'var(--color-bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)' }}>
                        <Icon name="description" size={24} />
                      </div>
                      <div style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>No documents in your knowledge base</div>
                      <div style={{ fontSize: '0.85rem' }}>Upload private technical documents or click &ldquo;Fetch Knowledge Base&rdquo; to sync admin docs.</div>
                    </div>
                  </td>
                </tr>
              ) : (
                docs.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(99, 102, 241, 0.08)', color: '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Icon name="description" size={17} />
                        </div>
                        <span style={{ fontWeight: 600, color: 'var(--color-text-primary)', fontSize: '0.875rem' }}>
                          {d.originalFilename}
                        </span>
                      </div>
                    </td>
                    <td>{sourceBadge(d.docSource)}</td>
                    <td>
                      <span className="zentra-badge zentra-badge-neutral" style={{ fontSize: '0.72rem' }}>
                        {d.fileType.replace('.', '').toUpperCase()}
                      </span>
                    </td>
                    <td style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}>
                      {fmtSize(d.fileSize)}
                    </td>
                    <td>
                      <span style={{ fontWeight: 600, color: 'var(--color-text-primary)', fontSize: '0.85rem' }}>
                        {d.chunkCount}
                      </span>
                    </td>
                    <td style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
                      {new Date(d.createdAt).toLocaleDateString()}
                    </td>
                    <td>{statusBadge(d.status)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        onClick={() => onDelete(d.id, d.docSource)}
                        disabled={loading}
                        className="zentra-btn zentra-btn-ghost"
                        style={{ padding: '6px 10px', color: '#ef4444' }}
                        title={d.docSource === 'SYNCED_FROM_ADMIN' ? 'Remove from your KB' : 'Delete document'}
                      >
                        <Icon name="delete" size={16} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default KnowledgeBaseClient
