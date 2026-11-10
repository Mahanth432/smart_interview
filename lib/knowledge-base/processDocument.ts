import prisma from '@/lib/db'
import { createAuditLog } from '@/lib/audit-log'
import { extractTextFromFile } from './extractText'
import { EMBEDDING_DIMENSIONS, generateEmbeddingsBatch } from './embeddings'

const STALE_PROCESSING_MS = 3 * 60 * 1000

// Split text into overlapping chunks
export function splitIntoChunks(text: string, chunkSize = 1200, overlap = 200): string[] {
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length)
    chunks.push(text.slice(start, end).trim())
    if (end === text.length) break
    start += chunkSize - overlap
  }
  return chunks.filter((c) => c.length > 0)
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

  const staleCutoff = new Date(Date.now() - STALE_PROCESSING_MS)
  const allowedStatuses = force ? ['UPLOADED', 'FAILED', 'PROCESSED'] : ['UPLOADED', 'FAILED']

  // Atomic conditional lock prevents duplicate/concurrent processing
  const claimed = await prisma.document.updateMany({
    where: {
      id,
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
      select: { status: true },
    })
    if (!latest) throw new Error('Document not found')
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
    // Phase 1: Extract text and split into overlapping chunks
    const extracted = await extractFn(doc.storagePath, doc.originalFilename, doc.fileType)
    const chunkTexts = splitIntoChunks(extracted)

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

    // Phase 3: Atomic non-interactive batch transaction (immune to P2028 on Neon pooler)
    await prisma.$transaction([
      prisma.documentChunk.deleteMany({ where: { documentId: id } }),
      prisma.$executeRaw`
        INSERT INTO "DocumentChunk" ("documentId", "content", "chunkIndex", "createdAt", "embedding")
        SELECT ${id}::int, u.content, u.chunk_index, NOW(), u.embedding::vector(384)
        FROM UNNEST(
          ${chunkTexts}::text[],
          ${chunkIndices}::int[],
          ${vectorStrings}::text[]
        ) AS u(content, chunk_index, embedding)
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
    const safeError = await markDocumentProcessingFailed(id, err, auditCtx)
    throw new Error(safeError)
  }
}

export default processDocument
