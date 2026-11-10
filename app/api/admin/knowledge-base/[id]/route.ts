import { NextResponse, NextRequest } from 'next/server'
import { getAppSession } from '@/lib/auth'
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
    const session = await getAppSession(request, response)

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

    return await buildDocumentDownloadResponse(doc)
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
    const response = NextResponse.json({})
    const session = await getAppSession(request, response)

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

    // Delete admin document first, then delete B2 object only if no other Document references the key
    await prisma.document.delete({ where: { id } })

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
      metadata: { name: doc.name }
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Admin KB delete error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
