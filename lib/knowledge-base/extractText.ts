import path from 'path'
import { readDocumentBuffer } from '@/lib/storage/b2'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeText(input: any): string {
  if (!input) return ''
  if (typeof input !== 'string') {
    if (typeof input === 'object') {
      throw new Error(
        `Extraction failed: expected string but received ${Array.isArray(input) ? 'Array' : 'Object'}`
      )
    }
    input = String(input)
  }
  // Normalize line endings
  let t = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  // Replace tabs with space
  t = t.replace(/\t+/g, ' ')
  // Collapse multiple spaces
  t = t.replace(/ {2,}/g, ' ')
  // Trim trailing spaces on each line
  t = t
    .split('\n')
    .map((l: string) => l.trimEnd())
    .join('\n')
  // Collapse excessive blank lines to maximum two (preserve paragraph separation)
  t = t.replace(/\n{3,}/g, '\n\n')
  // Trim overall
  t = t.trim()
  return t
}

function resolveExtension(storagePath: string, originalFilename?: string, fileType?: string): string {
  const fromOriginal = path.extname(originalFilename || '').toLowerCase()
  if (fromOriginal) return fromOriginal

  const fromStorage = path.extname(storagePath).toLowerCase()
  if (fromStorage) return fromStorage

  const normalizedType = (fileType || '').trim().toLowerCase()
  if (normalizedType === 'pdf' || normalizedType === 'application/pdf') return '.pdf'
  if (
    normalizedType === 'docx' ||
    normalizedType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return '.docx'
  }
  if (normalizedType === 'doc' || normalizedType === 'application/msword') return '.doc'
  if (normalizedType === 'md' || normalizedType === 'text/markdown') return '.md'
  if (normalizedType === 'txt' || normalizedType === 'text/plain') return '.txt'
  return ''
}

async function extractPdfText(buf: Buffer): Promise<string> {
  // Lazy-load unpdf only for PDFs; its serverless pdfjs build polyfills DOMMatrix
  // in pure JS without requiring @napi-rs/canvas or browser globals.
  const { extractText } = await import('unpdf')
  const uint8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  const result = await extractText(uint8, { mergePages: true })
  const text = Array.isArray(result.text) ? result.text.join('\n') : String(result.text ?? '')
  console.log(`[extractText] PDF extracted characters: ${text.length} (${result.totalPages} pages)`)
  return text
}

async function extractDocxText(buf: Buffer): Promise<string> {
  // Lazy-load mammoth only for DOCX files
  const mammothMod = await import('mammoth')
  const mammoth = (mammothMod.default ?? mammothMod) as {
    extractRawText: (opts: { buffer: Buffer }) => Promise<{ value: string }>
  }
  const result = await mammoth.extractRawText({ buffer: buf })
  const text = result && result.value ? String(result.value) : ''
  console.log(`[extractText] DOCX extracted characters: ${text.length}`)
  return text
}

export async function extractTextFromBuffer(
  buf: Buffer,
  originalFilename?: string,
  fileType?: string,
  storagePathHint = ''
): Promise<string> {
  const ext = resolveExtension(storagePathHint, originalFilename, fileType)
  let rawText = ''

  if (ext === '.pdf') {
    rawText = await extractPdfText(buf)
  } else if (ext === '.docx') {
    rawText = await extractDocxText(buf)
  } else if (ext === '.txt' || ext === '.md') {
    rawText = buf.toString('utf8')
    console.log(`[extractText] ${ext.slice(1).toUpperCase()} extracted characters: ${rawText.length}`)
  } else if (ext === '.doc') {
    throw new Error('DOC (binary) format is not supported. Convert to DOCX or PDF.')
  } else {
    rawText = buf.toString('utf8')
  }

  const normalized = normalizeText(rawText)

  if (!normalized || normalized.replace(/\s+/g, '').length < 20) {
    throw new Error('No meaningful text could be extracted from the document')
  }

  return normalized
}

export async function extractTextFromFile(
  storagePath: string,
  originalFilename?: string,
  fileType?: string
): Promise<string> {
  if (!storagePath) throw new Error('Missing storage path')
  const buf = await readDocumentBuffer(storagePath)
  return extractTextFromBuffer(buf, originalFilename, fileType, storagePath)
}

export default extractTextFromFile
