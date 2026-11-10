import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import dotenv from 'dotenv'
import { PrismaClient } from '@prisma/client'
import {
  S3Client,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'

// Load runtime environment without overriding shell-supplied variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
dotenv.config({ path: path.resolve(process.cwd(), '.env') })

const TARGET_DOC_IDS = [35, 39, 42, 43] as const
const EXPECTED_TOTAL_CHUNKS = 278
const EXPECTED_VECTOR_DIM = 384
const CHUNK_INSERT_BATCH_SIZE = 50
const SOURCE_FOLDER = path.resolve(process.cwd(), 'storage', 'knowledge-docs')
const TRANSIENT_PRISMA_CODES = new Set(['P1001', 'P1002', 'P2024'])

interface LocalDocRow {
  id: number
  name: string
  originalFilename: string
  fileType: string
  fileSize: number
  storagePath: string
  status: string
  userId: number
  createdAt: Date
  updatedAt: Date
  branch: string | null
  institution: string | null
  semester: string | null
  subject: string | null
  docSource: string
  adminDocId: number | null
}

interface LocalChunkRow {
  id: number
  documentId: number
  content: string
  chunkIndex: number
  createdAt: Date
  pageNumber: number | null
  sourceType: string | null
  topic: string | null
  unit: string | null
  embeddingText: string | null
  embeddingDims: number | null
}

interface B2Config {
  endpoint: string
  region: string
  bucketName: string
  keyId: string
  applicationKey: string
}

function normalizeEndpoint(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

function getB2ConfigFromEnv(): B2Config {
  const endpoint = normalizeEndpoint(process.env.B2_S3_ENDPOINT || '')
  const region = (process.env.B2_REGION || '').trim()
  const bucketName = (process.env.B2_BUCKET_NAME || '').trim()
  const keyId = (process.env.B2_KEY_ID || '').trim()
  const applicationKey = (process.env.B2_APPLICATION_KEY || '').trim()

  const missing: string[] = []
  if (!endpoint) missing.push('B2_S3_ENDPOINT')
  if (!region) missing.push('B2_REGION')
  if (!bucketName) missing.push('B2_BUCKET_NAME')
  if (!keyId) missing.push('B2_KEY_ID')
  if (!applicationKey) missing.push('B2_APPLICATION_KEY')

  if (missing.length > 0) {
    throw new Error(`Missing required Backblaze B2 env vars: ${missing.join(', ')}`)
  }

  return { endpoint, region, bucketName, keyId, applicationKey }
}

function createB2Client(config: B2Config): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.keyId,
      secretAccessKey: config.applicationKey,
    },
    forcePathStyle: true,
    maxAttempts: 5,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  })
}

function isS3NotFound(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as {
    name?: string
    Code?: string
    code?: string
    $metadata?: { httpStatusCode?: number }
  }
  return (
    e.name === 'NoSuchKey' ||
    e.name === 'NotFound' ||
    e.Code === 'NoSuchKey' ||
    e.code === 'NoSuchKey' ||
    e.$metadata?.httpStatusCode === 404
  )
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
      parsed.searchParams.set('connection_limit', '3')
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

const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
}

function resolveMimeType(fileType: string, originalFilename: string): string {
  const ext = path.extname(originalFilename || '').toLowerCase()
  if (ext && MIME_BY_EXT[ext]) return MIME_BY_EXT[ext]
  const norm = (fileType || '').trim().toLowerCase()
  if (norm === 'pdf') return MIME_BY_EXT['.pdf']
  if (norm === 'docx') return MIME_BY_EXT['.docx']
  if (norm === 'doc') return MIME_BY_EXT['.doc']
  if (norm === 'txt' || norm === 'text/plain') return MIME_BY_EXT['.txt']
  if (norm === 'md' || norm === 'text/markdown') return MIME_BY_EXT['.md']
  return 'application/octet-stream'
}

function resolveSafeLocalFile(storagePath: string): {
  resolvedPath: string
  basename: string
  diskSize: number
  sha256: string
} {
  if (!storagePath) {
    throw new Error('Source document has empty storagePath')
  }

  const basename = path.basename(storagePath)
  if (!basename || basename === '.' || basename === '..') {
    throw new Error(`Invalid storagePath basename for "${storagePath}"`)
  }

  // Strictly resolve ONLY inside C:\Users\Hp\OneDrive\Desktop\updating\storage\knowledge-docs\
  const candidate = path.resolve(SOURCE_FOLDER, basename)
  if (path.dirname(candidate).toLowerCase() !== SOURCE_FOLDER.toLowerCase()) {
    throw new Error(`Resolved file path escapes source folder: ${candidate}`)
  }

  if (!fs.existsSync(candidate)) {
    throw new Error(`Source file not found in approved folder: ${candidate}`)
  }

  const stat = fs.statSync(candidate)
  if (!stat.isFile()) {
    throw new Error(`Source path is not a regular file: ${candidate}`)
  }

  const fileBytes = fs.readFileSync(candidate)
  const sha256 = crypto.createHash('sha256').update(fileBytes).digest('hex')

  return {
    resolvedPath: candidate,
    basename,
    diskSize: stat.size,
    sha256,
  }
}

async function resolveTargetNeonUser(neon: PrismaClient) {
  const rawId = (process.env.TARGET_NEON_USER_ID || '').trim()
  const rawEmail = (process.env.TARGET_NEON_USER_EMAIL || '').trim().toLowerCase()

  if (!rawId && !rawEmail) {
    throw new Error('Set TARGET_NEON_USER_ID or TARGET_NEON_USER_EMAIL in the runtime environment.')
  }

  let user: {
    id: number
    username: string
    email: string | null
    name: string | null
    role: string
    emailVerified: boolean
  } | null = null

  if (rawId) {
    const parsedId = Number(rawId)
    if (!Number.isInteger(parsedId) || parsedId <= 0) {
      throw new Error(`Invalid TARGET_NEON_USER_ID: "${rawId}"`)
    }
    user = await neon.user.findUnique({
      where: { id: parsedId },
      select: { id: true, username: true, email: true, name: true, role: true, emailVerified: true },
    })
  } else {
    user = await neon.user.findFirst({
      where: { OR: [{ email: rawEmail }, { username: rawEmail }] },
      select: { id: true, username: true, email: true, name: true, role: true, emailVerified: true },
    })
  }

  if (!user) {
    throw new Error('Target Neon user not found. Provision the dedicated INTERVIEWER account first.')
  }
  if (rawId && rawEmail && user.email?.toLowerCase() !== rawEmail && user.username.toLowerCase() !== rawEmail) {
    throw new Error('TARGET_NEON_USER_ID and TARGET_NEON_USER_EMAIL refer to different users.')
  }
  if (user.role !== 'INTERVIEWER' && user.role !== 'ADMIN') {
    throw new Error(
      `Target Neon user id=${user.id} has role=${user.role}. Must be INTERVIEWER or ADMIN.`
    )
  }
  if (user.role !== 'ADMIN' && !user.emailVerified) {
    throw new Error(`Target Neon user id=${user.id} is not email-verified (emailVerified=false).`)
  }

  return user
}

async function getEmbeddingColumnType(prisma: PrismaClient): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Array<{ vec_type: string | null }>>(`
    SELECT format_type(atttypid, atttypmod) AS vec_type
    FROM pg_attribute
    WHERE attrelid = '"DocumentChunk"'::regclass
      AND attname = 'embedding'
      AND NOT attisdropped
  `)
  return rows[0]?.vec_type || 'missing'
}

async function headB2Object(
  s3: S3Client,
  bucket: string,
  key: string
): Promise<{ exists: boolean; contentLength?: number; eTag?: string }> {
  try {
    const res = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return {
      exists: true,
      contentLength: res.ContentLength,
      eTag: res.ETag,
    }
  } catch (err) {
    if (isS3NotFound(err)) return { exists: false }
    throw err
  }
}

interface PreparedDocPlan {
  localDoc: LocalDocRow
  chunks: LocalChunkRow[]
  localFile: {
    resolvedPath: string
    basename: string
    diskSize: number
    sha256: string
  }
  targetB2Key: string
  b2Status: { exists: boolean; contentLength?: number; eTag?: string }
  existingNeonDoc: {
    id: number
    originalFilename: string
    fileSize: number
    status: string
    chunkCount: number
  } | null
  alreadyMigrated: boolean
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run')
  const allowMixedOwners = process.argv.includes('--allow-mixed-owners')
  const allowNonPrivate = process.argv.includes('--allow-non-private')

  const rawLocalUrl = (process.env.LOCAL_DATABASE_URL || '').trim()
  const rawNeonUrl = (
    process.env.NEON_DATABASE_URL ||
    process.env.DATABASE_URL ||
    process.env.DIRECT_URL ||
    ''
  ).trim()

  if (!rawLocalUrl) {
    throw new Error('Missing LOCAL_DATABASE_URL in runtime environment.')
  }
  if (!rawNeonUrl) {
    throw new Error('Missing NEON_DATABASE_URL, DATABASE_URL, or DIRECT_URL in runtime environment.')
  }
  if (rawLocalUrl === rawNeonUrl) {
    throw new Error('LOCAL_DATABASE_URL and target Neon URL must not be identical.')
  }

  const localHostKind = describeDatabaseHost(rawLocalUrl)
  const neonHostKind = describeDatabaseHost(rawNeonUrl)
  if (localHostKind === 'invalid-url' || neonHostKind === 'invalid-url') {
    throw new Error('One of the database connection URLs is invalid.')
  }
  if (localHostKind === 'neon') {
    throw new Error('LOCAL_DATABASE_URL points to Neon; refusing because source must be local PostgreSQL.')
  }
  if (neonHostKind !== 'neon' && !process.argv.includes('--allow-non-neon')) {
    throw new Error(
      `Refusing migration: target DB host type is "${neonHostKind}", expected "neon".`
    )
  }

  const b2Config = getB2ConfigFromEnv()
  const s3 = createB2Client(b2Config)

  const localDb = new PrismaClient({ datasources: { db: { url: rawLocalUrl } } })
  const neonDb = new PrismaClient({ datasources: { db: { url: buildNeonScriptUrl(rawNeonUrl) } } })

  try {
    console.log('=== One-Time Knowledge Document Migration ===')
    console.log(`Mode: ${isDryRun ? 'DRY RUN (read-only preflight)' : 'EXECUTE'}`)
    console.log(`Source DB host type: ${localHostKind}`)
    console.log(`Target DB host type: ${neonHostKind}`)
    console.log(`Target Doc IDs: ${TARGET_DOC_IDS.join(', ')}`)
    console.log(`Source Folder: ${SOURCE_FOLDER}`)

    // 0. Connectivity prechecks (SELECT 1 on both DBs + B2 HeadBucket)
    await Promise.all([
      localDb.$connect().then(() => localDb.$queryRawUnsafe('SELECT 1')),
      withRetry('Neon SELECT 1 precheck', async () => {
        await neonDb.$connect()
        await neonDb.$queryRawUnsafe('SELECT 1')
      }),
      s3.send(new HeadBucketCommand({ Bucket: b2Config.bucketName })),
    ])
    console.log(`Connectivity verified: local SELECT 1, Neon SELECT 1, B2 bucket "${b2Config.bucketName}"`)

    // 1. Verify target Neon user
    const targetUser = await withRetry('Resolve target Neon user', () => resolveTargetNeonUser(neonDb))
    console.log(
      `Target Neon owner verified: id=${targetUser.id}, username=${targetUser.username}, role=${targetUser.role}, emailVerified=${targetUser.emailVerified}`
    )

    // 2. Verify embedding vector dimensions on both source and target
    const [localVecType, neonVecType] = await Promise.all([
      getEmbeddingColumnType(localDb),
      withRetry('Check Neon vector column type', () => getEmbeddingColumnType(neonDb)),
    ])
    console.log(`Vector column types: source=${localVecType}, target=${neonVecType}`)
    if (localVecType !== `vector(${EXPECTED_VECTOR_DIM})`) {
      throw new Error(`Source DocumentChunk.embedding is ${localVecType}, expected vector(${EXPECTED_VECTOR_DIM}).`)
    }
    if (neonVecType !== `vector(${EXPECTED_VECTOR_DIM})`) {
      throw new Error(`Target Neon DocumentChunk.embedding is ${neonVecType}, expected vector(${EXPECTED_VECTOR_DIM}).`)
    }

    // 3. Read strictly the 4 target documents from local DB
    const localDocs = await localDb.$queryRawUnsafe<LocalDocRow[]>(
      `
      SELECT
        "id", "name", "originalFilename", "fileType", "fileSize", "storagePath",
        "status", "userId", "createdAt", "updatedAt", "branch", "institution",
        "semester", "subject", "docSource", "adminDocId"
      FROM "Document"
      WHERE "id" = ANY($1::int[])
      ORDER BY "id" ASC
      `,
      [...TARGET_DOC_IDS]
    )

    const foundIds = new Set(localDocs.map((d) => d.id))
    const missingIds = TARGET_DOC_IDS.filter((id) => !foundIds.has(id))
    if (missingIds.length > 0) {
      throw new Error(`Missing target Document ID(s) in local DB: ${missingIds.join(', ')}`)
    }

    // 4. Read strictly the associated chunks from local DB
    const allLocalChunks = await localDb.$queryRawUnsafe<LocalChunkRow[]>(
      `
      SELECT
        "id",
        "documentId",
        "content",
        "chunkIndex",
        "createdAt",
        "pageNumber",
        "sourceType",
        "topic",
        "unit",
        "embedding"::text AS "embeddingText",
        vector_dims("embedding")::int AS "embeddingDims"
      FROM "DocumentChunk"
      WHERE "documentId" = ANY($1::int[])
      ORDER BY "documentId" ASC, "chunkIndex" ASC
      `,
      [...TARGET_DOC_IDS]
    )

    console.log(`Local chunks fetched: ${allLocalChunks.length} (expected ${EXPECTED_TOTAL_CHUNKS})`)
    if (allLocalChunks.length !== EXPECTED_TOTAL_CHUNKS) {
      throw new Error(
        `Expected exactly ${EXPECTED_TOTAL_CHUNKS} local chunks across docs [${TARGET_DOC_IDS.join(', ')}], found ${allLocalChunks.length}.`
      )
    }

    const chunksByDocId = new Map<number, LocalChunkRow[]>()
    for (const chunk of allLocalChunks) {
      if (!chunk.embeddingText) {
        throw new Error(`Local chunk id=${chunk.id} (doc=${chunk.documentId}) has NULL embedding.`)
      }
      if (chunk.embeddingDims !== EXPECTED_VECTOR_DIM) {
        throw new Error(
          `Local chunk id=${chunk.id} (doc=${chunk.documentId}) has ${chunk.embeddingDims} dimensions, expected ${EXPECTED_VECTOR_DIM}.`
        )
      }
      const list = chunksByDocId.get(chunk.documentId) || []
      list.push(chunk)
      chunksByDocId.set(chunk.documentId, list)
    }

    // 5. Ownership / docSource / adminDocId safety checks
    const distinctSourceUserIds = Array.from(new Set(localDocs.map((d) => d.userId)))
    const nonPrivateDocs = localDocs.filter(
      (d) => d.docSource !== 'INTERVIEWER_PRIVATE' || d.adminDocId !== null
    )

    if (distinctSourceUserIds.length > 1 && !allowMixedOwners) {
      throw new Error(
        `Source documents belong to multiple local userIds (${distinctSourceUserIds.join(', ')}). ` +
          'Re-run with --allow-mixed-owners only after verifying all four should be assigned to the single target interviewer.'
      )
    }
    if (nonPrivateDocs.length > 0 && !allowNonPrivate) {
      throw new Error(
        `Non-private or admin-linked document(s) detected: ${nonPrivateDocs
          .map((d) => `id=${d.id}(docSource=${d.docSource},adminDocId=${d.adminDocId})`)
          .join(', ')}. Re-run with --allow-non-private only if intentional.`
      )
    }

    // 6. Build per-document preflight plans (file checks, B2 HeadObject, Neon idempotency check)
    const plans: PreparedDocPlan[] = []
    for (const doc of localDocs) {
      const docChunks = chunksByDocId.get(doc.id) || []
      if (docChunks.length === 0) {
        throw new Error(`Local document id=${doc.id} has 0 chunks.`)
      }

      const localFile = resolveSafeLocalFile(doc.storagePath)
      if (localFile.diskSize !== doc.fileSize) {
        throw new Error(
          `File size mismatch for local doc id=${doc.id}: DB fileSize=${doc.fileSize}, disk=${localFile.diskSize}`
        )
      }

      const targetB2Key = `knowledge-docs/${targetUser.id}/${localFile.basename}`
      const b2Status = await headB2Object(s3, b2Config.bucketName, targetB2Key)

      const existingNeonRows = await withRetry(`Check Neon doc ${doc.id}`, () =>
        neonDb.document.findMany({
          where: { storagePath: targetB2Key, userId: targetUser.id },
          include: { _count: { select: { chunks: true } } },
        })
      )

      if (existingNeonRows.length > 1) {
        throw new Error(
          `Neon has ${existingNeonRows.length} duplicate Document rows for storagePath="${targetB2Key}".`
        )
      }

      const existing = existingNeonRows[0]
      let existingNeonDoc: PreparedDocPlan['existingNeonDoc'] = null
      let alreadyMigrated = false

      if (existing) {
        existingNeonDoc = {
          id: existing.id,
          originalFilename: existing.originalFilename,
          fileSize: existing.fileSize,
          status: existing.status,
          chunkCount: existing._count.chunks,
        }

        const matchesExact =
          existing.originalFilename === doc.originalFilename &&
          existing.fileSize === doc.fileSize &&
          existing._count.chunks === docChunks.length &&
          b2Status.exists &&
          b2Status.contentLength === doc.fileSize

        if (!matchesExact) {
          throw new Error(
            `Partial or conflicting Neon/B2 state for doc id=${doc.id} (neonDocId=${existing.id}, ` +
              `neonChunks=${existing._count.chunks}, expectedChunks=${docChunks.length}, ` +
              `b2Exists=${b2Status.exists}, b2Size=${b2Status.contentLength ?? 'n/a'}). Aborting cleanly.`
          )
        }
        alreadyMigrated = true
      }

      plans.push({
        localDoc: doc,
        chunks: docChunks,
        localFile,
        targetB2Key,
        b2Status,
        existingNeonDoc,
        alreadyMigrated,
      })
    }

    // Print comprehensive preflight report
    console.log('\n=== Preflight Report (4 Target Documents) ===')
    for (const p of plans) {
      console.log(
        JSON.stringify(
          {
            localDocId: p.localDoc.id,
            name: p.localDoc.name,
            originalFilename: p.localDoc.originalFilename,
            fileType: p.localDoc.fileType,
            fileSize: p.localDoc.fileSize,
            status: p.localDoc.status,
            sourceUserId: p.localDoc.userId,
            docSource: p.localDoc.docSource,
            adminDocId: p.localDoc.adminDocId,
            branch: p.localDoc.branch,
            institution: p.localDoc.institution,
            semester: p.localDoc.semester,
            subject: p.localDoc.subject,
            chunkCount: p.chunks.length,
            diskSize: p.localFile.diskSize,
            sha256: p.localFile.sha256,
            targetUserId: targetUser.id,
            targetB2Key: p.targetB2Key,
            b2AlreadyExists: p.b2Status.exists,
            neonState: p.alreadyMigrated ? `ALREADY_MIGRATED (neonId=${p.existingNeonDoc?.id})` : 'PENDING',
          },
          null,
          2
        )
      )
    }

    if (isDryRun) {
      console.log('\nDRY RUN COMPLETE: All preflight checks passed. No B2 uploads or Neon writes were performed.')
      return
    }

    // 7. Execute migration per document with B2 rollback on DB transaction failure
    for (const p of plans) {
      if (p.alreadyMigrated) {
        console.log(`[SKIP] Local doc id=${p.localDoc.id} already migrated as Neon doc id=${p.existingNeonDoc?.id}.`)
        continue
      }

      const fileBuffer = fs.readFileSync(p.localFile.resolvedPath)
      if (fileBuffer.byteLength !== p.localDoc.fileSize) {
        throw new Error(`Read byte mismatch for ${p.localFile.resolvedPath}`)
      }

      let uploadedInThisRun = false
      if (p.b2Status.exists) {
        if (p.b2Status.contentLength !== p.localDoc.fileSize) {
          throw new Error(
            `Existing B2 object "${p.targetB2Key}" size (${p.b2Status.contentLength}) != local size (${p.localDoc.fileSize}).`
          )
        }
        console.log(`[B2] Reusing verified existing object: ${p.targetB2Key}`)
      } else {
        const contentType = resolveMimeType(p.localDoc.fileType, p.localDoc.originalFilename)
        await s3.send(
          new PutObjectCommand({
            Bucket: b2Config.bucketName,
            Key: p.targetB2Key,
            Body: fileBuffer,
            ContentType: contentType,
            ContentLength: fileBuffer.byteLength,
          })
        )
        uploadedInThisRun = true

        const verified = await headB2Object(s3, b2Config.bucketName, p.targetB2Key)
        if (!verified.exists || verified.contentLength !== fileBuffer.byteLength) {
          if (uploadedInThisRun) {
            await s3
              .send(new DeleteObjectCommand({ Bucket: b2Config.bucketName, Key: p.targetB2Key }))
              .catch(() => {})
          }
          throw new Error(`Post-upload B2 verification failed for key "${p.targetB2Key}".`)
        }
        console.log(`[B2] Uploaded & verified (${verified.contentLength} bytes): ${p.targetB2Key}`)
      }

      try {
        const createdNeonId = await neonDb.$transaction(
          async (tx) => {
            const insertedDocs = await tx.$queryRawUnsafe<Array<{ id: number }>>(
              `
              INSERT INTO "Document" (
                "name", "originalFilename", "fileType", "fileSize", "storagePath",
                "status", "userId", "createdAt", "updatedAt", "branch", "institution",
                "semester", "subject", "docSource", "adminDocId"
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
              RETURNING "id"
              `,
              p.localDoc.name,
              p.localDoc.originalFilename,
              p.localDoc.fileType,
              p.localDoc.fileSize,
              p.targetB2Key,
              p.localDoc.status,
              targetUser.id,
              p.localDoc.createdAt,
              p.localDoc.updatedAt,
              p.localDoc.branch,
              p.localDoc.institution,
              p.localDoc.semester,
              p.localDoc.subject,
              p.localDoc.docSource,
              p.localDoc.adminDocId
            )

            const neonDocId = insertedDocs[0]?.id
            if (!neonDocId) {
              throw new Error('Failed to obtain inserted Neon Document id.')
            }

            // Batch-insert chunks with parameterized SQL while preserving exact 384-dim vectors
            for (let i = 0; i < p.chunks.length; i += CHUNK_INSERT_BATCH_SIZE) {
              const batch = p.chunks.slice(i, i + CHUNK_INSERT_BATCH_SIZE)
              const valuesClauses: string[] = []
              const params: unknown[] = []

              for (const chunk of batch) {
                const base = params.length
                valuesClauses.push(
                  `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::vector, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`
                )
                params.push(
                  neonDocId,
                  chunk.content,
                  chunk.chunkIndex,
                  chunk.createdAt,
                  chunk.embeddingText,
                  chunk.pageNumber,
                  chunk.sourceType,
                  chunk.topic,
                  chunk.unit
                )
              }

              await tx.$executeRawUnsafe(
                `
                INSERT INTO "DocumentChunk" (
                  "documentId", "content", "chunkIndex", "createdAt",
                  "embedding", "pageNumber", "sourceType", "topic", "unit"
                )
                VALUES ${valuesClauses.join(', ')}
                `,
                ...params
              )
            }

            return neonDocId
          },
          { timeout: 120000 }
        )

        console.log(
          `[NEON] Migrated local doc id=${p.localDoc.id} -> Neon doc id=${createdNeonId} (${p.chunks.length} chunks)`
        )
      } catch (txErr) {
        if (uploadedInThisRun) {
          console.warn(`[ROLLBACK] Deleting newly uploaded B2 object after DB error: ${p.targetB2Key}`)
          await s3
            .send(new DeleteObjectCommand({ Bucket: b2Config.bucketName, Key: p.targetB2Key }))
            .catch((cleanupErr) => {
              console.error('Failed to roll back B2 object:', cleanupErr)
            })
        }
        throw txErr
      }
    }

    // 8. Post-migration verification across all 4 documents, B2 objects, and Neon chunks
    console.log('\n=== Post-Migration Verification ===')
    const targetKeys = plans.map((p) => p.targetB2Key)

    for (const p of plans) {
      const head = await headB2Object(s3, b2Config.bucketName, p.targetB2Key)
      if (!head.exists || head.contentLength !== p.localDoc.fileSize) {
        throw new Error(
          `Post-migration B2 check failed for ${p.targetB2Key} (exists=${head.exists}, size=${head.contentLength})`
        )
      }
    }

    const neonVerifyRows = await withRetry('Post-migration Neon verify', () =>
      neonDb.$queryRawUnsafe<
        Array<{
          id: number
          storagePath: string
          originalFilename: string
          fileSize: number
          chunkCount: number
          validEmbeddings: number
        }>
      >(
        `
        SELECT
          d."id",
          d."storagePath",
          d."originalFilename",
          d."fileSize",
          COUNT(dc."id")::int AS "chunkCount",
          COUNT(CASE WHEN dc."embedding" IS NOT NULL AND vector_dims(dc."embedding") = $3 THEN 1 END)::int AS "validEmbeddings"
        FROM "Document" d
        LEFT JOIN "DocumentChunk" dc ON dc."documentId" = d."id"
        WHERE d."userId" = $1
          AND d."storagePath" = ANY($2::text[])
        GROUP BY d."id", d."storagePath", d."originalFilename", d."fileSize"
        ORDER BY d."id" ASC
        `,
        targetUser.id,
        targetKeys,
        EXPECTED_VECTOR_DIM
      )
    )

    const totalMigratedChunks = neonVerifyRows.reduce((sum, r) => sum + r.chunkCount, 0)
    const totalValidEmbeddings = neonVerifyRows.reduce((sum, r) => sum + r.validEmbeddings, 0)

    console.log(JSON.stringify({ documents: neonVerifyRows, totalMigratedChunks, totalValidEmbeddings }, null, 2))

    if (neonVerifyRows.length !== TARGET_DOC_IDS.length) {
      throw new Error(`Verification failed: expected ${TARGET_DOC_IDS.length} Neon docs, found ${neonVerifyRows.length}.`)
    }
    if (totalMigratedChunks !== EXPECTED_TOTAL_CHUNKS) {
      throw new Error(
        `Verification failed: expected ${EXPECTED_TOTAL_CHUNKS} chunks in Neon, found ${totalMigratedChunks}.`
      )
    }
    if (totalValidEmbeddings !== EXPECTED_TOTAL_CHUNKS) {
      throw new Error(
        `Verification failed: expected ${EXPECTED_TOTAL_CHUNKS} valid 384-dim embeddings, found ${totalValidEmbeddings}.`
      )
    }

    console.log('MIGRATION VERIFIED: All 4 B2 objects, 4 Neon Document rows, and 278 384-dim chunks match.')
  } finally {
    await localDb.$disconnect()
    await neonDb.$disconnect()
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err)
  console.error('Migration failed:', msg.replace(/postgres(ql)?:\/\/[^\s]+/gi, '<redacted>'))
  process.exit(1)
})
