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
  createdAt: string
  updatedAt: string
  chunkCount: number
  lastError?: string | null
}

export default function AdminKnowledgeBasePage() {
  const [docs, setDocs] = useState<Doc[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const fetchDocs = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/knowledge-base', { cache: 'no-store', credentials: 'include' })
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

  useEffect(() => { fetchDocs() }, [fetchDocs])

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return

    setError(null)
    setSuccess(null)
    setLoading(true)

    let successCount = 0
    let failCount = 0
    let lastUploadError = ''

    for (const file of files) {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('title', file.name)

      try {
        const res = await fetch('/api/admin/knowledge-base', { method: 'POST', body: fd, credentials: 'include' })
        if (res.ok) {
          successCount++
        } else {
          let errMsg = `HTTP ${res.status}`
          if (res.status === 413) {
            errMsg = `"${file.name}" exceeds Vercel's 4.5 MB upload payload limit.`
          } else {
            try {
              const data = await res.json()
              if (data?.error) errMsg = data.error
            } catch {}
          }
          console.error('Upload error:', errMsg)
          lastUploadError = errMsg
          failCount++
        }
      } catch {
        lastUploadError = 'Network error while uploading.'
        failCount++
      }
    }

    if (successCount === files.length) {
      setSuccess(`Successfully uploaded ${successCount} document(s) to Admin Master KB — processing in background...`)
    } else if (successCount > 0) {
      setSuccess(`Uploaded ${successCount} document(s), but ${failCount} failed.${lastUploadError ? ` (${lastUploadError})` : ''}`)
    } else {
      setError(lastUploadError || 'Upload failed for all documents.')
    }

    e.target.value = ''
    fetchDocs()
    setTimeout(() => fetchDocs(), 2000)
    setTimeout(() => fetchDocs(), 5000)
    setLoading(false)
  }

  const onDelete = async (id: number, name: string) => {
    if (!confirm(`Delete "${name}" from the Admin Master Knowledge Base?\n\nThis will remove it for all interviewers who have synced it.`)) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/knowledge-base/${id}`, { method: 'DELETE', credentials: 'include' })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Delete failed')
      } else {
        setSuccess('Document deleted from Admin Master KB.')
        await fetchDocs()
      }
    } catch {
      setError('Delete failed')
    } finally {
      setLoading(false)
    }
  }

  const onTriggerProcess = async (id: number) => {
    setLoading(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch(`/api/admin/knowledge-base/trigger-process/${id}`, { method: 'POST', credentials: 'include' })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Processing failed')
      } else {
        setSuccess(`Document processed (${data.chunkCount ?? 0} chunks indexed).`)
      }
      await fetchDocs()
    } catch {
      setError('Failed to trigger processing')
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
    switch (status) {
      case 'PROCESSED':
        return <span className="zentra-badge success">Processed</span>
      case 'PROCESSING':
        return <span className="zentra-badge warning">Processing...</span>
      case 'FAILED':
        return <span className="zentra-badge danger">Failed</span>
      default:
        return <span className="zentra-badge neutral">{status}</span>
    }
  }

  const totalChunks = docs.reduce((acc, doc) => acc + doc.chunkCount, 0)
  const processedDocs = docs.filter(d => d.status === 'PROCESSED').length
  const totalSize = docs.reduce((acc, doc) => acc + doc.fileSize, 0)

  return (
    <div className="zentra-page-container">
      {/* Header */}
      <div className="zentra-page-header">
        <div>
          <div className="zentra-title-row">
            <h1 className="zentra-page-title">Master Knowledge Base</h1>
            <span className="zentra-link-bubble" title="Global Knowledge Repository">
              <Icon name="link" size={16} />
            </span>
          </div>
          <p className="zentra-page-subtitle">Global repository for resumes, technical rubrics, and syllabus documents synced across interviewers.</p>
        </div>

        <div className="zentra-header-actions">
          <label className="zentra-btn zentra-btn-primary" style={{ cursor: 'pointer' }}>
            <Icon name="cloud_upload" size={17} />
            <span>Upload Document</span>
            <input
              type="file"
              multiple
              accept=".pdf,.txt,.md,.doc,.docx"
              style={{ display: 'none' }}
              onChange={handleFileChange}
              disabled={loading}
            />
          </label>
          <button onClick={fetchDocs} disabled={loading} className="zentra-btn zentra-btn-secondary">
            <Icon name="refresh" size={16} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Info Notice Card */}
      <div className="zentra-card" style={{ padding: '1rem 1.25rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.85rem', background: 'rgba(37, 99, 235, 0.04)', borderColor: 'rgba(37, 99, 235, 0.15)' }}>
        <Icon name="verified_user" size={20} style={{ color: '#2563eb', flexShrink: 0 }} />
        <span style={{ fontSize: '0.85rem', color: 'var(--zentra-text-secondary)', lineHeight: 1.5 }}>
          <strong style={{ color: 'var(--zentra-text-primary)' }}>Admin Master Source:</strong> Documents uploaded here represent the authoritative knowledge bank. Interviewers can synchronize these documents into their personal workspaces without modifying global records.
        </span>
      </div>

      {/* Feedback Alerts */}
      {error && (
        <div className="zentra-card" style={{ padding: '0.85rem 1.25rem', marginBottom: '1.5rem', background: 'rgba(239, 68, 68, 0.06)', borderColor: 'rgba(239, 68, 68, 0.2)', color: '#dc2626', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Icon name="error" size={18} />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="zentra-card" style={{ padding: '0.85rem 1.25rem', marginBottom: '1.5rem', background: 'rgba(16, 185, 129, 0.06)', borderColor: 'rgba(16, 185, 129, 0.2)', color: '#059669', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Icon name="check_circle" size={18} />
          <span>{success}</span>
        </div>
      )}

      {/* Summary Metric Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem', marginBottom: '1.75rem' }}>
        <div className="zentra-card">
          <div className="zentra-card-header" style={{ marginBottom: '0.75rem' }}>
            <span className="zentra-metric-label">Master Documents</span>
            <span className="zentra-pill-tag blue">Global</span>
          </div>
          <div className="zentra-metric-num">{docs.length}</div>
          <div className="zentra-metric-sub">Admin Master records</div>
        </div>

        <div className="zentra-card">
          <div className="zentra-card-header" style={{ marginBottom: '0.75rem' }}>
            <span className="zentra-metric-label">Processed &amp; RAG-Ready</span>
            <span className="zentra-pill-tag green">Indexed</span>
          </div>
          <div className="zentra-metric-num">{processedDocs}</div>
          <div className="zentra-metric-sub">{docs.length > 0 ? `${Math.round((processedDocs / docs.length) * 100)}% ready` : 'None'}</div>
        </div>

        <div className="zentra-card">
          <div className="zentra-card-header" style={{ marginBottom: '0.75rem' }}>
            <span className="zentra-metric-label">Vector Chunks</span>
            <span className="zentra-pill-tag">pgvector</span>
          </div>
          <div className="zentra-metric-num">{totalChunks}</div>
          <div className="zentra-metric-sub">Embedded chunk units</div>
        </div>

        <div className="zentra-card">
          <div className="zentra-card-header" style={{ marginBottom: '0.75rem' }}>
            <span className="zentra-metric-label">Corpus Storage</span>
            <span className="zentra-pill-tag">Disk</span>
          </div>
          <div className="zentra-metric-num">{fmtSize(totalSize)}</div>
          <div className="zentra-metric-sub">Total file payload</div>
        </div>
      </div>

      {/* Documents Table Card */}
      <div className="zentra-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '1.25rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--zentra-border)' }}>
          <div>
            <h3 className="zentra-card-title">Repository Documents ({docs.length})</h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--zentra-text-muted)' }}>Files indexed and available for interview synchronization</span>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="zentra-table">
            <thead>
              <tr>
                <th>Document Name</th>
                <th>Source</th>
                <th>Type</th>
                <th>Size</th>
                <th>Chunks</th>
                <th>Upload Date</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && docs.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: '3.5rem', textAlign: 'center', color: 'var(--zentra-text-muted)' }}>
                    Loading Master Knowledge Base...
                  </td>
                </tr>
              ) : docs.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: '3.5rem', textAlign: 'center', color: 'var(--zentra-text-muted)' }}>
                    No master documents uploaded yet. Click &ldquo;Upload Document&rdquo; above to get started.
                  </td>
                </tr>
              ) : (
                docs.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '8px',
                          background: 'rgba(239, 68, 68, 0.1)',
                          color: '#dc2626',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0
                        }}>
                          <Icon name="description" size={18} />
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--zentra-text-primary)' }}>{d.name}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--zentra-text-muted)' }}>{d.originalFilename}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="zentra-pill-tag blue">Admin Master</span>
                    </td>
                    <td>
                      <span className="zentra-pill-tag">
                        {d.fileType.replace('.', '').toUpperCase()}
                      </span>
                    </td>
                    <td style={{ color: 'var(--zentra-text-secondary)', fontSize: '0.85rem' }}>
                      {fmtSize(d.fileSize)}
                    </td>
                    <td>
                      <span className="zentra-pill-tag green">
                        {d.chunkCount} chunks
                      </span>
                    </td>
                    <td style={{ color: 'var(--zentra-text-muted)', fontSize: '0.8rem' }}>
                      {new Date(d.createdAt).toLocaleDateString()}
                    </td>
                    <td>
                      <div>{statusBadge(d.status)}</div>
                      {d.status === 'FAILED' && d.lastError && (
                        <div style={{ fontSize: '0.72rem', color: '#dc2626', marginTop: '0.25rem', maxWidth: '220px', wordBreak: 'break-word' }}>
                          {d.lastError}
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center' }}>
                        {(d.status === 'UPLOADED' || d.status === 'FAILED') && (
                          <button
                            onClick={() => onTriggerProcess(d.id)}
                            disabled={loading}
                            className="zentra-btn zentra-btn-secondary"
                            style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem' }}
                            title={d.status === 'FAILED' ? 'Retry processing' : 'Process chunks'}
                          >
                            <Icon name="refresh" size={14} />
                            <span>{d.status === 'FAILED' ? 'Retry' : 'Process'}</span>
                          </button>
                        )}
                        <button
                          onClick={() => onDelete(d.id, d.name)}
                          disabled={loading}
                          className="zentra-btn zentra-btn-danger"
                          style={{ padding: '0.35rem 0.65rem', fontSize: '0.75rem' }}
                          title="Delete from Master KB"
                        >
                          <Icon name="delete" size={15} />
                        </button>
                      </div>
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
