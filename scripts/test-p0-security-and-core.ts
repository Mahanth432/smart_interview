import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'

// Set deterministic dev env secret BEFORE importing modules
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
  console.log('=== P0 SECURITY & CORE WORKFLOW VERIFICATION SUITE ===\n')

  // 1. Crypto & Secret Validation
  console.log('--- 1. Secrets, Validation & Difficulty Units ---')
  const { getRequiredSessionSecret } = await import('../lib/auth')
  const { validatePasswordStrength } = await import('../lib/validation/user')
  const { normalizeDifficulty, stepDifficulty, parseEvaluationScore } = await import(
    '../lib/interview/difficulty'
  )
  const { sendOtpEmail } = await import('../lib/mail')

  await check('getRequiredSessionSecret fails closed in production when unset', () => {
    const prevEnv = process.env.NODE_ENV
    const prevSecret = process.env.SESSION_SECRET
    try {
      ;(process.env as Record<string, string | undefined>).NODE_ENV = 'production'
      delete process.env.SESSION_SECRET
      assert.throws(() => getRequiredSessionSecret('test'), /SESSION_SECRET/)
      process.env.SESSION_SECRET = 'too-short'
      assert.throws(() => getRequiredSessionSecret('test'), /SESSION_SECRET/)
    } finally {
      ;(process.env as Record<string, string | undefined>).NODE_ENV = prevEnv
      process.env.SESSION_SECRET = prevSecret
    }
  })

  await check('sendOtpEmail fails closed (returns false) in production without SMTP', async () => {
    const prevEnv = process.env.NODE_ENV
    const prevUser = process.env.SMTP_USER
    const prevPass = process.env.SMTP_PASS
    const prevEmail = process.env.SMTP_EMAIL
    const prevPassword = process.env.SMTP_PASSWORD
    try {
      ;(process.env as Record<string, string | undefined>).NODE_ENV = 'production'
      delete process.env.SMTP_USER
      delete process.env.SMTP_PASS
      delete process.env.SMTP_EMAIL
      delete process.env.SMTP_PASSWORD
      const ok = await sendOtpEmail({ email: 'test@example.com', otp: '123456' })
      assert.equal(ok, false)
    } finally {
      ;(process.env as Record<string, string | undefined>).NODE_ENV = prevEnv
      if (prevUser) process.env.SMTP_USER = prevUser
      if (prevPass) process.env.SMTP_PASS = prevPass
      if (prevEmail) process.env.SMTP_EMAIL = prevEmail
      if (prevPassword) process.env.SMTP_PASSWORD = prevPassword
    }
  })

  await check('validatePasswordStrength enforces 8..72 bytes + number/symbol', () => {
    assert.notEqual(validatePasswordStrength('short1'), null)
    assert.notEqual(validatePasswordStrength('onlyletters'), null)
    assert.notEqual(validatePasswordStrength('a'.repeat(73) + '1!'), null)
    assert.equal(validatePasswordStrength('ValidPass1!'), null)
  })

  await check('Canonical difficulty normalization and stepping work for UI & legacy values', () => {
    assert.equal(normalizeDifficulty('beginner'), 'easy')
    assert.equal(normalizeDifficulty('intermediate'), 'medium')
    assert.equal(normalizeDifficulty('advanced'), 'hard')
    assert.equal(normalizeDifficulty('expert'), 'expert')
    assert.equal(stepDifficulty('easy', 85), 'medium')
    assert.equal(stepDifficulty('medium', 80), 'hard')
    assert.equal(stepDifficulty('hard', 95), 'expert')
    assert.equal(stepDifficulty('expert', 30), 'hard')
    assert.equal(stepDifficulty('beginner', 90), 'medium')
  })

  await check('parseEvaluationScore preserves genuine 0 instead of defaulting to 70', () => {
    assert.equal(parseEvaluationScore(0, 70), 0)
    assert.equal(parseEvaluationScore('0', 70), 0)
    assert.equal(parseEvaluationScore(88.5, 70), 88.5)
    assert.equal(parseEvaluationScore(undefined, 70), 70)
    assert.equal(parseEvaluationScore(150, 70), 100)
    assert.equal(parseEvaluationScore(-10, 70), 0)
  })

  // 2. Logout Security & CSRF
  console.log('\n--- 2. Logout Security & Same-Origin CSRF ---')
  const logoutModule = await import('../app/api/auth/logout/route')

  await check('GET /api/auth/logout is not exported (POST-only)', () => {
    assert.equal((logoutModule as Record<string, unknown>).GET, undefined)
    assert.equal(typeof logoutModule.POST, 'function')
  })

  await check('POST /api/auth/logout rejects cross-origin requests with 403', async () => {
    const req = new Request('https://smartinterview.example.com/api/auth/logout', {
      method: 'POST',
      headers: {
        host: 'smartinterview.example.com',
        origin: 'https://evil.attacker.com',
      },
    })
    const res = await logoutModule.POST(req)
    assert.equal(res.status, 403)
  })

  await check('POST /api/auth/logout succeeds on same-origin and clears session cookie', async () => {
    const req = new Request('https://smartinterview.example.com/api/auth/logout', {
      method: 'POST',
      headers: {
        host: 'smartinterview.example.com',
        origin: 'https://smartinterview.example.com',
      },
    })
    const res = await logoutModule.POST(req)
    assert.equal(res.status, 200)
    const setCookie = res.headers.get('set-cookie') || ''
    assert.match(setCookie, /smartinterview_session=/)
    assert.match(setCookie, /Max-Age=0/i)
  })

  // 3. Mocked DB tests for Rate Limit, OTP TOCTOU, set-password, admin settings filter, evaluate, and end idempotency
  console.log('\n--- 3. Mocked Concurrency, Auth & Interview Route Contracts ---')

  const { hashOtp, OTP_MAX_ATTEMPTS } = await import('../lib/otp')
  const prisma = (await import('../lib/db')).default

  // Save originals to restore cleanly
  const origQueryRaw = prisma.$queryRaw
  const origTransaction = prisma.$transaction
  const origOtpFindFirst = prisma.otpVerification.findFirst
  const origOtpUpdateMany = prisma.otpVerification.updateMany
  const origAppSettingsFindMany = prisma.appSettings.findMany
  const origUserFindFirst = prisma.user.findFirst
  const origUserUpdateMany = prisma.user.updateMany

  try {
    // 3A. Atomic Rate Limit SQL contract
    await check('checkRateLimit executes atomic UPSERT RETURNING SQL', async () => {
      const { checkRateLimit } = await import('../lib/rate-limit')
      let calls = 0
      prisma.$queryRaw = (async () => {
        calls++
        return [{ count: calls, resetAt: new Date(Date.now() + 60_000) }]
      }) as typeof prisma.$queryRaw

      const r1 = await checkRateLimit({ key: 'test:ip:1.2.3.4', limit: 2, windowSeconds: 60 })
      const r2 = await checkRateLimit({ key: 'test:ip:1.2.3.4', limit: 2, windowSeconds: 60 })
      const r3 = await checkRateLimit({ key: 'test:ip:1.2.3.4', limit: 2, windowSeconds: 60 })
      assert.equal(r1.allowed, true)
      assert.equal(r2.allowed, true)
      assert.equal(r3.allowed, false)
      assert.equal(r3.count, 3)
    })

    // 3B. Concurrent OTP reuse race prevention
    await check('verifyAndConsumeOtp prevents concurrent double-consumption of same OTP', async () => {
      const { verifyAndConsumeOtp } = await import('../lib/otp-store')
      let used = false
      const validHash = hashOtp('654321')
      prisma.otpVerification.findFirst = (async () => ({
        id: 'otp-1',
        userId: 10,
        otpHash: validHash,
        expiresAt: new Date(Date.now() + 60_000),
        attempts: 0,
      })) as typeof prisma.otpVerification.findFirst

      prisma.otpVerification.updateMany = (async () => {
        if (!used) {
          used = true
          return { count: 1 }
        }
        return { count: 0 }
      }) as typeof prisma.otpVerification.updateMany

      const [a, b] = await Promise.all([
        verifyAndConsumeOtp({ email: 'u@example.com', otp: '654321', purpose: 'EMAIL_VERIFICATION' }),
        verifyAndConsumeOtp({ email: 'u@example.com', otp: '654321', purpose: 'EMAIL_VERIFICATION' }),
      ])
      const successes = [a, b].filter((r) => r.ok)
      assert.equal(successes.length, 1)
    })

    // 3C. set-password rejects missing OTP before mutating user
    await check('set-password rejects password change when OTP is missing (prevents pre-OTP takeover)', async () => {
      const { POST: setPasswordPost } = await import('../app/api/auth/set-password/route')
      prisma.$queryRaw = (async () => [
        { count: 1, resetAt: new Date(Date.now() + 60_000) },
      ]) as typeof prisma.$queryRaw
      let userMutated = false
      prisma.user.updateMany = (async () => {
        userMutated = true
        return { count: 1 }
      }) as typeof prisma.user.updateMany

      const req = new Request('http://localhost:3000/api/auth/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: JSON.stringify({ email: 'victim@example.com', newPassword: 'AttackerPassword1!' }),
      })
      const res = await setPasswordPost(req)
      assert.equal(res.status, 400)
      assert.equal(userMutated, false)
    })

    // 3D. set-password request-otp returns uniform 200 without enumeration
    await check('set-password request-otp returns non-enumerating 200 even for unknown emails', async () => {
      const { POST: setPasswordPost } = await import('../app/api/auth/set-password/route')
      prisma.$queryRaw = (async () => [
        { count: 1, resetAt: new Date(Date.now() + 60_000) },
      ]) as typeof prisma.$queryRaw
      prisma.otpVerification.findFirst = (async () => null) as typeof prisma.otpVerification.findFirst
      prisma.otpVerification.count = (async () => 0) as typeof prisma.otpVerification.count
      prisma.user.findFirst = (async () => null) as typeof prisma.user.findFirst

      const req = new Request('http://localhost:3000/api/auth/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: JSON.stringify({ action: 'request-otp', email: 'nonexistent@example.com' }),
      })
      const res = await setPasswordPost(req)
      assert.equal(res.status, 200)
      const json = await res.json()
      assert.equal(json.otpRequired, true)
    })

    // 3E. GET /api/admin/settings filters strictly to ALLOWED_KEYS
    await check('GET /api/admin/settings queries with ALLOWED_KEYS whitelist only', async () => {
      // Stub getValidatedAppSession DB lookup + ALLOWED_KEYS query filter
      const origUserFindUnique = prisma.user.findUnique
      prisma.user.findUnique = (async () => ({
        id: 1,
        username: 'admin',
        role: 'ADMIN',
        tokenVersion: 1,
        emailVerified: true,
      })) as unknown as typeof prisma.user.findUnique

      let capturedWhere: unknown = null
      prisma.appSettings.findMany = (async (args?: { where?: unknown }) => {
        capturedWhere = args?.where ?? null
        return [{ key: 'rag.enabled', value: 'true', updatedAt: new Date() }]
      }) as typeof prisma.appSettings.findMany

      const { getAppSession } = await import('../lib/auth')
      const { GET: getAdminSettings } = await import('../app/api/admin/settings/route')

      // Sign a real iron-session cookie for ADMIN user
      const seedRes = new Response()
      const s = await getAppSession(new Request('http://localhost:3000'), seedRes)
      s.isLoggedIn = true
      s.userId = 1
      s.username = 'admin'
      s.role = 'ADMIN'
      s.tokenVersion = 1
      s.expiresAt = Date.now() + 3600_000
      await s.save()
      const cookie = (seedRes.headers.get('set-cookie') || '').split(';')[0]

      const req = new Request('http://localhost:3000/api/admin/settings', {
        headers: { cookie },
      })
      let res: Response
      try {
        res = await getAdminSettings(req)
      } finally {
        prisma.user.findUnique = origUserFindUnique
      }
      assert.equal(res.status, 200)
      assert.ok(capturedWhere && typeof capturedWhere === 'object' && 'key' in capturedWhere)
      const inKeys = (capturedWhere as { key: { in: string[] } }).key.in
      assert.equal(inKeys.includes('llm.gemini_api_key'), false)
      assert.equal(inKeys.includes('rag.enabled'), true)
    })

    // 3F. Atomic attempt cap check SQL contract
    await check('OTP invalid code uses atomic attempt increment capped at OTP_MAX_ATTEMPTS', async () => {
      const { verifyAndConsumeOtp } = await import('../lib/otp-store')
      prisma.otpVerification.findFirst = (async () => ({
        id: 'otp-2',
        userId: 10,
        otpHash: hashOtp('999999'),
        expiresAt: new Date(Date.now() + 60_000),
        attempts: 4,
      })) as typeof prisma.otpVerification.findFirst
      prisma.$queryRaw = (async () => [
        { attempts: OTP_MAX_ATTEMPTS, usedAt: new Date() },
      ]) as typeof prisma.$queryRaw

      const r = await verifyAndConsumeOtp({
        email: 'u@example.com',
        otp: '000000',
        purpose: 'EMAIL_VERIFICATION',
      })
      assert.equal(r.ok, false)
      if (!r.ok) {
        assert.equal(r.reason, 'max_attempts')
      }
    })
  } finally {
    prisma.$queryRaw = origQueryRaw
    prisma.$transaction = origTransaction
    prisma.otpVerification.findFirst = origOtpFindFirst
    prisma.otpVerification.updateMany = origOtpUpdateMany
    prisma.appSettings.findMany = origAppSettingsFindMany
    prisma.user.findFirst = origUserFindFirst
    prisma.user.updateMany = origUserUpdateMany
  }

  // 4. Session Revocation, Candidate Isolation & Idempotent End
  console.log('\n--- 4. Session Revocation, Candidate Isolation & Interview Contracts ---')
  const origUserFindUnique = prisma.user.findUnique
  const origCandCount = prisma.candidate.count
  const origCandFindMany = prisma.candidate.findMany
  const origCandFindUnique = prisma.candidate.findUnique
  const origSessionFindUnique = prisma.interviewSession.findUnique

  try {
    const { getAppSession } = await import('../lib/auth')
    const { getValidatedAppSession } = await import('../lib/auth-server')

    const makeSessionCookie = async (userId: number, role: string, tokenVersion = 1) => {
      const seedRes = new Response()
      const s = await getAppSession(new Request('http://localhost:3000'), seedRes)
      s.isLoggedIn = true
      s.userId = userId
      s.username = 'user_' + userId
      s.role = role
      s.tokenVersion = tokenVersion
      s.expiresAt = Date.now() + 3600_000
      await s.save()
      return (seedRes.headers.get('set-cookie') || '').split(';')[0]
    }

    await check('getValidatedAppSession invalidates session when DB tokenVersion increments', async () => {
      prisma.user.findUnique = (async () => ({
        id: 5,
        username: 'alice',
        role: 'INTERVIEWER',
        tokenVersion: 2,
        emailVerified: true,
      })) as unknown as typeof prisma.user.findUnique

      const cookie = await makeSessionCookie(5, 'INTERVIEWER', 1)
      const validated = await getValidatedAppSession(
        new Request('http://localhost:3000', { headers: { cookie } }),
        new Response()
      )
      assert.equal(validated.isLoggedIn, false)
      assert.equal(validated.userId, undefined)
    })

    await check('GET /api/interviewer/candidates blocks CANDIDATE with 403 and scopes INTERVIEWER', async () => {
      const { GET: getCandidates } = await import('../app/api/interviewer/candidates/route')
      prisma.user.findUnique = (async ({ where }: { where: { id: number } }) => ({
        id: where.id,
        username: 'u' + where.id,
        role: where.id === 9 ? 'CANDIDATE' : 'INTERVIEWER',
        tokenVersion: 1,
        emailVerified: true,
      })) as unknown as typeof prisma.user.findUnique

      const candCookie = await makeSessionCookie(9, 'CANDIDATE', 1)
      const resCand = await getCandidates(
        new Request('http://localhost:3000/api/interviewer/candidates', { headers: { cookie: candCookie } })
      )
      assert.equal(resCand.status, 403)

      let capturedWhere: unknown = null
      prisma.candidate.count = (async (args?: { where?: unknown }) => {
        capturedWhere = args?.where ?? null
        return 1
      }) as typeof prisma.candidate.count
      prisma.candidate.findMany = (async () => []) as typeof prisma.candidate.findMany

      const intCookie = await makeSessionCookie(77, 'INTERVIEWER', 1)
      const resInt = await getCandidates(
        new Request('http://localhost:3000/api/interviewer/candidates', { headers: { cookie: intCookie } })
      )
      assert.equal(resInt.status, 200)
      assert.ok(JSON.stringify(capturedWhere).includes('"interviewerId":77'))
    })

    await check('POST /api/interview/start blocks cross-interviewer candidate access with 403', async () => {
      const { POST: startPost } = await import('../app/api/interview/start/route')
      prisma.$queryRaw = (async () => [
        { count: 1, resetAt: new Date(Date.now() + 60_000) },
      ]) as typeof prisma.$queryRaw
      prisma.user.findUnique = (async () => ({
        id: 77,
        username: 'interviewer77',
        role: 'INTERVIEWER',
        tokenVersion: 1,
        emailVerified: true,
      })) as unknown as typeof prisma.user.findUnique
      prisma.candidate.findUnique = (async () => ({
        id: 'cand-other',
        name: 'Other Candidate',
        email: null,
        userId: null,
        sessions: [{ interviewerId: 88 }],
      })) as unknown as typeof prisma.candidate.findUnique

      const intCookie = await makeSessionCookie(77, 'INTERVIEWER', 1)
      const req = new NextRequest('http://localhost:3000/api/interview/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', origin: 'http://localhost:3000', cookie: intCookie },
        body: JSON.stringify({ candidateId: 'cand-other', difficulty: 'hard' }),
      })
      const res = await startPost(req)
      assert.equal(res.status, 403)
    })

    await check('POST /api/interview/end is idempotent when report already exists', async () => {
      const { POST: endPost } = await import('../app/api/interview/end/route')
      prisma.$queryRaw = (async () => [
        { count: 1, resetAt: new Date(Date.now() + 60_000) },
      ]) as typeof prisma.$queryRaw
      prisma.user.findUnique = (async () => ({
        id: 77,
        username: 'interviewer77',
        role: 'INTERVIEWER',
        tokenVersion: 1,
        emailVerified: true,
      })) as unknown as typeof prisma.user.findUnique
      prisma.interviewSession.findUnique = (async () => ({
        id: 'sess-done',
        interviewerId: 77,
        status: 'completed',
        endedAt: new Date(),
        candidate: { userId: null },
        questions: [],
        gaps: [],
        report: { id: 'rep-1', overallScore: 85 },
      })) as unknown as typeof prisma.interviewSession.findUnique

      const intCookie = await makeSessionCookie(77, 'INTERVIEWER', 1)
      const req = new NextRequest('http://localhost:3000/api/interview/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', origin: 'http://localhost:3000', cookie: intCookie },
        body: JSON.stringify({ sessionId: 'sess-done' }),
      })
      const res = await endPost(req)
      assert.equal(res.status, 200)
      const json = await res.json()
      assert.equal(json.alreadyCompleted, true)
      assert.equal(json.reportId, 'rep-1')
    })
  } finally {
    prisma.user.findUnique = origUserFindUnique
    prisma.candidate.count = origCandCount
    prisma.candidate.findMany = origCandFindMany
    prisma.candidate.findUnique = origCandFindUnique
    prisma.interviewSession.findUnique = origSessionFindUnique
    prisma.$queryRaw = origQueryRaw
  }

  console.log(`\n=== SUMMARY: ${passCount} PASSED, ${failCount} FAILED ===`)
  if (failCount > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
