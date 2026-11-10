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

const APPROVED_DOCS_DIR = path.resolve(
  'C:\\Users\\Hp\\OneDrive\\Desktop\\updating\\storage\\knowledge-docs'
)
const EXPECTED_VECTOR_DIM = 384
const CHUNK_BATCH_SIZE = 50
const TRANSIENT_PRISMA_CODES = new Set(['P1001', 'P1002', 'P2024'])

const APPLICATION_TABLES = [
  'User',
  'Candidate',
  'Document',
  'DocumentChunk',
  'InterviewSession',
  'Question',
  'Answer',
  'AnswerEvaluation',
  'InterviewReport',
  'KnowledgeGap',
  'AuditLog',
  'OtpVerification',
  'AppSettings',
] as const

type TableName = (typeof APPLICATION_TABLES)[number]

interface LocalUserRow {
  id: number
  username: string
  email: string | null
  name: string | null
  passwordHash: string | null
  role: string
  emailVerified: boolean
  createdAt: Date
}

interface LocalCandidateRow {
  id: string
  name: string
  email: string | null
  createdAt: Date
  userId: number | null
}

interface LocalDocumentRow {
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

interface LocalSessionRow {
  id: string
  candidateId: string
  interviewerId: number | null
  status: string
  difficulty: string
  interviewType: string
  scope: unknown
  score: number | null
  topicsCovered: string[]
  weakTopics: string[]
  strongTopics: string[]
  startedAt: Date
  endedAt: Date | null
}

interface LocalQuestionRow {
  id: string
  sessionId: string
  questionNumber: number
  content: string
  type: string
  difficulty: string
  topic: string | null
  expectedAnswer: string | null
  coreConcepts: string[]
  requiredKeywords: string[]
  askedAt: Date
}

interface LocalAnswerRow {
  id: string
  questionId: string
  transcript: string
  audioPath: string | null
  duration: number | null
  answeredAt: Date
}

interface LocalAnswerEvalRow {
  id: string
  answerId: string
  score: number
  correctness: string
  completeness: string
  relevance: string
  technicalAccuracy: string
  mentionedKeywords: string[]
  missingKeywords: string[]
  feedback: string
}

interface LocalReportRow {
  id: string
  sessionId: string
  overallScore: number
  topicScores: unknown
  strengths: string[]
  weaknesses: string[]
  executiveSummary: string
  improvementPlan: string
  createdAt: Date
}

interface LocalGapRow {
  id: string
  sessionId: string
  concept: string
  confidence: string
  evidence: string
}

interface LocalAuditLogRow {
  id: string
  userId: number | null
  username: string | null
  action: string
  entityType: string | null
  entityId: string | null
  status: string
  metadata: unknown
  ipAddress: string | null
  userAgent: string | null
  createdAt: Date
}

interface LocalOtpRow {
  id: string
  userId: number | null
  email: string
  otpHash: string
  purpose: string
  expiresAt: Date
  attempts: number
  usedAt: Date | null
  createdAt: Date
}

interface LocalAppSettingRow {
  id: number
  key: string
  value: string
  updatedAt: Date
}

interface B2Config {
  endpoint: string
  region: string
  bucketName: string
  keyId: string
  applicationKey: string
}

type DocClassification =
  | 'AVAILABLE_IN_APPROVED_FOLDER'
  | 'EXISTING_B2_OBJECT'
  | 'MISSING_OR_OUTSIDE_APPROVED_FOLDER'
  | 'INVALID_OR_INCONSISTENT_METADATA'

interface DocumentAuditEntry {
  localDocId: number
  name: string
  originalFilename: string
  fileSize: number
  status: string
  sourceUserId: number
  targetUserId: number | null
  docSource: string
  adminDocId: number | null
  sourceStoragePath: string
  classification: DocClassification
  issues: string[]
  approvedFilePath: string | null
  diskSize: number | null
  sha256: string | null
  chunkCount: number
  targetB2Key: string | null
  b2AlreadyExists: boolean
  b2ContentLength: number | null
  existingNeonDocId: number | null
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
      console.warn(
        `[retry] ${label} hit transient connection error (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs}ms...`
      )
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

async function getTableCounts(prisma: PrismaClient): Promise<Record<TableName, number>> {
  const [
    User,
    Candidate,
    Document,
    DocumentChunk,
    InterviewSession,
    Question,
    Answer,
    AnswerEvaluation,
    InterviewReport,
    KnowledgeGap,
    AuditLog,
    OtpVerification,
    AppSettings,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.candidate.count(),
    prisma.document.count(),
    prisma.documentChunk.count(),
    prisma.interviewSession.count(),
    prisma.question.count(),
    prisma.answer.count(),
    prisma.answerEvaluation.count(),
    prisma.interviewReport.count(),
    prisma.knowledgeGap.count(),
    prisma.auditLog.count(),
    prisma.otpVerification.count(),
    prisma.appSettings.count(),
  ])

  return {
    User,
    Candidate,
    Document,
    DocumentChunk,
    InterviewSession,
    Question,
    Answer,
    AnswerEvaluation,
    InterviewReport,
    KnowledgeGap,
    AuditLog,
    OtpVerification,
    AppSettings,
  }
}

interface ColumnMeta {
  ordinalPosition: number
  columnName: string
  dataType: string
  udtName: string
  isNullable: string
  columnDefault: string | null
}

interface ConstraintMeta {
  tableName: string
  conname: string
  contype: string
  def: string
}

interface IndexMeta {
  tableName: string
  indexname: string
  indexdef: string
}

async function getSchemaMetadata(prisma: PrismaClient) {
  const [columns, constraints, indexes, vecRows] = await Promise.all([
    prisma.$queryRawUnsafe<
      Array<{
        table_name: string
        ordinal_position: number
        column_name: string
        data_type: string
        udt_name: string
        is_nullable: string
        column_default: string | null
      }>
    >(`
      SELECT
        table_name,
        ordinal_position::int,
        column_name,
        data_type,
        udt_name,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `),
    prisma.$queryRawUnsafe<
      Array<{
        table_name: string
        conname: string
        contype: string
        def: string
      }>
    >(`
      SELECT
        c.relname AS table_name,
        con.conname,
        con.contype::text,
        pg_get_constraintdef(con.oid) AS def
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND con.contype IN ('p', 'f', 'u')
      ORDER BY table_name, con.contype, con.conname
    `),
    prisma.$queryRawUnsafe<
      Array<{
        tablename: string
        indexname: string
        indexdef: string
      }>
    >(`
      SELECT tablename, indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
      ORDER BY tablename, indexname
    `),
    prisma.$queryRawUnsafe<Array<{ vec_type: string | null }>>(`
      SELECT format_type(atttypid, atttypmod) AS vec_type
      FROM pg_attribute
      WHERE attrelid = '"DocumentChunk"'::regclass
        AND attname = 'embedding'
        AND NOT attisdropped
    `),
  ])

  const columnsByTable = new Map<string, ColumnMeta[]>()
  for (const row of columns) {
    if (row.table_name === '_prisma_migrations') continue
    const list = columnsByTable.get(row.table_name) || []
    list.push({
      ordinalPosition: Number(row.ordinal_position),
      columnName: row.column_name,
      dataType: row.data_type,
      udtName: row.udt_name,
      isNullable: row.is_nullable,
      columnDefault: row.column_default,
    })
    columnsByTable.set(row.table_name, list)
  }

  const constraintsByTable = new Map<string, ConstraintMeta[]>()
  for (const row of constraints) {
    if (row.table_name === '_prisma_migrations') continue
    const list = constraintsByTable.get(row.table_name) || []
    list.push({
      tableName: row.table_name,
      conname: row.conname,
      contype: row.contype,
      def: row.def,
    })
    constraintsByTable.set(row.table_name, list)
  }

  const indexesByTable = new Map<string, IndexMeta[]>()
  for (const row of indexes) {
    if (row.tablename === '_prisma_migrations') continue
    const list = indexesByTable.get(row.tablename) || []
    list.push({
      tableName: row.tablename,
      indexname: row.indexname,
      indexdef: row.indexdef,
    })
    indexesByTable.set(row.tablename, list)
  }

  return {
    columnsByTable,
    constraintsByTable,
    indexesByTable,
    embeddingVectorType: vecRows[0]?.vec_type || 'missing',
  }
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

function isInsideApprovedDir(storagePath: string): {
  isInApprovedDir: boolean
  resolvedSourcePath: string
  approvedCandidatePath: string
  basename: string
} {
  const resolvedSourcePath = path.resolve(storagePath)
  const sourceDir = path.dirname(resolvedSourcePath)
  const basename = path.basename(storagePath)
  const approvedCandidatePath = path.resolve(APPROVED_DOCS_DIR, basename)
  const isInApprovedDir =
    sourceDir.toLowerCase() === APPROVED_DOCS_DIR.toLowerCase() &&
    path.dirname(approvedCandidatePath).toLowerCase() === APPROVED_DOCS_DIR.toLowerCase()

  return {
    isInApprovedDir,
    resolvedSourcePath,
    approvedCandidatePath,
    basename,
  }
}

function remapSessionScope(
  rawScope: unknown,
  docIdMap: Map<number, number>
): { remappedScope: unknown; unmappedDocIds: number[] } {
  if (!rawScope || typeof rawScope !== 'object' || Array.isArray(rawScope)) {
    return { remappedScope: rawScope, unmappedDocIds: [] }
  }

  const clone: Record<string, unknown> = { ...(rawScope as Record<string, unknown>) }
  const unmappedDocIds: number[] = []

  if (Array.isArray(clone.selectedDocumentIds)) {
    const mapped: number[] = []
    for (const rawId of clone.selectedDocumentIds) {
      const id = Number(rawId)
      if (!Number.isInteger(id)) continue
      const nextId = docIdMap.get(id)
      if (nextId !== undefined) {
        mapped.push(nextId)
      } else {
        unmappedDocIds.push(id)
      }
    }
    clone.selectedDocumentIds = mapped
  }

  if (typeof clone.setupData === 'string' && clone.setupData.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(clone.setupData)
      if (Array.isArray(parsed)) {
        const mapped = parsed
          .map((v) => Number(v))
          .filter((id) => Number.isInteger(id))
          .map((id) => docIdMap.get(id) ?? id)
        clone.setupData = JSON.stringify(mapped)
      }
    } catch {
      // keep non-JSON setupData verbatim
    }
  }

  return { remappedScope: clone, unmappedDocIds }
}

async function main() {
  const wantsExecute = process.argv.includes('--execute')
  const confirmExecute = process.argv.includes('--confirm-execute')
  const isDryRun = !wantsExecute || process.argv.includes('--dry-run')

  if (wantsExecute && !confirmExecute) {
    throw new Error('Execution requires both --execute and --confirm-execute flags after reviewing --dry-run.')
  }

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
    throw new Error('One of the database URLs is invalid.')
  }
  if (localHostKind === 'neon') {
    throw new Error('LOCAL_DATABASE_URL points to Neon; source must be local PostgreSQL.')
  }
  if (neonHostKind !== 'neon' && !process.argv.includes('--allow-non-neon')) {
    throw new Error(`Target DB host type is "${neonHostKind}", expected "neon".`)
  }

  const b2Config = getB2ConfigFromEnv()
  const s3 = createB2Client(b2Config)

  const localDb = new PrismaClient({ datasources: { db: { url: rawLocalUrl } } })
  const neonDb = new PrismaClient({ datasources: { db: { url: buildNeonScriptUrl(rawNeonUrl) } } })

  try {
    console.log('=== SmartInterview Full Database Migration ===')
    console.log(`Mode: ${isDryRun ? 'DRY RUN (Phases A-F, read-only)' : 'EXECUTE (Phase H)'}`)
    console.log(`Source DB host type: ${localHostKind}`)
    console.log(`Target DB host type: ${neonHostKind}`)
    console.log(`Approved Document Folder: ${APPROVED_DOCS_DIR}`)

    // PHASE E: Connectivity checks
    await Promise.all([
      localDb.$connect().then(() => localDb.$queryRawUnsafe('SELECT 1')),
      withRetry('Neon SELECT 1', async () => {
        await neonDb.$connect()
        await neonDb.$queryRawUnsafe('SELECT 1')
      }),
      s3.send(new HeadBucketCommand({ Bucket: b2Config.bucketName })),
    ])
    console.log(`Connectivity PASS: local SELECT 1, Neon SELECT 1, B2 bucket "${b2Config.bucketName}"`)

    // PHASE A & B: Schema + Count Inventory
    const [localCounts, neonCounts, localSchema, neonSchema] = await Promise.all([
      getTableCounts(localDb),
      withRetry('Neon table counts', () => getTableCounts(neonDb)),
      getSchemaMetadata(localDb),
      withRetry('Neon schema metadata', () => getSchemaMetadata(neonDb)),
    ])

    console.log('\n--- Table Counts Inventory ---')
    console.log(JSON.stringify({ localCounts, neonCounts }, null, 2))

    if (localSchema.embeddingVectorType !== `vector(${EXPECTED_VECTOR_DIM})`) {
      throw new Error(
        `Source DocumentChunk.embedding is ${localSchema.embeddingVectorType}, expected vector(${EXPECTED_VECTOR_DIM}).`
      )
    }
    if (neonSchema.embeddingVectorType !== `vector(${EXPECTED_VECTOR_DIM})`) {
      throw new Error(
        `Target Neon DocumentChunk.embedding is ${neonSchema.embeddingVectorType}, expected vector(${EXPECTED_VECTOR_DIM}).`
      )
    }

    const schemaDiffs: string[] = []
    const ordinalOrderNotes: string[] = []

    for (const table of APPLICATION_TABLES) {
      const lCols = localSchema.columnsByTable.get(table) || []
      const nCols = neonSchema.columnsByTable.get(table) || []

      if (lCols.length === 0) {
        schemaDiffs.push(`Missing table in local source: ${table}`)
        continue
      }
      if (nCols.length === 0) {
        schemaDiffs.push(`Missing table in Neon: ${table}`)
        continue
      }

      const lByName = new Map(lCols.map((c) => [c.columnName, c]))
      const nByName = new Map(nCols.map((c) => [c.columnName, c]))

      const tableMismatches: string[] = []
      for (const [colName, lc] of lByName) {
        const nc = nByName.get(colName)
        if (!nc) {
          tableMismatches.push(`extra column in local "${colName}" (${lc.dataType}, nullable=${lc.isNullable})`)
          continue
        }
        if (lc.dataType !== nc.dataType || lc.udtName !== nc.udtName) {
          tableMismatches.push(
            `type mismatch on "${colName}": local=${lc.dataType}(${lc.udtName}) vs neon=${nc.dataType}(${nc.udtName})`
          )
        }
        if (lc.isNullable !== nc.isNullable) {
          tableMismatches.push(
            `nullability mismatch on "${colName}": local=${lc.isNullable} vs neon=${nc.isNullable}`
          )
        }
      }
      for (const [colName, nc] of nByName) {
        if (!lByName.has(colName)) {
          tableMismatches.push(`missing column in local "${colName}" (${nc.dataType}, nullable=${nc.isNullable})`)
        }
      }

      // Verify PK / FK / Unique constraint definitions match (ignoring PostgreSQL constraint name differences)
      const lCons = new Set((localSchema.constraintsByTable.get(table) || []).map((c) => `${c.contype}:${c.def}`))
      const nCons = new Set((neonSchema.constraintsByTable.get(table) || []).map((c) => `${c.contype}:${c.def}`))
      for (const lc of lCons) {
        if (!nCons.has(lc)) tableMismatches.push(`constraint in local missing in neon: ${lc}`)
      }
      for (const nc of nCons) {
        if (!lCons.has(nc)) tableMismatches.push(`constraint in neon missing in local: ${nc}`)
      }

      if (tableMismatches.length > 0) {
        schemaDiffs.push(`${table}: ${tableMismatches.join('; ')}`)
        console.error(`\n[SCHEMA DIFF] ${table}`)
        console.error(
          JSON.stringify(
            {
              localColumns: lCols,
              neonColumns: nCols,
              localConstraints: localSchema.constraintsByTable.get(table) || [],
              neonConstraints: neonSchema.constraintsByTable.get(table) || [],
              localIndexes: localSchema.indexesByTable.get(table) || [],
              neonIndexes: neonSchema.indexesByTable.get(table) || [],
            },
            null,
            2
          )
        )
      } else {
        const lOrder = lCols.map((c) => c.columnName).join(',')
        const nOrder = nCols.map((c) => c.columnName).join(',')
        if (lOrder !== nOrder) {
          ordinalOrderNotes.push(
            `${table} physical column order differs (safe: named-column inserts used) -> local=[${lOrder}] vs neon=[${nOrder}]`
          )
        }
      }
    }

    if (ordinalOrderNotes.length > 0) {
      console.log('\n--- Schema Ordinal-Position Notes (Informational) ---')
      for (const note of ordinalOrderNotes) console.log(`- ${note}`)
    }

    if (schemaDiffs.length > 0) {
      throw new Error(`Schema compatibility check failed: ${schemaDiffs.join(' | ')}`)
    }
    console.log(`Schema Check PASS: All ${APPLICATION_TABLES.length} tables (columns, types, nullability, PK/FK/unique constraints) and vector(384) match.`)

    // Load full local dataset (read-only) & existing Neon reconciliation tables
    const [
      localUsers,
      localCandidates,
      localDocs,
      localChunks,
      localSessions,
      localQuestions,
      localAnswers,
      localAnswerEvals,
      localReports,
      localGaps,
      localAuditLogs,
      localOtps,
      localAppSettings,
      neonUsers,
      neonCandidates,
      neonDocs,
      neonSessions,
      neonQuestions,
      neonAnswers,
      neonAnswerEvals,
      neonReports,
      neonGaps,
      neonAuditLogs,
      neonOtps,
      neonAppSettings,
    ] = await Promise.all([
      localDb.user.findMany({ orderBy: { id: 'asc' } }) as Promise<LocalUserRow[]>,
      localDb.candidate.findMany({ orderBy: { createdAt: 'asc' } }) as Promise<LocalCandidateRow[]>,
      localDb.document.findMany({ orderBy: { id: 'asc' } }) as Promise<LocalDocumentRow[]>,
      localDb.$queryRawUnsafe<LocalChunkRow[]>(`
        SELECT
          "id", "documentId", "content", "chunkIndex", "createdAt",
          "pageNumber", "sourceType", "topic", "unit",
          "embedding"::text AS "embeddingText",
          vector_dims("embedding")::int AS "embeddingDims"
        FROM "DocumentChunk"
        ORDER BY "documentId" ASC, "chunkIndex" ASC, "id" ASC
      `),
      localDb.interviewSession.findMany({ orderBy: { startedAt: 'asc' } }) as Promise<LocalSessionRow[]>,
      localDb.question.findMany({ orderBy: { askedAt: 'asc' } }) as Promise<LocalQuestionRow[]>,
      localDb.answer.findMany({ orderBy: { answeredAt: 'asc' } }) as Promise<LocalAnswerRow[]>,
      localDb.answerEvaluation.findMany() as Promise<LocalAnswerEvalRow[]>,
      localDb.interviewReport.findMany({ orderBy: { createdAt: 'asc' } }) as Promise<LocalReportRow[]>,
      localDb.knowledgeGap.findMany() as Promise<LocalGapRow[]>,
      localDb.auditLog.findMany({ orderBy: { createdAt: 'asc' } }) as Promise<LocalAuditLogRow[]>,
      localDb.otpVerification.findMany({ orderBy: { createdAt: 'asc' } }) as Promise<LocalOtpRow[]>,
      localDb.appSettings.findMany({ orderBy: { id: 'asc' } }) as Promise<LocalAppSettingRow[]>,
      withRetry('Neon users', () =>
        neonDb.user.findMany({
          select: { id: true, username: true, email: true, name: true, role: true, emailVerified: true, createdAt: true },
          orderBy: { id: 'asc' },
        })
      ),
      withRetry('Neon candidates', () => neonDb.candidate.findMany()),
      withRetry('Neon docs', () =>
        neonDb.document.findMany({ include: { _count: { select: { chunks: true } } } })
      ),
      withRetry('Neon sessions', () => neonDb.interviewSession.findMany({ select: { id: true } })),
      withRetry('Neon questions', () => neonDb.question.findMany({ select: { id: true } })),
      withRetry('Neon answers', () => neonDb.answer.findMany({ select: { id: true } })),
      withRetry('Neon evals', () => neonDb.answerEvaluation.findMany({ select: { id: true } })),
      withRetry('Neon reports', () => neonDb.interviewReport.findMany({ select: { id: true } })),
      withRetry('Neon gaps', () => neonDb.knowledgeGap.findMany({ select: { id: true } })),
      withRetry('Neon auditLogs', () => neonDb.auditLog.findMany({ select: { id: true } })),
      withRetry('Neon otps', () => neonDb.otpVerification.findMany({ select: { id: true } })),
      withRetry('Neon settings', () => neonDb.appSettings.findMany()),
    ])

    // PHASE C: User Reconciliation
    const neonUserByEmail = new Map<string, (typeof neonUsers)[number]>()
    const neonUserByUsername = new Map<string, (typeof neonUsers)[number]>()
    for (const nu of neonUsers) {
      if (nu.email) neonUserByEmail.set(nu.email.trim().toLowerCase(), nu)
      neonUserByUsername.set(nu.username.trim().toLowerCase(), nu)
    }

    const userPlan: Array<{
      localId: number
      username: string
      email: string | null
      role: string
      action: 'REUSE' | 'CREATE' | 'CONFLICT'
      neonUserId: number | null
      reason?: string
    }> = []

    const plannedUserIdMap = new Map<number, number | null>() // null = CREATE (new serial ID assigned at insert)
    const userConflicts: string[] = []

    for (const lu of localUsers) {
      const normEmail = lu.email ? lu.email.trim().toLowerCase() : null
      const normUsername = lu.username.trim().toLowerCase()
      const byEmail = normEmail ? neonUserByEmail.get(normEmail) : undefined
      const byUsername = neonUserByUsername.get(normUsername)

      if (byEmail && byUsername && byEmail.id !== byUsername.id) {
        const msg = `Local user id=${lu.id} (${lu.username}) matches TWO different Neon users: email->id=${byEmail.id}, username->id=${byUsername.id}`
        userConflicts.push(msg)
        userPlan.push({ localId: lu.id, username: lu.username, email: lu.email, role: lu.role, action: 'CONFLICT', neonUserId: null, reason: msg })
        continue
      }

      const matched = byEmail || byUsername
      if (matched) {
        if (matched.role !== lu.role) {
          const msg = `Role conflict for "${lu.username}": local role=${lu.role}, existing Neon id=${matched.id} role=${matched.role}`
          userConflicts.push(msg)
          userPlan.push({ localId: lu.id, username: lu.username, email: lu.email, role: lu.role, action: 'CONFLICT', neonUserId: matched.id, reason: msg })
          continue
        }
        plannedUserIdMap.set(lu.id, matched.id)
        userPlan.push({ localId: lu.id, username: lu.username, email: lu.email, role: lu.role, action: 'REUSE', neonUserId: matched.id })
      } else {
        plannedUserIdMap.set(lu.id, null)
        userPlan.push({ localId: lu.id, username: lu.username, email: lu.email, role: lu.role, action: 'CREATE', neonUserId: null })
      }
    }

    // Candidate Reconciliation
    const neonCandidateByUserId = new Map<number, (typeof neonCandidates)[number]>()
    const neonCandidateById = new Map<string, (typeof neonCandidates)[number]>()
    for (const nc of neonCandidates) {
      neonCandidateById.set(nc.id, nc)
      if (nc.userId !== null) neonCandidateByUserId.set(nc.userId, nc)
    }

    const candidateConflicts: string[] = []
    const candidatePlan: Array<{
      localId: string
      name: string
      email: string | null
      localUserId: number | null
      action: 'REUSE' | 'CREATE' | 'CONFLICT'
      neonCandidateId: string | null
      reason?: string
    }> = []

    for (const lc of localCandidates) {
      const mappedNeonUserId = lc.userId !== null ? plannedUserIdMap.get(lc.userId) : undefined
      if (lc.userId !== null && mappedNeonUserId === undefined) {
        const msg = `Local candidate ${lc.id} references missing local userId=${lc.userId}`
        candidateConflicts.push(msg)
        candidatePlan.push({ localId: lc.id, name: lc.name, email: lc.email, localUserId: lc.userId, action: 'CONFLICT', neonCandidateId: null, reason: msg })
        continue
      }

      if (mappedNeonUserId !== null && mappedNeonUserId !== undefined) {
        const existingForUser = neonCandidateByUserId.get(mappedNeonUserId)
        if (existingForUser) {
          candidatePlan.push({ localId: lc.id, name: lc.name, email: lc.email, localUserId: lc.userId, action: 'REUSE', neonCandidateId: existingForUser.id })
          continue
        }
      }

      const byUuid = neonCandidateById.get(lc.id)
      if (byUuid) {
        const msg = `Candidate UUID collision for ${lc.id} (local userId=${lc.userId}, Neon userId=${byUuid.userId})`
        candidateConflicts.push(msg)
        candidatePlan.push({ localId: lc.id, name: lc.name, email: lc.email, localUserId: lc.userId, action: 'CONFLICT', neonCandidateId: byUuid.id, reason: msg })
        continue
      }

      candidatePlan.push({ localId: lc.id, name: lc.name, email: lc.email, localUserId: lc.userId, action: 'CREATE', neonCandidateId: lc.id })
    }

    // PHASE D: Audit all Document records & Chunks
    const chunksByDocId = new Map<number, LocalChunkRow[]>()
    const embeddingIssues: string[] = []
    for (const chunk of localChunks) {
      if (!chunk.embeddingText) {
        embeddingIssues.push(`Chunk id=${chunk.id} (doc=${chunk.documentId}) has NULL embedding`)
      } else if (chunk.embeddingDims !== EXPECTED_VECTOR_DIM) {
        embeddingIssues.push(`Chunk id=${chunk.id} (doc=${chunk.documentId}) has ${chunk.embeddingDims} dims (expected ${EXPECTED_VECTOR_DIM})`)
      }
      const list = chunksByDocId.get(chunk.documentId) || []
      list.push(chunk)
      chunksByDocId.set(chunk.documentId, list)
    }

    const localDocById = new Map(localDocs.map((d) => [d.id, d]))
    const docAudits: DocumentAuditEntry[] = []

    for (const doc of localDocs) {
      const issues: string[] = []
      const docChunks = chunksByDocId.get(doc.id) || []

      if (!plannedUserIdMap.has(doc.userId)) {
        issues.push(`Orphaned local userId=${doc.userId}`)
      }
      const mappedNeonUserId = plannedUserIdMap.get(doc.userId) ?? null

      if (doc.docSource === 'SYNCED_FROM_ADMIN') {
        if (doc.adminDocId === null || !localDocById.has(doc.adminDocId)) {
          issues.push(`SYNCED_FROM_ADMIN missing valid adminDocId=${doc.adminDocId}`)
        }
      }

      if (doc.status === 'PROCESSED' && docChunks.length === 0) {
        issues.push('Document status is PROCESSED but has 0 chunks')
      }

      // Inspect storagePath strictly against APPROVED_DOCS_DIR
      let approvedFilePath: string | null = null
      let diskSize: number | null = null
      let sha256: string | null = null

      const pathCheck = isInsideApprovedDir(doc.storagePath)
      const existsInApprovedDir = fs.existsSync(pathCheck.approvedCandidatePath)

      if (!doc.storagePath || doc.storagePath === 'seeded') {
        issues.push(`Non-file storagePath="${doc.storagePath}"`)
      } else if (!pathCheck.isInApprovedDir) {
        issues.push(
          `storagePath points outside approved folder (${path.dirname(pathCheck.resolvedSourcePath)}); same basename in approved folder=${existsInApprovedDir}`
        )
      } else if (!existsInApprovedDir) {
        issues.push(`Original file missing in approved folder: ${pathCheck.approvedCandidatePath}`)
      } else {
        const stat = fs.statSync(pathCheck.approvedCandidatePath)
        if (!stat.isFile()) {
          issues.push(`Approved path is not a file: ${pathCheck.approvedCandidatePath}`)
        } else {
          approvedFilePath = pathCheck.approvedCandidatePath
          diskSize = stat.size
          if (diskSize !== doc.fileSize) {
            issues.push(`Size mismatch: DB fileSize=${doc.fileSize}, disk=${diskSize}`)
          }
          const bytes = fs.readFileSync(approvedFilePath)
          sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
        }
      }

      // Target B2 key (deterministic):
      // For REUSE users we already know neonUserId; for CREATE users we show placeholder <newUserId:localId> in dry-run
      const ownerSegment = mappedNeonUserId !== null ? String(mappedNeonUserId) : `<newUserId:${doc.userId}>`
      const b2Prefix = doc.docSource === 'ADMIN_MASTER' ? 'admin-kb-docs' : `knowledge-docs/${ownerSegment}`
      const targetB2Key = pathCheck.basename ? `${b2Prefix}/${pathCheck.basename}` : null

      let b2AlreadyExists = false
      let b2ContentLength: number | null = null
      if (targetB2Key && mappedNeonUserId !== null) {
        const head = await headB2Object(s3, b2Config.bucketName, targetB2Key)
        b2AlreadyExists = head.exists
        b2ContentLength = head.contentLength ?? null
        if (head.exists && head.contentLength !== doc.fileSize) {
          issues.push(`Existing B2 object size (${head.contentLength}) != DB fileSize (${doc.fileSize})`)
        }
      }

      // Check existing Neon Document
      let existingNeonDocId: number | null = null
      if (mappedNeonUserId !== null && targetB2Key) {
        const matchNeon = neonDocs.find(
          (nd) =>
            nd.userId === mappedNeonUserId &&
            (nd.storagePath === targetB2Key ||
              (nd.originalFilename === doc.originalFilename &&
                nd.fileSize === doc.fileSize &&
                nd.createdAt.getTime() === doc.createdAt.getTime()))
        )
        if (matchNeon) {
          existingNeonDocId = matchNeon.id
          if (matchNeon._count.chunks !== docChunks.length) {
            issues.push(
              `Existing Neon doc id=${matchNeon.id} has ${matchNeon._count.chunks} chunks, local has ${docChunks.length}`
            )
          }
        }
      }

      let classification: DocClassification
      if (issues.some((i) => i.includes('outside approved folder') || i.includes('missing in approved folder') || i.includes('Non-file storagePath'))) {
        classification = 'MISSING_OR_OUTSIDE_APPROVED_FOLDER'
      } else if (issues.length > 0) {
        classification = 'INVALID_OR_INCONSISTENT_METADATA'
      } else if (b2AlreadyExists) {
        classification = 'EXISTING_B2_OBJECT'
      } else {
        classification = 'AVAILABLE_IN_APPROVED_FOLDER'
      }

      docAudits.push({
        localDocId: doc.id,
        name: doc.name,
        originalFilename: doc.originalFilename,
        fileSize: doc.fileSize,
        status: doc.status,
        sourceUserId: doc.userId,
        targetUserId: mappedNeonUserId,
        docSource: doc.docSource,
        adminDocId: doc.adminDocId,
        sourceStoragePath: doc.storagePath,
        classification,
        issues,
        approvedFilePath,
        diskSize,
        sha256,
        chunkCount: docChunks.length,
        targetB2Key,
        b2AlreadyExists,
        b2ContentLength,
        existingNeonDocId,
      })
    }

    // AppSettings conflict check
    const neonSettingByKey = new Map(neonAppSettings.map((s) => [s.key, s]))
    const settingConflicts: string[] = []
    const appSettingsToInsert: LocalAppSettingRow[] = []
    for (const ls of localAppSettings) {
      if (ls.key.startsWith('pwd_reset_')) continue // skip ephemeral password reset tokens
      const existing = neonSettingByKey.get(ls.key)
      if (existing) {
        if (existing.value !== ls.value) {
          settingConflicts.push(`AppSettings key="${ls.key}" exists in Neon with a different value`)
        }
      } else {
        appSettingsToInsert.push(ls)
      }
    }

    // Print Comprehensive Report
    console.log('\n--- User Reconciliation Plan ---')
    console.log(JSON.stringify(userPlan, null, 2))

    console.log('\n--- Candidate Reconciliation Plan ---')
    console.log(JSON.stringify(candidatePlan, null, 2))

    console.log('\n--- Document Audit Report (All Local Documents) ---')
    console.log(
      JSON.stringify(
        docAudits.map((d) => ({
          localDocId: d.localDocId,
          name: d.name,
          originalFilename: d.originalFilename,
          fileSize: d.fileSize,
          status: d.status,
          sourceUserId: d.sourceUserId,
          targetUserId: d.targetUserId,
          docSource: d.docSource,
          adminDocId: d.adminDocId,
          classification: d.classification,
          chunkCount: d.chunkCount,
          targetB2Key: d.targetB2Key,
          b2AlreadyExists: d.b2AlreadyExists,
          existingNeonDocId: d.existingNeonDocId,
          issues: d.issues,
        })),
        null,
        2
      )
    )

    const summaryByClass = docAudits.reduce<Record<string, number>>((acc, d) => {
      acc[d.classification] = (acc[d.classification] || 0) + 1
      return acc
    }, {})

    const blockedDocs = docAudits.filter(
      (d) =>
        d.classification === 'MISSING_OR_OUTSIDE_APPROVED_FOLDER' ||
        d.classification === 'INVALID_OR_INCONSISTENT_METADATA'
    )

    console.log('\n--- Migration Dry-Run Summary ---')
    console.log(
      JSON.stringify(
        {
          documentClassifications: summaryByClass,
          totalLocalChunks: localChunks.length,
          embeddingIssuesCount: embeddingIssues.length,
          userConflicts,
          candidateConflicts,
          settingConflicts,
          blockedDocumentIds: blockedDocs.map((d) => ({ id: d.localDocId, issues: d.issues })),
          otherTablesToMigrate: {
            InterviewSession: localSessions.filter((s) => !neonSessions.some((ns) => ns.id === s.id)).length,
            Question: localQuestions.filter((q) => !neonQuestions.some((nq) => nq.id === q.id)).length,
            Answer: localAnswers.filter((a) => !neonAnswers.some((na) => na.id === a.id)).length,
            AnswerEvaluation: localAnswerEvals.filter((e) => !neonAnswerEvals.some((ne) => ne.id === e.id)).length,
            InterviewReport: localReports.filter((r) => !neonReports.some((nr) => nr.id === r.id)).length,
            KnowledgeGap: localGaps.filter((g) => !neonGaps.some((ng) => ng.id === g.id)).length,
            AuditLog: localAuditLogs.filter((l) => !neonAuditLogs.some((nl) => nl.id === l.id)).length,
            OtpVerification: localOtps.filter((o) => !neonOtps.some((no) => no.id === o.id)).length,
            AppSettings: appSettingsToInsert.length,
          },
        },
        null,
        2
      )
    )

    const hasBlockers =
      userConflicts.length > 0 ||
      candidateConflicts.length > 0 ||
      settingConflicts.length > 0 ||
      embeddingIssues.length > 0 ||
      blockedDocs.length > 0

    if (isDryRun) {
      if (hasBlockers) {
        console.log('\nDRY RUN DETECTED BLOCKERS: Resolve the above conflicts/missing files before executing.')
        process.exitCode = 2
      } else {
        console.log('\nDRY RUN PASS: Zero blockers detected. Ready for --execute --confirm-execute.')
      }
      return
    }

    if (hasBlockers) {
      throw new Error('Refusing --execute: preflight detected unresolved conflicts, missing files, or embedding issues.')
    }

    // PHASE H: Execute Full Migration
    // 1. Reconcile / Create Users first in a transaction? Better: create Users first only if needed?
    // Wait: B2 key uses target Neon userId! So we resolve final userIdMap inside an initial user/candidate step OR use transaction?
    // Actually: if we create new Users inside a transaction BEFORE B2 uploads, if B2 upload fails we could leave new Users; OR
    // we can upload B2 objects for REUSE users first, or create Users + upload B2 + insert rest cleanly!
    // Even cleaner: compute final userIdMap first inside a short idempotent Users-only transaction (since Users are safe & idempotent),
    // THEN upload & HeadObject verify all B2 objects with exact target userId keys,
    // THEN insert remaining tables inside one atomic transaction (rolling back any newly uploaded B2 keys if it fails)!

    const finalUserIdMap = new Map<number, number>()
    const createdUsersSummary: Array<{ localId: number; neonId: number; username: string; role: string }> = []
    const reusedUsersSummary: Array<{ localId: number; neonId: number; username: string; role: string }> = []

    await withRetry('Reconcile Neon Users', () =>
      neonDb.$transaction(async (tx) => {
        for (const lu of localUsers) {
          const planned = plannedUserIdMap.get(lu.id)
          if (planned !== null && planned !== undefined) {
            finalUserIdMap.set(lu.id, planned)
            reusedUsersSummary.push({ localId: lu.id, neonId: planned, username: lu.username, role: lu.role })
            continue
          }

          const inserted = await tx.$queryRawUnsafe<Array<{ id: number }>>(
            `
            INSERT INTO "User" (
              "username", "email", "name", "passwordHash", "role", "emailVerified", "createdAt"
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING "id"
            `,
            lu.username,
            lu.email,
            lu.name,
            lu.passwordHash,
            lu.role,
            lu.emailVerified,
            lu.createdAt
          )
          const newId = inserted[0]?.id
          if (!newId) throw new Error(`Failed to insert User localId=${lu.id}`)
          finalUserIdMap.set(lu.id, newId)
          createdUsersSummary.push({ localId: lu.id, neonId: newId, username: lu.username, role: lu.role })
        }
      })
    )

    // 2. Upload all Document files to B2 and verify ContentLength
    const finalB2KeyByLocalDocId = new Map<number, string>()
    const uploadedB2KeysThisRun: string[] = []

    try {
      for (const audit of docAudits) {
        const mappedUserId = finalUserIdMap.get(audit.sourceUserId)
        if (!mappedUserId) throw new Error(`Missing finalUserIdMap for doc id=${audit.localDocId}`)
        if (!audit.approvedFilePath) throw new Error(`Missing approvedFilePath for doc id=${audit.localDocId}`)

        const basename = path.basename(audit.approvedFilePath)
        const key =
          audit.docSource === 'ADMIN_MASTER'
            ? `admin-kb-docs/${basename}`
            : `knowledge-docs/${mappedUserId}/${basename}`
        finalB2KeyByLocalDocId.set(audit.localDocId, key)

        const existingHead = await headB2Object(s3, b2Config.bucketName, key)
        if (existingHead.exists) {
          if (existingHead.contentLength !== audit.fileSize) {
            throw new Error(`Existing B2 key "${key}" size ${existingHead.contentLength} != ${audit.fileSize}`)
          }
          console.log(`[B2] Verified existing object: ${key}`)
          continue
        }

        const buffer = fs.readFileSync(audit.approvedFilePath)
        if (buffer.byteLength !== audit.fileSize) {
          throw new Error(`Disk read byte mismatch for ${audit.approvedFilePath}`)
        }

        const localDoc = localDocById.get(audit.localDocId)!
        await s3.send(
          new PutObjectCommand({
            Bucket: b2Config.bucketName,
            Key: key,
            Body: buffer,
            ContentType: resolveMimeType(localDoc.fileType, localDoc.originalFilename),
            ContentLength: buffer.byteLength,
          })
        )
        uploadedB2KeysThisRun.push(key)

        const verifyHead = await headB2Object(s3, b2Config.bucketName, key)
        if (!verifyHead.exists || verifyHead.contentLength !== buffer.byteLength) {
          throw new Error(`Post-upload B2 verification failed for ${key}`)
        }
        console.log(`[B2] Uploaded & verified (${verifyHead.contentLength} bytes): ${key}`)
      }

      // 3. Insert Candidates, Documents, Chunks, Sessions, Questions, Answers, Evaluations, Reports, Gaps, AuditLogs, OTPs, Settings atomically
      const docIdMap = new Map<number, number>()
      const candidateIdMap = new Map<string, string>()

      await neonDb.$transaction(
        async (tx) => {
          // 3a. Candidates
          for (const cp of candidatePlan) {
            if (cp.action === 'REUSE' && cp.neonCandidateId) {
              candidateIdMap.set(cp.localId, cp.neonCandidateId)
              continue
            }
            const lc = localCandidates.find((c) => c.id === cp.localId)!
            const mappedUserId = lc.userId !== null ? finalUserIdMap.get(lc.userId) ?? null : null
            await tx.$executeRawUnsafe(
              `INSERT INTO "Candidate" ("id", "name", "email", "createdAt", "userId") VALUES ($1, $2, $3, $4, $5)`,
              lc.id,
              lc.name,
              lc.email,
              lc.createdAt,
              mappedUserId
            )
            candidateIdMap.set(lc.id, lc.id)
          }

          // 3b. Documents (non-synced first, then SYNCED_FROM_ADMIN)
          const orderedDocs = [
            ...localDocs.filter((d) => d.docSource !== 'SYNCED_FROM_ADMIN'),
            ...localDocs.filter((d) => d.docSource === 'SYNCED_FROM_ADMIN'),
          ]

          const existingNeonDocs = await tx.document.findMany({
            select: { id: true, userId: true, storagePath: true, originalFilename: true, fileSize: true, createdAt: true },
          })

          for (const ld of orderedDocs) {
            const mappedUserId = finalUserIdMap.get(ld.userId)!
            const targetKey = finalB2KeyByLocalDocId.get(ld.id)!
            const mappedAdminDocId = ld.adminDocId !== null ? docIdMap.get(ld.adminDocId) ?? null : null

            const existingDoc = existingNeonDocs.find(
              (nd) =>
                nd.userId === mappedUserId &&
                (nd.storagePath === targetKey ||
                  (nd.originalFilename === ld.originalFilename &&
                    nd.fileSize === ld.fileSize &&
                    nd.createdAt.getTime() === ld.createdAt.getTime()))
            )

            if (existingDoc) {
              docIdMap.set(ld.id, existingDoc.id)
              continue
            }

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
              ld.name,
              ld.originalFilename,
              ld.fileType,
              ld.fileSize,
              targetKey,
              ld.status,
              mappedUserId,
              ld.createdAt,
              ld.updatedAt,
              ld.branch,
              ld.institution,
              ld.semester,
              ld.subject,
              ld.docSource,
              mappedAdminDocId
            )
            const newDocId = insertedDocs[0]?.id
            if (!newDocId) throw new Error(`Failed to insert Document localId=${ld.id}`)
            docIdMap.set(ld.id, newDocId)

            // Insert chunks for this newly inserted document in parameterized batches
            const docChunks = chunksByDocId.get(ld.id) || []
            for (let i = 0; i < docChunks.length; i += CHUNK_BATCH_SIZE) {
              const batch = docChunks.slice(i, i + CHUNK_BATCH_SIZE)
              const clauses: string[] = []
              const params: unknown[] = []
              for (const chunk of batch) {
                const b = params.length
                clauses.push(
                  `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}::vector, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9})`
                )
                params.push(
                  newDocId,
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
                VALUES ${clauses.join(', ')}
                `,
                ...params
              )
            }
          }

          // 3c. InterviewSessions
          const existingSessionIds = new Set(neonSessions.map((s) => s.id))
          for (const ls of localSessions) {
            if (existingSessionIds.has(ls.id)) continue
            const mappedCandidateId = candidateIdMap.get(ls.candidateId)
            if (!mappedCandidateId) throw new Error(`Missing candidateIdMap for session ${ls.id}`)
            const mappedInterviewerId =
              ls.interviewerId !== null ? finalUserIdMap.get(ls.interviewerId) ?? null : null
            const { remappedScope } = remapSessionScope(ls.scope, docIdMap)

            await tx.$executeRawUnsafe(
              `
              INSERT INTO "InterviewSession" (
                "id", "candidateId", "interviewerId", "status", "difficulty", "interviewType",
                "scope", "score", "topicsCovered", "weakTopics", "strongTopics", "startedAt", "endedAt"
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13)
              `,
              ls.id,
              mappedCandidateId,
              mappedInterviewerId,
              ls.status,
              ls.difficulty,
              ls.interviewType,
              remappedScope === null || remappedScope === undefined ? null : JSON.stringify(remappedScope),
              ls.score,
              ls.topicsCovered,
              ls.weakTopics,
              ls.strongTopics,
              ls.startedAt,
              ls.endedAt
            )
          }

          // 3d. Questions
          const existingQuestionIds = new Set(neonQuestions.map((q) => q.id))
          for (const lq of localQuestions) {
            if (existingQuestionIds.has(lq.id)) continue
            await tx.$executeRawUnsafe(
              `
              INSERT INTO "Question" (
                "id", "sessionId", "questionNumber", "content", "type", "difficulty",
                "topic", "expectedAnswer", "coreConcepts", "requiredKeywords", "askedAt"
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
              `,
              lq.id,
              lq.sessionId,
              lq.questionNumber,
              lq.content,
              lq.type,
              lq.difficulty,
              lq.topic,
              lq.expectedAnswer,
              lq.coreConcepts,
              lq.requiredKeywords,
              lq.askedAt
            )
          }

          // 3e. Answers
          const existingAnswerIds = new Set(neonAnswers.map((a) => a.id))
          for (const la of localAnswers) {
            if (existingAnswerIds.has(la.id)) continue
            await tx.$executeRawUnsafe(
              `
              INSERT INTO "Answer" ("id", "questionId", "transcript", "audioPath", "duration", "answeredAt")
              VALUES ($1, $2, $3, $4, $5, $6)
              `,
              la.id,
              la.questionId,
              la.transcript,
              la.audioPath,
              la.duration,
              la.answeredAt
            )
          }

          // 3f. AnswerEvaluations
          const existingEvalIds = new Set(neonAnswerEvals.map((e) => e.id))
          for (const le of localAnswerEvals) {
            if (existingEvalIds.has(le.id)) continue
            await tx.$executeRawUnsafe(
              `
              INSERT INTO "AnswerEvaluation" (
                "id", "answerId", "score", "correctness", "completeness", "relevance",
                "technicalAccuracy", "mentionedKeywords", "missingKeywords", "feedback"
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
              `,
              le.id,
              le.answerId,
              le.score,
              le.correctness,
              le.completeness,
              le.relevance,
              le.technicalAccuracy,
              le.mentionedKeywords,
              le.missingKeywords,
              le.feedback
            )
          }

          // 3g. InterviewReports
          const existingReportIds = new Set(neonReports.map((r) => r.id))
          for (const lr of localReports) {
            if (existingReportIds.has(lr.id)) continue
            await tx.$executeRawUnsafe(
              `
              INSERT INTO "InterviewReport" (
                "id", "sessionId", "overallScore", "topicScores", "strengths",
                "weaknesses", "executiveSummary", "improvementPlan", "createdAt"
              )
              VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9)
              `,
              lr.id,
              lr.sessionId,
              lr.overallScore,
              JSON.stringify(lr.topicScores ?? {}),
              lr.strengths,
              lr.weaknesses,
              lr.executiveSummary,
              lr.improvementPlan,
              lr.createdAt
            )
          }

          // 3h. KnowledgeGaps
          const existingGapIds = new Set(neonGaps.map((g) => g.id))
          for (const lg of localGaps) {
            if (existingGapIds.has(lg.id)) continue
            await tx.$executeRawUnsafe(
              `
              INSERT INTO "KnowledgeGap" ("id", "sessionId", "concept", "confidence", "evidence")
              VALUES ($1, $2, $3, $4, $5)
              `,
              lg.id,
              lg.sessionId,
              lg.concept,
              lg.confidence,
              lg.evidence
            )
          }

          // 3i. AuditLogs (batched)
          const existingLogIds = new Set(neonAuditLogs.map((l) => l.id))
          const logsToInsert = localAuditLogs.filter((l) => !existingLogIds.has(l.id))
          for (let i = 0; i < logsToInsert.length; i += CHUNK_BATCH_SIZE) {
            const batch = logsToInsert.slice(i, i + CHUNK_BATCH_SIZE)
            const clauses: string[] = []
            const params: unknown[] = []
            for (const log of batch) {
              const mappedUserId = log.userId !== null ? finalUserIdMap.get(log.userId) ?? null : null
              let mappedEntityId = log.entityId
              if (log.entityType === 'Document' && log.entityId) {
                const oldDocId = Number(log.entityId)
                if (Number.isInteger(oldDocId) && docIdMap.has(oldDocId)) {
                  mappedEntityId = String(docIdMap.get(oldDocId))
                }
              } else if (log.entityType === 'User' && log.entityId) {
                const oldUserId = Number(log.entityId)
                if (Number.isInteger(oldUserId) && finalUserIdMap.has(oldUserId)) {
                  mappedEntityId = String(finalUserIdMap.get(oldUserId))
                }
              } else if (log.entityType === 'Candidate' && log.entityId && candidateIdMap.has(log.entityId)) {
                mappedEntityId = candidateIdMap.get(log.entityId)!
              }

              const b = params.length
              clauses.push(
                `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}::jsonb, $${b + 9}, $${b + 10}, $${b + 11})`
              )
              params.push(
                log.id,
                mappedUserId,
                log.username,
                log.action,
                log.entityType,
                mappedEntityId,
                log.status,
                log.metadata === null || log.metadata === undefined ? null : JSON.stringify(log.metadata),
                log.ipAddress,
                log.userAgent,
                log.createdAt
              )
            }
            await tx.$executeRawUnsafe(
              `
              INSERT INTO "AuditLog" (
                "id", "userId", "username", "action", "entityType", "entityId",
                "status", "metadata", "ipAddress", "userAgent", "createdAt"
              )
              VALUES ${clauses.join(', ')}
              `,
              ...params
            )
          }

          // 3j. OtpVerification
          const existingOtpIds = new Set(neonOtps.map((o) => o.id))
          for (const lo of localOtps) {
            if (existingOtpIds.has(lo.id)) continue
            const mappedUserId = lo.userId !== null ? finalUserIdMap.get(lo.userId) ?? null : null
            await tx.$executeRawUnsafe(
              `
              INSERT INTO "OtpVerification" (
                "id", "userId", "email", "otpHash", "purpose", "expiresAt", "attempts", "usedAt", "createdAt"
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
              `,
              lo.id,
              mappedUserId,
              lo.email,
              lo.otpHash,
              lo.purpose,
              lo.expiresAt,
              lo.attempts,
              lo.usedAt,
              lo.createdAt
            )
          }

          // 3k. AppSettings
          for (const ls of appSettingsToInsert) {
            await tx.$executeRawUnsafe(
              `INSERT INTO "AppSettings" ("key", "value", "updatedAt") VALUES ($1, $2, $3)`,
              ls.key,
              ls.value,
              ls.updatedAt
            )
          }

          // 3l. Synchronize SERIAL sequences safely
          for (const seqTable of ['User', 'Document', 'DocumentChunk', 'AppSettings'] as const) {
            await tx.$executeRawUnsafe(`
              SELECT setval(
                pg_get_serial_sequence('"${seqTable}"', 'id'),
                GREATEST(COALESCE((SELECT MAX("id") FROM "${seqTable}"), 1), 1),
                COALESCE((SELECT COUNT(*) > 0 FROM "${seqTable}"), false)
              )
            `)
          }
        },
        { timeout: 300000 }
      )

      // PHASE I: Verification
      const [postNeonCounts, postVecStats] = await Promise.all([
        withRetry('Post-migration Neon counts', () => getTableCounts(neonDb)),
        withRetry('Post-migration Neon vector stats', () =>
          neonDb.$queryRawUnsafe<Array<{ total: number; valid_384: number }>>(`
            SELECT
              COUNT(*)::int AS total,
              COUNT(CASE WHEN "embedding" IS NOT NULL AND vector_dims("embedding") = ${EXPECTED_VECTOR_DIM} THEN 1 END)::int AS valid_384
            FROM "DocumentChunk"
          `)
        ),
      ])

      console.log('\n=== Post-Migration Verification Report ===')
      console.log(
        JSON.stringify(
          {
            reusedUsers: reusedUsersSummary,
            createdUsers: createdUsersSummary,
            docIdMapping: Array.from(docIdMap.entries()).map(([oldId, newId]) => ({ oldId, newId })),
            b2UploadedCount: uploadedB2KeysThisRun.length,
            postNeonCounts,
            chunkEmbeddings: postVecStats[0],
          },
          null,
          2
        )
      )
    } catch (err) {
      if (uploadedB2KeysThisRun.length > 0) {
        console.warn(`[ROLLBACK] Cleaning up ${uploadedB2KeysThisRun.length} B2 object(s) uploaded in this failed run...`)
        for (const key of uploadedB2KeysThisRun) {
          await s3.send(new DeleteObjectCommand({ Bucket: b2Config.bucketName, Key: key })).catch(() => {})
        }
      }
      throw err
    }
  } finally {
    await localDb.$disconnect()
    await neonDb.$disconnect()
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err)
  console.error('Full migration error:', msg.replace(/postgres(ql)?:\/\/[^\s]+/gi, '<redacted>'))
  process.exit(1)
})
