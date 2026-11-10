import path from 'path'

// Conservative 4 MB limit to stay safely under Vercel's 4.5 MB serverless request payload cap
// after multipart FormData boundaries and headers.
export const MAX_TRANSCRIBE_AUDIO_BYTES = 4 * 1024 * 1024
export const MAX_TRANSCRIBE_REQUEST_BYTES = 4_400_000

export const ALLOWED_AUDIO_EXTENSIONS = new Set([
  '.webm',
  '.mp4',
  '.m4a',
  '.ogg',
  '.oga',
  '.wav',
  '.mp3',
  '.mpeg',
  '.flac',
])

export const ALLOWED_AUDIO_MIME_TYPES = new Set([
  'audio/webm',
  'video/webm',
  'audio/mp4',
  'video/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/ogg',
  'application/ogg',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/vnd.wave',
  'audio/mpeg',
  'audio/mp3',
  'audio/flac',
  'audio/x-flac',
])

export function normalizeAudioMimeType(rawMime?: string | null): string {
  return (rawMime || '').split(';')[0].trim().toLowerCase()
}

export function resolveRecordingFilename(mimeType?: string | null): string {
  const normalized = normalizeAudioMimeType(mimeType)
  if (normalized === 'audio/mp4' || normalized === 'video/mp4' || normalized === 'audio/m4a' || normalized === 'audio/x-m4a') {
    return 'recording.mp4'
  }
  if (normalized === 'audio/ogg' || normalized === 'application/ogg') {
    return 'recording.ogg'
  }
  if (normalized === 'audio/wav' || normalized === 'audio/x-wav' || normalized === 'audio/wave' || normalized === 'audio/vnd.wave') {
    return 'recording.wav'
  }
  if (normalized === 'audio/mpeg' || normalized === 'audio/mp3') {
    return 'recording.mp3'
  }
  if (normalized === 'audio/flac' || normalized === 'audio/x-flac') {
    return 'recording.flac'
  }
  return 'recording.webm'
}

export type AudioValidationResult =
  | {
      ok: true
      filename: string
      extension: string
      mimeType: string
    }
  | {
      ok: false
      error: string
      status: number
    }

export function validateAudioUpload(file: File): AudioValidationResult {
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return {
      ok: false,
      error: 'Empty audio recording received. Please record again or type your answer manually.',
      status: 400,
    }
  }

  if (file.size > MAX_TRANSCRIBE_AUDIO_BYTES) {
    return {
      ok: false,
      error: 'Audio recording exceeds the 4 MB upload limit. Please record a shorter segment or type manually.',
      status: 413,
    }
  }

  const rawName = path.basename((file.name || '').trim())
  const normalizedMime = normalizeAudioMimeType(file.type)
  const rawExt = path.extname(rawName).toLowerCase()

  const mimeAllowed = ALLOWED_AUDIO_MIME_TYPES.has(normalizedMime)
  const extAllowed = rawExt ? ALLOWED_AUDIO_EXTENSIONS.has(rawExt) : false

  // Reject disallowed extensions even if MIME is generic or spoofed
  if (rawExt && !extAllowed) {
    return {
      ok: false,
      error: `Unsupported audio file extension (${rawExt}). Supported formats: WebM, MP4/M4A, OGG, WAV, MP3, FLAC.`,
      status: 400,
    }
  }

  // Reject explicitly non-audio MIME types unless generic octet-stream paired with valid audio extension
  const genericMimeWithValidExt =
    (normalizedMime === '' || normalizedMime === 'application/octet-stream') && extAllowed

  if (!mimeAllowed && !genericMimeWithValidExt) {
    return {
      ok: false,
      error: `Unsupported audio MIME type (${normalizedMime || 'unknown'}). Please record using a supported browser audio format.`,
      status: 400,
    }
  }

  const resolvedFilename = rawName && rawExt ? rawName : resolveRecordingFilename(normalizedMime)
  const resolvedExt = path.extname(resolvedFilename).toLowerCase() || '.webm'
  const resolvedMime = mimeAllowed ? normalizedMime : 'application/octet-stream'

  return {
    ok: true,
    filename: resolvedFilename,
    extension: resolvedExt,
    mimeType: resolvedMime,
  }
}
