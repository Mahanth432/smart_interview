import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'

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
  console.log('=== P1 KB, RAG, LIFECYCLE & HEALTH VERIFICATION SUITE ===\n')

  const { validateClientDocumentFile } = await import('../lib/knowledge-base/clientDirectUpload')
  const { splitIntoChunks } = await import('../lib/knowledge-base/processDocument')
  const { formatRagContextWithCitations, searchChunks } = await import(
    '../lib/knowledge-base/searchChunks'
  )
  const { handleLLMError } = await import('../lib/llm')
  const { getAppSession } = await import('../lib/auth')
  const prisma = (await import('../lib/db')).default

  await check('Client document validation rejects binary .doc files cleanly', () => {
    const fakeDoc = { name: 'syllabus.doc', size: 2048 } as unknown as File
    const fakeDocx = { name: 'syllabus.docx', size: 2048 } as unknown as File
    assert.match(validateClientDocumentFile(fakeDoc) || '', /not supported/i)
    assert.equal(validateClientDocumentFile(fakeDocx), null)
  })

  await check('splitIntoChunks honors custom chunkSize & chunkOverlap cleanly', () => {
    const sample = Array.from({ length: 40 }, (_, i) => `Sentence number ${i + 1} explains indexing.`).join(' ')
    const small = splitIntoChunks(sample, 240, 40)
    const large = splitIntoChunks(sample, 900, 100)
    assert.ok(small.length > large.length)
    assert.ok(small.every((c) => c.length <= 240))
  })

  await check('formatRagContextWithCitations preserves document metadata and scores', () => {
    const { contextText, sources } = formatRagContextWithCitations([
      {
        chunkId: 11,
        documentId: 55,
        documentName: 'CN_Notes',
        originalFilename: 'cn.pdf',
        chunkIndex: 2,
        content: 'Sliding window flow control regulates sender frames.',
        similarity: 0.78,
        pageNumber: 4,
        topic: 'Computer Networks',
      },
    ])
    assert.match(contextText, /Document: CN_Notes/)
    assert.match(contextText, /Chunk #3/)
    assert.match(contextText, /Relevance: 78%/)
    assert.equal(sources.length, 1)
    assert.equal(sources[0].documentId, 55)
  })

  await check('handleLLMError separates Prisma DB/JSON errors from LLM provider outages', () => {
    const dupErr = new Prisma.PrismaClientKnownRequestError('Unique violation', {
      code: 'P2002',
      clientVersion: '6.3.0',
    })
    assert.equal(handleLLMError(dupErr).status, 409)
    assert.equal(handleLLMError(new SyntaxError('Unexpected token')).status, 400)
    assert.equal(handleLLMError(new Error('LLM down')).status, 503)
  })

  const origSettingsFindMany = prisma.appSettings.findMany
  const origQueryRaw = prisma.$queryRaw
  const origUserFindUnique = prisma.user.findUnique
  const origSessionFindUnique = prisma.interviewSession.findUnique
  const origSessionUpdate = prisma.interviewSession.update
  const origDocFindMany = prisma.document.findMany
  const origDocFindUnique = prisma.document.findUnique
  const origDocDelete = prisma.document.delete
  const origDocDeleteMany = prisma.document.deleteMany
  const origDocCount = prisma.document.count
  const origTransaction = prisma.$transaction

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
    await check('searchChunks returns [] immediately when rag.enabled is false', async () => {
      prisma.appSettings.findMany = (async () => [
        { key: 'rag.enabled', value: 'false' },
      ]) as unknown as typeof prisma.appSettings.findMany

      const hits = await searchChunks('binary search tree', 77, 5)
      assert.deepEqual(hits, [])
    })

    await check('GET /api/health checks DB and omits secret credentials', async () => {
      const { GET: healthGet } = await import('../app/api/health/route')
      prisma.$queryRaw = (async () => [{ '?column?': 1 }]) as typeof prisma.$queryRaw
      const res = await healthGet()
      assert.equal(res.status, 200)
      const body = await res.json()
      assert.equal(body.status, 'ok')
      assert.equal(body.database.ok, true)
      const serialized = JSON.stringify(body)
      assert.equal(serialized.includes('postgresql://'), false)
      assert.equal(serialized.includes(process.env.SESSION_SECRET || 'NONE'), false)
    })

    await check('POST /api/interview/pause and /api/interview/abandon enforce ownership and transitions', async () => {
      const { POST: pausePost } = await import('../app/api/interview/pause/route')
      const { POST: abandonPost } = await import('../app/api/interview/abandon/route')

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
        status: 'active',
        candidate: { userId: null },
      })) as unknown as typeof prisma.interviewSession.findUnique

      let lastStatusWritten = ''
      prisma.interviewSession.update = (async ({ data }: { data: { status: string } }) => {
        lastStatusWritten = data.status
        return { id: 'sess-1', status: data.status, pausedAt: new Date(), endedAt: new Date() }
      }) as unknown as typeof prisma.interviewSession.update

      const cookie = await makeCookie(77, 'INTERVIEWER')
      const pauseRes = await pausePost(
        new NextRequest('http://localhost:3000/api/interview/pause', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie },
          body: JSON.stringify({ sessionId: 'sess-1' }),
        })
      )
      assert.equal(pauseRes.status, 200)
      assert.equal(lastStatusWritten, 'paused')

      const abandonRes = await abandonPost(
        new NextRequest('http://localhost:3000/api/interview/abandon', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie },
          body: JSON.stringify({ sessionId: 'sess-1' }),
        })
      )
      assert.equal(abandonRes.status, 200)
      assert.equal(lastStatusWritten, 'abandoned')
    })

    await check('POST /api/knowledge-base/fetch filters to PROCESSED docs only and prunes stale synced copies', async () => {
      const { POST: fetchKbPost } = await import('../app/api/knowledge-base/fetch/route')
      let capturedAdminWhere: Record<string, unknown> | null = null
      let deletedStaleIds: number[] = []

      prisma.document.findMany = (async (args?: { where?: Record<string, unknown> }) => {
        if (args?.where?.docSource === 'ADMIN_MASTER') {
          capturedAdminWhere = args.where
          return []
        }
        return [
          {
            id: 901,
            adminDocId: 404,
            docSource: 'SYNCED_FROM_ADMIN',
            updatedAt: new Date(),
            status: 'PROCESSED',
            storageStatus: 'AVAILABLE',
            _count: { chunks: 2 },
          },
        ]
      }) as unknown as typeof prisma.document.findMany

      prisma.document.deleteMany = (async (args?: { where?: { id?: { in?: number[] } } }) => {
        deletedStaleIds = args?.where?.id?.in || []
        return { count: deletedStaleIds.length }
      }) as unknown as typeof prisma.document.deleteMany

      const cookie = await makeCookie(77, 'INTERVIEWER')
      const res = await fetchKbPost(
        new Request('http://localhost:3000/api/knowledge-base/fetch', {
          method: 'POST',
          headers: { cookie },
        })
      )
      assert.equal(res.status, 200)
      const json = await res.json()
      assert.equal(capturedAdminWhere?.['status'], 'PROCESSED')
      assert.deepEqual(deletedStaleIds, [901])
      assert.equal(json.removed, 1)
    })

    await check('DELETE /api/admin/knowledge-base/[id] removes SYNCED_FROM_ADMIN copies before B2 ref check', async () => {
      const { DELETE: deleteAdminKb } = await import('../app/api/admin/knowledge-base/[id]/route')
      let syncedDeletedWhere: Record<string, unknown> | null = null

      prisma.document.findUnique = (async () => ({
        id: 50,
        name: 'Master Doc',
        docSource: 'ADMIN_MASTER',
        storagePath: '',
      })) as unknown as typeof prisma.document.findUnique

      prisma.$transaction = (async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          document: {
            deleteMany: async (args: { where: Record<string, unknown> }) => {
              syncedDeletedWhere = args.where
              return { count: 2 }
            },
            delete: async () => ({ id: 50 }),
          },
        })) as unknown as typeof prisma.$transaction

      const cookie = await makeCookie(1, 'ADMIN')
      const res = await deleteAdminKb(
        new NextRequest('http://localhost:3000/api/admin/knowledge-base/50', {
          method: 'DELETE',
          headers: { cookie },
        }),
        { params: Promise.resolve({ id: '50' }) }
      )
      assert.equal(res.status, 200)
      const json = await res.json()
      assert.equal(syncedDeletedWhere?.['adminDocId'], 50)
      assert.equal(json.deletedSyncedCopies, 2)
    })
  } finally {
    prisma.appSettings.findMany = origSettingsFindMany
    prisma.$queryRaw = origQueryRaw
    prisma.user.findUnique = origUserFindUnique
    prisma.interviewSession.findUnique = origSessionFindUnique
    prisma.interviewSession.update = origSessionUpdate
    prisma.document.findMany = origDocFindMany
    prisma.document.findUnique = origDocFindUnique
    prisma.document.delete = origDocDelete
    prisma.document.deleteMany = origDocDeleteMany
    prisma.document.count = origDocCount
    prisma.$transaction = origTransaction
  }

  console.log(`\n=== SUMMARY: ${passCount} PASSED, ${failCount} FAILED ===`)
  if (failCount > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
