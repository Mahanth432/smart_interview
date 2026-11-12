import { NextResponse } from 'next/server'
import { getAppSession } from '@/lib/auth'
import prisma from '@/lib/db'

const ALLOWED_KEYS = [
  'app.name',
  'interview.default_difficulty',
  'interview.default_type',
  'rag.enabled',
  'rag.top_k',
  'rag.chunk_size',
  'rag.chunk_overlap',
  'rag.min_similarity',
  'auth.session_timeout_hours',
  'llm.default_provider',
  'llm.primary_provider',
  'llm.gemini_enabled',
  'llm.groq_enabled',
]

// GET /api/admin/settings — return all settings (admin only)
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

    const settings = await prisma.appSettings.findMany({
      where: { key: { in: ALLOWED_KEYS } },
      orderBy: { key: 'asc' },
    })

    const map: Record<string, string> = {}
    for (const s of settings) {
      map[s.key] = s.value
    }

    // System info (no secrets exposed)
    const systemInfo = {
      nodeVersion: process.version,
      platform: process.platform,
      env: process.env.NODE_ENV || 'development',
      geminiConfigured: !!process.env.GEMINI_API_KEY,
      groqConfigured: !!process.env.GROQ_API_KEY,
      databaseConfigured: !!process.env.DATABASE_URL,
    }

    return NextResponse.json({ settings: map, systemInfo })
  } catch (err) {
    console.error('Admin settings GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/admin/settings — update settings (admin only)
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

    const body = await request.json()
    const updates = body.settings as Record<string, string>

    if (!updates || typeof updates !== 'object') {
      return NextResponse.json({ error: 'Invalid settings payload' }, { status: 400 })
    }

    const upserts = []
    for (const [key, value] of Object.entries(updates)) {
      if (!ALLOWED_KEYS.includes(key)) {
        continue // Silently skip disallowed keys
      }
      if (typeof value !== 'string') continue

      upserts.push(
        prisma.appSettings.upsert({
          where: { key },
          update: { value },
          create: { key, value },
        })
      )
    }

    await Promise.all(upserts)

    const { createAuditLog } = await import('@/lib/audit-log')
    createAuditLog({
      userId: session.userId,
      username: session.username,
      action: 'ADMIN_SETTINGS_UPDATED',
      entityType: 'AppSettings',
      metadata: { updatedKeys: Object.keys(updates).filter((k) => ALLOWED_KEYS.includes(k)) }
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Admin settings POST error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
