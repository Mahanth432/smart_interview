import prisma from '@/lib/db'
import { extractTextFromFile } from './extractText'
import { generateEmbeddingsBatch } from './embeddings'

// Split text into overlapping chunks
function splitIntoChunks(text: string, chunkSize = 1200, overlap = 200): string[] {
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

/**
 * Full document processing pipeline:
 *   upload → extract text → clean → chunk → save chunks → generate embeddings → store vectors
 *
 * The document is only marked PROCESSED after ALL chunk embeddings are stored.
 * If any step fails, the document is marked FAILED.
 */
export async function processDocument(id: number) {
  const doc = await prisma.document.findUnique({ where: { id } })
  if (!doc) throw new Error('Document not found')

  // Avoid duplicate processing
  if (doc.status === 'PROCESSING') return

  await prisma.document.update({
    where: { id },
    data: { status: 'PROCESSING' },
  })

  try {
    // === Phase 1: Extract text and create chunks ===
    const extracted = await extractTextFromFile(doc.storagePath, doc.originalFilename, doc.fileType)
    const chunkTexts = splitIntoChunks(extracted)

    if (chunkTexts.length === 0) throw new Error('Text splitting produced zero chunks')

    // Clear any stale chunks from a prior failed run and create new ones
    await prisma.$transaction(async (tx) => {
      await tx.documentChunk.deleteMany({ where: { documentId: id } })
      await tx.documentChunk.createMany({
        data: chunkTexts.map((content, chunkIndex) => ({
          documentId: id,
          content,
          chunkIndex,
        })),
      })
    })

    console.log(`[processDocument] Chunk count: ${chunkTexts.length}`)
    console.log(`[processDocument] Embedding generation started`)

    // === Phase 2: Generate LOCAL embeddings and store them ===
    const embeddings = await generateEmbeddingsBatch(chunkTexts)
    console.log(`[processDocument] Embedding generation completed`)

    // Fetch the created chunk IDs (ordered by chunkIndex to match embedding order)
    const savedChunks = await prisma.documentChunk.findMany({
      where: { documentId: id },
      orderBy: { chunkIndex: 'asc' },
      select: { id: true, chunkIndex: true },
    })

    if (savedChunks.length !== embeddings.length) {
      throw new Error(
        `Chunk/embedding count mismatch: ${savedChunks.length} chunks vs ${embeddings.length} embeddings`
      )
    }

    // Store embeddings using raw SQL inside a single transaction
    const updatePromises = savedChunks.map((chunk, i) => {
      const vector = embeddings[i]
      const vectorStr = `[${vector.join(',')}]`
      return prisma.$executeRawUnsafe(
        `UPDATE "DocumentChunk" SET "embedding" = $1::vector WHERE "id" = $2`,
        vectorStr,
        chunk.id
      )
    })
    await prisma.$transaction(updatePromises)

    console.log(`[processDocument] Doc ${id}: stored ${embeddings.length} embeddings successfully`)

    // === Phase 3: Mark as fully processed ===
    await prisma.document.update({
      where: { id },
      data: { status: 'PROCESSED' },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Processing failed'
    console.error(`[processDocument] FAILED for doc ${id}:`, err)

    // Clean up any partial/unembedded chunks and mark document as FAILED
    await prisma.documentChunk
      .deleteMany({ where: { documentId: id } })
      .catch(() => {})

    await prisma.document
      .update({
        where: { id },
        data: { status: 'FAILED' },
      })
      .catch(() => {})

    throw new Error(message)
  }
}

export default processDocument
