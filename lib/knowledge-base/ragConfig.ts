import prisma from '@/lib/db'

export interface RagRuntimeSettings {
  enabled: boolean
  topK: number
  chunkSize: number
  chunkOverlap: number
  minSimilarity: number
}

export const DEFAULT_RAG_SETTINGS: RagRuntimeSettings = {
  enabled: true,
  topK: 5,
  chunkSize: 1200,
  chunkOverlap: 200,
  minSimilarity: 0.25,
}

function parseBoundedInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

function parseBoundedFloat(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (!raw) return fallback
  const n = Number.parseFloat(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

/**
 * Loads RAG runtime settings from AppSettings cleanly, falling back safely on missing keys.
 */
export async function getRagRuntimeSettings(): Promise<RagRuntimeSettings> {
  try {
    const rows = await prisma.appSettings.findMany({
      where: {
        key: {
          in: ['rag.enabled', 'rag.top_k', 'rag.chunk_size', 'rag.chunk_overlap', 'rag.min_similarity'],
        },
      },
      select: { key: true, value: true },
    })

    const map = new Map(rows.map((r) => [r.key, r.value]))
    const enabledRaw = map.get('rag.enabled')?.trim().toLowerCase()
    const enabled = enabledRaw === undefined ? DEFAULT_RAG_SETTINGS.enabled : enabledRaw !== 'false'
    const topK = parseBoundedInt(map.get('rag.top_k'), DEFAULT_RAG_SETTINGS.topK, 1, 20)
    const chunkSize = parseBoundedInt(
      map.get('rag.chunk_size'),
      DEFAULT_RAG_SETTINGS.chunkSize,
      200,
      4000
    )
    const maxOverlap = Math.max(0, Math.min(Math.floor(chunkSize / 2), 1000))
    const chunkOverlap = parseBoundedInt(
      map.get('rag.chunk_overlap'),
      Math.min(DEFAULT_RAG_SETTINGS.chunkOverlap, maxOverlap),
      0,
      maxOverlap
    )
    const minSimilarity = parseBoundedFloat(
      map.get('rag.min_similarity'),
      DEFAULT_RAG_SETTINGS.minSimilarity,
      0,
      0.95
    )

    return { enabled, topK, chunkSize, chunkOverlap, minSimilarity }
  } catch {
    return DEFAULT_RAG_SETTINGS
  }
}
