import { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { generateEmbedding } from './embeddings'
import { getRagRuntimeSettings } from './ragConfig'

export interface SearchResult {
  chunkId: number
  documentId: number
  documentName: string
  originalFilename: string
  chunkIndex: number
  content: string
  similarity: number
  pageNumber?: number | null
  sourceType?: string | null
  topic?: string | null
  unit?: string | null
}

export interface SearchChunksOptions {
  minSimilarity?: number
  respectRagEnabled?: boolean
}

export interface RagSourceReference {
  chunkId: number
  documentId: number
  documentName: string
  originalFilename: string
  chunkIndex: number
  similarity: number
  pageNumber?: number | null
  topic?: string | null
}

/**
 * Formats retrieved chunks with explicit source attribution headers and compact reference objects.
 */
export function formatRagContextWithCitations(results: SearchResult[]): {
  contextText: string
  sources: RagSourceReference[]
} {
  if (!results || results.length === 0) {
    return { contextText: '', sources: [] }
  }

  const contextText = results
    .map((r) => {
      const metaParts = [
        `Document: ${r.documentName}`,
        `Chunk #${r.chunkIndex + 1}`,
        r.pageNumber ? `Page ${r.pageNumber}` : null,
        r.topic ? `Topic: ${r.topic}` : null,
        `Relevance: ${(r.similarity * 100).toFixed(0)}%`,
      ].filter(Boolean)
      return `[${metaParts.join(' | ')}]\n${r.content}`
    })
    .join('\n\n')

  const sources: RagSourceReference[] = results.map((r) => ({
    chunkId: r.chunkId,
    documentId: r.documentId,
    documentName: r.documentName,
    originalFilename: r.originalFilename,
    chunkIndex: r.chunkIndex,
    similarity: Math.round(r.similarity * 1000) / 1000,
    pageNumber: r.pageNumber ?? null,
    topic: r.topic ?? null,
  }))

  return { contextText, sources }
}

/**
 * Perform semantic similarity search against DocumentChunk embeddings.
 *
 * - Honors AppSettings `rag.enabled`, `rag.top_k`, and `rag.min_similarity`.
 * - Enforces userId ownership & storageStatus = 'AVAILABLE' isolation.
 * - Filters out irrelevant results below minimum similarity threshold.
 */
export async function searchChunks(
  query: string,
  userId: number,
  topK?: number,
  documentIds?: number[],
  options: SearchChunksOptions = {}
): Promise<SearchResult[]> {
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    throw new Error('Search query cannot be empty')
  }

  if (typeof userId !== 'number' || !Number.isInteger(userId) || userId <= 0) {
    return []
  }

  const ragSettings = await getRagRuntimeSettings()
  const respectEnabled = options.respectRagEnabled !== false
  if (respectEnabled && !ragSettings.enabled) {
    return []
  }

  let docFilter: Prisma.Sql = Prisma.empty
  if (documentIds !== undefined) {
    const validIds = Array.isArray(documentIds)
      ? Array.from(
          new Set(
            documentIds.filter(
              (id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0
            )
          )
        )
      : []

    if (validIds.length === 0) {
      return []
    }

    docFilter = Prisma.sql`AND d."id" IN (${Prisma.join(validIds)})`
  }

  const requestedTopK = typeof topK === 'number' && !isNaN(topK) ? Math.floor(topK) : ragSettings.topK
  const safeLimit = Math.min(Math.max(1, requestedTopK), 100)
  const minSimilarity =
    typeof options.minSimilarity === 'number' && Number.isFinite(options.minSimilarity)
      ? Math.max(0, Math.min(0.95, options.minSimilarity))
      : ragSettings.minSimilarity

  const queryEmbedding = await generateEmbedding(query)
  const vectorStr = `[${queryEmbedding.join(',')}]`

  type ChunkRow = {
    chunk_id: number
    document_id: number
    document_name: string
    original_filename: string
    chunk_index: number
    content: string
    page_number: number | null
    source_type: string | null
    topic: string | null
    unit: string | null
    distance: number
  }

  const runVectorQuery = (client: Pick<typeof prisma, '$queryRaw'>) => client.$queryRaw<ChunkRow[]>`
    SELECT
      dc."id"                AS chunk_id,
      dc."documentId"        AS document_id,
      d."name"               AS document_name,
      d."originalFilename"   AS original_filename,
      dc."chunkIndex"        AS chunk_index,
      dc."content"           AS content,
      dc."pageNumber"        AS page_number,
      dc."sourceType"        AS source_type,
      dc."topic"             AS topic,
      dc."unit"              AS unit,
      (dc."embedding" <=> ${vectorStr}::vector) AS distance
    FROM "DocumentChunk" dc
    INNER JOIN "Document" d ON d."id" = dc."documentId"
    WHERE d."userId" = ${userId}
      AND d."storageStatus" = 'AVAILABLE'
      AND d."status" = 'PROCESSED'
      AND dc."embedding" IS NOT NULL
      ${docFilter}
    ORDER BY dc."embedding" <=> ${vectorStr}::vector ASC
    LIMIT ${safeLimit}
  `

  const results =
    typeof prisma.$transaction === 'function'
      ? await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SET LOCAL hnsw.ef_search = 100`
          return runVectorQuery(tx)
        })
      : await runVectorQuery(prisma)

  return results
    .map((row) => ({
      chunkId: row.chunk_id,
      documentId: row.document_id,
      documentName: row.document_name,
      originalFilename: row.original_filename,
      chunkIndex: row.chunk_index,
      content: row.content,
      similarity: Math.max(0, Math.min(1, 1 - Number(row.distance))),
      pageNumber: row.page_number,
      sourceType: row.source_type,
      topic: row.topic,
      unit: row.unit,
    }))
    .filter((item) => item.similarity >= minSimilarity)
}
