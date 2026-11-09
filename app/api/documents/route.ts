import { NextResponse } from 'next/server'
import { getAppSession } from '@/lib/auth'
import prisma from '@/lib/db'

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
    }))

    if (process.env.NODE_ENV === 'development') {
      console.log(`[DEV TIMING] API GET /api/documents: query=${(tQueryEnd - tQuery0).toFixed(1)}ms, total=${(performance.now() - t0).toFixed(1)}ms`)
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

    const form = await request.formData()
    const file = form.get('file') as File | null
    const title = (form.get('title') as string) || ''

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }

    const size = file.size
    if (!size || size <= 0) {
      return NextResponse.json({ error: 'Empty file' }, { status: 400 })
    }
    if (size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 400 })
    }

    const ALLOWED_MIME = [
      'application/pdf',
      'text/plain',
      'text/markdown',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]
    const mime = file.type || 'application/octet-stream'
    if (!ALLOWED_MIME.includes(mime)) {
      return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 })
    }

    // Save file to storage
    const { promises: fs } = await import('fs')
    const path = await import('path')
    const storageDir = path.join(process.cwd(), 'storage', 'knowledge-docs')
    await fs.mkdir(storageDir, { recursive: true })

    const originalFilename = file.name ?? `upload-${Date.now()}`
    const ext = path.extname(originalFilename).toLowerCase()
    const safePrefix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const filename = `${safePrefix}${ext}`
    const storagePath = path.join(storageDir, filename)
    const buffer = Buffer.from(await file.arrayBuffer())
    await fs.writeFile(storagePath, buffer)

    // Create DB record — always INTERVIEWER_PRIVATE for this endpoint
    const doc = await prisma.document.create({
      data: {
        name: title || originalFilename,
        originalFilename,
        fileType: ext.replace('.', '').toUpperCase() || mime,
        fileSize: size,
        storagePath,
        status: 'UPLOADED',
        userId: session.userId,
        docSource: 'INTERVIEWER_PRIVATE',
      },
    })

    const { createAuditLog } = await import('@/lib/audit-log')
    createAuditLog({
      userId: session.userId,
      username: session.username,
      action: 'KNOWLEDGE_DOCUMENT_UPLOADED',
      entityType: 'Document',
      entityId: doc.id.toString(),
      metadata: { name: doc.name, fileSize: doc.fileSize, fileType: doc.fileType }
    })

    // Kick off background processing (extract text → chunks)
    import('@/lib/knowledge-base/processDocument')
      .then(({ processDocument }) => processDocument(doc.id))
      .catch((e) => console.error('Background processing error:', e))

    return NextResponse.json({ success: true, document: { id: doc.id, status: 'UPLOADED' } }, { status: 202 })
  } catch (err) {
    console.error('Upload error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
