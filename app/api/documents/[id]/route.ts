import { NextResponse, NextRequest } from 'next/server'

import { getAppSession } from '@/lib/auth'
import prisma from '@/lib/db'
import { buildDocumentDownloadResponse } from '@/lib/knowledge-base/documentHandlers'
import { deleteDocumentObject } from '@/lib/storage/b2'

// GET /api/documents/[id] — securely stream document bytes from B2 after ownership validation
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
    if (session.role === 'CANDIDATE') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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

    if (doc.userId !== session.userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    return await buildDocumentDownloadResponse(doc)
  } catch (err) {
    console.error('Download document error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/documents/[id]
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
    if (session.role === 'CANDIDATE') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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

    // Server-side ownership: user can only delete their own documents
    if (doc.userId !== session.userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Interviewers cannot delete admin master documents via this endpoint
    if (doc.docSource === 'ADMIN_MASTER') {
      return NextResponse.json({ error: 'Forbidden — Admin master documents cannot be deleted here' }, { status: 403 })
    }

    // For SYNCED_FROM_ADMIN docs, only delete the local reference (not the underlying file)
    const isSharedFile = doc.docSource === 'SYNCED_FROM_ADMIN'

    if (!isSharedFile && doc.storagePath) {
      // Delete object from B2 (or legacy local storage) before deleting DB record
      await deleteDocumentObject(doc.storagePath)
    }

    // Cascade deletes DocumentChunk rows automatically (onDelete: Cascade)
    await prisma.document.delete({ where: { id } })

    const { createAuditLog } = await import('@/lib/audit-log')
    createAuditLog({
      userId: session.userId,
      username: session.username,
      action: 'KNOWLEDGE_DOCUMENT_DELETED',
      entityType: 'Document',
      entityId: id.toString(),
      metadata: { name: doc.name, docSource: doc.docSource }
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Delete document error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
