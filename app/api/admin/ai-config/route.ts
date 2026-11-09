import { NextResponse } from 'next/server'
import { getAppSession } from '@/lib/auth'
import {
  getAdminAIConfig,
  updateAdminAIConfig,
  testProviderConnection,
  LLMProviderId,
} from '@/lib/llm/config'
import prisma from '@/lib/db'

// GET /api/admin/ai-config — LLM provider status and failover topology (Admin only)
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

    const aiConfig = await getAdminAIConfig()

    // Fetch RAG parameters from AppSettings
    const ragSettings = await prisma.appSettings.findMany({
      where: {
        key: {
          in: ['rag.enabled', 'rag.top_k', 'rag.chunk_size', 'rag.chunk_overlap'],
        },
      },
    })
    const ragMap: Record<string, string> = {}
    for (const r of ragSettings) {
      ragMap[r.key] = r.value
    }

    return NextResponse.json({
      ...aiConfig,
      rag: {
        enabled: ragMap['rag.enabled'] !== 'false',
        embeddingModel: 'all-MiniLM-L6-v2 (local, 384-dim)',
        vectorStore: 'pgvector (PostgreSQL)',
        chunkSize: parseInt(ragMap['rag.chunk_size'] || '1200', 10),
        chunkOverlap: parseInt(ragMap['rag.chunk_overlap'] || '200', 10),
        topK: parseInt(ragMap['rag.top_k'] || '5', 10),
      },
    })
  } catch (err) {
    console.error('Admin AI config GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/admin/ai-config — Update configuration or perform test connection (Admin only)
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

    // 1. Manual Test Connection Action
    if (body.action === 'test') {
      const provider = body.provider as LLMProviderId
      if (provider !== 'gemini' && provider !== 'groq') {
        return NextResponse.json({ error: 'Invalid provider specified for test' }, { status: 400 })
      }
      const testResult = await testProviderConnection(provider, body.apiKey)
      return NextResponse.json({
        success: testResult.success,
        latencyMs: testResult.latencyMs,
        error: testResult.error,
      })
    }

    // 2. Configuration Update
    const updated = await updateAdminAIConfig(
      {
        primaryProvider: body.primaryProvider,
        geminiApiKey: body.geminiApiKey,
        groqApiKey: body.groqApiKey,
        geminiEnabled: typeof body.geminiEnabled === 'boolean' ? body.geminiEnabled : undefined,
        groqEnabled: typeof body.groqEnabled === 'boolean' ? body.groqEnabled : undefined,
      },
      session.userId,
      session.username
    )

    return NextResponse.json({ success: true, config: updated })
  } catch (err) {
    console.error('Admin AI config POST error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
