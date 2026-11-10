import { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { generateEmbedding } from './embeddings'

export interface SearchResult {
  chunkId: number
  documentId: number
  documentName: string
  originalFilename: string
  chunkIndex: number
  content: string
  similarity: number
}

/**
 * Perform semantic similarity search against DocumentChunk embeddings.
 *
 * - Generates an embedding for the query using the same local model (all-MiniLM-L6-v2).
 * - Uses pgvector's cosine distance operator (<=>) in PostgreSQL.
 * - Filters to only chunks belonging to documents owned by the given user.
 * - Returns top K results sorted by similarity (highest first).
 *
 * @param query  Natural-language search query
 * @param userId Authenticated user's ID (ownership filter)
 * @param topK   Number of results to return (default 5, capped at 100)
 * @param documentIds Optional array of document IDs to restrict search to
 */
export async function searchChunks(
  query: string,
  userId: number,
  topK = 5,
  documentIds?: number[]
): Promise<SearchResult[]> {
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    throw new Error('Search query cannot be empty')
  }

  // Validate userId to ensure valid ownership boundary
  if (typeof userId !== 'number' || !Number.isInteger(userId) || userId <= 0) {
    return []
  }

  // Validate and prepare documentIds filter if provided
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

    // If documentIds filter is explicitly provided but contains no valid IDs,
    // enforce hard boundary: return 0 results immediately and avoid invalid SQL (e.g. IN ())
    if (validIds.length === 0) {
      return []
    }

    // Build fully parameterized Prisma.Sql fragment — validIds are bound as parameters, never concatenated
    docFilter = Prisma.sql`AND d."id" IN (${Prisma.join(validIds)})`
  }

  // Validate and clamp topK to a safe integer range [1, 100] while preserving default 5
  const rawTopK = typeof topK === 'number' && !isNaN(topK) ? Math.floor(topK) : 5
  const safeLimit = Math.min(Math.max(1, rawTopK), 100)

  // Generate query embedding using the SAME model as document embeddings
  const queryEmbedding = await generateEmbedding(query)
  const vectorStr = `[${queryEmbedding.join(',')}]`

  // pgvector cosine distance: 1 - cosine_distance = cosine_similarity
  // The <=> operator returns cosine distance (0 = identical, 2 = opposite)
  // We compute similarity as (1 - distance) so higher = more similar
  //
  // All dynamic values are strictly parameterized:
  // - vectorStr is passed into $queryRaw template and cast to ::vector in PostgreSQL
  // - userId is bound as a parameter
  // - docFilter uses Prisma.sql + Prisma.join, ensuring each document ID is a bound parameter
  // - safeLimit is bound as a parameter
  const results = await prisma.$queryRaw<
    Array<{
      chunk_id: number
      document_id: number
      document_name: string
      original_filename: string
      chunk_index: number
      content: string
      distance: number
    }>
  >`
    SELECT
      dc."id"                AS chunk_id,
      dc."documentId"        AS document_id,
      d."name"               AS document_name,
      d."originalFilename"   AS original_filename,
      dc."chunkIndex"        AS chunk_index,
      dc."content"           AS content,
      (dc."embedding" <=> ${vectorStr}::vector) AS distance
    FROM "DocumentChunk" dc
    JOIN "Document" d ON d."id" = dc."documentId"
    WHERE d."userId" = ${userId}
      AND d."storageStatus" = 'AVAILABLE'
      AND dc."embedding" IS NOT NULL
      ${docFilter}
    ORDER BY dc."embedding" <=> ${vectorStr}::vector ASC
    LIMIT ${safeLimit}
  `

  return results.map((r) => ({
    chunkId: r.chunk_id,
    documentId: r.document_id,
    documentName: r.document_name,
    originalFilename: r.original_filename,
    chunkIndex: r.chunk_index,
    content: r.content,
    similarity: Math.round((1 - Number(r.distance)) * 10000) / 10000,
  }))
}

export default searchChunks
