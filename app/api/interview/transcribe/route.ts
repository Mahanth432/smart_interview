import { NextRequest, NextResponse } from 'next/server'
import { getAppSession } from '@/lib/auth'
import {
  MAX_TRANSCRIBE_REQUEST_BYTES,
  validateAudioUpload,
} from '@/lib/audio/validation'

export const maxDuration = 60

const WHISPER_REQUEST_TIMEOUT_MS = 45_000

function isProductionRuntime(): boolean {
  return Boolean(process.env.VERCEL || process.env.VERCEL_ENV || process.env.NODE_ENV === 'production')
}

function resolveWhisperServiceUrl(): string | null {
  const configured = (process.env.WHISPER_SERVICE_URL || '').trim().replace(/\/+$/, '')
  if (configured) {
    return configured
  }
  if (!isProductionRuntime()) {
    return 'http://127.0.0.1:8000'
  }
  return null
}

function sanitizeUpstreamMessage(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string' || !raw.trim()) return fallback
  return raw
    .replace(/postgres(ql)?:\/\/[^\s]+/gi, '<redacted>')
    .replace(/https?:\/\/[^\s]+/gi, '<redacted-url>')
    .replace(/(secret|token|key|password|authorization)=([^\s&]+)/gi, '$1=<redacted>')
    .trim()
    .slice(0, 250)
}

export async function POST(req: NextRequest) {
  try {
    const res = NextResponse.json({})
    const session = await getAppSession(req as unknown as Request, res as unknown as Response)

    if (!session?.isLoggedIn || !session.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Reject oversized Content-Length upfront before reading FormData into memory
    const contentLengthHeader = req.headers.get('content-length')
    if (contentLengthHeader) {
      const contentLength = Number(contentLengthHeader)
      if (Number.isFinite(contentLength) && contentLength > MAX_TRANSCRIBE_REQUEST_BYTES) {
        return NextResponse.json(
          { error: 'Audio upload exceeds the 4 MB limit. Please record a shorter segment or enter manually.' },
          { status: 413 }
        )
      }
    }

    const formData = await req.formData()
    const file = (formData.get('audio') || formData.get('file')) as File | null

    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 })
    }

    const validation = validateAudioUpload(file)
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }

    // Fail-closed: WHISPER_API_SECRET is strictly required in ALL environments
    const whisperSecret = (process.env.WHISPER_API_SECRET || '').trim()
    if (!whisperSecret) {
      console.error('[Transcribe API] WHISPER_API_SECRET is not configured.')
      return NextResponse.json(
        { error: 'Transcription service is not configured. You can type your answer manually.' },
        { status: 503 }
      )
    }

    const whisperBaseUrl = resolveWhisperServiceUrl()
    if (!whisperBaseUrl) {
      console.error('[Transcribe API] WHISPER_SERVICE_URL is not configured in production.')
      return NextResponse.json(
        { error: 'Transcription service is currently unavailable. Please enter your answer manually.' },
        { status: 503 }
      )
    }

    const targetEndpoint = `${whisperBaseUrl}/transcribe`

    // Forward validated audio to FastAPI faster-whisper service (no external paid API fallback)
    const audioBytes = await file.arrayBuffer()
    const forwardBlob = new Blob([audioBytes], { type: validation.mimeType })
    const outboundData = new FormData()
    outboundData.append('file', forwardBlob, validation.filename)

    let whisperRes: Response
    try {
      whisperRes = await fetch(targetEndpoint, {
        method: 'POST',
        headers: {
          'X-Whisper-Secret': whisperSecret,
          Authorization: `Bearer ${whisperSecret}`,
        },
        body: outboundData,
        signal: AbortSignal.timeout(WHISPER_REQUEST_TIMEOUT_MS),
      })
    } catch (err: unknown) {
      const isTimeout =
        err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
      console.warn(
        `[Transcribe API] Whisper request ${isTimeout ? 'timed out' : 'failed to reach service'}.`
      )
      return NextResponse.json(
        {
          error: isTimeout
            ? 'Speech-to-text request timed out. Please retry with a shorter recording or enter your answer manually.'
            : 'Speech-to-text service is temporarily unavailable. Please enter your answer manually.',
        },
        { status: isTimeout ? 504 : 503 }
      )
    }

    if (!whisperRes.ok) {
      const status = whisperRes.status
      console.error(`[Transcribe API] Whisper service returned HTTP ${status}`)

      if (status === 401 || status === 403) {
        return NextResponse.json(
          { error: 'Transcription service authentication failed. Please contact the administrator or enter your answer manually.' },
          { status: 503 }
        )
      }

      if (status === 504) {
        return NextResponse.json(
          { error: 'Speech-to-text timed out while decoding audio. Please retry with a shorter clip or enter your answer manually.' },
          { status: 504 }
        )
      }

      if (status === 400 || status === 413 || status === 415) {
        const errJson = (await whisperRes.json().catch(() => null)) as { detail?: string } | null
        return NextResponse.json(
          { error: sanitizeUpstreamMessage(errJson?.detail, 'Invalid audio upload.') },
          { status }
        )
      }

      return NextResponse.json(
        { error: 'Speech-to-text processing failed. You can retry recording or type your answer manually.' },
        { status: 503 }
      )
    }

    const data = (await whisperRes.json().catch(() => ({}))) as {
      text?: unknown
      language?: unknown
      language_probability?: unknown
      duration?: unknown
      processing_ms?: unknown
    }

    const transcriptText = typeof data.text === 'string' ? data.text.trim() : ''
    const language = typeof data.language === 'string' && data.language.trim() ? data.language.trim() : null
    const languageProbability =
      typeof data.language_probability === 'number' && Number.isFinite(data.language_probability)
        ? data.language_probability
        : null
    const duration =
      typeof data.duration === 'number' && Number.isFinite(data.duration) ? data.duration : null
    const processingMs =
      typeof data.processing_ms === 'number' && Number.isFinite(data.processing_ms)
        ? data.processing_ms
        : null

    return NextResponse.json({
      text: transcriptText,
      transcript: transcriptText,
      language,
      languageProbability,
      duration,
      processingMs,
    })
  } catch (error: unknown) {
    console.error('[Transcribe API] Unexpected error:', error instanceof Error ? error.name : 'Unknown')
    return NextResponse.json(
      { error: 'Internal transcription error. Please type your answer manually.' },
      { status: 500 }
    )
  }
}
