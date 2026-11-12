export const CANONICAL_DIFFICULTIES = ['easy', 'medium', 'hard', 'expert'] as const
export type CanonicalDifficulty = (typeof CANONICAL_DIFFICULTIES)[number]

const LEGACY_DIFFICULTY_MAP: Record<string, CanonicalDifficulty> = {
  beginner: 'easy',
  junior: 'easy',
  foundational: 'easy',
  easy: 'easy',
  intermediate: 'medium',
  'mid-level': 'medium',
  medium: 'medium',
  advanced: 'hard',
  senior: 'hard',
  hard: 'hard',
  expert: 'expert',
  principal: 'expert',
  architect: 'expert',
}

/**
 * Normalizes any UI/legacy difficulty string into the single canonical enum:
 * 'easy' | 'medium' | 'hard' | 'expert'. Defaults to 'medium'.
 */
export function normalizeDifficulty(
  raw: unknown,
  fallback: CanonicalDifficulty = 'medium'
): CanonicalDifficulty {
  if (typeof raw !== 'string') return fallback
  const key = raw.trim().toLowerCase()
  return LEGACY_DIFFICULTY_MAP[key] ?? fallback
}

/**
 * Pure adaptive difficulty transition function.
 * Steps up on score >= 80 and steps down on score <= 40 within CANONICAL_DIFFICULTIES.
 */
export function stepDifficulty(
  current: unknown,
  score: number | null | undefined
): CanonicalDifficulty {
  const normalized = normalizeDifficulty(current, 'medium')
  if (typeof score !== 'number' || !Number.isFinite(score)) {
    return normalized
  }

  const idx = CANONICAL_DIFFICULTIES.indexOf(normalized)
  if (score >= 80 && idx < CANONICAL_DIFFICULTIES.length - 1) {
    return CANONICAL_DIFFICULTIES[idx + 1]
  }
  if (score <= 40 && idx > 0) {
    return CANONICAL_DIFFICULTIES[idx - 1]
  }
  return normalized
}

/**
 * Parses an evaluation score safely in range [0, 100] without coalescing a genuine 0 to 70.
 */
export function parseEvaluationScore(raw: unknown, fallback = 70): number {
  let num: number | null = null
  if (typeof raw === 'number') {
    num = raw
  } else if (typeof raw === 'string' && raw.trim().length > 0) {
    num = Number(raw.trim())
  }

  if (num === null || !Number.isFinite(num)) {
    return fallback
  }
  return Math.max(0, Math.min(100, Math.round(num * 100) / 100))
}
