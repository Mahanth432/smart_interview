import { NextResponse } from 'next/server'
import { getAppSession } from '@/lib/auth'
import prisma from '@/lib/db'
import { handleDocumentUpload, getFailedDocumentErrors } from '@/lib/knowledge-base/documentHandlers'

export const maxDuration = 60

// GET /api/admin/knowledge-base — list ALL admin master documents
export async function GET(request: Request) {
  try {
    const response = NextResponse.json({})
    const session = await getAppSession(request, response)

    if (!session?.isLoggedIn || !session.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden — Admin only' }, { status: 403 })
    }

    const documents = await prisma.document.findMany({
      where: { docSource: 'ADMIN_MASTER' },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { chunks: true } },
      },
    })

    const failedIds = documents.filter((d) => d.status === 'FAILED').map((d) => d.id)
    const errorMap = await getFailedDocumentErrors(failedIds)

    const safe = documents.map((d) => ({
      id: d.id,
      name: d.name,
      originalFilename: d.originalFilename,
      fileType: d.fileType,
      fileSize: d.fileSize,
      status: d.status,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      docSource: d.docSource,
      chunkCount: d._count.chunks,
      lastError: errorMap.get(d.id) ?? null,
    }))

    return NextResponse.json({ documents: safe })
  } catch (err) {
    console.error('Admin KB fetch error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/admin/knowledge-base — upload document as ADMIN_MASTER
export async function POST(request: Request) {
  try {
    const response = NextResponse.json({})
    const session = await getAppSession(request, response)

    if (!session?.isLoggedIn || !session.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden — Admin only' }, { status: 403 })
    }

    return await handleDocumentUpload({
      request,
      userId: session.userId,
      username: session.username,
      docSource: 'ADMIN_MASTER',
      storageScope: 'admin-kb-docs',
      auditAction: 'ADMIN_KB_DOCUMENT_UPLOADED',
    })
  } catch (err) {
    console.error('Admin KB upload error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
