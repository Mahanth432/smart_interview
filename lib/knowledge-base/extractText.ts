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

export interface ExtractedPage {
  pageNumber: number
  text: string
}

export interface ExtractedDocumentContent {
  text: string
  pages?: ExtractedPage[]
}

async function extractPdfContent(buf: Buffer): Promise<ExtractedDocumentContent> {
  // Lazy-load unpdf only for PDFs; its serverless pdfjs build polyfills DOMMatrix
  // in pure JS without requiring @napi-rs/canvas or browser globals.
  const { extractText } = await import('unpdf')
  const uint8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  const result = await extractText(uint8, { mergePages: false })
  const rawPages = Array.isArray(result.text)
    ? result.text.map((p) => String(p ?? ''))
    : [String(result.text ?? '')]
  const pages: ExtractedPage[] = rawPages.map((pageText, index) => ({
    pageNumber: index + 1,
    text: normalizeText(pageText),
  }))
  const text = pages.map((p) => p.text).filter(Boolean).join('\n')
  console.log(`[extractText] PDF extracted characters: ${text.length} (${result.totalPages} pages)`)
  return { text, pages }
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

export function validateFileMagicBytes(
  buf: Buffer,
  ext: string
): { ok: true } | { ok: false; error: string } {
  const normalizedExt = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`
  if (normalizedExt === '.pdf') {
    const header = buf.subarray(0, 16).toString('latin1')
    if (!header.includes('%PDF-')) {
      return { ok: false, error: 'File signature does not match a valid PDF document.' }
    }
  } else if (normalizedExt === '.docx') {
    if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b || buf[2] !== 0x03 || buf[3] !== 0x04) {
      return { ok: false, error: 'File signature does not match a valid DOCX archive.' }
    }
  } else if (normalizedExt === '.txt' || normalizedExt === '.md') {
    if (buf.subarray(0, 4096).includes(0x00)) {
      return { ok: false, error: 'Binary content is not allowed in plain text/markdown files.' }
    }
  }
  return { ok: true }
}

export async function extractDocumentContentFromBuffer(
  buf: Buffer,
  originalFilename?: string,
  fileType?: string,
  storagePathHint = ''
): Promise<ExtractedDocumentContent> {
  const ext = resolveExtension(storagePathHint, originalFilename, fileType)
  const magicCheck = validateFileMagicBytes(buf, ext)
  if (!magicCheck.ok) {
    throw new Error(magicCheck.error)
  }
  let rawText = ''
  let pages: ExtractedPage[] | undefined

  if (ext === '.pdf') {
    const pdfResult = await extractPdfContent(buf)
    rawText = pdfResult.text
    pages = pdfResult.pages
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

  return pages ? { text: normalized, pages } : { text: normalized }
}

export async function extractTextFromBuffer(
  buf: Buffer,
  originalFilename?: string,
  fileType?: string,
  storagePathHint = ''
): Promise<string> {
  const content = await extractDocumentContentFromBuffer(buf, originalFilename, fileType, storagePathHint)
  return content.text
}

export async function extractDocumentContentFromFile(
  storagePath: string,
  originalFilename?: string,
  fileType?: string
): Promise<ExtractedDocumentContent> {
  if (!storagePath) throw new Error('Missing storage path')
  const buf = await readDocumentBuffer(storagePath)
  return extractDocumentContentFromBuffer(buf, originalFilename, fileType, storagePath)
}

export async function extractTextFromFile(
  storagePath: string,
  originalFilename?: string,
  fileType?: string
): Promise<string> {
  const content = await extractDocumentContentFromFile(storagePath, originalFilename, fileType)
  return content.text
}

export default extractTextFromFile
