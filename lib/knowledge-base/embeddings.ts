/**
 * Local embedding generation using @xenova/transformers
 * Model: sentence-transformers/all-MiniLM-L6-v2 (384-dimensional)
 *
 * - Runs entirely in the Node.js process (zero API calls, zero cost)
 * - Model is downloaded once on first use, then cached locally
 * - No OpenAI, no mock/random vectors, no external embedding API
 */

import fs from 'fs'
import os from 'os'
import path from 'path'

export const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2'
export const EMBEDDING_DIMENSIONS = 384

// Process-level singleton promise — model is loaded once and reused across all calls
declare const globalThis: {
  _embeddingPipelinePromise?: Promise<unknown> | null
} & typeof global

let _pipelinePromise: Promise<unknown> | null = globalThis._embeddingPipelinePromise ?? null

/**
 * Load (or return cached) embedding pipeline promise.
 * Concurrent requests share the same in-flight promise to prevent duplicate model loads.
 */
const MODEL_LOAD_TIMEOUT_MS = 20_000

async function loadPipelineWithTimeout(): Promise<unknown> {
  const { pipeline, env } = await import('@xenova/transformers')
  if (process.env.VERCEL || process.env.VERCEL_ENV || process.env.TRANSFORMERS_CACHE) {
    // Ephemeral /tmp cache is reused across warm invocations on the same serverless instance
    const cacheDir = process.env.TRANSFORMERS_CACHE || path.join(os.tmpdir(), 'transformers-cache')
    fs.mkdirSync(cacheDir, { recursive: true })
    env.cacheDir = cacheDir
    env.useFSCache = true
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Embedding model load timed out after ${MODEL_LOAD_TIMEOUT_MS}ms`))
    }, MODEL_LOAD_TIMEOUT_MS)
  })

  try {
    console.log('[embeddings] Loading local model: Xenova/all-MiniLM-L6-v2 ...')
    const pipe = await Promise.race([
      pipeline('feature-extraction', EMBEDDING_MODEL, {
        progress_callback: undefined,
      }),
      timeoutPromise,
    ])
    console.log('[embeddings] Model loaded successfully')
    return pipe
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

/**
 * Load (or return cached) embedding pipeline promise.
 * Concurrent requests share the same in-flight promise to prevent duplicate model loads.
 * Retries once on transient cold-start download errors and clears cache on failure.
 */
export function getEmbeddingPipeline(): Promise<unknown> {
  if (!_pipelinePromise) {
    _pipelinePromise = (async () => {
      try {
        return await loadPipelineWithTimeout()
      } catch (firstErr) {
        console.warn(
          '[embeddings] Cold-start model load failed, retrying once:',
          firstErr instanceof Error ? firstErr.message : String(firstErr)
        )
        await new Promise((resolve) => setTimeout(resolve, 500))
        return await loadPipelineWithTimeout()
      }
    })().catch((err) => {
      _pipelinePromise = null
      globalThis._embeddingPipelinePromise = null
      throw new Error(
        `Embedding pipeline unavailable: ${err instanceof Error ? err.message : String(err)}`
      )
    })

    globalThis._embeddingPipelinePromise = _pipelinePromise
  }
  return _pipelinePromise
}

/**
 * Convert raw pipeline output (nested Float32Array/Array) to a plain number[].
 * The pipeline returns shape [1, sequence_length, 384]; we mean-pool to [384].
 */
function toVector(output: unknown): number[] {
  const out = output as { data?: Float32Array; dims?: number[] } | undefined
  const data = out?.data
  const dims = out?.dims

  if (!data || !dims || dims.length < 3) {
    // Fallback: if dims not available, assume already pooled to 384
    const arr = Array.from((data ?? output) as ArrayLike<number>)
    if (arr.length === EMBEDDING_DIMENSIONS) return arr
    throw new Error(`[embeddings] Unexpected output shape: dims=${JSON.stringify(dims)}`)
  }

  const [, seqLen, hidden] = dims
  if (hidden !== EMBEDDING_DIMENSIONS) {
    throw new Error(`[embeddings] Unexpected hidden dim: ${hidden}, expected ${EMBEDDING_DIMENSIONS}`)
  }

  // Mean pooling over sequence dimension
  const pooled = new Array<number>(hidden).fill(0)
  for (let tok = 0; tok < seqLen; tok++) {
    for (let h = 0; h < hidden; h++) {
      pooled[h] += data[tok * hidden + h]
    }
  }
  for (let h = 0; h < hidden; h++) {
    pooled[h] /= seqLen
  }

  return pooled
}

/**
 * Normalize a vector to unit length (required for cosine similarity via pgvector).
 */
function normalizeVector(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0))
  if (!Number.isFinite(norm) || norm === 0) {
    throw new Error('[embeddings] Zero-norm or non-finite embedding vector produced')
  }
  return vec.map((v) => v / norm)
}

const MAX_EMBEDDING_INPUT_CHARS = 1800

/**
 * Generate a 384-dimensional embedding for a single text string.
 * Returns a unit-normalized number[] suitable for pgvector cosine search.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  if (!text || text.trim().length === 0) {
    throw new Error('[embeddings] Cannot generate embedding for empty text')
  }

  const boundedText =
    text.length > MAX_EMBEDDING_INPUT_CHARS ? text.slice(0, MAX_EMBEDDING_INPUT_CHARS) : text

  const pipe = (await getEmbeddingPipeline()) as (
    text: string,
    options?: { pooling?: string; normalize?: boolean }
  ) => Promise<{ data?: Float32Array; dims?: number[]; tolist?: () => number[] | number[][] }>
  const output = await pipe(boundedText, { pooling: 'mean', normalize: true })

  // Try the convenient accessor first (newer @xenova/transformers returns it pooled)
  let vec: number[]
  if (output && typeof output.tolist === 'function') {
    // Flattened 1-D already
    const list = output.tolist()
    // tolist() may return [[...]] (2-D with batch dim) or [...] (1-D)
    vec = Array.isArray(list[0]) ? (list[0] as number[]) : (list as number[])
  } else {
    vec = toVector(output)
  }

  if (vec.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `[embeddings] Dimension mismatch: got ${vec.length}, expected ${EMBEDDING_DIMENSIONS}`
    )
  }

  // Normalize for cosine similarity (pipeline may already do this when normalize:true)
  return normalizeVector(vec)
}

/**
 * Generate 384-dimensional embeddings for a batch of texts.
 * Processes in chunks of BATCH_SIZE to manage memory.
 * Returns number[][] in the same order as the input.
 */
export async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []

  const BATCH_SIZE = 4 // bounded concurrency to prevent Vercel serverless memory exhaustion
  const results: number[][] = []

  console.log(`[embeddings] Generating embeddings for ${texts.length} chunks (batches of ${BATCH_SIZE})`)

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)
    const batchEmbeddings = await Promise.all(batch.map((t) => generateEmbedding(t)))
    results.push(...batchEmbeddings)

    if (i % (BATCH_SIZE * 4) === 0 && i > 0) {
      console.log(`[embeddings]   ... ${i}/${texts.length} done`)
    }
  }

  console.log(`[embeddings] Generated ${results.length} embeddings. Dimension: ${EMBEDDING_DIMENSIONS}`)
  return results
}
