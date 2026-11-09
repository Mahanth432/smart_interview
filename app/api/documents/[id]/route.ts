import { NextResponse, NextRequest } from 'next/server'

import { getAppSession } from '@/lib/auth'
import prisma from '@/lib/db'

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

    if (!isSharedFile) {
      // Delete file from disk (best-effort) only for private docs
      try {
        const { promises: fs } = await import('fs')
        if (doc.storagePath) await fs.unlink(doc.storagePath)
      } catch (e: unknown) {
        const err = e as NodeJS.ErrnoException
        if (err?.code !== 'ENOENT') console.error('File delete error:', e)
      }
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
