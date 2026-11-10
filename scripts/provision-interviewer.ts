import path from 'path'
import dotenv from 'dotenv'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'

// Load runtime environment without overriding shell-supplied variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
dotenv.config({ path: path.resolve(process.cwd(), '.env') })

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TRANSIENT_PRISMA_CODES = new Set(['P1001', 'P1002', 'P2024'])

function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) {
    return 'INTERVIEWER_PASSWORD must be at least 8 characters long.'
  }
  if (!/[0-9!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password)) {
    return 'INTERVIEWER_PASSWORD must contain at least one number or special character.'
  }
  return null
}

function describeDatabaseHost(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.hostname.includes('neon')) return 'neon'
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') return 'localhost'
    return 'remote-postgres'
  } catch {
    return 'invalid-url'
  }
}

function buildNeonScriptUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl)
  if (parsed.hostname.includes('neon')) {
    if (!parsed.searchParams.has('connect_timeout')) {
      parsed.searchParams.set('connect_timeout', '60')
    }
    if (!parsed.searchParams.has('pool_timeout')) {
      parsed.searchParams.set('pool_timeout', '60')
    }
    if (!parsed.searchParams.has('connection_limit')) {
      parsed.searchParams.set('connection_limit', '1')
    }
  }
  return parsed.toString()
}

function isTransientConnectionError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { code?: string; message?: string }
  if (e.code && TRANSIENT_PRISMA_CODES.has(e.code)) return true
  const msg = e.message || ''
  return (
    msg.includes("Can't reach database server") ||
    msg.includes('Timed out fetching a new connection from the connection pool')
  )
}

async function withRetry<T>(label: string, fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (!isTransientConnectionError(err) || attempt === maxAttempts) {
        throw err
      }
      const delayMs = attempt * 2000
      console.warn(`[retry] ${label} hit transient connection error (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs}ms...`)
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }
  throw lastErr
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run')

  const rawDbUrl = (process.env.DATABASE_URL || process.env.DIRECT_URL || '').trim()
  if (!rawDbUrl) {
    throw new Error('Missing DATABASE_URL or DIRECT_URL in environment.')
  }

  const hostKind = describeDatabaseHost(rawDbUrl)
  if (hostKind === 'invalid-url') {
    throw new Error('Target database URL is not a valid connection URI.')
  }
  if (hostKind !== 'neon' && !process.argv.includes('--allow-non-neon')) {
    throw new Error(
      `Refusing to provision interviewer against non-Neon host (${hostKind}). Set DATABASE_URL/DIRECT_URL to Neon or pass --allow-non-neon.`
    )
  }

  const username = (process.env.INTERVIEWER_USERNAME || '').trim()
  const email = (process.env.INTERVIEWER_EMAIL || '').trim().toLowerCase()
  const name = (process.env.INTERVIEWER_NAME || '').trim()
  const password = process.env.INTERVIEWER_PASSWORD || ''

  if (!username || username.includes('@') || !/^[a-zA-Z0-9_.-]{3,40}$/.test(username)) {
    throw new Error(
      'INTERVIEWER_USERNAME must be set to a valid username (3-40 chars: letters, numbers, _, ., -; must not be an email).'
    )
  }
  if (!email || !EMAIL_REGEX.test(email)) {
    throw new Error('INTERVIEWER_EMAIL must be set to a valid email address.')
  }
  if (!name) {
    throw new Error('INTERVIEWER_NAME must be set to a non-empty display name.')
  }
  if (!password) {
    throw new Error('INTERVIEWER_PASSWORD must be set in the runtime environment.')
  }

  const pwError = validatePasswordStrength(password)
  if (pwError) {
    throw new Error(pwError)
  }

  const normalizedUrl = buildNeonScriptUrl(rawDbUrl)
  const prisma = new PrismaClient({
    datasources: { db: { url: normalizedUrl } },
  })

  try {
    console.log(`Target database host type: ${hostKind}${isDryRun ? ' [DRY RUN]' : ''}`)

    await withRetry('Neon SELECT 1 precheck', async () => {
      await prisma.$connect()
      await prisma.$queryRawUnsafe('SELECT 1')
    })

    const existing = await withRetry('Lookup existing user', () =>
      prisma.user.findFirst({
        where: {
          OR: [
            { email },
            { username: { equals: username, mode: 'insensitive' } },
            { username: email },
          ],
        },
        select: {
          id: true,
          username: true,
          email: true,
          name: true,
          role: true,
          emailVerified: true,
        },
      })
    )

    if (existing) {
      if (existing.role === 'INTERVIEWER' && existing.emailVerified) {
        console.log('Dedicated INTERVIEWER account already exists (no changes made):')
        console.log(JSON.stringify(existing, null, 2))
        return
      }

      throw new Error(
        `Existing user conflict for "${username}" / "${email}" (id=${existing.id}, role=${existing.role}, emailVerified=${existing.emailVerified}). ` +
          'Refusing to modify any existing user role or credentials.'
      )
    }

    if (isDryRun) {
      console.log('DRY RUN OK: No conflicting user found. Ready to create verified INTERVIEWER account:')
      console.log(
        JSON.stringify(
          {
            username,
            email,
            name,
            role: 'INTERVIEWER',
            emailVerified: true,
          },
          null,
          2
        )
      )
      return
    }

    const passwordHash = await bcrypt.hash(password, 12)

    const created = await withRetry('Create INTERVIEWER user', () =>
      prisma.user.create({
        data: {
          username,
          email,
          name,
          passwordHash,
          role: 'INTERVIEWER',
          emailVerified: true,
        },
        select: {
          id: true,
          username: true,
          email: true,
          name: true,
          role: true,
          emailVerified: true,
          createdAt: true,
        },
      })
    )

    await prisma.auditLog
      .create({
        data: {
          userId: created.id,
          username: created.username,
          action: 'INTERVIEWER_PROVISIONED',
          entityType: 'User',
          entityId: String(created.id),
          status: 'SUCCESS',
          metadata: { role: 'INTERVIEWER', emailVerified: true, method: 'cli-provision' },
        },
      })
      .catch((err) => {
        console.warn('Warning: failed to write AuditLog entry:', err instanceof Error ? err.message : err)
      })

    console.log('Created dedicated INTERVIEWER account:')
    console.log(JSON.stringify(created, null, 2))
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err)
  console.error('Provisioning failed:', msg.replace(/postgres(ql)?:\/\/[^\s]+/gi, '<redacted>'))
  process.exit(1)
})
