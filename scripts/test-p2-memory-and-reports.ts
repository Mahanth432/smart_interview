import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'

process.env.SESSION_SECRET = 'test_session_secret_at_least_32_characters_long_123456'

let passCount = 0
let failCount = 0

async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn()
    console.log(`  [PASS] ${name}`)
    passCount++
  } catch (err) {
    console.error(`  [FAIL] ${name}:`, err instanceof Error ? err.message : err)
    failCount++
  }
}

async function main() {
  console.log('=== P2 ADAPTIVE AI, CANDIDATE MEMORY & REPORTS VERIFICATION SUITE ===\n')

  const {
    computeForgettingRisk,
    deduplicateQuestionSuggestions,
    buildAnonymizedMemoryContext,
    recordEvaluationToCandidateMemory,
    refreshRevisionRecommendations,
  } = await import('../lib/interview/memory')
  const { getAppSession } = await import('../lib/auth')
  const prisma = (await import('../lib/db')).default

  await check('computeForgettingRisk decays predictably with days, low mastery, and weakness recurrence', () => {
    const now = new Date('2026-11-11T00:00:00Z')
    const recentStrong = computeForgettingRisk({
      masteryScore: 90,
      attemptCount: 4,
      weaknessCount: 0,
      lastTestedAt: new Date('2026-11-10T00:00:00Z'),
      now,
    })
    const staleWeak = computeForgettingRisk({
      masteryScore: 35,
      attemptCount: 2,
      weaknessCount: 3,
      lastTestedAt: new Date('2026-10-25T00:00:00Z'),
      now,
    })
    assert.ok(recentStrong.forgettingRisk < staleWeak.forgettingRisk)
    assert.equal(recentStrong.riskLabel, 'low')
    assert.equal(staleWeak.riskLabel, 'high')
    assert.ok(staleWeak.forgettingRisk >= 0 && staleWeak.forgettingRisk <= 1)
  })

  await check('deduplicateQuestionSuggestions removes exact & paraphrased repeats', () => {
    const previous = [
      'Explain how TCP congestion control uses AIMD and slow start.',
      'What is database normalization up to Third Normal Form?',
    ]
    const filtered = deduplicateQuestionSuggestions(
      [
        { question: 'Explain how TCP congestion control uses AIMD and slow start.' },
        { question: 'Explain how slow start and AIMD work in TCP congestion control?' },
        { question: 'How does LSM-tree compaction affect read versus write amplification?' },
      ],
      previous
    )
    assert.equal(filtered.length, 1)
    assert.match(filtered[0].question || '', /LSM-tree/)
  })

  const origProfileFindUnique = prisma.candidateProfile.findUnique
  const origProfileUpsert = prisma.candidateProfile.upsert
  const origMasteryFindUnique = prisma.candidateConceptMastery.findUnique
  const origMasteryUpsert = prisma.candidateConceptMastery.upsert
  const origMasteryFindMany = prisma.candidateConceptMastery.findMany
  const origRevDeleteMany = prisma.revisionRecommendation.deleteMany
  const origRevCreate = prisma.revisionRecommendation.create
  const origDocFindMany = prisma.document.findMany
  const origUserFindUnique = prisma.user.findUnique
  const origSessionFindUnique = prisma.interviewSession.findUnique
  const origReportUpdate = prisma.interviewReport.update
  const origCandFindMany = prisma.candidate.findMany

  const makeCookie = async (userId: number, role: string) => {
    const seedRes = new Response()
    const s = await getAppSession(new Request('http://localhost:3000'), seedRes)
    s.isLoggedIn = true
    s.userId = userId
    s.username = 'u' + userId
    s.role = role
    s.tokenVersion = 1
    s.expiresAt = Date.now() + 3600_000
    await s.save()
    return (seedRes.headers.get('set-cookie') || '').split(';')[0]
  }

  try {
    await check('buildAnonymizedMemoryContext excludes PII and summarizes weaknesses & decay risk', async () => {
      prisma.candidateProfile.findUnique = (async () => ({
        answeringStyle: 'Structured first-principles explainer',
        reasoningPattern: 'Strong step-by-step decomposition',
        technicalStrengths: ['Binary Trees', 'SQL Joins'],
      })) as unknown as typeof prisma.candidateProfile.findUnique

      prisma.candidateConceptMastery.findMany = (async () => [
        {
          conceptName: 'B-Tree Splitting',
          subject: 'DBMS',
          masteryScore: 42,
          attemptCount: 3,
          weaknessCount: 2,
          lastTestedAt: new Date(Date.now() - 12 * 86400_000),
        },
      ]) as unknown as typeof prisma.candidateConceptMastery.findMany

      const summary = await buildAnonymizedMemoryContext('cand-secret-id')
      assert.match(summary, /Structured first-principles explainer/)
      assert.match(summary, /B-Tree Splitting/)
      assert.equal(summary.includes('cand-secret-id'), false)
    })

    await check('recordEvaluationToCandidateMemory updates mastery & profile cleanly', async () => {
      const savedConcepts: string[] = []
      let savedProfileStyle = ''

      prisma.candidateConceptMastery.findUnique = (async () => null) as unknown as typeof prisma.candidateConceptMastery.findUnique
      prisma.candidateConceptMastery.upsert = (async (args: { create: { conceptName: string } }) => {
        savedConcepts.push(args.create.conceptName)
        return args.create
      }) as unknown as typeof prisma.candidateConceptMastery.upsert

      prisma.candidateProfile.findUnique = (async () => null) as unknown as typeof prisma.candidateProfile.findUnique
      prisma.candidateProfile.upsert = (async (args: { create: { answeringStyle: string } }) => {
        savedProfileStyle = args.create.answeringStyle
        return args.create
      }) as unknown as typeof prisma.candidateProfile.upsert

      await recordEvaluationToCandidateMemory({
        candidateId: 'cand-1',
        subject: 'Computer Networks',
        topic: 'Congestion Control',
        coreConcepts: ['Slow Start', 'AIMD'],
        score: 84,
        communicationScore: 88,
        reasoningQuality: 'Structured first-principles reasoning with trade-offs',
        correctConcepts: ['Slow Start'],
        missingConcepts: ['RED Queue'],
      })

      assert.ok(savedConcepts.includes('Slow Start'))
      assert.ok(savedConcepts.includes('RED Queue'))
      assert.match(savedProfileStyle, /Structured first-principles/i)
    })

    await check('refreshRevisionRecommendations links matching KB docs and prioritizes weak decaying concepts', async () => {
      prisma.candidateConceptMastery.findMany = (async () => [
        {
          conceptName: 'Congestion Avoidance',
          subject: 'Computer Networks',
          masteryScore: 38,
          attemptCount: 2,
          weaknessCount: 3,
          lastTestedAt: new Date(Date.now() - 10 * 86400_000),
          linkedDocumentId: null,
          linkedDocumentName: null,
        },
      ]) as unknown as typeof prisma.candidateConceptMastery.findMany

      prisma.document.findMany = (async () => [
        { id: 55, name: 'Computer Networks Unit 3', subject: 'Computer Networks' },
      ]) as unknown as typeof prisma.document.findMany
      prisma.revisionRecommendation.deleteMany = (async () => ({ count: 0 })) as unknown as typeof prisma.revisionRecommendation.deleteMany
      prisma.revisionRecommendation.create = (async ({ data }: { data: Record<string, unknown> }) => data) as unknown as typeof prisma.revisionRecommendation.create

      const recs = await refreshRevisionRecommendations('cand-1', 77)
      assert.equal(recs.length, 1)
      assert.equal((recs[0] as { linkedDocumentId: number | null }).linkedDocumentId, 55)
    })

    await check('PATCH /api/interview/[sessionId]/report blocks CANDIDATE (403) and preserves AI originals', async () => {
      const { PATCH: patchReport } = await import('../app/api/interview/[sessionId]/report/route')
      prisma.user.findUnique = (async ({ where }: { where: { id: number } }) => ({
        id: where.id,
        username: where.id === 9 ? 'cand9' : 'int77',
        role: where.id === 9 ? 'CANDIDATE' : 'INTERVIEWER',
        tokenVersion: 1,
        emailVerified: true,
      })) as unknown as typeof prisma.user.findUnique

      const candCookie = await makeCookie(9, 'CANDIDATE')
      const resForbidden = await patchReport(
        new NextRequest('http://localhost:3000/api/interview/sess-1/report', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', cookie: candCookie },
          body: JSON.stringify({ executiveSummary: 'Tamper' }),
        }),
        { params: Promise.resolve({ sessionId: 'sess-1' }) }
      )
      assert.equal(resForbidden.status, 403)

      prisma.interviewSession.findUnique = (async () => ({
        id: 'sess-1',
        interviewerId: 77,
        report: {
          id: 'rep-1',
          executiveSummary: 'Original AI summary',
          strengths: ['S1'],
          weaknesses: ['W1'],
          improvementPlan: 'Original AI plan',
          aiExecutiveSummary: null,
          aiStrengths: [],
          aiWeaknesses: [],
          aiImprovementPlan: null,
        },
      })) as unknown as typeof prisma.interviewSession.findUnique

      let updatedData: Record<string, unknown> | null = null
      prisma.interviewReport.update = (async ({ data }: { data: Record<string, unknown> }) => {
        updatedData = data
        return { id: 'rep-1', ...data }
      }) as unknown as typeof prisma.interviewReport.update

      const intCookie = await makeCookie(77, 'INTERVIEWER')
      const resOk = await patchReport(
        new NextRequest('http://localhost:3000/api/interview/sess-1/report', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', cookie: intCookie },
          body: JSON.stringify({ executiveSummary: 'Edited by interviewer', interviewerNotes: 'Strong comms' }),
        }),
        { params: Promise.resolve({ sessionId: 'sess-1' }) }
      )
      assert.equal(resOk.status, 200)
      assert.equal(updatedData?.['aiExecutiveSummary'], 'Original AI summary')
      assert.equal(updatedData?.['executiveSummary'], 'Edited by interviewer')
      assert.equal(updatedData?.['editedByUserId'], 77)
    })

    await check('GET /api/interview/[sessionId]/report/export returns CSV and JSON attachments', async () => {
      const { GET: exportGet } = await import('../app/api/interview/[sessionId]/report/export/route')
      prisma.user.findUnique = (async () => ({
        id: 77,
        username: 'int77',
        role: 'INTERVIEWER',
        tokenVersion: 1,
        emailVerified: true,
      })) as unknown as typeof prisma.user.findUnique

      prisma.interviewSession.findUnique = (async () => ({
        id: 'sess-1',
        interviewerId: 77,
        status: 'completed',
        difficulty: 'medium',
        score: 82,
        startedAt: new Date('2026-11-11T00:00:00Z'),
        endedAt: new Date('2026-11-11T00:30:00Z'),
        topicsCovered: ['Graphs'],
        strongTopics: ['Graphs'],
        weakTopics: [],
        scope: { subject: 'Algorithms', mode: 'standard' },
        candidate: { id: 'c1', name: 'Alice', email: 'alice@kmit.edu', userId: null },
        interviewer: { username: 'int77', email: null, candidate: null },
        report: {
          overallScore: 82,
          executiveSummary: 'Good understanding, needs practice.',
          improvementPlan: 'Practice DFS.',
          strengths: ['BFS'],
          weaknesses: ['Topological sort'],
        },
        gaps: [],
        questions: [],
      })) as unknown as typeof prisma.interviewSession.findUnique

      const intCookie = await makeCookie(77, 'INTERVIEWER')
      const csvRes = await exportGet(
        new NextRequest('http://localhost:3000/api/interview/sess-1/report/export?format=csv', {
          headers: { cookie: intCookie },
        }),
        { params: Promise.resolve({ sessionId: 'sess-1' }) }
      )
      assert.equal(csvRes.status, 200)
      assert.match(csvRes.headers.get('content-type') || '', /text\/csv/)
      const csvText = await csvRes.text()
      assert.match(csvText, /"Good understanding, needs practice\."/)

      const jsonRes = await exportGet(
        new NextRequest('http://localhost:3000/api/interview/sess-1/report/export?format=json', {
          headers: { cookie: intCookie },
        }),
        { params: Promise.resolve({ sessionId: 'sess-1' }) }
      )
      assert.equal(jsonRes.status, 200)
      const jsonBody = await jsonRes.json()
      assert.equal(jsonBody.session.id, 'sess-1')
    })

    await check('GET /api/interviewer/compare scopes candidates to interviewer and computes topic averages', async () => {
      const { GET: compareGet } = await import('../app/api/interviewer/compare/route')
      prisma.user.findUnique = (async () => ({
        id: 77,
        username: 'int77',
        role: 'INTERVIEWER',
        tokenVersion: 1,
        emailVerified: true,
      })) as unknown as typeof prisma.user.findUnique

      prisma.candidate.findMany = (async () => [
        {
          id: 'c1',
          name: 'Cand A',
          email: null,
          profile: { answeringStyle: 'Concise', technicalStrengths: ['DP'] },
          conceptMastery: [],
          sessions: [
            {
              status: 'completed',
              score: 80,
              report: { overallScore: 80, topicScores: { DP: { averageScore: 80 } } },
            },
          ],
        },
      ]) as unknown as typeof prisma.candidate.findMany

      const cookie = await makeCookie(77, 'INTERVIEWER')
      const res = await compareGet(
        new Request('http://localhost:3000/api/interviewer/compare?candidateIds=c1,c2', {
          headers: { cookie },
        })
      )
      assert.equal(res.status, 200)
      const body = await res.json()
      assert.equal(body.comparison[0].topicAverages.DP, 80)
    })
  } finally {
    prisma.candidateProfile.findUnique = origProfileFindUnique
    prisma.candidateProfile.upsert = origProfileUpsert
    prisma.candidateConceptMastery.findUnique = origMasteryFindUnique
    prisma.candidateConceptMastery.upsert = origMasteryUpsert
    prisma.candidateConceptMastery.findMany = origMasteryFindMany
    prisma.revisionRecommendation.deleteMany = origRevDeleteMany
    prisma.revisionRecommendation.create = origRevCreate
    prisma.document.findMany = origDocFindMany
    prisma.user.findUnique = origUserFindUnique
    prisma.interviewSession.findUnique = origSessionFindUnique
    prisma.interviewReport.update = origReportUpdate
    prisma.candidate.findMany = origCandFindMany
  }

  console.log(`\n=== SUMMARY: ${passCount} PASSED, ${failCount} FAILED ===`)
  if (failCount > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
