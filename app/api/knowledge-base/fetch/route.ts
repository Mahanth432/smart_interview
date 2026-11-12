import { NextResponse } from 'next/server'
import { getValidatedAppSession } from '@/lib/auth-server'
import { verifySameOrigin } from '@/lib/csrf'
import prisma, { withDbRetry } from '@/lib/db'
import { enforceRateLimit } from '@/lib/rate-limit'

export const maxDuration = 60

/**
 * GET /api/knowledge-base/fetch
 * Check status of PROCESSED Admin Master KB vs interviewer's synced KB.
 */
export async function GET(request: Request) {
  try {
    const response = NextResponse.json({})
    const session = await getValidatedAppSession(request, response)

    if (!session?.isLoggedIn || !session.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (session.role !== 'INTERVIEWER' && session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden — Interviewer only' }, { status: 403 })
    }

    const adminDocs = await prisma.document.findMany({
      where: {
        docSource: 'ADMIN_MASTER',
        storageStatus: 'AVAILABLE',
        status: 'PROCESSED',
      },
      orderBy: { createdAt: 'desc' },
    })

    const syncedDocs = await prisma.document.findMany({
      where: {
        userId: session.userId,
        docSource: 'SYNCED_FROM_ADMIN',
        storageStatus: 'AVAILABLE',
      },
    })

    const syncedByAdminId = new Map(syncedDocs.map((d) => [d.adminDocId, d]))

    const latestAdminUpdate =
      adminDocs.length > 0
        ? adminDocs.reduce(
            (latest, d) => (d.updatedAt > latest ? d.updatedAt : latest),
            adminDocs[0].updatedAt
          )
        : null

    return NextResponse.json({
      adminDocCount: adminDocs.length,
      syncedDocCount: syncedDocs.length,
      latestAdminUpdate,
      syncedByAdminIds: [...syncedByAdminId.keys()],
    })
  } catch (err) {
    console.error('KB fetch status error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/knowledge-base/fetch
 *
 * Syncs PROCESSED & AVAILABLE Admin Master KB documents into the calling interviewer's personal KB:
 * - Adds new PROCESSED master documents and copies their chunks/embeddings/metadata.
 * - Refreshes updated master documents.
 * - Reconciles & removes stale SYNCED_FROM_ADMIN copies whose master document was deleted or marked MISSING.
 * - NEVER deletes interviewer private documents.
 */
export async function POST(request: Request) {
  try {
    const csrfError = verifySameOrigin(request)
    if (csrfError) return csrfError
    const response = NextResponse.json({})
    const session = await getValidatedAppSession(request, response)

    if (!session?.isLoggedIn || !session.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (session.role !== 'INTERVIEWER' && session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden — Interviewer only' }, { status: 403 })
    }

    const rlError = await enforceRateLimit(
      {
        key: `kb:fetch:user:${session.userId}`,
        limit: 10,
        windowSeconds: 15 * 60,
      },
      'Too many Knowledge Base synchronization requests. Please wait before trying again.'
    )
    if (rlError) return rlError

    const PAGE_SIZE = 200
    const BATCH_SIZE = 5

    // Step 1: Collect authoritative IDs of ALL eligible ADMIN_MASTER documents (lightweight IDs only)
    const allActiveAdminIds = await withDbRetry(() =>
      prisma.document.findMany({
        where: {
          docSource: 'ADMIN_MASTER',
          storageStatus: 'AVAILABLE',
          status: 'PROCESSED',
        },
        orderBy: { id: 'asc' },
        select: { id: true },
      })
    )
    const activeAdminIds = new Set(allActiveAdminIds.map((d) => d.id))

    // Step 2: Cursor-paginate existing SYNCED_FROM_ADMIN copies to detect stale copies & build lightweight metadata map
    const syncedByAdminId = new Map<
      number,
      { id: number; updatedAt: Date; status: string; storageStatus: string; chunkCount: number }
    >()
    const staleSyncedIds: number[] = []
    let lastSyncedId = 0

    while (true) {
      const syncedPage = await withDbRetry(() =>
        prisma.document.findMany({
          where: {
            userId: session.userId,
            docSource: 'SYNCED_FROM_ADMIN',
            ...(lastSyncedId > 0 ? { id: { gt: lastSyncedId } } : {}),
          },
          orderBy: { id: 'asc' },
          take: PAGE_SIZE,
          select: {
            id: true,
            adminDocId: true,
            updatedAt: true,
            status: true,
            storageStatus: true,
            _count: { select: { chunks: true } },
          },
        })
      )
      if (syncedPage.length === 0) break

      for (const s of syncedPage) {
        if (!s.adminDocId || !activeAdminIds.has(s.adminDocId)) {
          staleSyncedIds.push(s.id)
        } else {
          syncedByAdminId.set(s.adminDocId, {
            id: s.id,
            updatedAt: s.updatedAt,
            status: s.status,
            storageStatus: s.storageStatus,
            chunkCount: s._count.chunks,
          })
        }
      }

      lastSyncedId = syncedPage[syncedPage.length - 1].id
      if (syncedPage.length < PAGE_SIZE) break
    }

    let removed = 0
    for (let i = 0; i < staleSyncedIds.length; i += PAGE_SIZE) {
      const idSlice = staleSyncedIds.slice(i, i + PAGE_SIZE)
      const del = await withDbRetry(() =>
        prisma.document.deleteMany({
          where: {
            id: { in: idSlice },
            userId: session.userId,
            docSource: 'SYNCED_FROM_ADMIN',
          },
        })
      )
      removed += del.count
    }

    // Step 3: Stable keyset cursor pagination (id > lastAdminId) over ALL eligible ADMIN_MASTER docs
    let added = 0
    let updated = 0
    let lastAdminId = 0

    while (true) {
      const adminPage = await withDbRetry(() =>
        prisma.document.findMany({
          where: {
            docSource: 'ADMIN_MASTER',
            storageStatus: 'AVAILABLE',
            status: 'PROCESSED',
            ...(lastAdminId > 0 ? { id: { gt: lastAdminId } } : {}),
          },
          orderBy: { id: 'asc' },
          take: PAGE_SIZE,
          select: {
            id: true,
            name: true,
            originalFilename: true,
            fileType: true,
            fileSize: true,
            storagePath: true,
            contentEtag: true,
            storageStatus: true,
            lastStorageCheckAt: true,
            status: true,
            subject: true,
            updatedAt: true,
            _count: { select: { chunks: true } },
          },
        })
      )
      if (adminPage.length === 0) break

      const toAdd: typeof adminPage = []
      const toUpdate: Array<{ adminDoc: (typeof adminPage)[number]; existingId: number }> = []

      for (const adminDoc of adminPage) {
        const existingSynced = syncedByAdminId.get(adminDoc.id)
        if (!existingSynced) {
          toAdd.push(adminDoc)
        } else {
          const needsUpdate =
            adminDoc.updatedAt > existingSynced.updatedAt ||
            adminDoc.status !== existingSynced.status ||
            adminDoc.storageStatus !== existingSynced.storageStatus ||
            existingSynced.chunkCount !== adminDoc._count.chunks
          if (needsUpdate) {
            toUpdate.push({ adminDoc, existingId: existingSynced.id })
          }
        }
      }

      for (let i = 0; i < toAdd.length; i += BATCH_SIZE) {
        const batch = toAdd.slice(i, i + BATCH_SIZE)
        await Promise.all(
          batch.map((adminDoc) =>
            withDbRetry(() =>
              prisma.$transaction(async (tx) => {
                const newSynced = await tx.document.create({
                  data: {
                    name: adminDoc.name,
                    originalFilename: adminDoc.originalFilename,
                    fileType: adminDoc.fileType,
                    fileSize: adminDoc.fileSize,
                    storagePath: adminDoc.storagePath,
                    contentEtag: adminDoc.contentEtag,
                    storageStatus: adminDoc.storageStatus,
                    lastStorageCheckAt: adminDoc.lastStorageCheckAt,
                    status: adminDoc.status,
                    subject: adminDoc.subject,
                    userId: session.userId!,
                    docSource: 'SYNCED_FROM_ADMIN',
                    adminDocId: adminDoc.id,
                  },
                })

                if (adminDoc._count.chunks > 0) {
                  await tx.$executeRaw`
                    INSERT INTO "DocumentChunk" ("documentId", "content", "chunkIndex", "createdAt", "embedding", "pageNumber", "sourceType", "topic", "unit")
                    SELECT ${newSynced.id}::int, "content", "chunkIndex", NOW(), "embedding", "pageNumber", "sourceType", "topic", "unit"
                    FROM "DocumentChunk"
                    WHERE "documentId" = ${adminDoc.id}::int
                  `
                }
              })
            )
          )
        )
        added += batch.length
      }

      for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
        const batch = toUpdate.slice(i, i + BATCH_SIZE)
        await Promise.all(
          batch.map(({ adminDoc, existingId }) =>
            withDbRetry(() =>
              prisma.$transaction(async (tx) => {
                await tx.document.update({
                  where: { id: existingId },
                  data: {
                    name: adminDoc.name,
                    originalFilename: adminDoc.originalFilename,
                    fileType: adminDoc.fileType,
                    fileSize: adminDoc.fileSize,
                    storagePath: adminDoc.storagePath,
                    contentEtag: adminDoc.contentEtag,
                    storageStatus: adminDoc.storageStatus,
                    lastStorageCheckAt: adminDoc.lastStorageCheckAt,
                    status: adminDoc.status,
                    subject: adminDoc.subject,
                  },
                })

                await tx.documentChunk.deleteMany({
                  where: { documentId: existingId },
                })

                if (adminDoc._count.chunks > 0) {
                  await tx.$executeRaw`
                    INSERT INTO "DocumentChunk" ("documentId", "content", "chunkIndex", "createdAt", "embedding", "pageNumber", "sourceType", "topic", "unit")
                    SELECT ${existingId}::int, "content", "chunkIndex", NOW(), "embedding", "pageNumber", "sourceType", "topic", "unit"
                    FROM "DocumentChunk"
                    WHERE "documentId" = ${adminDoc.id}::int
                  `
                }
              })
            )
          )
        )
        updated += batch.length
      }

      lastAdminId = adminPage[adminPage.length - 1].id
      if (adminPage.length < PAGE_SIZE) break
    }

    const totalAdminDocs = allActiveAdminIds.length
    let message = ''
    if (added === 0 && updated === 0 && removed === 0) {
      message =
        totalAdminDocs === 0
          ? 'Admin Knowledge Base has no processed documents to sync.'
          : 'Knowledge Base is already up to date.'
    } else {
      const parts: string[] = []
      if (added > 0) parts.push(`${added} new document${added !== 1 ? 's' : ''} added`)
      if (updated > 0) parts.push(`${updated} document${updated !== 1 ? 's' : ''} updated`)
      if (removed > 0) parts.push(`${removed} deleted/unavailable copy${removed !== 1 ? 's' : ''} removed`)
      message = `Knowledge Base synchronized. ${parts.join(', ')}.`
    }

    const { createAuditLog } = await import('@/lib/audit-log')
    createAuditLog({
      userId: session.userId,
      username: session.username,
      action: 'KB_FETCH_FROM_ADMIN',
      entityType: 'Document',
      metadata: { added, updated, removed, totalAdminDocs },
    })

    return NextResponse.json({
      success: true,
      added,
      updated,
      removed,
      totalAdminDocs,
      message,
    })
  } catch (err) {
    console.error('KB fetch error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
