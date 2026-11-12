import prisma from '@/lib/db'
import { createAuditLog } from '@/lib/audit-log'
import {
  headDocumentObject,
  isB2Configured,
  isLegacyLocalStoragePath,
  listDocumentObjectsByPrefixes,
  type ListedB2Object,
} from '@/lib/storage/b2'

export type ReconciliationScope =
  | { kind: 'all' }
  | { kind: 'admin' }
  | { kind: 'user'; userId: number }

export interface StorageSyncSummary {
  ok: boolean
  checked: number
  availableCount: number
  missingCount: number
  newlyMarkedMissing: number
  restoredCount: number
  restoredChangedDocIds: number[]
  inconclusiveCount: number
  lastCheckedAt: string
  error?: string
}

interface CandidateDoc {
  id: number
  userId: number
  docSource: string
  storagePath: string
  fileSize: number
  status: string
  storageStatus: 'AVAILABLE' | 'MISSING'
  contentEtag: string | null
  lastStorageCheckAt: Date | null
}

const inFlightReconciliations = new Map<string, Promise<StorageSyncSummary>>()

function normalizeEtag(etag?: string | null): string | null {
  if (!etag) return null
  const trimmed = etag.trim().replace(/^"+|"+$/g, '').toLowerCase()
  return trimmed || null
}

function scopeKey(scope: ReconciliationScope): string {
  if (scope.kind === 'user') return `user:${scope.userId}`
  return scope.kind
}

function sanitizeSyncError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || 'Storage check failed')
  return raw
    .replace(/postgres(ql)?:\/\/[^\s]+/gi, '<redacted>')
    .replace(/(key|secret|token|password|authorization|x-amz-[a-z-]+)=([^\s&]+)/gi, '$1=<redacted>')
    .slice(0, 240)
}

function resolvePrefixesForScope(scope: ReconciliationScope, docs: CandidateDoc[]): string[] {
  if (scope.kind === 'all') {
    return ['admin-kb-docs/', 'knowledge-docs/']
  }

  if (scope.kind === 'admin') {
    return ['admin-kb-docs/']
  }

  const prefixes = new Set<string>([`knowledge-docs/${scope.userId}/`])
  for (const doc of docs) {
    if (doc.storagePath.startsWith('admin-kb-docs/')) {
      prefixes.add('admin-kb-docs/')
      break
    }
  }
  return Array.from(prefixes)
}

/**
 * Reconcile Neon Document storage state against Backblaze B2 objects.
 * Uses paginated ListObjectsV2 plus definitive HeadObject 404/NoSuchKey confirmation
 * before marking any document MISSING. Never marks MISSING on transient errors.
 */
export async function reconcileStorage(
  scope: ReconciliationScope,
  actor?: { userId?: number; username?: string | null; reason?: string }
): Promise<StorageSyncSummary> {
  const key = scopeKey(scope)
  const existing = inFlightReconciliations.get(key)
  if (existing) {
    return existing
  }

  const runPromise = runReconcileStorage(scope, actor).finally(() => {
    if (inFlightReconciliations.get(key) === runPromise) {
      inFlightReconciliations.delete(key)
    }
  })

  inFlightReconciliations.set(key, runPromise)
  return runPromise
}

async function runReconcileStorage(
  scope: ReconciliationScope,
  actor?: { userId?: number; username?: string | null; reason?: string }
): Promise<StorageSyncSummary> {
  const now = new Date()

  const whereClause =
    scope.kind === 'admin'
      ? { docSource: 'ADMIN_MASTER', storagePath: { not: 'seeded' } }
      : scope.kind === 'user'
        ? { userId: scope.userId, storagePath: { not: 'seeded' } }
        : { storagePath: { not: 'seeded' } }

  const docs = (await prisma.document.findMany({
    where: whereClause,
    select: {
      id: true,
      userId: true,
      docSource: true,
      storagePath: true,
      fileSize: true,
      status: true,
      storageStatus: true,
      contentEtag: true,
      lastStorageCheckAt: true,
    },
  })) as CandidateDoc[]

  if (docs.length === 0) {
    return {
      ok: true,
      checked: 0,
      availableCount: 0,
      missingCount: 0,
      newlyMarkedMissing: 0,
      restoredCount: 0,
      restoredChangedDocIds: [],
      inconclusiveCount: 0,
      lastCheckedAt: now.toISOString(),
    }
  }

  const b2Docs = docs.filter((d) => d.storagePath && !isLegacyLocalStoragePath(d.storagePath))
  const localDocs = docs.filter((d) => d.storagePath && isLegacyLocalStoragePath(d.storagePath))

  let listedMap = new Map<string, ListedB2Object>()
  let b2ListingError: string | undefined

  if (b2Docs.length > 0) {
    if (!isB2Configured()) {
      b2ListingError = 'Backblaze B2 storage is not configured'
    } else {
      try {
        const prefixes = resolvePrefixesForScope(scope, b2Docs)
        listedMap = await listDocumentObjectsByPrefixes(prefixes)
      } catch (err) {
        b2ListingError = sanitizeSyncError(err)
      }
    }
  }

  // If listing B2 failed, do not mark anything MISSING; still allow local check if any, and report error cleanly.
  if (b2Docs.length > 0 && b2ListingError) {
    const availableCount = docs.filter((d) => d.storageStatus === 'AVAILABLE').length
    const missingCount = docs.filter((d) => d.storageStatus === 'MISSING').length
    return {
      ok: false,
      checked: 0,
      availableCount,
      missingCount,
      newlyMarkedMissing: 0,
      restoredCount: 0,
      restoredChangedDocIds: [],
      inconclusiveCount: b2Docs.length,
      lastCheckedAt: now.toISOString(),
      error: `Storage check temporarily unavailable: ${b2ListingError}`,
    }
  }

  // Group docs by storagePath so shared paths (e.g. ADMIN_MASTER + SYNCED_FROM_ADMIN) share one HeadObject call.
  const docsByPath = new Map<string, CandidateDoc[]>()
  for (const doc of docs) {
    const list = docsByPath.get(doc.storagePath)
    if (list) {
      list.push(doc)
    } else {
      docsByPath.set(doc.storagePath, [doc])
    }
  }

  let checked = 0
  let newlyMarkedMissing = 0
  let restoredCount = 0
  const restoredChangedDocIds: number[] = []
  let inconclusiveCount = 0
  const unchangedAvailableDocIds: number[] = []
  const etagBackfillDocs: Array<{ id: number; etag: string }> = []

  async function handlePresentObject(params: {
    storagePath: string
    group: CandidateDoc[]
    headSize?: number
    headEtag?: string | null
    listedEtag?: string | null
    listedSize?: number
    reason: string
  }): Promise<void> {
    const hasMissing = params.group.some((d) => d.storageStatus === 'MISSING')
    if (!hasMissing) {
      for (const doc of params.group) {
        const candidateEtag = params.headEtag ?? params.listedEtag ?? null
        if (!doc.contentEtag && candidateEtag) {
          etagBackfillDocs.push({ id: doc.id, etag: candidateEtag })
        }
        unchangedAvailableDocIds.push(doc.id)
      }
      return
    }

    let authoritativeSize = params.headSize
    let authoritativeEtag = params.headEtag ?? params.listedEtag ?? null
    if (typeof authoritativeSize !== 'number') {
      const head = await headDocumentObject(params.storagePath)
      if (!head.exists) {
        return
      }
      authoritativeSize = typeof head.contentLength === 'number' ? head.contentLength : params.listedSize ?? 0
      authoritativeEtag = head.etag ?? params.listedEtag ?? null
    }

    const headEtagNorm = normalizeEtag(authoritativeEtag)
    const userScopedFilter = scope.kind === 'user' ? { userId: scope.userId } : {}
    const allSharingRows = await prisma.document.findMany({
      where: { storagePath: params.storagePath, ...userScopedFilter },
      select: {
        id: true,
        docSource: true,
        fileSize: true,
        status: true,
        storageStatus: true,
        contentEtag: true,
      },
    })

    for (const row of allSharingRows) {
      if (row.storageStatus !== 'MISSING') {
        unchangedAvailableDocIds.push(row.id)
        continue
      }

      const storedEtag = normalizeEtag(row.contentEtag)
      const etagChanged = Boolean(storedEtag && headEtagNorm && storedEtag !== headEtagNorm)
      const sizeChanged = authoritativeSize !== row.fileSize
      const contentChanged = etagChanged || sizeChanged

      if (contentChanged) {
        await prisma.$transaction([
          prisma.documentChunk.deleteMany({ where: { documentId: row.id } }),
          prisma.document.update({
            where: { id: row.id },
            data: {
              storageStatus: 'AVAILABLE',
              missingAt: null,
              lastStorageCheckAt: now,
              fileSize: authoritativeSize,
              contentEtag: authoritativeEtag,
              status: 'UPLOADED',
            },
          }),
        ])

        restoredCount++
        restoredChangedDocIds.push(row.id)

        await createAuditLog({
          userId: actor?.userId,
          username: actor?.username ?? undefined,
          action: 'DOCUMENT_STORAGE_RESTORED_CHANGED',
          entityType: 'Document',
          entityId: String(row.id),
          status: 'SUCCESS',
          metadata: {
            storagePath: params.storagePath,
            docSource: row.docSource,
            previousSize: row.fileSize,
            newSize: authoritativeSize,
            reason: actor?.reason ?? params.reason,
          },
        })
      } else {
        await prisma.document.update({
          where: { id: row.id },
          data: {
            storageStatus: 'AVAILABLE',
            missingAt: null,
            lastStorageCheckAt: now,
            contentEtag: authoritativeEtag ?? row.contentEtag,
          },
        })

        restoredCount++

        await createAuditLog({
          userId: actor?.userId,
          username: actor?.username ?? undefined,
          action: 'DOCUMENT_STORAGE_RESTORED',
          entityType: 'Document',
          entityId: String(row.id),
          status: 'SUCCESS',
          metadata: {
            storagePath: params.storagePath,
            docSource: row.docSource,
            reason: actor?.reason ?? params.reason,
          },
        })
      }
    }
  }

  for (const [storagePath, group] of docsByPath.entries()) {
    const isLocal = localDocs.some((d) => d.storagePath === storagePath)
    const listed = !isLocal ? listedMap.get(storagePath) : undefined

    if (listed) {
      checked += group.length
      try {
        await handlePresentObject({
          storagePath,
          group,
          listedEtag: listed.etag,
          listedSize: listed.size,
          reason: 'reconciliation',
        })
      } catch {
        inconclusiveCount += group.length
      }
      continue
    }

    // Absent from ListObjectsV2 (or local path): confirm definitively via HeadObject / fs.stat
    let head: Awaited<ReturnType<typeof headDocumentObject>>
    try {
      head = await headDocumentObject(storagePath)
    } catch {
      inconclusiveCount += group.length
      continue
    }

    checked += group.length

    if (!head.exists) {
      // Definitive 404 / NoSuchKey / ENOENT -> mark AVAILABLE rows sharing this storagePath as MISSING
      const userScopedFilter = scope.kind === 'user' ? { userId: scope.userId } : {}
      const affected = await prisma.document.findMany({
        where: { storagePath, storageStatus: 'AVAILABLE', ...userScopedFilter },
        select: { id: true, docSource: true, status: true },
      })

      if (affected.length > 0) {
        const updateRes = await prisma.document.updateMany({
          where: {
            id: { in: affected.map((d) => d.id) },
            storageStatus: 'AVAILABLE',
          },
          data: {
            storageStatus: 'MISSING',
            missingAt: now,
            lastStorageCheckAt: now,
          },
        })

        newlyMarkedMissing += updateRes.count

        if (updateRes.count > 0) {
          for (const row of affected) {
            await createAuditLog({
              userId: actor?.userId,
              username: actor?.username ?? undefined,
              action: 'DOCUMENT_STORAGE_MISSING',
              entityType: 'Document',
              entityId: String(row.id),
              status: 'FAILURE',
              metadata: {
                storagePath,
                docSource: row.docSource,
                previousStatus: row.status,
                reason: actor?.reason ?? 'b2_head_not_found',
              },
            })
          }
        }
      }

      const alreadyMissingIds = group
        .filter((d) => d.storageStatus === 'MISSING')
        .map((d) => d.id)
      if (alreadyMissingIds.length > 0) {
        await prisma.document.updateMany({
          where: { id: { in: alreadyMissingIds }, storageStatus: 'MISSING' },
          data: { lastStorageCheckAt: now },
        })
      }
    } else {
      await handlePresentObject({
        storagePath,
        group,
        headSize: typeof head.contentLength === 'number' ? head.contentLength : 0,
        headEtag: head.etag ?? null,
        reason: 'head_exists',
      })
    }
  }

  // Batch update lastStorageCheckAt for unchanged AVAILABLE docs (single query)
  if (unchangedAvailableDocIds.length > 0) {
    await prisma.document.updateMany({
      where: { id: { in: unchangedAvailableDocIds }, storageStatus: 'AVAILABLE' },
      data: { lastStorageCheckAt: now },
    })
  }

  // One-time contentEtag backfill for older docs without an ETag
  for (const item of etagBackfillDocs) {
    await prisma.document.updateMany({
      where: { id: item.id, contentEtag: null },
      data: { contentEtag: item.etag },
    })
  }

  const finalCounts = await prisma.document.groupBy({
    by: ['storageStatus'],
    where: whereClause,
    _count: { _all: true },
  })

  let availableCount = 0
  let missingCount = 0
  for (const row of finalCounts) {
    if (row.storageStatus === 'AVAILABLE') availableCount = row._count._all
    if (row.storageStatus === 'MISSING') missingCount = row._count._all
  }

  return {
    ok: inconclusiveCount === 0,
    checked,
    availableCount,
    missingCount,
    newlyMarkedMissing,
    restoredCount,
    restoredChangedDocIds,
    inconclusiveCount,
    lastCheckedAt: now.toISOString(),
    error:
      inconclusiveCount > 0
        ? `${inconclusiveCount} document storage check(s) were inconclusive due to transient storage errors.`
        : undefined,
  }
}

/**
 * Confirm via HeadObject whether a storagePath is truly absent in storage,
 * and if confirmed 404/NoSuchKey, mark all Document rows referencing it as MISSING.
 */
export async function confirmAndMarkStorageMissing(params: {
  storagePath: string
  userId?: number
  username?: string | null
  reason?: string
}): Promise<boolean> {
  if (!params.storagePath || params.storagePath === 'seeded') {
    return false
  }

  let head: Awaited<ReturnType<typeof headDocumentObject>>
  try {
    head = await headDocumentObject(params.storagePath)
  } catch {
    return false
  }

  if (head.exists) {
    return false
  }

  const now = new Date()
  const affected = await prisma.document.findMany({
    where: { storagePath: params.storagePath, storageStatus: 'AVAILABLE' },
    select: { id: true, docSource: true, status: true },
  })

  if (affected.length === 0) {
    return true
  }

  const res = await prisma.document.updateMany({
    where: { id: { in: affected.map((d) => d.id) }, storageStatus: 'AVAILABLE' },
    data: {
      storageStatus: 'MISSING',
      missingAt: now,
      lastStorageCheckAt: now,
    },
  })

  if (res.count > 0) {
    for (const row of affected) {
      await createAuditLog({
        userId: params.userId,
        username: params.username ?? undefined,
        action: 'DOCUMENT_STORAGE_MISSING',
        entityType: 'Document',
        entityId: String(row.id),
        status: 'FAILURE',
        metadata: {
          storagePath: params.storagePath,
          docSource: row.docSource,
          previousStatus: row.status,
          reason: params.reason ?? 'object_not_found_on_access',
        },
      })
    }
  }

  return true
}
