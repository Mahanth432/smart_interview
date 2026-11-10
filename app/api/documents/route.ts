import { NextResponse } from 'next/server'
import { getAppSession } from '@/lib/auth'
import prisma from '@/lib/db'
import { handleDocumentUpload, getFailedDocumentErrors } from '@/lib/knowledge-base/documentHandlers'

export const maxDuration = 60

// GET /api/documents — list documents for the logged-in user (private + synced from admin)
export async function GET(request: Request) {
  const t0 = performance.now()
  try {
    const response = NextResponse.json({})
    const session = await getAppSession(request, response)

    if (!session?.isLoggedIn || !session.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (session.role === 'CANDIDATE') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Build base where clause — always filter by userId (ownership)
    const where: { userId: number } = { userId: session.userId }

    const tQuery0 = performance.now()
    const documents = await prisma.document.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { chunks: true } },
      },
    })
    const tQueryEnd = performance.now()

    const failedIds = documents.filter((d) => d.status === 'FAILED').map((d) => d.id)
    const errorMap = await getFailedDocumentErrors(failedIds)

    const safe = documents.map((d) => ({
      id: d.id,
      name: d.name,
      originalFilename: d.originalFilename,
      fileType: d.fileType,
      fileSize: d.fileSize,
      status: d.status,
      docSource: d.docSource,
      adminDocId: d.adminDocId,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      chunkCount: d._count.chunks,
      lastError: errorMap.get(d.id) ?? null,
    }))

    if (process.env.NODE_ENV === 'development') {
      console.log(
        `[DEV TIMING] API GET /api/documents: query=${(tQueryEnd - tQuery0).toFixed(1)}ms, total=${(performance.now() - t0).toFixed(1)}ms`
      )
    }

    return NextResponse.json({ documents: safe })
  } catch (err) {
    console.error('Fetch documents error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/documents — upload and process a document (always INTERVIEWER_PRIVATE)
export async function POST(request: Request) {
  try {
    const response = NextResponse.json({})
    const session = await getAppSession(request, response)

    if (!session?.isLoggedIn || !session.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (session.role === 'CANDIDATE') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    return await handleDocumentUpload({
      request,
      userId: session.userId,
      username: session.username,
      docSource: 'INTERVIEWER_PRIVATE',
      storageScope: 'knowledge-docs',
      auditAction: 'KNOWLEDGE_DOCUMENT_UPLOADED',
    })
  } catch (err) {
    console.error('Upload error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
