import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export type StorageScope = 'knowledge-docs' | 'admin-kb-docs'

export class DocumentObjectNotFoundError extends Error {
  constructor(message = 'Document object not found in storage') {
    super(message)
    this.name = 'DocumentObjectNotFoundError'
  }
}

export class StorageConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StorageConfigurationError'
  }
}

interface B2Config {
  endpoint: string
  region: string
  bucketName: string
  keyId: string
  applicationKey: string
}

declare const globalThis: {
  _b2S3Client?: S3Client
  _b2S3ClientKey?: string
} & typeof global

function normalizeEndpoint(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

export function isB2Configured(): boolean {
  return Boolean(
    process.env.B2_S3_ENDPOINT?.trim() &&
      process.env.B2_REGION?.trim() &&
      process.env.B2_BUCKET_NAME?.trim() &&
      process.env.B2_KEY_ID?.trim() &&
      process.env.B2_APPLICATION_KEY?.trim()
  )
}

function isVercelRuntime(): boolean {
  return Boolean(process.env.VERCEL || process.env.VERCEL_ENV)
}

function getB2Config(): B2Config {
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
    throw new StorageConfigurationError(
      `Backblaze B2 storage is not configured (missing: ${missing.join(', ')})`
    )
  }

  return { endpoint, region, bucketName, keyId, applicationKey }
}

function getB2Client(config: B2Config): S3Client {
  const cacheKey = `${config.endpoint}|${config.region}|${config.keyId}`
  if (globalThis._b2S3Client && globalThis._b2S3ClientKey === cacheKey) {
    return globalThis._b2S3Client
  }

  const client = new S3Client({
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

  globalThis._b2S3Client = client
  globalThis._b2S3ClientKey = cacheKey
  return client
}

function sanitizeExtension(originalFilename: string): string {
  const rawExt = path.extname(originalFilename || '').toLowerCase()
  const cleaned = rawExt.replace(/[^a-z0-9.]/g, '')
  return cleaned.startsWith('.') ? cleaned : ''
}

export function buildDocumentStorageKey(params: {
  scope: StorageScope
  userId?: number
  originalFilename: string
}): string {
  const ext = sanitizeExtension(params.originalFilename)
  const uniqueName = `${Date.now()}-${crypto.randomUUID()}${ext}`

  if (params.scope === 'admin-kb-docs') {
    return `admin-kb-docs/${uniqueName}`
  }

  const ownerSegment =
    typeof params.userId === 'number' && Number.isInteger(params.userId) && params.userId > 0
      ? String(params.userId)
      : 'shared'
  return `knowledge-docs/${ownerSegment}/${uniqueName}`
}

export function isLegacyLocalStoragePath(storagePath: string): boolean {
  if (!storagePath) return false
  return (
    path.isAbsolute(storagePath) ||
    storagePath.startsWith('storage/') ||
    storagePath.startsWith('storage\\')
  )
}

function isS3NotFoundError(err: unknown): boolean {
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
    e.Code === 'NotFound' ||
    e.code === 'NoSuchKey' ||
    e.code === 'NotFound' ||
    e.$metadata?.httpStatusCode === 404
  )
}

/**
 * Store an uploaded document buffer.
 * Uses Backblaze B2 when configured. Only allows local filesystem fallback in
 * non-production local development when B2 env vars are intentionally unset.
 */
export async function saveDocumentBuffer(params: {
  scope: StorageScope
  userId?: number
  originalFilename: string
  contentType: string
  buffer: Buffer
}): Promise<{ storagePath: string; storageProvider: 'b2' | 'local' }> {
  if (isB2Configured()) {
    const config = getB2Config()
    const client = getB2Client(config)
    const key = buildDocumentStorageKey({
      scope: params.scope,
      userId: params.userId,
      originalFilename: params.originalFilename,
    })

    await client.send(
      new PutObjectCommand({
        Bucket: config.bucketName,
        Key: key,
        Body: params.buffer,
        ContentType: params.contentType || 'application/octet-stream',
        ContentLength: params.buffer.byteLength,
      })
    )

    return { storagePath: key, storageProvider: 'b2' }
  }

  if (isVercelRuntime() || process.env.NODE_ENV === 'production') {
    throw new StorageConfigurationError(
      'Backblaze B2 environment variables are required in production and Vercel environments.'
    )
  }

  // Local development fallback when B2 env vars are not configured
  const storageDir = path.join(process.cwd(), 'storage', params.scope)
  await fs.promises.mkdir(storageDir, { recursive: true })
  const ext = sanitizeExtension(params.originalFilename)
  const filename = `${Date.now()}-${crypto.randomUUID()}${ext}`
  const localPath = path.join(storageDir, filename)
  await fs.promises.writeFile(localPath, params.buffer)

  return { storagePath: localPath, storageProvider: 'local' }
}

/**
 * Retrieve document bytes from Backblaze B2 (or legacy local storage path).
 */
export async function readDocumentBuffer(storagePath: string): Promise<Buffer> {
  if (!storagePath || storagePath === 'seeded') {
    throw new DocumentObjectNotFoundError('Seeded or empty document has no backing file')
  }

  if (isLegacyLocalStoragePath(storagePath)) {
    try {
      return await fs.promises.readFile(storagePath)
    } catch (err: unknown) {
      const fsErr = err as NodeJS.ErrnoException
      if (fsErr?.code === 'ENOENT') {
        throw new DocumentObjectNotFoundError('Legacy local document file not found')
      }
      throw err
    }
  }

  const config = getB2Config()
  const client = getB2Client(config)

  try {
    const res = await client.send(
      new GetObjectCommand({
        Bucket: config.bucketName,
        Key: storagePath,
      })
    )

    if (!res.Body) {
      throw new DocumentObjectNotFoundError('Empty response body from B2 storage')
    }

    const bytes = await res.Body.transformToByteArray()
    return Buffer.from(bytes)
  } catch (err: unknown) {
    if (isS3NotFoundError(err)) {
      throw new DocumentObjectNotFoundError('Document object not found in B2 storage')
    }
    throw err
  }
}

/**
 * Delete a document object from Backblaze B2 (or legacy local storage path).
 * Treats missing objects (404/NoSuchKey/ENOENT) as already deleted so cleanup is idempotent.
 */
export async function deleteDocumentObject(storagePath: string): Promise<void> {
  if (!storagePath || storagePath === 'seeded') {
    return
  }

  if (isLegacyLocalStoragePath(storagePath)) {
    try {
      await fs.promises.unlink(storagePath)
    } catch (err: unknown) {
      const fsErr = err as NodeJS.ErrnoException
      if (fsErr?.code !== 'ENOENT') {
        throw err
      }
    }
    return
  }

  const config = getB2Config()
  const client = getB2Client(config)

  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: config.bucketName,
        Key: storagePath,
      })
    )
  } catch (err: unknown) {
    if (!isS3NotFoundError(err)) {
      throw err
    }
  }
}

const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
}

export function resolveSafeMimeType(fileType?: string | null, originalFilename?: string | null): string {
  const extFromName = path.extname(originalFilename || '').toLowerCase()
  if (extFromName && MIME_BY_EXT[extFromName]) {
    return MIME_BY_EXT[extFromName]
  }

  const normalizedType = (fileType || '').trim().toLowerCase()
  if (normalizedType === 'pdf') return MIME_BY_EXT['.pdf']
  if (normalizedType === 'docx') return MIME_BY_EXT['.docx']
  if (normalizedType === 'doc') return MIME_BY_EXT['.doc']
  if (normalizedType === 'txt' || normalizedType === 'text/plain') return MIME_BY_EXT['.txt']
  if (normalizedType === 'md' || normalizedType === 'text/markdown') return MIME_BY_EXT['.md']

  return 'application/octet-stream'
}

export function sanitizeDownloadFilename(originalFilename: string): string {
  const base = path.basename(originalFilename || 'document')
  const cleaned = base.replace(/["\\\r\n]/g, '_').trim()
  return cleaned || 'document'
}

export interface B2HeadObjectResult {
  exists: boolean
  contentLength?: number
  contentType?: string
  etag?: string | null
  lastModified?: Date | null
}

export interface ListedB2Object {
  key: string
  size: number
  etag: string | null
  lastModified: Date | null
}

const ALLOWED_DOCUMENT_PREFIXES = ['admin-kb-docs/', 'knowledge-docs/'] as const

export function isAllowedDocumentPrefix(prefix: string): boolean {
  return ALLOWED_DOCUMENT_PREFIXES.some((allowed) => prefix.startsWith(allowed))
}

/**
 * Create a short-lived presigned PUT URL for direct browser-to-B2 uploads.
 * Prefix & ownership segment are derived purely server-side from scope/userId.
 */
export async function createPresignedDocumentUpload(params: {
  scope: StorageScope
  userId?: number
  originalFilename: string
  contentType: string
  contentLength?: number
  expiresInSeconds?: number
}): Promise<{
  uploadUrl: string
  storagePath: string
  expiresAt: Date
  contentType: string
}> {
  if (!isB2Configured()) {
    throw new StorageConfigurationError(
      'Backblaze B2 direct upload is unavailable because B2 environment variables are not configured.'
    )
  }

  if (
    params.scope === 'knowledge-docs' &&
    !(typeof params.userId === 'number' && Number.isInteger(params.userId) && params.userId > 0)
  ) {
    throw new StorageConfigurationError('Valid numeric userId is required for knowledge-docs uploads')
  }

  const config = getB2Config()
  const client = getB2Client(config)
  const storagePath = buildDocumentStorageKey({
    scope: params.scope,
    userId: params.userId,
    originalFilename: params.originalFilename,
  })

  const contentType = (params.contentType || '').trim() || 'application/octet-stream'
  const rawTtl = typeof params.expiresInSeconds === 'number' ? params.expiresInSeconds : 600
  const expiresIn = Math.min(Math.max(Math.floor(rawTtl), 60), 900)
  const expiresAt = new Date(Date.now() + expiresIn * 1000)

  const command = new PutObjectCommand({
    Bucket: config.bucketName,
    Key: storagePath,
    ContentType: contentType,
    ...(typeof params.contentLength === 'number' && params.contentLength > 0
      ? { ContentLength: Math.floor(params.contentLength) }
      : {}),
  })

  const uploadUrl = await getSignedUrl(client, command, { expiresIn })

  return {
    uploadUrl,
    storagePath,
    expiresAt,
    contentType,
  }
}

/**
 * Verify whether a document object exists in B2 (or legacy local disk) and inspect its metadata.
 * Throws on transient network, permission, or rate-limit errors so callers never treat them as 404.
 */
export async function headDocumentObject(storagePath: string): Promise<B2HeadObjectResult> {
  if (!storagePath || storagePath === 'seeded') {
    return { exists: false }
  }

  if (isLegacyLocalStoragePath(storagePath)) {
    try {
      const stat = await fs.promises.stat(storagePath)
      return {
        exists: true,
        contentLength: stat.size,
        lastModified: stat.mtime,
        etag: null,
      }
    } catch (err: unknown) {
      const fsErr = err as NodeJS.ErrnoException
      if (fsErr?.code === 'ENOENT') {
        return { exists: false }
      }
      throw err
    }
  }

  const config = getB2Config()
  const client = getB2Client(config)

  try {
    const res = await client.send(
      new HeadObjectCommand({
        Bucket: config.bucketName,
        Key: storagePath,
      })
    )

    return {
      exists: true,
      contentLength: typeof res.ContentLength === 'number' ? res.ContentLength : 0,
      contentType: res.ContentType,
      etag: res.ETag ?? null,
      lastModified: res.LastModified ?? null,
    }
  } catch (err: unknown) {
    if (isS3NotFoundError(err)) {
      return { exists: false }
    }
    throw err
  }
}

/**
 * List B2 objects under approved document prefixes using paginated ListObjectsV2.
 */
export async function listDocumentObjectsByPrefixes(
  prefixes: string[]
): Promise<Map<string, ListedB2Object>> {
  const validPrefixes = Array.from(new Set(prefixes.map((p) => p.trim()).filter(Boolean)))
  if (validPrefixes.length === 0) {
    return new Map()
  }

  for (const prefix of validPrefixes) {
    if (!isAllowedDocumentPrefix(prefix)) {
      throw new StorageConfigurationError(`Disallowed storage prefix requested: ${prefix}`)
    }
  }

  const config = getB2Config()
  const client = getB2Client(config)
  const objects = new Map<string, ListedB2Object>()

  for (const prefix of validPrefixes) {
    let continuationToken: string | undefined

    do {
      const res = await client.send(
        new ListObjectsV2Command({
          Bucket: config.bucketName,
          Prefix: prefix,
          ContinuationToken: continuationToken,
          MaxKeys: 1000,
        })
      )

      for (const item of res.Contents ?? []) {
        if (!item.Key) continue
        objects.set(item.Key, {
          key: item.Key,
          size: typeof item.Size === 'number' ? item.Size : 0,
          etag: item.ETag ?? null,
          lastModified: item.LastModified ?? null,
        })
      }

      continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined
    } while (continuationToken)
  }

  return objects
}
