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

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.txt', '.md', '.doc', '.docx'])

export function scheduleDocumentProcessing(docId: number): void {
  const run = async () => {
    try {
      const { processDocument } = await import('@/lib/knowledge-base/processDocument')
      await processDocument(docId)
    } catch (err) {
      console.error('Background processing error:', err)
    }
  }

  try {
    after(run)
  } catch {
    void run()
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
  scheduleDocumentProcessing(doc.id)

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
