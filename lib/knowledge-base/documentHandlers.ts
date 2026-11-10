import path from 'path'
import { NextResponse, after } from 'next/server'
import prisma from '@/lib/db'
import { createAuditLog } from '@/lib/audit-log'
import {
  saveDocumentBuffer,
  readDocumentBuffer,
  deleteDocumentObject,
  resolveSafeMimeType,
  sanitizeDownloadFilename,
  DocumentObjectNotFoundError,
  StorageConfigurationError,
  type StorageScope,
} from '@/lib/storage/b2'

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024 // 10MB
const STALE_PROCESSING_MS = 3 * 60 * 1000

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.txt', '.md', '.doc', '.docx'])

async function fallbackMarkDocumentFailed(
  docId: number,
  err: unknown,
  ctx?: { userId?: number; username?: string | null }
): Promise<void> {
  const raw = err instanceof Error ? err.message : String(err || 'Background processing error')
  const safeError = raw
    .replace(/postgres(ql)?:\/\/[^\s]+/gi, '<redacted-db-url>')
    .replace(/(key|secret|token|password|authorization)=([^\s&]+)/gi, '$1=<redacted>')
    .slice(0, 400)

  await prisma.document
    .updateMany({
      where: { id: docId, status: { in: ['UPLOADED', 'PROCESSING'] } },
      data: { status: 'FAILED' },
    })
    .catch(() => {})

  await createAuditLog({
    userId: ctx?.userId,
    username: ctx?.username ?? undefined,
    action: 'DOCUMENT_PROCESSING_FAILED',
    entityType: 'Document',
    entityId: String(docId),
    status: 'FAILURE',
    metadata: { error: safeError, stage: 'scheduler' },
  })
}

export function scheduleDocumentProcessing(
  docId: number,
  options?: { userId?: number; username?: string | null; force?: boolean }
): void {
  const run = async () => {
    try {
      const { processDocument } = await import('@/lib/knowledge-base/processDocument')
      await processDocument(docId, {
        force: options?.force,
        actingUserId: options?.userId,
        actingUsername: options?.username,
      })
    } catch (err) {
      console.error('Background processing error:', err)
      await fallbackMarkDocumentFailed(docId, err, {
        userId: options?.userId,
        username: options?.username,
      })
    }
  }

  try {
    after(run)
  } catch {
    void run()
  }
}

export async function getFailedDocumentErrors(docIds: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>()
  if (docIds.length === 0) return map

  const logs = await prisma.auditLog.findMany({
    where: {
      action: 'DOCUMENT_PROCESSING_FAILED',
      entityType: 'Document',
      entityId: { in: docIds.map(String) },
    },
    orderBy: { createdAt: 'desc' },
    select: { entityId: true, metadata: true },
  })

  for (const log of logs) {
    if (!log.entityId) continue
    const id = parseInt(log.entityId, 10)
    if (Number.isNaN(id) || map.has(id)) continue
    const meta = log.metadata as { error?: unknown } | null
    if (meta && typeof meta.error === 'string' && meta.error.trim()) {
      map.set(id, meta.error)
    }
  }

  return map
}

export async function retryDocumentProcessing(params: {
  docId: number
  userId: number
  username?: string | null
  role: string
  requireAdminMaster?: boolean
  sync?: boolean
}): Promise<NextResponse> {
  const doc = await prisma.document.findUnique({
    where: { id: params.docId },
    select: {
      id: true,
      userId: true,
      docSource: true,
      status: true,
      updatedAt: true,
    },
  })

  if (!doc) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  if (params.requireAdminMaster) {
    if (params.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden — Admin only' }, { status: 403 })
    }
    if (doc.docSource !== 'ADMIN_MASTER') {
      return NextResponse.json({ error: 'Not an admin master document' }, { status: 400 })
    }
  } else {
    if (doc.userId !== params.userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (doc.docSource === 'ADMIN_MASTER' && params.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden — Admin master documents cannot be reprocessed here' }, { status: 403 })
    }
  }

  const isActivelyProcessing =
    doc.status === 'PROCESSING' && Date.now() - doc.updatedAt.getTime() < STALE_PROCESSING_MS
  if (isActivelyProcessing) {
    return NextResponse.json(
      { error: 'Document is already being processed. Please wait for the active job to finish.' },
      { status: 409 }
    )
  }

  if (params.sync) {
    try {
      const { processDocument } = await import('@/lib/knowledge-base/processDocument')
      const result = await processDocument(doc.id, {
        force: true,
        actingUserId: params.userId,
        actingUsername: params.username,
      })

      if (result.status === 'ALREADY_PROCESSING') {
        return NextResponse.json(
          { error: 'Document is already being processed.' },
          { status: 409 }
        )
      }

      return NextResponse.json({
        success: true,
        status: result.status,
        chunkCount: result.chunkCount ?? 0,
        message: 'Document processed successfully.',
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Processing failed'
      await fallbackMarkDocumentFailed(doc.id, err, {
        userId: params.userId,
        username: params.username,
      })
      return NextResponse.json({ error: msg, status: 'FAILED' }, { status: 500 })
    }
  }

  scheduleDocumentProcessing(doc.id, {
    userId: params.userId,
    username: params.username,
    force: true,
  })

  return NextResponse.json(
    { success: true, message: 'Processing started', status: doc.status },
    { status: 202 }
  )
}

export async function handleDocumentUpload(params: {
  request: Request
  userId: number
  username?: string | null
  docSource: 'INTERVIEWER_PRIVATE' | 'ADMIN_MASTER'
  storageScope: StorageScope
  auditAction: 'KNOWLEDGE_DOCUMENT_UPLOADED' | 'ADMIN_KB_DOCUMENT_UPLOADED'
}): Promise<NextResponse> {
  const form = await params.request.formData()
  const file = form.get('file') as File | null
  const title = (form.get('title') as string) || ''

  if (!file) {
    return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
  }

  const size = file.size
  if (!size || size <= 0) {
    return NextResponse.json({ error: 'Empty file' }, { status: 400 })
  }
  if (size > MAX_DOCUMENT_BYTES) {
    return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 400 })
  }

  const originalFilename = path.basename(file.name || `upload-${Date.now()}`)
  const ext = path.extname(originalFilename).toLowerCase()
  const mime = (file.type || '').trim() || 'application/octet-stream'

  const mimeAllowed = ALLOWED_MIME_TYPES.has(mime)
  const genericMimeWithAllowedExt =
    (mime === 'application/octet-stream' || mime === '') && ALLOWED_EXTENSIONS.has(ext)

  if (!mimeAllowed && !genericMimeWithAllowedExt) {
    return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 })
  }

  if (ext && !ALLOWED_EXTENSIONS.has(ext)) {
    return NextResponse.json({ error: 'Unsupported file extension' }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const effectiveContentType = mimeAllowed
    ? mime
    : resolveSafeMimeType(ext.replace('.', ''), originalFilename)

  let stored: { storagePath: string; storageProvider: 'b2' | 'local' }
  try {
    stored = await saveDocumentBuffer({
      scope: params.storageScope,
      userId: params.userId,
      originalFilename,
      contentType: effectiveContentType,
      buffer,
    })
  } catch (err) {
    if (err instanceof StorageConfigurationError) {
      console.error('Document storage configuration error:', err.message)
      return NextResponse.json(
        { error: 'Document storage is not configured on the server' },
        { status: 500 }
      )
    }
    throw err
  }

  let doc
  try {
    doc = await prisma.document.create({
      data: {
        name: title.trim() || originalFilename,
        originalFilename,
        fileType: ext.replace('.', '').toUpperCase() || effectiveContentType,
        fileSize: size,
        storagePath: stored.storagePath,
        status: 'UPLOADED',
        userId: params.userId,
        docSource: params.docSource,
      },
    })
  } catch (dbErr) {
    // Roll back uploaded B2/local object so failed DB writes never leave orphaned files
    await deleteDocumentObject(stored.storagePath).catch((cleanupErr) => {
      console.error('Failed to clean up orphaned storage object after DB error:', cleanupErr)
    })
    throw dbErr
  }

  createAuditLog({
    userId: params.userId,
    username: params.username ?? undefined,
    action: params.auditAction,
    entityType: 'Document',
    entityId: doc.id.toString(),
    metadata: {
      name: doc.name,
      fileSize: doc.fileSize,
      fileType: doc.fileType,
      storageProvider: stored.storageProvider,
    },
  })

  // Kick off background processing (extract text -> chunks -> embeddings -> Neon pgvector)
  scheduleDocumentProcessing(doc.id, {
    userId: params.userId,
    username: params.username,
  })

  return NextResponse.json(
    { success: true, document: { id: doc.id, status: 'UPLOADED' } },
    { status: 202 }
  )
}

export async function buildDocumentDownloadResponse(doc: {
  storagePath: string
  fileType: string
  originalFilename: string
}): Promise<NextResponse> {
  try {
    const buffer = await readDocumentBuffer(doc.storagePath)
    const contentType = resolveSafeMimeType(doc.fileType, doc.originalFilename)
    const filename = sanitizeDownloadFilename(doc.originalFilename)

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(buffer.byteLength),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (err) {
    if (err instanceof DocumentObjectNotFoundError) {
      return NextResponse.json({ error: 'Document file not found' }, { status: 404 })
    }
    if (err instanceof StorageConfigurationError) {
      console.error('Document download storage config error:', err.message)
      return NextResponse.json(
        { error: 'Document storage is not configured on the server' },
        { status: 500 }
      )
    }
    throw err
  }
}
