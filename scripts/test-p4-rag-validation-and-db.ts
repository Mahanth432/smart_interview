import fs from 'node:fs'
import path from 'node:path'
import { parsePaginationParams, parseDateRange } from '../lib/validation/query'
import { isTransientDbError, withDbRetry } from '../lib/db'
import { extractRequestMetadata } from '../lib/audit-log'
import { verifySameOrigin } from '../lib/csrf'

let passed = 0
let failed = 0

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  PASS: ${label}`)
    passed++
  } else {
    console.error(`  FAIL: ${label}`)
    failed++
  }
}

async function main() {
  console.log('1. Pagination & Date Validation (lib/validation/query.ts)')
  const nanParams = new URLSearchParams('page=abc&limit=notanumber')
  const parsedNan = parsePaginationParams(nanParams, { defaultLimit: 25, maxLimit: 100 })
  assert(
    parsedNan.page === 1 && parsedNan.limit === 25 && parsedNan.skip === 0 && !Number.isNaN(parsedNan.skip),
    'NaN page and limit safely fall back without producing NaN skip'
  )

  const hugeParams = new URLSearchParams('page=-5&limit=9999')
  const parsedHuge = parsePaginationParams(hugeParams, { defaultLimit: 20, maxLimit: 100 })
  assert(
    parsedHuge.page === 1 && parsedHuge.limit === 100 && parsedHuge.skip === 0,
    'Negative page clamps to 1 and limit clamps to maxLimit (100)'
  )

  const validParams = new URLSearchParams('page=3&limit=15')
  const parsedValid = parsePaginationParams(validParams)
  assert(
    parsedValid.page === 3 && parsedValid.limit === 15 && parsedValid.skip === 30,
    'Valid page=3 & limit=15 produces skip=30'
  )

  const invalidFrom = parseDateRange('not-a-date', '')
  assert(!invalidFrom.ok && invalidFrom.error.includes('"from"'), 'Invalid from date rejected cleanly')

  const reversedRange = parseDateRange('2026-11-12', '2026-11-01')
  assert(!reversedRange.ok && reversedRange.error.includes('earlier'), 'from > to range rejected cleanly')

  const validRange = parseDateRange('2026-11-01', '2026-11-11')
  assert(validRange.ok && Boolean(validRange.gte) && Boolean(validRange.lte), 'Valid ISO date range accepted')

  console.log('2. Neon Cold-Start Retry & Error Classification (lib/db.ts)')
  assert(isTransientDbError({ code: 'P1001', message: 'db unreachable' }), 'P1001 classified transient')
  assert(isTransientDbError(new Error('Connection terminated unexpectedly')), 'Socket close classified transient')
  assert(!isTransientDbError({ code: 'P2002', message: 'Unique constraint failed' }), 'P2002 NOT retried')

  let flakyAttempts = 0
  const retryResult = await withDbRetry(async () => {
    flakyAttempts += 1
    if (flakyAttempts < 3) {
      throw Object.assign(new Error('Connection terminated unexpectedly'), { code: 'P1017' })
    }
    return 'recovered'
  }, 3, 5)
  assert(retryResult === 'recovered' && flakyAttempts === 3, 'withDbRetry recovers after transient P1017 wakeups')

  let permanentAttempts = 0
  let caughtPermanent = false
  try {
    await withDbRetry(async () => {
      permanentAttempts += 1
      throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
    }, 3, 5)
  } catch {
    caughtPermanent = true
  }
  assert(caughtPermanent && permanentAttempts === 1, 'withDbRetry fails fast on non-transient errors')

  console.log('3. Audit Metadata & CSRF Origin Checks')
  const metaReq = new Request('https://app.example.com/api/auth/login', {
    headers: {
      'x-forwarded-for': '203.0.113.10, 10.0.0.1',
      'user-agent': 'X'.repeat(400),
    },
  })
  const meta = extractRequestMetadata(metaReq)
  assert(meta.ipAddress === '203.0.113.10', 'extractRequestMetadata extracts client IP from x-forwarded-for')
  assert(meta.userAgent !== null && meta.userAgent.length === 250, 'extractRequestMetadata caps userAgent at 250 chars')

  const sameOriginReq = new Request('https://app.example.com/api/auth/logout', {
    method: 'POST',
    headers: { origin: 'https://app.example.com', host: 'app.example.com' },
  })
  const crossOriginReq = new Request('https://app.example.com/api/auth/logout', {
    method: 'POST',
    headers: { origin: 'https://evil.attacker.test', host: 'app.example.com' },
  })
  assert(verifySameOrigin(sameOriginReq) === null, 'verifySameOrigin allows matching Origin (returns null)')
  assert(verifySameOrigin(crossOriginReq)?.status === 403, 'verifySameOrigin blocks cross-site Origin (returns 403)')

  console.log('4. P4 Non-Destructive Index Migration Check')
  const migrationPath = path.join(
    process.cwd(),
    'prisma',
    'migrations',
    '20261111_p4_indexes_and_constraints',
    'migration.sql'
  )
  const sql = fs.readFileSync(migrationPath, 'utf8')
  assert(sql.includes('USING hnsw ("embedding" vector_cosine_ops)'), 'Migration includes HNSW vector index')
  assert(sql.includes('InterviewSession_candidateId_idx'), 'Migration indexes InterviewSession.candidateId')
  assert(sql.includes('Question_sessionId_idx'), 'Migration indexes Question.sessionId')
  assert(!/\b(DROP|TRUNCATE|DELETE)\b/i.test(sql), 'Migration contains zero destructive statements')

  console.log(`\nP4 Validation & DB Checks: ${passed} PASSED, ${failed} FAILED`)
  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
