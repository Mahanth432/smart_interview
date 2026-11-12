'use client'

import React, { useEffect, useState, useCallback, useRef } from 'react'
import Icon from '@/components/Icon'
import {
  uploadDocumentDirect,
  completeDirectUpload,
  DirectUploadError,
  type DirectUploadStage,
  type StorageSyncStatus,
} from '@/lib/knowledge-base/clientDirectUpload'

type Doc = {
  id: number
  name: string
  originalFilename: string
  fileType: string
  fileSize: number
  status: string
  storageStatus?: 'AVAILABLE' | 'MISSING'
  missingAt?: string | null
  docSource: string
  createdAt: string
  updatedAt: string
  chunkCount: number
  lastError?: string | null
}

export default function AdminKnowledgeBasePage() {
  const [docs, setDocs] = useState<Doc[]>([])
  const [missingDocs, setMissingDocs] = useState<Doc[]>([])
  const [syncStatus, setSyncStatus] = useState<StorageSyncStatus | null>(null)
  const [syncingStorage, setSyncingStorage] = useState(false)
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<{
    filename: string
    index: number
    total: number
    percent: number
    stage: DirectUploadStage
  } | null>(null)
  const [pendingRetryComplete, setPendingRetryComplete] = useState<{
    uploadIntentId: string
    filename: string
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const uploadAbortRef = useRef<AbortController | null>(null)

  const fetchDocs = useCallback(async (reconcile = false) => {
    setLoading(true)
    try {
      const url = reconcile ? '/api/admin/knowledge-base?reconcile=1' : '/api/admin/knowledge-base'
      const res = await fetch(url, { cache: 'no-store', credentials: 'include' })
      const data = await res.json()
      if (res.ok) {
        setDocs(data.documents || [])
        setMissingDocs(data.missingDocuments || [])
        if (data.syncStatus) setSyncStatus(data.syncStatus)
      } else {
        setError(data.error || 'Failed to fetch documents')
      }
    } catch {
      setError('Failed to fetch documents')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchDocs(false)
  }, [fetchDocs])

  const hasPendingDocs = docs.some((d) => d.status === 'UPLOADED' || d.status === 'PROCESSING')
  useEffect(() => {
    if (!hasPendingDocs) return
    let polls = 0
    const interval = setInterval(() => {
      polls++
      if (polls > 24) {
        clearInterval(interval)
        return
      }
      fetchDocs(false)
    }, 2500)
    return () => clearInterval(interval)
  }, [hasPendingDocs, fetchDocs])

  const handleSyncStorage = async () => {
    setSyncingStorage(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch('/api/admin/knowledge-base/sync-storage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'all' }),
        credentials: 'include',
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Storage sync failed')
      } else {
        const st = data.syncStatus as StorageSyncStatus
        setSyncStatus(st)
        if (st.ok) {
          setSuccess(
            `Storage sync complete (${st.checked} checked, ${st.newlyMarkedMissing} marked missing, ${st.restoredCount} restored).`
          )
        }
        await fetchDocs(false)
      }
    } catch {
      setError('Failed to synchronize storage with Backblaze B2')
    } finally {
      setSyncingStorage(false)
    }
  }

  const handleCancelUpload = () => {
    uploadAbortRef.current?.abort()
  }

  const handleRetryCompletion = async () => {
    if (!pendingRetryComplete) return
    setLoading(true)
    setError(null)
    try {
      await completeDirectUpload({
        uploadIntentId: pendingRetryComplete.uploadIntentId,
        title: pendingRetryComplete.filename,
      })
      setSuccess(`Confirmed "${pendingRetryComplete.filename}" — processing in background...`)
      setPendingRetryComplete(null)
      await fetchDocs(false)
      setTimeout(() => fetchDocs(false), 2000)
      setTimeout(() => fetchDocs(false), 5000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry confirmation failed')
    } finally {
      setLoading(false)
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return

    setError(null)
    setSuccess(null)
    setPendingRetryComplete(null)
    setUploading(true)
    const abortController = new AbortController()
    uploadAbortRef.current = abortController

    let successCount = 0
    let failCount = 0
    let cancelled = false
    let lastUploadError = ''

    for (let i = 0; i < files.length; i++) {
      if (abortController.signal.aborted) {
        cancelled = true
        break
      }
      const file = files[i]
      setUploadProgress({
        filename: file.name,
        index: i + 1,
        total: files.length,
        percent: 0,
        stage: 'initializing',
      })

      try {
        await uploadDocumentDirect({
          file,
          title: file.name,
          docSource: 'ADMIN_MASTER',
          signal: abortController.signal,
          onStageChange: (stage) => {
            setUploadProgress((prev) => (prev ? { ...prev, stage } : null))
          },
          onProgress: (percent) => {
            setUploadProgress((prev) => (prev ? { ...prev, percent } : null))
          },
        })
        successCount++
      } catch (err) {
        if (err instanceof DirectUploadError) {
          if (err.code === 'CANCELLED') {
            cancelled = true
            break
          }
          if (err.code === 'COMPLETE_FAILED' && err.uploadIntentId) {
            setPendingRetryComplete({
              uploadIntentId: err.uploadIntentId,
              filename: file.name,
            })
          }
          lastUploadError = err.message
        } else {
          lastUploadError = err instanceof Error ? err.message : 'Upload failed'
        }
        failCount++
      }
    }

    uploadAbortRef.current = null
    setUploadProgress(null)
    setUploading(false)
    e.target.value = ''

    if (cancelled) {
      setError(
        successCount > 0
          ? `Upload cancelled after ${successCount} file(s) completed.`
          : 'Upload cancelled.'
      )
    } else if (successCount === files.length) {
      setSuccess(
        `Successfully uploaded ${successCount} document(s) directly to B2 — processing in background...`
      )
    } else if (successCount > 0) {
      setSuccess(
        `Uploaded ${successCount} document(s), but ${failCount} failed.${lastUploadError ? ` (${lastUploadError})` : ''}`
      )
    } else {
      setError(lastUploadError || 'Upload failed for all documents.')
    }

    if (successCount > 0) {
      fetchDocs(false)
    }
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
          <label className="zentra-btn zentra-btn-primary" style={{ cursor: uploading || loading ? 'not-allowed' : 'pointer' }}>
            <Icon name="cloud_upload" size={17} />
            <span>{uploading ? 'Uploading...' : 'Upload Document'}</span>
            <input
              type="file"
              multiple
              accept=".pdf,.txt,.md,.docx"
              style={{ display: 'none' }}
              onChange={handleFileChange}
              disabled={loading || uploading}
            />
          </label>
          <button
            onClick={handleSyncStorage}
            disabled={loading || uploading || syncingStorage}
            className="zentra-btn zentra-btn-secondary"
            title="Verify Backblaze B2 storage objects across all documents"
          >
            <Icon name="sync" size={16} />
            <span>{syncingStorage ? 'Syncing B2...' : 'Sync Storage'}</span>
          </button>
          <button onClick={() => fetchDocs(true)} disabled={loading || uploading} className="zentra-btn zentra-btn-secondary">
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

      {/* Direct Upload Progress */}
      {uploadProgress && (
        <div className="zentra-card" style={{ padding: '1rem 1.25rem', marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', gap: '1rem' }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--zentra-text-primary)' }}>
              {uploadProgress.stage === 'initializing' && `Preparing direct upload (${uploadProgress.index}/${uploadProgress.total}): ${uploadProgress.filename}`}
              {uploadProgress.stage === 'uploading' && `Uploading directly to B2 (${uploadProgress.index}/${uploadProgress.total}): ${uploadProgress.filename} — ${uploadProgress.percent}%`}
              {uploadProgress.stage === 'confirming' && `Confirming upload & starting processing: ${uploadProgress.filename}`}
              {uploadProgress.stage === 'completed' && `Completed: ${uploadProgress.filename}`}
            </div>
            {uploadProgress.stage === 'uploading' && (
              <button onClick={handleCancelUpload} className="zentra-btn zentra-btn-danger" style={{ padding: '0.25rem 0.65rem', fontSize: '0.75rem' }}>
                Cancel
              </button>
            )}
          </div>
          <div style={{ height: '6px', borderRadius: '999px', background: 'var(--zentra-border)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${uploadProgress.percent}%`, background: '#2563eb', transition: 'width 150ms ease' }} />
          </div>
        </div>
      )}

      {/* Storage Sync Outage Warning */}
      {syncStatus && !syncStatus.ok && syncStatus.error && (
        <div className="zentra-card" style={{ padding: '0.85rem 1.25rem', marginBottom: '1.5rem', background: 'rgba(245, 158, 11, 0.08)', borderColor: 'rgba(245, 158, 11, 0.25)', color: '#b45309', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Icon name="warning" size={18} />
          <span>{syncStatus.error}</span>
        </div>
      )}

      {/* Feedback Alerts */}
      {error && (
        <div className="zentra-card" style={{ padding: '0.85rem 1.25rem', marginBottom: '1.5rem', background: 'rgba(239, 68, 68, 0.06)', borderColor: 'rgba(239, 68, 68, 0.2)', color: '#dc2626', fontSize: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Icon name="error" size={18} />
            <span>{error}</span>
          </div>
          {pendingRetryComplete && (
            <button onClick={handleRetryCompletion} disabled={loading} className="zentra-btn zentra-btn-secondary" style={{ padding: '0.3rem 0.75rem', fontSize: '0.75rem' }}>
              Retry Confirmation
            </button>
          )}
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

      {/* Storage Missing Records Section */}
      {missingDocs.length > 0 && (
        <div className="zentra-card" style={{ padding: 0, overflow: 'hidden', marginTop: '1.75rem', borderColor: 'rgba(245, 158, 11, 0.35)' }}>
          <div style={{ padding: '1.15rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--zentra-border)', background: 'rgba(245, 158, 11, 0.05)' }}>
            <div>
              <h3 className="zentra-card-title" style={{ color: '#b45309' }}>Storage Missing ({missingDocs.length})</h3>
              <span style={{ fontSize: '0.8rem', color: 'var(--zentra-text-muted)' }}>
                These database records are excluded from RAG search and syncing because their objects no longer exist in Backblaze B2.
              </span>
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="zentra-table">
              <thead>
                <tr>
                  <th>Document Name</th>
                  <th>Size</th>
                  <th>Chunks</th>
                  <th>Detected Missing</th>
                  <th>Storage Status</th>
                  <th style={{ textAlign: 'right' }}>Cleanup</th>
                </tr>
              </thead>
              <tbody>
                {missingDocs.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--zentra-text-primary)' }}>{d.name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--zentra-text-muted)' }}>{d.originalFilename}</div>
                    </td>
                    <td style={{ color: 'var(--zentra-text-secondary)', fontSize: '0.85rem' }}>{fmtSize(d.fileSize)}</td>
                    <td style={{ color: 'var(--zentra-text-muted)', fontSize: '0.85rem' }}>{d.chunkCount} chunks</td>
                    <td style={{ color: 'var(--zentra-text-muted)', fontSize: '0.8rem' }}>
                      {d.missingAt ? new Date(d.missingAt).toLocaleString() : 'Recently'}
                    </td>
                    <td>
                      <span className="zentra-badge danger">Missing from Storage</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        onClick={() => onDelete(d.id, d.name)}
                        disabled={loading}
                        className="zentra-btn zentra-btn-danger"
                        style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem' }}
                      >
                        <Icon name="delete" size={14} />
                        <span>Remove Stale Record</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
