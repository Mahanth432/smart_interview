import { NextResponse } from 'next/server'
import { getAppSession } from '@/lib/auth'
import prisma from '@/lib/db'

/**
 * GET /api/knowledge-base/fetch
 * Check status of PROCESSED Admin Master KB vs interviewer's synced KB.
 */
export async function GET(request: Request) {
  try {
    const response = NextResponse.json({})
    const session = await getAppSession(request, response)

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
    const response = NextResponse.json({})
    const session = await getAppSession(request, response)

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
      include: { _count: { select: { chunks: true } } },
    })

    const syncedDocs = await prisma.document.findMany({
      where: {
        userId: session.userId,
        docSource: 'SYNCED_FROM_ADMIN',
      },
      include: { _count: { select: { chunks: true } } },
    })

    const activeAdminIds = new Set(adminDocs.map((d) => d.id))
    const staleSyncedIds = syncedDocs
      .filter((s) => !s.adminDocId || !activeAdminIds.has(s.adminDocId))
      .map((s) => s.id)

    let removed = 0
    if (staleSyncedIds.length > 0) {
      const del = await prisma.document.deleteMany({
        where: {
          id: { in: staleSyncedIds },
          userId: session.userId,
          docSource: 'SYNCED_FROM_ADMIN',
        },
      })
      removed = del.count
    }

    const syncedByAdminId = new Map(
      syncedDocs.filter((s) => s.adminDocId && activeAdminIds.has(s.adminDocId)).map((d) => [d.adminDocId, d])
    )

    let added = 0
    let updated = 0

    for (const adminDoc of adminDocs) {
      const existingSynced = syncedByAdminId.get(adminDoc.id)

      if (!existingSynced) {
        await prisma.$transaction(async (tx) => {
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
        added++
      } else {
        const needsUpdate =
          adminDoc.updatedAt > existingSynced.updatedAt ||
          adminDoc.status !== existingSynced.status ||
          adminDoc.storageStatus !== existingSynced.storageStatus ||
          existingSynced._count.chunks !== adminDoc._count.chunks

        if (needsUpdate) {
          await prisma.$transaction(async (tx) => {
            await tx.document.update({
              where: { id: existingSynced.id },
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
              where: { documentId: existingSynced.id },
            })

            if (adminDoc._count.chunks > 0) {
              await tx.$executeRaw`
                INSERT INTO "DocumentChunk" ("documentId", "content", "chunkIndex", "createdAt", "embedding", "pageNumber", "sourceType", "topic", "unit")
                SELECT ${existingSynced.id}::int, "content", "chunkIndex", NOW(), "embedding", "pageNumber", "sourceType", "topic", "unit"
                FROM "DocumentChunk"
                WHERE "documentId" = ${adminDoc.id}::int
              `
            }
          })
          updated++
        }
      }
    }

    let message = ''
    if (added === 0 && updated === 0 && removed === 0) {
      message =
        adminDocs.length === 0
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
      metadata: { added, updated, removed, totalAdminDocs: adminDocs.length },
    })

    return NextResponse.json({
      success: true,
      added,
      updated,
      removed,
      totalAdminDocs: adminDocs.length,
      message,
    })
  } catch (err) {
    console.error('KB fetch error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
