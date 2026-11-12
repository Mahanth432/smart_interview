import prisma from '@/lib/db'
import type { RagSourceReference } from '@/lib/knowledge-base/searchChunks'

export interface ForgettingRiskEstimate {
  daysSinceTested: number
  stabilityDays: number
  retentionProbability: number
  forgettingRisk: number
  riskLabel: 'low' | 'moderate' | 'high'
  recommendedReviewAt: Date
}

/**
 * Explainable Ebbinghaus-inspired retention decay model:
 * - Stability increases with masteryScore and practice attemptCount, and decreases with repeated weaknesses.
 * - Forgetting risk = 1 - exp(-daysSinceTested / stabilityDays), bounded [0, 1].
 */
export function computeForgettingRisk(params: {
  masteryScore: number
  attemptCount: number
  weaknessCount: number
  lastTestedAt: Date | string
  now?: Date
}): ForgettingRiskEstimate {
  const now = params.now ?? new Date()
  const testedDate =
    params.lastTestedAt instanceof Date ? params.lastTestedAt : new Date(params.lastTestedAt)
  const daysSinceTested = Math.max(0, (now.getTime() - testedDate.getTime()) / (1000 * 60 * 60 * 24))

  const mastery = Math.max(0, Math.min(100, params.masteryScore))
  const attempts = Math.max(1, params.attemptCount)
  const weaknesses = Math.max(0, params.weaknessCount)

  const stabilityDays = Math.max(
    1.5,
    2 + (mastery / 100) * 18 + Math.min(attempts, 5) * 2 - Math.min(weaknesses, 4) * 1.2
  )

  const retentionProbability = Math.exp(-daysSinceTested / stabilityDays)
  const forgettingRisk = Math.max(0, Math.min(1, Math.round((1 - retentionProbability) * 1000) / 1000))
  const riskLabel: 'low' | 'moderate' | 'high' =
    forgettingRisk >= 0.6 ? 'high' : forgettingRisk >= 0.35 ? 'moderate' : 'low'

  // Schedule next ideal review around 70% retention threshold (~0.356 * stabilityDays)
  const idealIntervalDays = Math.max(1, Math.round(stabilityDays * 0.36))
  const recommendedReviewAt = new Date(testedDate.getTime() + idealIntervalDays * 24 * 60 * 60 * 1000)

  return {
    daysSinceTested: Math.round(daysSinceTested * 10) / 10,
    stabilityDays: Math.round(stabilityDays * 10) / 10,
    retentionProbability: Math.round(retentionProbability * 1000) / 1000,
    forgettingRisk,
    riskLabel,
    recommendedReviewAt,
  }
}

export function normalizeConceptKey(concept: string): string {
  return concept.trim().toLowerCase().replace(/[^a-z0-9\s#+.-]/g, '').replace(/\s+/g, ' ')
}

function tokenizeQuestion(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2)
  )
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const token of a) {
    if (b.has(token)) intersection++
  }
  const union = a.size + b.size - intersection
  return union > 0 ? intersection / union : 0
}

/**
 * Filters out AI-generated question suggestions that repeat or closely paraphrase prior session questions.
 */
export function deduplicateQuestionSuggestions<T extends { question?: string }>(
  suggestions: T[],
  previousQuestions: string[],
  similarityThreshold = 0.65
): T[] {
  const seenNormalized = new Set(previousQuestions.map((q) => normalizeConceptKey(q)))
  const seenTokenSets = previousQuestions.map(tokenizeQuestion)
  const accepted: T[] = []

  for (const s of suggestions) {
    const qText = typeof s?.question === 'string' ? s.question.trim() : ''
    if (!qText) continue
    const norm = normalizeConceptKey(qText)
    if (seenNormalized.has(norm)) continue

    const tokens = tokenizeQuestion(qText)
    const isNearDuplicate = seenTokenSets.some((prev) => jaccardSimilarity(tokens, prev) >= similarityThreshold)
    if (isNearDuplicate) continue

    seenNormalized.add(norm)
    seenTokenSets.push(tokens)
    accepted.push(s)
  }

  return accepted.length > 0 ? accepted : suggestions.slice(0, 1)
}

function mergeUniqueStrings(existing: string[], additions: string[], cap = 15): string[] {
  const seen = new Set(existing.map((x) => x.toLowerCase()))
  const merged = [...existing]
  for (const item of additions) {
    const clean = item.trim()
    if (!clean || seen.has(clean.toLowerCase())) continue
    seen.add(clean.toLowerCase())
    merged.push(clean)
  }
  return merged.slice(-cap)
}

function summarizeReasoningStyle(reasoningQuality: string, commScore: number | null, techScore: number): string {
  const lower = reasoningQuality.toLowerCase()
  if (lower.includes('first-principles') || lower.includes('systematic') || lower.includes('structured')) {
    return 'Structured first-principles explainer'
  }
  if (lower.includes('example') || lower.includes('practical') || lower.includes('scenario')) {
    return 'Example-driven applied thinker'
  }
  if (lower.includes('concise') || lower.includes('brief')) {
    return 'Concise high-level responder'
  }
  if (lower.includes('fragment') || lower.includes('vague') || techScore <= 45) {
    return 'Developing foundational reasoning — benefits from guided scaffolding'
  }
  if (typeof commScore === 'number' && commScore >= 75) {
    return 'Clear conceptual communicator'
  }
  return 'Balanced analytical responder'
}

/**
 * Updates persistent CandidateProfile and cross-interview CandidateConceptMastery
 * after every evaluated question.
 */
export async function recordEvaluationToCandidateMemory(params: {
  candidateId: string
  subject: string
  topic?: string | null
  coreConcepts?: string[]
  score: number
  communicationScore?: number | null
  reasoningQuality?: string
  correctConcepts?: string[]
  missingConcepts?: string[]
  incorrectConcepts?: string[]
  knowledgeGaps?: Array<{ concept: string }>
  sourceReferences?: RagSourceReference[]
}): Promise<void> {
  const now = new Date()
  const primarySource = params.sourceReferences?.[0]
  const weakSet = new Set<string>()
  for (const c of [
    ...(params.missingConcepts ?? []),
    ...(params.incorrectConcepts ?? []),
    ...(params.knowledgeGaps ?? []).map((g) => g.concept),
  ]) {
    if (c && c.trim()) weakSet.add(normalizeConceptKey(c))
  }

  const allConcepts = new Map<string, { displayName: string; isWeak: boolean }>()
  for (const c of [...(params.coreConcepts ?? []), ...(params.correctConcepts ?? [])]) {
    const key = normalizeConceptKey(c)
    if (key) allConcepts.set(key, { displayName: c.trim(), isWeak: weakSet.has(key) || params.score < 60 })
  }
  for (const c of [
    ...(params.missingConcepts ?? []),
    ...(params.incorrectConcepts ?? []),
    ...(params.knowledgeGaps ?? []).map((g) => g.concept),
  ]) {
    const key = normalizeConceptKey(c)
    if (key) allConcepts.set(key, { displayName: c.trim(), isWeak: true })
  }
  if (allConcepts.size === 0 && params.topic) {
    const key = normalizeConceptKey(params.topic)
    if (key) allConcepts.set(key, { displayName: params.topic.trim(), isWeak: params.score < 60 })
  }

  for (const [conceptKey, meta] of allConcepts.entries()) {
    const existing = await prisma.candidateConceptMastery.findUnique({
      where: { candidateId_conceptKey: { candidateId: params.candidateId, conceptKey } },
    })

    const obsScore = meta.isWeak ? Math.min(params.score, 50) : params.score
    const nextAttempts = (existing?.attemptCount ?? 0) + 1
    const nextWeaknesses = (existing?.weaknessCount ?? 0) + (meta.isWeak ? 1 : 0)
    const nextMastery = existing
      ? Math.round((existing.masteryScore * 0.65 + obsScore * 0.35) * 100) / 100
      : Math.round(obsScore * 100) / 100

    const risk = computeForgettingRisk({
      masteryScore: nextMastery,
      attemptCount: nextAttempts,
      weaknessCount: nextWeaknesses,
      lastTestedAt: now,
      now,
    })

    await prisma.candidateConceptMastery.upsert({
      where: { candidateId_conceptKey: { candidateId: params.candidateId, conceptKey } },
      update: {
        conceptName: meta.displayName,
        subject: params.subject || existing?.subject || 'General',
        masteryScore: nextMastery,
        attemptCount: nextAttempts,
        weaknessCount: nextWeaknesses,
        lastScore: params.score,
        lastTestedAt: now,
        forgettingRisk: risk.forgettingRisk,
        recommendedReviewAt: risk.recommendedReviewAt,
        linkedDocumentId: primarySource?.documentId ?? existing?.linkedDocumentId ?? null,
        linkedDocumentName: primarySource?.documentName ?? existing?.linkedDocumentName ?? null,
      },
      create: {
        candidateId: params.candidateId,
        conceptKey,
        conceptName: meta.displayName,
        subject: params.subject || 'General',
        masteryScore: nextMastery,
        attemptCount: 1,
        weaknessCount: meta.isWeak ? 1 : 0,
        lastScore: params.score,
        lastTestedAt: now,
        forgettingRisk: risk.forgettingRisk,
        recommendedReviewAt: risk.recommendedReviewAt,
        linkedDocumentId: primarySource?.documentId ?? null,
        linkedDocumentName: primarySource?.documentName ?? null,
      },
    })
  }

  // Update CandidateProfile incrementally
  const profile = await prisma.candidateProfile.findUnique({
    where: { candidateId: params.candidateId },
  })
  const prevTotal = profile?.totalEvaluations ?? 0
  const nextTotal = prevTotal + 1
  const prevAvg = profile?.averageScore ?? params.score
  const nextAvg = Math.round(((prevAvg * prevTotal + params.score) / nextTotal) * 100) / 100

  const styleSummary = summarizeReasoningStyle(
    params.reasoningQuality ?? '',
    params.communicationScore ?? null,
    params.score
  )

  const newStrengths =
    params.score >= 75
      ? mergeUniqueStrings(
          profile?.technicalStrengths ?? [],
          [...(params.correctConcepts ?? []), ...(params.topic ? [params.topic] : [])],
          12
        )
      : profile?.technicalStrengths ?? []

  const commTraitAdditions: string[] = []
  if (typeof params.communicationScore === 'number') {
    if (params.communicationScore >= 80) commTraitAdditions.push('Clear structured articulation')
    else if (params.communicationScore < 55) commTraitAdditions.push('Needs clearer structured explanations')
  }
  if (params.reasoningQuality?.trim()) {
    commTraitAdditions.push(params.reasoningQuality.trim().slice(0, 80))
  }
  const nextCommTraits = mergeUniqueStrings(profile?.communicationTraits ?? [], commTraitAdditions, 8)

  const prefAdditions: string[] = []
  if (weakSet.size > 0) prefAdditions.push(`Spaced practice on ${params.subject}`)
  if (params.score >= 80) prefAdditions.push(`Deep-dive trade-offs in ${params.subject}`)
  const nextPrefs = mergeUniqueStrings(profile?.learningPreferences ?? [], prefAdditions, 6)

  await prisma.candidateProfile.upsert({
    where: { candidateId: params.candidateId },
    update: {
      answeringStyle: styleSummary,
      reasoningPattern: params.reasoningQuality?.trim() || profile?.reasoningPattern || styleSummary,
      technicalStrengths: newStrengths,
      communicationTraits: nextCommTraits,
      learningPreferences: nextPrefs,
      totalEvaluations: nextTotal,
      averageScore: nextAvg,
      lastAnalyzedAt: now,
    },
    create: {
      candidateId: params.candidateId,
      answeringStyle: styleSummary,
      reasoningPattern: params.reasoningQuality?.trim() || styleSummary,
      technicalStrengths: newStrengths,
      communicationTraits: nextCommTraits,
      learningPreferences: nextPrefs,
      totalEvaluations: nextTotal,
      averageScore: nextAvg,
      lastAnalyzedAt: now,
    },
  })
}

/**
 * Recomputes prioritized revision recommendations based on mastery, recurring weaknesses,
 * and current forgetting risk, linking matching KB materials when available.
 */
export async function refreshRevisionRecommendations(
  candidateId: string,
  kbOwnerUserId?: number | null
) {
  const masteries = await prisma.candidateConceptMastery.findMany({
    where: { candidateId },
    orderBy: [{ weaknessCount: 'desc' }, { masteryScore: 'asc' }],
  })

  if (masteries.length === 0) return []

  const now = new Date()
  const ranked = masteries
    .map((m) => {
      const risk = computeForgettingRisk({
        masteryScore: m.masteryScore,
        attemptCount: m.attemptCount,
        weaknessCount: m.weaknessCount,
        lastTestedAt: m.lastTestedAt,
        now,
      })

      const priorityScore =
        Math.round(
          ((100 - m.masteryScore) * 0.45 +
            risk.forgettingRisk * 100 * 0.35 +
            Math.min(m.weaknessCount * 12, 30) * 0.2) *
            10
        ) / 10

      return { m, risk, priorityScore }
    })
    .filter((entry) => entry.m.weaknessCount > 0 || entry.m.masteryScore < 75 || entry.risk.forgettingRisk >= 0.4)
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, 8)

  // Optionally find matching KB docs by subject/name without calling external LLMs
  let ownerDocs: Array<{ id: number; name: string; subject: string | null }> = []
  if (kbOwnerUserId) {
    ownerDocs = await prisma.document.findMany({
      where: { userId: kbOwnerUserId, status: 'PROCESSED', storageStatus: 'AVAILABLE' },
      select: { id: true, name: true, subject: true },
      take: 25,
    })
  }

  await prisma.revisionRecommendation.deleteMany({
    where: { candidateId, status: 'pending' },
  })

  if (ranked.length === 0) return []

  const created = []
  for (const { m, risk, priorityScore } of ranked) {
    const matchedDoc =
      m.linkedDocumentId && m.linkedDocumentName
        ? { id: m.linkedDocumentId, name: m.linkedDocumentName }
        : ownerDocs.find(
            (d) =>
              (d.subject && m.subject.toLowerCase().includes(d.subject.toLowerCase())) ||
              d.name.toLowerCase().includes(m.conceptName.toLowerCase()) ||
              d.name.toLowerCase().includes(m.subject.toLowerCase())
          ) ?? null

    const reasonParts = [
      `Mastery ${Math.round(m.masteryScore)}%`,
      m.weaknessCount > 0 ? `flagged weak ${m.weaknessCount} time(s)` : null,
      `${Math.round(risk.forgettingRisk * 100)}% forgetting risk (${risk.daysSinceTested}d since review)`,
    ].filter(Boolean)

    const rec = await prisma.revisionRecommendation.create({
      data: {
        candidateId,
        conceptName: m.conceptName,
        subject: m.subject,
        priorityScore,
        forgettingRisk: risk.forgettingRisk,
        reason: reasonParts.join(' • '),
        linkedDocumentId: matchedDoc?.id ?? null,
        linkedDocumentName: matchedDoc?.name ?? null,
        status: 'pending',
      },
    })
    created.push(rec)
  }

  return created
}

/**
 * Returns an anonymized summary string for AI prompt injection.
 * Strictly strips personal identifiers (name, email, IDs).
 */
export async function buildAnonymizedMemoryContext(candidateId: string): Promise<string> {
  const [profile, masteries] = await Promise.all([
    prisma.candidateProfile.findUnique({ where: { candidateId } }),
    prisma.candidateConceptMastery.findMany({
      where: { candidateId },
      orderBy: [{ weaknessCount: 'desc' }, { masteryScore: 'asc' }],
      take: 15,
    }),
  ])

  if (!profile && masteries.length === 0) {
    return 'No prior cross-interview memory recorded yet (first assessment).'
  }

  const now = new Date()
  const recurringWeaknesses = masteries
    .filter((m) => m.weaknessCount > 0 || m.masteryScore < 60)
    .slice(0, 6)
    .map((m) => `${m.conceptName} (${m.subject}, mastery ${Math.round(m.masteryScore)}%, weak ${m.weaknessCount}x)`)

  const atForgettingRisk = masteries
    .map((m) => ({
      m,
      risk: computeForgettingRisk({
        masteryScore: m.masteryScore,
        attemptCount: m.attemptCount,
        weaknessCount: m.weaknessCount,
        lastTestedAt: m.lastTestedAt,
        now,
      }),
    }))
    .filter((x) => x.risk.forgettingRisk >= 0.45)
    .sort((a, b) => b.risk.forgettingRisk - a.risk.forgettingRisk)
    .slice(0, 5)
    .map((x) => `${x.m.conceptName} (${Math.round(x.risk.forgettingRisk * 100)}% decay risk)`)

  return [
    profile?.answeringStyle ? `- Answering Style: ${profile.answeringStyle}` : null,
    profile?.reasoningPattern ? `- Reasoning Pattern: ${profile.reasoningPattern}` : null,
    profile?.technicalStrengths?.length
      ? `- Prior Technical Strengths: ${profile.technicalStrengths.slice(0, 6).join(', ')}`
      : null,
    recurringWeaknesses.length > 0
      ? `- Recurring Cross-Session Weaknesses: ${recurringWeaknesses.join('; ')}`
      : null,
    atForgettingRisk.length > 0
      ? `- High Forgetting-Risk Concepts (verify retention): ${atForgettingRisk.join('; ')}`
      : null,
  ]
    .filter(Boolean)
    .join('\n')
}

export async function getCandidateLearningSnapshot(candidateId: string) {
  const now = new Date()
  const [profile, masteries, revisions, sessions] = await Promise.all([
    prisma.candidateProfile.findUnique({ where: { candidateId } }),
    prisma.candidateConceptMastery.findMany({
      where: { candidateId },
      orderBy: [{ masteryScore: 'asc' }, { weaknessCount: 'desc' }],
    }),
    prisma.revisionRecommendation.findMany({
      where: { candidateId, status: 'pending' },
      orderBy: { priorityScore: 'desc' },
      take: 10,
    }),
    prisma.interviewSession.findMany({
      where: { candidateId },
      orderBy: { startedAt: 'asc' },
      select: {
        id: true,
        startedAt: true,
        status: true,
        difficulty: true,
        score: true,
        scope: true,
        topicsCovered: true,
        strongTopics: true,
        weakTopics: true,
        report: { select: { overallScore: true, topicScores: true } },
      },
    }),
  ])

  const enrichedMasteries = masteries.map((m) => {
    const estimate = computeForgettingRisk({
      masteryScore: m.masteryScore,
      attemptCount: m.attemptCount,
      weaknessCount: m.weaknessCount,
      lastTestedAt: m.lastTestedAt,
      now,
    })
    return {
      ...m,
      forgettingRisk: estimate.forgettingRisk,
      retentionProbability: estimate.retentionProbability,
      daysSinceTested: estimate.daysSinceTested,
      stabilityDays: estimate.stabilityDays,
      riskLabel: estimate.riskLabel,
    }
  })

  const recurringWeaknesses = enrichedMasteries.filter((m) => m.weaknessCount >= 2 || m.masteryScore < 55)
  const forgettingPredictions = [...enrichedMasteries]
    .filter((m) => m.forgettingRisk >= 0.35)
    .sort((a, b) => b.forgettingRisk - a.forgettingRisk)

  // Longitudinal topic aggregation across sessions
  const topicHistoryMap = new Map<string, Array<{ date: string; score: number }>>()
  const progression = sessions
    .filter((s) => typeof (s.score ?? s.report?.overallScore) === 'number')
    .map((s, idx) => {
      const scope = s.scope as { subject?: string } | null
      const score = Number(s.score ?? s.report?.overallScore ?? 0)
      const dateStr = new Date(s.startedAt).toISOString().slice(0, 10)
      const topicScores = s.report?.topicScores as Record<string, { averageScore?: number }> | null
      if (topicScores && typeof topicScores === 'object') {
        for (const [topic, val] of Object.entries(topicScores)) {
          if (typeof val?.averageScore === 'number') {
            const arr = topicHistoryMap.get(topic) ?? []
            arr.push({ date: dateStr, score: val.averageScore })
            topicHistoryMap.set(topic, arr)
          }
        }
      }
      return {
        sessionId: s.id,
        sessionNumber: idx + 1,
        subject: scope?.subject || 'General',
        difficulty: s.difficulty,
        score,
        date: s.startedAt,
      }
    })

  return {
    profile,
    conceptMasteries: enrichedMasteries,
    recurringWeaknesses,
    forgettingPredictions,
    revisions,
    progression,
    topicProgression: Object.fromEntries(topicHistoryMap.entries()),
  }
}
