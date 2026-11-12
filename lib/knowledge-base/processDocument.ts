import prisma from '@/lib/db'
import { createAuditLog } from '@/lib/audit-log'
import { DocumentObjectNotFoundError } from '@/lib/storage/b2'
import { confirmAndMarkStorageMissing } from './storageReconciliation'
import { extractTextFromFile } from './extractText'
import { EMBEDDING_DIMENSIONS, generateEmbeddingsBatch } from './embeddings'
import { getRagRuntimeSettings } from './ragConfig'

export class DocumentStorageMissingError extends Error {
  constructor(message = 'Document file is missing from Backblaze B2 storage') {
    super(message)
    this.name = 'DocumentStorageMissingError'
  }
}

const STALE_PROCESSING_MS = 3 * 60 * 1000

// Split text into overlapping chunks respecting configured size/overlap and whitespace boundaries when possible
export function splitIntoChunks(text: string, chunkSize = 1200, overlap = 200): string[] {
  const safeSize = Math.max(200, Math.floor(chunkSize))
  const safeOverlap = Math.max(0, Math.min(Math.floor(overlap), Math.floor(safeSize / 2)))
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(start + safeSize, text.length)
    if (end < text.length) {
      const slice = text.slice(start, end)
      const lastBreak = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf('. '), slice.lastIndexOf(' '))
      if (lastBreak > Math.floor(safeSize * 0.6)) {
        end = start + lastBreak + 1
      }
    }
    const piece = text.slice(start, end).trim()
    if (piece.length > 0) {
      chunks.push(piece)
    }
    if (end >= text.length) break
    const nextStart = end - safeOverlap
    start = nextStart > start ? nextStart : end
  }
  return chunks
}

export function sanitizeProcessingError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || 'Document processing failed')
  const redacted = raw
    .replace(/postgres(ql)?:\/\/[^\s]+/gi, '<redacted-db-url>')
    .replace(/(key|secret|token|password|authorization)=([^\s&]+)/gi, '$1=<redacted>')
    .trim()
  return redacted.length > 400 ? redacted.slice(0, 400) + '...' : redacted
}

export async function markDocumentProcessingFailed(
  docId: number,
  err: unknown,
  context?: { userId?: number | null; username?: string | null }
): Promise<string> {
  const safeError = sanitizeProcessingError(err)

  await prisma.documentChunk
    .deleteMany({ where: { documentId: docId } })
    .catch(() => {})

  await prisma.document
    .updateMany({
      where: {
        id: docId,
        status: { in: ['UPLOADED', 'PROCESSING'] },
      },
      data: { status: 'FAILED' },
    })
    .catch(() => {})

  await createAuditLog({
    userId: context?.userId ?? undefined,
    username: context?.username ?? undefined,
    action: 'DOCUMENT_PROCESSING_FAILED',
    entityType: 'Document',
    entityId: String(docId),
    status: 'FAILURE',
    metadata: { error: safeError },
  })

  return safeError
}

export interface ProcessDocumentResult {
  status: 'PROCESSED' | 'ALREADY_PROCESSING' | 'ALREADY_PROCESSED'
  chunkCount?: number
}

export interface ProcessDocumentOptions {
  force?: boolean
  actingUserId?: number | null
  actingUsername?: string | null
  extractFn?: (storagePath: string, originalFilename?: string, fileType?: string) => Promise<string>
  embedFn?: (texts: string[]) => Promise<number[][]>
}

/**
 * Full durable document processing pipeline:
 *   claim lock (UPLOADED/FAILED -> PROCESSING)
 *   -> extract text -> chunk -> generate 384-dim Xenova/all-MiniLM-L6-v2 embeddings
 *   -> atomic batched DB transaction (delete stale chunks + UNNEST insert + mark PROCESSED)
 *
 * - Uses atomic conditional updateMany lock to prevent concurrent processing of the same document.
 * - Uses a non-interactive Prisma batch $transaction([...]) with UNNEST so Neon PgBouncer
 *   never hits interactive transaction P2028 timeouts while preserving full atomicity.
 * - Guarantees FAILED status + sanitized AuditLog entry on any failure.
 */
export async function processDocument(
  id: number,
  options: ProcessDocumentOptions = {}
): Promise<ProcessDocumentResult> {
  const force = Boolean(options.force)
  const extractFn = options.extractFn ?? extractTextFromFile
  const embedFn = options.embedFn ?? generateEmbeddingsBatch

  const doc = await prisma.document.findUnique({ where: { id } })
  if (!doc) throw new Error('Document not found')
  if (doc.storageStatus === 'MISSING') {
    throw new DocumentStorageMissingError()
  }

  const staleCutoff = new Date(Date.now() - STALE_PROCESSING_MS)
  const allowedStatuses = force ? ['UPLOADED', 'FAILED', 'PROCESSED'] : ['UPLOADED', 'FAILED']

  // Atomic conditional lock prevents duplicate/concurrent processing
  const claimed = await prisma.document.updateMany({
    where: {
      id,
      storageStatus: 'AVAILABLE',
      OR: [
        { status: { in: allowedStatuses } },
        { status: 'PROCESSING', updatedAt: { lt: staleCutoff } },
      ],
    },
    data: { status: 'PROCESSING' },
  })

  if (claimed.count === 0) {
    const latest = await prisma.document.findUnique({
      where: { id },
      select: { status: true, storageStatus: true },
    })
    if (!latest) throw new Error('Document not found')
    if (latest.storageStatus === 'MISSING') {
      throw new DocumentStorageMissingError()
    }
    if (latest.status === 'PROCESSING') {
      return { status: 'ALREADY_PROCESSING' }
    }
    return { status: 'ALREADY_PROCESSED' }
  }

  const auditCtx = {
    userId: options.actingUserId ?? doc.userId,
    username: options.actingUsername ?? null,
  }

  try {
    // Phase 1: Extract text and split into overlapping chunks using admin-configured RAG chunking
    const ragSettings = await getRagRuntimeSettings()
    const extracted = await extractFn(doc.storagePath, doc.originalFilename, doc.fileType)
    const chunkTexts = splitIntoChunks(extracted, ragSettings.chunkSize, ragSettings.chunkOverlap)

    if (chunkTexts.length === 0) {
      throw new Error('Text splitting produced zero chunks')
    }

    console.log(`[processDocument] Doc ${id}: chunk count = ${chunkTexts.length}`)
    console.log(`[processDocument] Doc ${id}: embedding generation started`)

    // Phase 2: Generate 384-dimensional Xenova/all-MiniLM-L6-v2 embeddings in memory
    const embeddings = await embedFn(chunkTexts)
    if (embeddings.length !== chunkTexts.length) {
      throw new Error(
        `Chunk/embedding count mismatch: ${chunkTexts.length} chunks vs ${embeddings.length} embeddings`
      )
    }

    const vectorStrings = embeddings.map((vec, idx) => {
      if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `Invalid embedding dimension at chunk ${idx}: got ${vec?.length ?? 0}, expected ${EMBEDDING_DIMENSIONS}`
        )
      }
      if (vec.some((n) => !Number.isFinite(n))) {
        throw new Error(`Non-finite embedding value at chunk ${idx}`)
      }
      return `[${vec.join(',')}]`
    })
    const chunkIndices = chunkTexts.map((_, idx) => idx)
    const chunkSourceTypes = chunkTexts.map(() => doc.fileType || null)
    const chunkTopics = chunkTexts.map(() => doc.subject || null)

    // Phase 3: Atomic non-interactive batch transaction (immune to P2028 on Neon pooler)
    await prisma.$transaction([
      prisma.documentChunk.deleteMany({ where: { documentId: id } }),
      prisma.$executeRaw`
        INSERT INTO "DocumentChunk" ("documentId", "content", "chunkIndex", "sourceType", "topic", "createdAt", "embedding")
        SELECT ${id}::int, u.content, u.chunk_index, u.source_type, u.topic, NOW(), u.embedding::vector(384)
        FROM UNNEST(
          ${chunkTexts}::text[],
          ${chunkIndices}::int[],
          ${chunkSourceTypes}::text[],
          ${chunkTopics}::text[],
          ${vectorStrings}::text[]
        ) AS u(content, chunk_index, source_type, topic, embedding)
      `,
      prisma.document.update({
        where: { id },
        data: { status: 'PROCESSED' },
      }),
    ])

    console.log(`[processDocument] Doc ${id}: stored ${embeddings.length} embeddings successfully`)

    await createAuditLog({
      userId: auditCtx.userId ?? undefined,
      username: auditCtx.username ?? undefined,
      action: 'DOCUMENT_PROCESSING_SUCCEEDED',
      entityType: 'Document',
      entityId: String(id),
      status: 'SUCCESS',
      metadata: { chunkCount: chunkTexts.length },
    })

    return { status: 'PROCESSED', chunkCount: chunkTexts.length }
  } catch (err: unknown) {
    console.error(`[processDocument] FAILED for doc ${id}:`, err)
    if (err instanceof DocumentObjectNotFoundError) {
      await confirmAndMarkStorageMissing({
        storagePath: doc.storagePath,
        userId: auditCtx.userId ?? undefined,
        username: auditCtx.username,
        reason: 'missing_during_processing',
      }).catch(() => {})
    }
    const safeError = await markDocumentProcessingFailed(id, err, auditCtx)
    throw new Error(safeError)
  }
}

export default processDocument
