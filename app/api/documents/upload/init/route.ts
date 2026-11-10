import { NextResponse } from 'next/server'
import { getAppSession } from '@/lib/auth'
import { initDirectDocumentUpload } from '@/lib/knowledge-base/documentHandlers'

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

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    if ('storagePath' in body || 'key' in body || 'prefix' in body || 'bucket' in body) {
      return NextResponse.json(
        { error: 'Client-supplied storage paths or prefixes are not permitted' },
        { status: 400 }
      )
    }

    const filename = typeof body.filename === 'string' ? body.filename : ''
    const contentType = typeof body.contentType === 'string' ? body.contentType : ''
    const fileSize = typeof body.fileSize === 'number' ? body.fileSize : Number(body.fileSize)
    const title = typeof body.title === 'string' ? body.title : ''
    const docSource = typeof body.docSource === 'string' ? body.docSource : 'INTERVIEWER_PRIVATE'

    if (!filename.trim()) {
      return NextResponse.json({ error: 'filename is required' }, { status: 400 })
    }

    return await initDirectDocumentUpload({
      userId: session.userId,
      username: session.username,
      role: session.role || 'INTERVIEWER',
      filename,
      contentType,
      fileSize,
      title,
      docSource,
    })
  } catch (err) {
    console.error('Upload init error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
