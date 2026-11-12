import { NextResponse, NextRequest } from 'next/server'

import { getValidatedAppSession } from '@/lib/auth-server'
import { verifySameOrigin } from '@/lib/csrf'
import { enforceRateLimit } from '@/lib/rate-limit'
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
    const session = await getValidatedAppSession(request, response)

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

    return await buildDocumentDownloadResponse(doc, {
      userId: session.userId,
      username: session.username,
    })
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
    const csrfError = verifySameOrigin(request)
    if (csrfError) return csrfError
    const response = NextResponse.json({})
    const session = await getValidatedAppSession(request, response)

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

    // Cascade deletes DocumentChunk rows automatically (onDelete: Cascade)
    const rlError = await enforceRateLimit(
      {
        key: `documents:item:user:${session.userId}`,
        limit: 40,
        windowSeconds: 15 * 60,
      },
      'Too many document delete requests. Please wait before trying again.'
    )
    if (rlError) return rlError

    await prisma.document.delete({ where: { id } })

    // Only delete underlying B2 object for private docs when no other Document rows reference the same key
    const isSharedFile = doc.docSource === 'SYNCED_FROM_ADMIN'
    if (!isSharedFile && doc.storagePath) {
      const remainingRefs = await prisma.document.count({ where: { storagePath: doc.storagePath } })
      if (remainingRefs === 0) {
        await deleteDocumentObject(doc.storagePath)
      }
    }

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
