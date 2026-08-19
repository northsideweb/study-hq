/**
 * Text extraction for uploaded schoolwork.
 * The original file is ALWAYS preserved on disk - extraction only ever adds text.
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import { aiConfigured, transcribeImage } from './ai.js'

const run = promisify(execFile)

const require = createRequire(import.meta.url)

export type ExtractResult = {
  text: string
  status: 'ok' | 'failed' | 'unsupported'
  error?: string
  /** Which reader produced the text, so the UI can say so. */
  engine?: 'claude' | 'tesseract' | 'pdf' | 'docx' | 'pptx' | 'text'
}

/**
 * Normalise a photo for vision: convert HEIC to JPEG and cap the long edge.
 * Uses macOS `sips`, which is built in. Falls back to the original file.
 */
async function prepareImage(filePath: string, mime: string): Promise<{ base64: string; mediaType: string }> {
  const out = path.join(os.tmpdir(), `shq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`)
  try {
    // -Z caps the longest side; 1600px is plenty for reading handwriting and keeps
    // the request small. Also converts HEIC/HEIF, which no OCR path can read directly.
    await run('sips', ['-s', 'format', 'jpeg', '-Z', '1600', filePath, '--out', out], { timeout: 30_000 })
    const data = await fs.readFile(out)
    fs.unlink(out).catch(() => {})
    return { base64: data.toString('base64'), mediaType: 'image/jpeg' }
  } catch {
    const data = await fs.readFile(filePath)
    const type = /heic|heif/i.test(mime) ? 'image/jpeg' : mime || 'image/jpeg'
    return { base64: data.toString('base64'), mediaType: type }
  }
}

export function isImage(mime: string, filename: string) {
  return mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|tiff?|heic)$/i.test(filename)
}

async function extractPdf(filePath: string): Promise<string> {
  // pdfjs legacy build runs in Node without a DOM.
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = new Uint8Array(await fs.readFile(filePath))
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise
  const out: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const line = content.items.map((it: any) => ('str' in it ? it.str : '')).join(' ')
    out.push(`--- Page ${i} ---\n${line.replace(/\s+/g, ' ').trim()}`)
  }
  await doc.destroy()
  return out.join('\n\n')
}

async function extractDocx(filePath: string): Promise<string> {
  const mammoth: any = await import('mammoth')
  const res = await (mammoth.default ?? mammoth).extractRawText({ path: filePath })
  return String(res.value || '')
}

async function extractPptx(filePath: string): Promise<string> {
  const unzipper: any = require('unzipper')
  const dir = await unzipper.Open.file(filePath)
  const slides = dir.files
    .filter((f: any) => /^ppt\/slides\/slide\d+\.xml$/.test(f.path))
    .sort((a: any, b: any) => {
      const n = (p: string) => Number(p.match(/slide(\d+)\.xml/)![1])
      return n(a.path) - n(b.path)
    })
  const out: string[] = []
  for (const [i, s] of slides.entries()) {
    const xml = (await s.buffer()).toString('utf8')
    const texts = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) =>
      m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    )
    if (texts.length) out.push(`--- Slide ${i + 1} ---\n${texts.join('\n')}`)
  }
  return out.join('\n\n')
}

/** OCR handwritten / photographed work. Slow, so callers run it in the background. */
export async function ocrImage(
  filePath: string,
  onProgress?: (pct: number) => void
): Promise<string> {
  const { createWorker } = await import('tesseract.js')
  const worker: any = await createWorker('eng', 1, {
    logger: (m: any) => {
      if (m.status === 'recognizing text' && onProgress) onProgress(Math.round(m.progress * 100))
    },
  })
  try {
    const { data } = await worker.recognize(filePath)
    return String(data.text || '').trim()
  } finally {
    await worker.terminate()
  }
}

export async function extractFile(
  filePath: string,
  mime: string,
  originalName: string,
  onProgress?: (pct: number) => void
): Promise<ExtractResult> {
  const ext = path.extname(originalName || filePath).toLowerCase()
  try {
    if (ext === '.pdf' || mime === 'application/pdf') {
      const text = await extractPdf(filePath)
      // A scanned PDF yields almost no text - say so rather than pretending it worked.
      if (text.replace(/--- Page \d+ ---/g, '').trim().length < 20) {
        return {
          text,
          status: 'failed',
          error: 'This PDF looks scanned (no selectable text). Upload page photos to OCR them instead.',
        }
      }
      return { text, status: 'ok', engine: 'pdf' }
    }
    if (ext === '.docx') return { text: await extractDocx(filePath), status: 'ok', engine: 'docx' }
    if (ext === '.pptx') return { text: await extractPptx(filePath), status: 'ok', engine: 'pptx' }
    if (ext === '.txt' || ext === '.md' || ext === '.csv' || mime.startsWith('text/')) {
      return { text: await fs.readFile(filePath, 'utf8'), status: 'ok', engine: 'text' }
    }
    if (isImage(mime, originalName)) {
      // Claude reads handwriting far better than classical OCR, so use it when AI is on.
      if (aiConfigured()) {
        try {
          onProgress?.(20)
          const img = await prepareImage(filePath, mime)
          onProgress?.(45)
          const text = await transcribeImage({ base64: img.base64, mediaType: img.mediaType })
          onProgress?.(100)
          if (text.trim()) return { text, status: 'ok', engine: 'claude' }
          return {
            text: '',
            status: 'failed',
            error: 'Nothing readable was found in this photo. Check it is in focus and the whole page is in frame.',
            engine: 'claude',
          }
        } catch (err: any) {
          // Fall through to offline OCR rather than losing the upload.
          const text = await ocrImage(filePath, onProgress)
          if (text) {
            return {
              text,
              status: 'ok',
              engine: 'tesseract',
              error: `Read with offline OCR because the AI reader failed (${err?.message || err}). Accuracy on handwriting will be lower.`,
            }
          }
          return { text: '', status: 'failed', error: `Could not read this image: ${err?.message || err}` }
        }
      }

      const text = await ocrImage(filePath, onProgress)
      if (!text) {
        return {
          text: '',
          status: 'failed',
          error: 'Offline OCR found no readable text. Offline OCR struggles with handwriting - turn AI on in Settings for far better results.',
          engine: 'tesseract',
        }
      }
      return { text, status: 'ok', engine: 'tesseract' }
    }
    if (ext === '.doc' || ext === '.ppt') {
      return {
        text: '',
        status: 'unsupported',
        error: 'Legacy .doc/.ppt is not readable. Re-save as .docx/.pptx or paste the text.',
      }
    }
    return { text: '', status: 'unsupported', error: `No text extractor for ${ext || mime}.` }
  } catch (err: any) {
    return { text: '', status: 'failed', error: err?.message || String(err) }
  }
}
