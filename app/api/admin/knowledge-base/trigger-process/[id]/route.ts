import { NextResponse, NextRequest } from 'next/server'
import { getAppSession } from '@/lib/auth'
import prisma from '@/lib/db'
import { scheduleDocumentProcessing } from '@/lib/knowledge-base/documentHandlers'

// POST /api/admin/knowledge-base/trigger-process/[id]
export async function POST(
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

    // Reset status to allow reprocessing
    await prisma.document.update({ where: { id }, data: { status: 'UPLOADED' } })

    // Kick off background processing
    scheduleDocumentProcessing(id)

    return NextResponse.json({ success: true, message: 'Processing started' })
  } catch (err) {
    console.error('Admin KB trigger-process error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
