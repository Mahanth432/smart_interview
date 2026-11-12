import { NextResponse, NextRequest } from 'next/server'
import { getValidatedAppSession } from '@/lib/auth-server'
import { verifySameOrigin } from '@/lib/csrf'
import { enforceRateLimit } from '@/lib/rate-limit'
import prisma from '@/lib/db'
import { buildDocumentDownloadResponse } from '@/lib/knowledge-base/documentHandlers'
import { deleteDocumentObject } from '@/lib/storage/b2'

// GET /api/admin/knowledge-base/[id] — securely stream Admin Master KB file from B2
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const response = NextResponse.json({})
    const session = await getValidatedAppSession(request, response)

    if (!session?.isLoggedIn || !session.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden — Admin only' }, { status: 403 })
    }

    const { id: idStr } = await context.params
    const id = parseInt(idStr, 10)
    if (Number.isNaN(id)) {
      return NextResponse.json({ error: 'Invalid document ID' }, { status: 400 })
    }

    const doc = await prisma.document.findUnique({ where: { id } })
    if (!doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }
    if (doc.docSource !== 'ADMIN_MASTER') {
      return NextResponse.json({ error: 'Not an admin master document' }, { status: 400 })
    }

    return await buildDocumentDownloadResponse(doc, {
      userId: session.userId,
      username: session.username,
    })
  } catch (err) {
    console.error('Admin KB download error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/admin/knowledge-base/[id]
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const csrfError = verifySameOrigin(request)
    if (csrfError) return csrfError
    const response = NextResponse.json({})
    const session = await getValidatedAppSession(request, response)

    if (!session?.isLoggedIn || !session.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden — Admin only' }, { status: 403 })
    }

    const rlError = await enforceRateLimit(
      {
        key: `admin:kb-item:user:${session.userId}`,
        limit: 40,
        windowSeconds: 15 * 60,
      },
      'Too many knowledge base delete requests. Please wait before trying again.'
    )
    if (rlError) return rlError

    const { id: idStr } = await context.params
    const id = parseInt(idStr, 10)
    if (Number.isNaN(id)) {
      return NextResponse.json({ error: 'Invalid document ID' }, { status: 400 })
    }

    const doc = await prisma.document.findUnique({ where: { id } })
    if (!doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }
    if (doc.docSource !== 'ADMIN_MASTER') {
      return NextResponse.json({ error: 'Not an admin master document' }, { status: 400 })
    }

    // Delete all synced interviewer copies + admin master document atomically,
    // then delete B2 object only if no other Document references the key
    const deletedSynced = await prisma.$transaction(async (tx) => {
      const syncedResult = await tx.document.deleteMany({
        where: { docSource: 'SYNCED_FROM_ADMIN', adminDocId: id },
      })
      await tx.document.delete({ where: { id } })
      return syncedResult.count
    })

    if (doc.storagePath) {
      const remainingRefs = await prisma.document.count({ where: { storagePath: doc.storagePath } })
      if (remainingRefs === 0) {
        await deleteDocumentObject(doc.storagePath)
      }
    }

    const { createAuditLog } = await import('@/lib/audit-log')
    createAuditLog({
      userId: session.userId,
      username: session.username,
      action: 'ADMIN_KB_DOCUMENT_DELETED',
      entityType: 'Document',
      entityId: id.toString(),
      metadata: { name: doc.name, deletedSyncedCopies: deletedSynced },
    })

    return NextResponse.json({ success: true, deletedSyncedCopies: deletedSynced })
  } catch (err) {
    console.error('Admin KB delete error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
