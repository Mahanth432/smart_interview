export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.txt', '.md', '.doc', '.docx'])

export type DirectUploadStage =
  | 'initializing'
  | 'uploading'
  | 'confirming'
  | 'completed'

export type DirectUploadErrorCode =
  | 'VALIDATION'
  | 'INIT_FAILED'
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'EXPIRED'
  | 'NETWORK'
  | 'B2_REJECTED'
  | 'COMPLETE_FAILED'

export class DirectUploadError extends Error {
  code: DirectUploadErrorCode
  uploadIntentId?: string

  constructor(message: string, code: DirectUploadErrorCode, uploadIntentId?: string) {
    super(message)
    this.name = 'DirectUploadError'
    this.code = code
    this.uploadIntentId = uploadIntentId
  }
}

export interface StorageSyncStatus {
  ok: boolean
  checked: number
  availableCount: number
  missingCount: number
  newlyMarkedMissing: number
  restoredCount: number
  restoredChangedDocIds: number[]
  inconclusiveCount: number
  lastCheckedAt: string
  error?: string
}

export function validateClientDocumentFile(file: File): string | null {
  if (!file || file.size <= 0) {
    return 'Selected file is empty.'
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    return 'File is too large (max 10 MB).'
  }
  const dotIdx = file.name.lastIndexOf('.')
  const ext = dotIdx >= 0 ? file.name.slice(dotIdx).toLowerCase() : ''
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return 'Unsupported file type. Allowed formats: PDF, DOCX, DOC, TXT, MD.'
  }
  return null
}

async function postCancelBestEffort(
  uploadIntentId: string,
  reason: 'cancelled' | 'expired'
): Promise<void> {
  await fetch('/api/documents/upload/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadIntentId, reason }),
  }).catch(() => {})
}

export async function completeDirectUpload(params: {
  uploadIntentId: string
  title?: string
}): Promise<{ id: number; status: string; idempotent?: boolean }> {
  let res: Response
  try {
    res = await fetch('/api/documents/upload/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uploadIntentId: params.uploadIntentId,
        title: params.title,
      }),
    })
  } catch {
    throw new DirectUploadError(
      'File uploaded to B2, but confirmation request failed due to network error. Click Retry Confirmation.',
      'COMPLETE_FAILED',
      params.uploadIntentId
    )
  }

  const data = (await res.json().catch(() => ({}))) as {
    error?: string
    idempotent?: boolean
    document?: { id: number; status: string }
  }

  if (!res.ok || !data.document) {
    const code: DirectUploadErrorCode =
      res.status >= 500 || res.status === 503 ? 'COMPLETE_FAILED' : 'B2_REJECTED'
    throw new DirectUploadError(
      data.error || 'Failed to finalize upload.',
      code,
      params.uploadIntentId
    )
  }

  return {
    id: data.document.id,
    status: data.document.status,
    idempotent: data.idempotent,
  }
}

export async function uploadDocumentDirect(params: {
  file: File
  title?: string
  docSource: 'ADMIN_MASTER' | 'INTERVIEWER_PRIVATE'
  timeoutMs?: number
  signal?: AbortSignal
  onStageChange?: (stage: DirectUploadStage) => void
  onProgress?: (percent: number) => void
}): Promise<{ id: number; status: string; uploadIntentId: string }> {
  const clientErr = validateClientDocumentFile(params.file)
  if (clientErr) {
    throw new DirectUploadError(clientErr, 'VALIDATION')
  }

  if (params.signal?.aborted) {
    throw new DirectUploadError('Upload cancelled', 'CANCELLED')
  }

  params.onStageChange?.('initializing')
  params.onProgress?.(0)

  const initRes = await fetch('/api/documents/upload/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: params.file.name,
      contentType: params.file.type || 'application/octet-stream',
      fileSize: params.file.size,
      title: params.title || '',
      docSource: params.docSource,
    }),
  })

  const initData = (await initRes.json().catch(() => ({}))) as {
    error?: string
    uploadIntentId?: string
    uploadUrl?: string
    requiredHeaders?: Record<string, string>
  }

  if (!initRes.ok || !initData.uploadIntentId || !initData.uploadUrl) {
    throw new DirectUploadError(
      initData.error || 'Failed to initialize direct upload',
      'INIT_FAILED'
    )
  }

  const { uploadIntentId, uploadUrl, requiredHeaders } = initData

  params.onStageChange?.('uploading')

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    let settled = false

    const cleanup = () => {
      if (params.signal) {
        params.signal.removeEventListener('abort', onAbortSignal)
      }
    }

    const onAbortSignal = () => {
      if (!settled) {
        xhr.abort()
      }
    }

    if (params.signal) {
      if (params.signal.aborted) {
        settled = true
        void postCancelBestEffort(uploadIntentId, 'cancelled')
        reject(new DirectUploadError('Upload cancelled', 'CANCELLED', uploadIntentId))
        return
      }
      params.signal.addEventListener('abort', onAbortSignal, { once: true })
    }

    xhr.open('PUT', uploadUrl, true)
    xhr.timeout = params.timeoutMs ?? 120_000

    const contentType = requiredHeaders?.['Content-Type']
    if (contentType) {
      xhr.setRequestHeader('Content-Type', contentType)
    }

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && ev.total > 0) {
        const pct = Math.min(99, Math.round((ev.loaded / ev.total) * 100))
        params.onProgress?.(pct)
      }
    }

    xhr.onload = () => {
      if (settled) return
      settled = true
      cleanup()

      if (xhr.status >= 200 && xhr.status < 300) {
        params.onProgress?.(100)
        resolve()
        return
      }

      const body = (xhr.responseText || '').toLowerCase()
      const isExpired =
        xhr.status === 403 && (body.includes('expired') || body.includes('request has expired'))

      void postCancelBestEffort(uploadIntentId, isExpired ? 'expired' : 'cancelled')

      if (isExpired) {
        reject(
          new DirectUploadError(
            'Upload URL expired before transfer finished. Please try again.',
            'EXPIRED',
            uploadIntentId
          )
        )
        return
      }

      reject(
        new DirectUploadError(
          `Direct upload to B2 rejected (${xhr.status || 'error'}).`,
          'B2_REJECTED',
          uploadIntentId
        )
      )
    }

    xhr.onabort = () => {
      if (settled) return
      settled = true
      cleanup()
      void postCancelBestEffort(uploadIntentId, 'cancelled')
      reject(new DirectUploadError('Upload cancelled', 'CANCELLED', uploadIntentId))
    }

    xhr.ontimeout = () => {
      if (settled) return
      settled = true
      cleanup()
      void postCancelBestEffort(uploadIntentId, 'cancelled')
      reject(
        new DirectUploadError(
          'Upload timed out while transferring directly to Backblaze B2. Please retry.',
          'TIMEOUT',
          uploadIntentId
        )
      )
    }

    xhr.onerror = () => {
      if (settled) return
      settled = true
      cleanup()
      void postCancelBestEffort(uploadIntentId, 'cancelled')
      reject(
        new DirectUploadError(
          'Direct upload to Backblaze B2 failed due to a network or bucket CORS error.',
          'NETWORK',
          uploadIntentId
        )
      )
    }

    xhr.send(params.file)
  })

  params.onStageChange?.('confirming')
  const completed = await completeDirectUpload({
    uploadIntentId,
    title: params.title,
  })
  params.onStageChange?.('completed')

  return {
    id: completed.id,
    status: completed.status,
    uploadIntentId,
  }
}
