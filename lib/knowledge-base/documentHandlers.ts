import path from 'path'
import { NextResponse, after } from 'next/server'
import prisma from '@/lib/db'
import { createAuditLog } from '@/lib/audit-log'
import {
  saveDocumentBuffer,
  readDocumentBuffer,
  deleteDocumentObject,
  createPresignedDocumentUpload,
  headDocumentObject,
  resolveSafeMimeType,
  sanitizeDownloadFilename,
  DocumentObjectNotFoundError,
  StorageConfigurationError,
  type StorageScope,
} from '@/lib/storage/b2'
import { confirmAndMarkStorageMissing } from './storageReconciliation'

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024 // 10MB
const STALE_PROCESSING_MS = 3 * 60 * 1000

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.txt', '.md', '.docx'])

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
      storageStatus: true,
      storagePath: true,
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

  if (doc.storageStatus === 'MISSING') {
    return NextResponse.json(
      { error: 'Document file is missing from Backblaze B2 storage and cannot be processed.' },
      { status: 409 }
    )
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
      const { processDocument, DocumentStorageMissingError } = await import(
        '@/lib/knowledge-base/processDocument'
      )
      try {
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
      } catch (innerErr) {
        if (innerErr instanceof DocumentStorageMissingError) {
          return NextResponse.json(
            { error: innerErr.message, storageStatus: 'MISSING' },
            { status: 409 }
          )
        }
        throw innerErr
      }
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

export function validateDocumentDescriptor(params: {
  filename: string
  mimeType?: string | null
  size: number
}):
  | {
      ok: true
      originalFilename: string
      ext: string
      fileTypeLabel: string
      effectiveContentType: string
    }
  | { ok: false; error: string; status: number } {
  if (!Number.isFinite(params.size) || params.size <= 0) {
    return { ok: false, error: 'Empty file', status: 400 }
  }
  if (params.size > MAX_DOCUMENT_BYTES) {
    return { ok: false, error: 'File too large (max 10MB)', status: 400 }
  }

  const originalFilename = path.basename((params.filename || '').trim() || `upload-${Date.now()}`)
  const ext = path.extname(originalFilename).toLowerCase()
  const rawMime = (params.mimeType || '').split(';')[0].trim().toLowerCase() || 'application/octet-stream'

  const mimeAllowed = ALLOWED_MIME_TYPES.has(rawMime)
  const genericMimeWithAllowedExt =
    (rawMime === 'application/octet-stream' || rawMime === '') && ALLOWED_EXTENSIONS.has(ext)

  if (!mimeAllowed && !genericMimeWithAllowedExt) {
    return { ok: false, error: 'Unsupported file type', status: 400 }
  }

  if (ext && !ALLOWED_EXTENSIONS.has(ext)) {
    return { ok: false, error: 'Unsupported file extension', status: 400 }
  }

  const effectiveContentType = mimeAllowed
    ? rawMime
    : resolveSafeMimeType(ext.replace('.', ''), originalFilename).split(';')[0].trim()

  return {
    ok: true,
    originalFilename,
    ext,
    fileTypeLabel: ext.replace('.', '').toUpperCase() || effectiveContentType,
    effectiveContentType,
  }
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

  const validation = validateDocumentDescriptor({
    filename: file.name || `upload-${Date.now()}`,
    mimeType: file.type,
    size: file.size,
  })
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: validation.status })
  }

  const { originalFilename, fileTypeLabel, effectiveContentType } = validation
  const size = file.size

  const buffer = Buffer.from(await file.arrayBuffer())

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
        fileType: fileTypeLabel,
        fileSize: size,
        storagePath: stored.storagePath,
        status: 'UPLOADED',
        storageStatus: 'AVAILABLE',
        lastStorageCheckAt: new Date(),
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

export async function buildDocumentDownloadResponse(
  doc: {
    id?: number
    storagePath: string
    fileType: string
    originalFilename: string
    storageStatus?: 'AVAILABLE' | 'MISSING'
  },
  actor?: { userId?: number; username?: string | null }
): Promise<NextResponse> {
  if (doc.storageStatus === 'MISSING') {
    return NextResponse.json(
      { error: 'Document file is missing from Backblaze B2 storage', storageStatus: 'MISSING' },
      { status: 404 }
    )
  }

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
      await confirmAndMarkStorageMissing({
        storagePath: doc.storagePath,
        userId: actor?.userId,
        username: actor?.username,
        reason: 'missing_on_download',
      }).catch(() => {})
      return NextResponse.json(
        { error: 'Document file is missing from Backblaze B2 storage', storageStatus: 'MISSING' },
        { status: 404 }
      )
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

export async function initDirectDocumentUpload(params: {
  userId: number
  username?: string | null
  role: string
  filename: string
  contentType?: string | null
  fileSize: number
  title?: string | null
  docSource?: string | null
}): Promise<NextResponse> {
  if (!Number.isInteger(params.userId) || params.userId <= 0) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const requestedSource = (params.docSource || 'INTERVIEWER_PRIVATE').trim()
  if (requestedSource !== 'INTERVIEWER_PRIVATE' && requestedSource !== 'ADMIN_MASTER') {
    return NextResponse.json({ error: 'Invalid upload target scope' }, { status: 400 })
  }

  if (requestedSource === 'ADMIN_MASTER' && params.role !== 'ADMIN') {
    return NextResponse.json(
      { error: 'Forbidden — Admin role required for admin master uploads' },
      { status: 403 }
    )
  }

  const validation = validateDocumentDescriptor({
    filename: params.filename,
    mimeType: params.contentType,
    size: params.fileSize,
  })
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: validation.status })
  }

  const storageScope: StorageScope =
    requestedSource === 'ADMIN_MASTER' ? 'admin-kb-docs' : 'knowledge-docs'

  let presigned: Awaited<ReturnType<typeof createPresignedDocumentUpload>>
  try {
    presigned = await createPresignedDocumentUpload({
      scope: storageScope,
      userId: params.userId,
      originalFilename: validation.originalFilename,
      contentType: validation.effectiveContentType,
      expiresInSeconds: 600,
    })
  } catch (err) {
    if (err instanceof StorageConfigurationError) {
      return NextResponse.json(
        { error: 'Direct B2 upload is unavailable because Backblaze B2 is not configured' },
        { status: 500 }
      )
    }
    throw err
  }

  const intent = await prisma.uploadIntent.create({
    data: {
      userId: params.userId,
      docSource: requestedSource,
      storagePath: presigned.storagePath,
      originalFilename: validation.originalFilename,
      mimeType: presigned.contentType,
      expectedSize: Math.trunc(params.fileSize),
      subject: params.title?.trim() || null,
      status: 'PENDING',
      expiresAt: presigned.expiresAt,
    },
    select: {
      id: true,
      expiresAt: true,
      expectedSize: true,
      originalFilename: true,
      docSource: true,
    },
  })

  return NextResponse.json(
    {
      uploadIntentId: intent.id,
      uploadUrl: presigned.uploadUrl,
      expiresAt: intent.expiresAt.toISOString(),
      requiredHeaders: {
        'Content-Type': presigned.contentType,
      },
      maxBytes: MAX_DOCUMENT_BYTES,
      docSource: intent.docSource,
    },
    { status: 201 }
  )
}

export async function completeDirectDocumentUpload(params: {
  uploadIntentId: string
  userId: number
  username?: string | null
  role: string
  title?: string | null
}): Promise<NextResponse> {
  const intentId = (params.uploadIntentId || '').trim()
  if (!intentId) {
    return NextResponse.json({ error: 'uploadIntentId is required' }, { status: 400 })
  }

  const intent = await prisma.uploadIntent.findUnique({
    where: { id: intentId },
  })

  if (!intent) {
    return NextResponse.json({ error: 'Upload intent not found' }, { status: 404 })
  }

  if (intent.userId !== params.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (intent.docSource === 'ADMIN_MASTER' && params.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden — Admin only' }, { status: 403 })
  }

  // Fast idempotent path if already completed
  if (intent.status === 'COMPLETED' && intent.documentId !== null) {
    const existingDoc = await prisma.document.findUnique({
      where: { id: intent.documentId },
      select: { id: true, status: true, storageStatus: true },
    })
    if (!existingDoc) {
      return NextResponse.json(
        { error: 'Completed document no longer exists' },
        { status: 410 }
      )
    }
    return NextResponse.json(
      { success: true, idempotent: true, document: existingDoc },
      { status: 200 }
    )
  }

  if (intent.status === 'CANCELLED') {
    return NextResponse.json({ error: 'Upload session was cancelled' }, { status: 409 })
  }

  if (intent.status === 'EXPIRED' || intent.expiresAt.getTime() < Date.now()) {
    if (intent.status === 'PENDING') {
      await prisma.uploadIntent.updateMany({
        where: { id: intent.id, status: 'PENDING' },
        data: { status: 'EXPIRED' },
      })
    }
    return NextResponse.json(
      { error: 'Upload URL expired before completion. Please upload the file again.' },
      { status: 410 }
    )
  }

  let head: Awaited<ReturnType<typeof headDocumentObject>>
  try {
    head = await headDocumentObject(intent.storagePath)
  } catch (err) {
    if (err instanceof StorageConfigurationError) {
      return NextResponse.json(
        { error: 'Document storage is not configured on the server' },
        { status: 500 }
      )
    }
    return NextResponse.json(
      { error: 'Temporarily unable to verify uploaded file in B2 storage. Please retry completion.' },
      { status: 503 }
    )
  }

  if (!head.exists) {
    return NextResponse.json(
      { error: 'Uploaded file was not found in Backblaze B2 storage' },
      { status: 400 }
    )
  }

  const actualSize = typeof head.contentLength === 'number' ? head.contentLength : 0
  if (actualSize <= 0 || actualSize > MAX_DOCUMENT_BYTES) {
    await deleteDocumentObject(intent.storagePath).catch(() => {})
    await prisma.uploadIntent.updateMany({
      where: { id: intent.id, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    })
    return NextResponse.json(
      { error: 'Uploaded object size is empty or exceeds the 10MB limit' },
      { status: 400 }
    )
  }

  if (actualSize !== intent.expectedSize) {
    await deleteDocumentObject(intent.storagePath).catch(() => {})
    await prisma.uploadIntent.updateMany({
      where: { id: intent.id, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    })
    return NextResponse.json(
      {
        error: `Uploaded file size (${actualSize} bytes) does not match expected size (${intent.expectedSize} bytes)`,
      },
      { status: 400 }
    )
  }

  const headMime = (head.contentType || '').split(';')[0].trim().toLowerCase()
  if (headMime && !ALLOWED_MIME_TYPES.has(headMime) && headMime !== 'application/octet-stream') {
    await deleteDocumentObject(intent.storagePath).catch(() => {})
    await prisma.uploadIntent.updateMany({
      where: { id: intent.id, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    })
    return NextResponse.json(
      { error: `Uploaded object content type (${headMime}) is not allowed` },
      { status: 400 }
    )
  }

  const ext = path.extname(intent.originalFilename).toLowerCase()
  const fileTypeLabel = ext.replace('.', '').toUpperCase() || intent.mimeType
  const docName = (params.title ?? intent.subject ?? '').trim() || intent.originalFilename

  const txResult = await prisma.$transaction(
    async (tx) => {
      const lockedRows = await tx.$queryRaw<
        Array<{ id: string; status: string; documentId: number | null }>
      >`
        SELECT "id", "status"::text AS "status", "documentId"
        FROM "UploadIntent"
        WHERE "id" = ${intent.id}
        FOR UPDATE
      `
      const locked = lockedRows[0]
      if (!locked) {
        return { kind: 'NOT_FOUND' as const }
      }

      if (locked.status === 'COMPLETED' && locked.documentId !== null) {
        const existingDoc = await tx.document.findUnique({
          where: { id: locked.documentId },
          select: { id: true, status: true, storageStatus: true },
        })
        return { kind: 'ALREADY_COMPLETED' as const, document: existingDoc }
      }

      if (locked.status !== 'PENDING') {
        return { kind: 'INVALID_STATE' as const, status: locked.status }
      }

      const now = new Date()
      const createdDoc = await tx.document.create({
        data: {
          name: docName,
          originalFilename: intent.originalFilename,
          fileType: fileTypeLabel,
          fileSize: actualSize,
          storagePath: intent.storagePath,
          contentEtag: head.etag ?? null,
          status: 'UPLOADED',
          storageStatus: 'AVAILABLE',
          lastStorageCheckAt: now,
          userId: intent.userId,
          docSource: intent.docSource,
        },
        select: { id: true, name: true, fileSize: true, fileType: true, status: true, storageStatus: true },
      })

      await tx.uploadIntent.update({
        where: { id: intent.id },
        data: {
          status: 'COMPLETED',
          documentId: createdDoc.id,
          completedAt: now,
        },
      })

      return { kind: 'CREATED' as const, document: createdDoc }
    },
    { maxWait: 5000, timeout: 10000 }
  )

  if (txResult.kind === 'NOT_FOUND') {
    return NextResponse.json({ error: 'Upload intent not found' }, { status: 404 })
  }

  if (txResult.kind === 'INVALID_STATE') {
    return NextResponse.json(
      { error: `Upload intent cannot be completed from state ${txResult.status}` },
      { status: 409 }
    )
  }

  if (txResult.kind === 'ALREADY_COMPLETED') {
    if (!txResult.document) {
      return NextResponse.json({ error: 'Completed document no longer exists' }, { status: 410 })
    }
    return NextResponse.json(
      { success: true, idempotent: true, document: txResult.document },
      { status: 200 }
    )
  }

  const doc = txResult.document

  await createAuditLog({
    userId: params.userId,
    username: params.username ?? undefined,
    action:
      intent.docSource === 'ADMIN_MASTER'
        ? 'ADMIN_KB_DOCUMENT_UPLOADED'
        : 'KNOWLEDGE_DOCUMENT_UPLOADED',
    entityType: 'Document',
    entityId: doc.id.toString(),
    metadata: {
      name: doc.name,
      fileSize: doc.fileSize,
      fileType: doc.fileType,
      storageProvider: 'b2',
      uploadMode: 'direct-presigned',
    },
  })

  scheduleDocumentProcessing(doc.id, {
    userId: params.userId,
    username: params.username,
  })

  return NextResponse.json(
    {
      success: true,
      idempotent: false,
      document: {
        id: doc.id,
        status: doc.status,
        storageStatus: doc.storageStatus,
      },
    },
    { status: 202 }
  )
}

export async function cancelDirectDocumentUpload(params: {
  uploadIntentId: string
  userId: number
  reason?: string | null
}): Promise<NextResponse> {
  const intentId = (params.uploadIntentId || '').trim()
  if (!intentId) {
    return NextResponse.json({ error: 'uploadIntentId is required' }, { status: 400 })
  }

  const intent = await prisma.uploadIntent.findUnique({
    where: { id: intentId },
  })
  if (!intent) {
    return NextResponse.json({ error: 'Upload intent not found' }, { status: 404 })
  }
  if (intent.userId !== params.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (intent.status === 'COMPLETED') {
    return NextResponse.json({ error: 'Upload already completed' }, { status: 409 })
  }

  const targetStatus = params.reason === 'expired' ? 'EXPIRED' : 'CANCELLED'
  const updated = await prisma.uploadIntent.updateMany({
    where: { id: intent.id, status: 'PENDING' },
    data: { status: targetStatus },
  })

  if (updated.count > 0) {
    await deleteDocumentObject(intent.storagePath).catch(() => {})
  }

  return NextResponse.json({
    success: true,
    status: updated.count > 0 ? targetStatus : intent.status,
  })
}
