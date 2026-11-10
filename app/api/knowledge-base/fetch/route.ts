import { NextResponse } from 'next/server'
import { getAppSession } from '@/lib/auth'
import prisma from '@/lib/db'

/**
 * GET /api/knowledge-base/fetch
 * Check status of Admin Master KB vs interviewer's synced KB.
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

    // Get all available admin master docs
    const adminDocs = await prisma.document.findMany({
      where: { docSource: 'ADMIN_MASTER', storageStatus: 'AVAILABLE' },
      orderBy: { createdAt: 'desc' },
    })

    // Get this interviewer's available synced copies
    const syncedDocs = await prisma.document.findMany({
      where: {
        userId: session.userId,
        docSource: 'SYNCED_FROM_ADMIN',
        storageStatus: 'AVAILABLE',
      },
    })

    const syncedByAdminId = new Map(syncedDocs.map((d) => [d.adminDocId, d]))

    // Get the latest admin KB updated time
    const latestAdminUpdate = adminDocs.length > 0
      ? adminDocs.reduce((latest, d) => (d.updatedAt > latest ? d.updatedAt : latest), adminDocs[0].updatedAt)
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
 * Syncs Admin Master KB documents into the calling interviewer's personal KB.
 * - Copies admin master docs that the interviewer doesn't have yet.
 * - Copies document chunks & embeddings so vector search & UI chunk counts work immediately.
 * - If an admin doc was updated, refreshes the synced copy and its chunks.
 * - NEVER deletes the interviewer's private documents.
 * - Safe to call repeatedly (idempotent using adminDocId).
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

    // Get all available admin master docs
    const adminDocs = await prisma.document.findMany({
      where: { docSource: 'ADMIN_MASTER', storageStatus: 'AVAILABLE' },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { chunks: true } } },
    })

    if (adminDocs.length === 0) {
      return NextResponse.json({ success: true, added: 0, updated: 0, totalAdminDocs: 0, message: 'Admin Knowledge Base is currently empty.' })
    }

    // Get this interviewer's existing synced copies
    const syncedDocs = await prisma.document.findMany({
      where: {
        userId: session.userId,
        docSource: 'SYNCED_FROM_ADMIN',
      },
      include: { _count: { select: { chunks: true } } },
    })

    const syncedByAdminId = new Map(syncedDocs.map((d) => [d.adminDocId, d]))

    let added = 0
    let updated = 0

    for (const adminDoc of adminDocs) {
      const existingSynced = syncedByAdminId.get(adminDoc.id)

      if (!existingSynced) {
        // New admin doc — create a synced reference for this interviewer
        const newSynced = await prisma.document.create({
          data: {
            name: adminDoc.name,
            originalFilename: adminDoc.originalFilename,
            fileType: adminDoc.fileType,
            fileSize: adminDoc.fileSize,
            storagePath: adminDoc.storagePath, // Share the same file storage path
            contentEtag: adminDoc.contentEtag,
            storageStatus: adminDoc.storageStatus,
            lastStorageCheckAt: adminDoc.lastStorageCheckAt,
            status: adminDoc.status,
            userId: session.userId,
            docSource: 'SYNCED_FROM_ADMIN',
            adminDocId: adminDoc.id,
          },
        })

        // Copy chunks & embeddings from adminDoc to newSynced
        if (adminDoc._count.chunks > 0) {
          await prisma.$executeRawUnsafe(`
            INSERT INTO "DocumentChunk" ("documentId", "content", "chunkIndex", "createdAt", "embedding", "pageNumber", "sourceType", "topic", "unit")
            SELECT $1, "content", "chunkIndex", NOW(), "embedding", "pageNumber", "sourceType", "topic", "unit"
            FROM "DocumentChunk"
            WHERE "documentId" = $2
          `, newSynced.id, adminDoc.id)
        }

        added++
      } else {
        // Check if admin doc was updated or if chunk count is mismatched
        const needsUpdate =
          adminDoc.updatedAt > existingSynced.updatedAt ||
          adminDoc.status !== existingSynced.status ||
          existingSynced._count.chunks !== adminDoc._count.chunks

        if (needsUpdate) {
          await prisma.document.update({
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
            },
          })

          // Refresh chunks: delete old synced chunks and re-copy from adminDoc
          await prisma.documentChunk.deleteMany({
            where: { documentId: existingSynced.id }
          })

          if (adminDoc._count.chunks > 0) {
            await prisma.$executeRawUnsafe(`
              INSERT INTO "DocumentChunk" ("documentId", "content", "chunkIndex", "createdAt", "embedding", "pageNumber", "sourceType", "topic", "unit")
              SELECT $1, "content", "chunkIndex", NOW(), "embedding", "pageNumber", "sourceType", "topic", "unit"
              FROM "DocumentChunk"
              WHERE "documentId" = $2
            `, existingSynced.id, adminDoc.id)
          }

          updated++
        }
      }
    }

    // Build descriptive message
    let message = ''
    if (added === 0 && updated === 0) {
      message = 'Knowledge Base is already up to date.'
    } else {
      const parts = []
      if (added > 0) parts.push(`${added} new document${added !== 1 ? 's' : ''} added`)
      if (updated > 0) parts.push(`${updated} document${updated !== 1 ? 's' : ''} updated`)
      message = `Knowledge Base fetched successfully. ${parts.join(', ')}.`
    }

    const { createAuditLog } = await import('@/lib/audit-log')
    createAuditLog({
      userId: session.userId,
      username: session.username,
      action: 'KB_FETCH_FROM_ADMIN',
      entityType: 'Document',
      metadata: { added, updated, totalAdminDocs: adminDocs.length }
    })

    return NextResponse.json({
      success: true,
      added,
      updated,
      totalAdminDocs: adminDocs.length,
      message,
    })
  } catch (err) {
    console.error('KB fetch error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
