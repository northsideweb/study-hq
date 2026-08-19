import { Router } from 'express'
import multer from 'multer'
import fs from 'node:fs'
import path from 'node:path'
import { db, uid, plain, plainAll } from '../lib/db.js'
import { UPLOAD_DIR } from '../lib/config.js'
import { extractFile, isImage } from '../lib/extract.js'
import { organiseContent } from '../lib/ai.js'

export const uploads = Router()
const wrap = (fn: any) => (req: any, res: any, next: any) => Promise.resolve(fn(req, res, next)).catch(next)

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\- ]+/g, '_').slice(-80)
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safe}`)
  },
})
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } })

/** Live extraction/OCR progress, polled by the UI. */
const progress = new Map<string, { pct: number; stage: string }>()

function runExtraction(id: string, filePath: string, mime: string, originalName: string) {
  progress.set(id, { pct: 0, stage: isImage(mime, originalName) ? 'Reading handwriting (OCR)' : 'Extracting text' })
  db.prepare(`UPDATE uploads SET extract_status='pending' WHERE id=?`).run(id)
  extractFile(filePath, mime, originalName, (pct) => progress.set(id, { pct, stage: 'Reading handwriting (OCR)' }))
    .then((r) => {
      db.prepare('UPDATE uploads SET extracted_text=?, extract_status=?, extract_error=? WHERE id=?').run(
        r.text, r.status, r.error || '', id
      )
      progress.set(id, { pct: 100, stage: r.status === 'ok' ? 'Done' : r.status })
      setTimeout(() => progress.delete(id), 60_000)
    })
    .catch((err) => {
      db.prepare(`UPDATE uploads SET extract_status='failed', extract_error=? WHERE id=?`).run(String(err?.message || err), id)
      progress.set(id, { pct: 100, stage: 'failed' })
    })
}

uploads.get('/uploads', (req, res) => {
  const { subject_id, topic_id, work_type, limit } = req.query as any
  const rows = plainAll(
    db
      .prepare(
        `SELECT u.*, s.name AS subject_name, s.color AS subject_color, t.name AS topic_name
         FROM uploads u LEFT JOIN subjects s ON s.id=u.subject_id LEFT JOIN topics t ON t.id=u.topic_id
         WHERE (? IS NULL OR u.subject_id=?) AND (? IS NULL OR u.topic_id=?) AND (? IS NULL OR u.work_type=?)
         ORDER BY u.created_at DESC LIMIT ?`
      )
      .all(subject_id ?? null, subject_id ?? null, topic_id ?? null, topic_id ?? null,
           work_type ?? null, work_type ?? null, Number(limit || 500))
  )
  // Keep list payloads small - full text is fetched per item.
  res.json(rows.map((r) => ({ ...r, extracted_text: (r.extracted_text || '').slice(0, 400), has_text: !!r.extracted_text })))
})

uploads.get('/uploads/:id', (req, res) => {
  const row = plain(db.prepare('SELECT * FROM uploads WHERE id=?').get(req.params.id))
  if (!row) return res.status(404).json({ error: 'Upload not found' })
  res.json(row)
})

uploads.get('/uploads/:id/progress', (req, res) => {
  const row: any = plain(db.prepare('SELECT extract_status, extract_error FROM uploads WHERE id=?').get(req.params.id))
  res.json({ ...(progress.get(req.params.id) || { pct: row?.extract_status === 'pending' ? 5 : 100, stage: row?.extract_status || 'none' }), status: row?.extract_status, error: row?.extract_error })
})

/** Serve the ORIGINAL file - never deleted, always downloadable. */
uploads.get('/uploads/:id/file', (req, res) => {
  const row: any = plain(db.prepare('SELECT * FROM uploads WHERE id=?').get(req.params.id))
  if (!row?.stored_name) return res.status(404).json({ error: 'No original file for this item' })
  const p = path.join(UPLOAD_DIR, row.stored_name)
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'File missing from disk' })
  res.setHeader('Content-Type', row.mime || 'application/octet-stream')
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(row.original_filename || 'file')}"`)
  fs.createReadStream(p).pipe(res)
})

function insertUpload(b: any, file?: Express.Multer.File) {
  const profile: any = plain(db.prepare('SELECT * FROM profile WHERE id=1').get())
  const id = uid('up')
  db.prepare(
    `INSERT INTO uploads (id,subject_id,topic_id,subtopic,title,work_type,year_level,term,school,teacher,work_date,
      source,original_filename,stored_name,mime,size,extracted_text,extract_status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id, b.subject_id || null, b.topic_id || null, b.subtopic || '',
    b.title || file?.originalname || 'Untitled', b.work_type || 'Other',
    Number(b.year_level || profile?.year_level || 11), Number(b.term || profile?.term || 1),
    b.school || profile?.school || '', b.teacher || '',
    b.work_date || new Date().toISOString().slice(0, 10),
    b.source || (file ? 'file' : 'paste'),
    file?.originalname || '', file?.filename || '', file?.mimetype || '', file?.size || 0,
    b.text || '', file ? 'pending' : b.text ? 'ok' : 'none'
  )
  return id
}

/** Upload one or more files. Extraction/OCR runs in the background. */
uploads.post('/uploads', upload.array('files', 20), (req: any, res) => {
  const files: Express.Multer.File[] = req.files || []
  if (!files.length) return res.status(400).json({ error: 'No files received' })
  const ids: string[] = []
  for (const f of files) {
    const id = insertUpload({ ...req.body, title: req.body.title || f.originalname }, f)
    ids.push(id)
    runExtraction(id, path.join(UPLOAD_DIR, f.filename), f.mimetype, f.originalname)
  }
  res.status(201).json({ ids, items: ids.map((i) => plain(db.prepare('SELECT * FROM uploads WHERE id=?').get(i))) })
})

/** Paste text straight into the knowledge base. */
uploads.post('/uploads/paste', (req, res) => {
  const b = req.body || {}
  if (!String(b.text || '').trim()) return res.status(400).json({ error: 'Nothing to save - paste some text first.' })
  const id = insertUpload({ ...b, source: 'paste' })
  res.status(201).json(plain(db.prepare('SELECT * FROM uploads WHERE id=?').get(id)))
})

uploads.put('/uploads/:id', (req, res) => {
  const cur: any = plain(db.prepare('SELECT * FROM uploads WHERE id=?').get(req.params.id))
  if (!cur) return res.status(404).json({ error: 'Upload not found' })
  const b = req.body || {}
  db.prepare(
    `UPDATE uploads SET subject_id=?, topic_id=?, subtopic=?, title=?, work_type=?, year_level=?, term=?,
      school=?, teacher=?, work_date=?, extracted_text=? WHERE id=?`
  ).run(
    b.subject_id === undefined ? cur.subject_id : b.subject_id || null,
    b.topic_id === undefined ? cur.topic_id : b.topic_id || null,
    b.subtopic ?? cur.subtopic, b.title ?? cur.title, b.work_type ?? cur.work_type,
    Number(b.year_level ?? cur.year_level), Number(b.term ?? cur.term),
    b.school ?? cur.school, b.teacher ?? cur.teacher, b.work_date ?? cur.work_date,
    b.extracted_text ?? cur.extracted_text, req.params.id
  )
  res.json(plain(db.prepare('SELECT * FROM uploads WHERE id=?').get(req.params.id)))
})

uploads.post('/uploads/:id/reextract', (req, res) => {
  const row: any = plain(db.prepare('SELECT * FROM uploads WHERE id=?').get(req.params.id))
  if (!row?.stored_name) return res.status(400).json({ error: 'This item has no original file to re-read.' })
  runExtraction(row.id, path.join(UPLOAD_DIR, row.stored_name), row.mime, row.original_filename)
  res.json({ ok: true })
})

/** AI categorisation suggestion - the student always confirms before it is applied. */
uploads.post('/uploads/:id/organise', wrap(async (req: any, res: any) => {
  const row: any = plain(db.prepare('SELECT * FROM uploads WHERE id=?').get(req.params.id))
  if (!row) return res.status(404).json({ error: 'Upload not found' })
  const text = (row.extracted_text || '').trim()
  if (!text) return res.status(400).json({ error: 'No text to analyse yet. Wait for extraction, or paste/type the text.' })
  const subjects = plainAll(db.prepare('SELECT id,name FROM subjects WHERE archived=0').all())
  const topics = plainAll(db.prepare(`SELECT id,subject_id,name FROM topics WHERE archived=0 LIMIT 300`).all())
  const suggestion = await organiseContent({ text, subjects, topics })
  res.json(suggestion)
}))

uploads.delete('/uploads/:id', (req, res) => {
  const row: any = plain(db.prepare('SELECT * FROM uploads WHERE id=?').get(req.params.id))
  if (row?.stored_name) {
    const p = path.join(UPLOAD_DIR, row.stored_name)
    // Only remove the file when the student explicitly deletes the record.
    if (fs.existsSync(p)) { try { fs.unlinkSync(p) } catch { /* leave orphan rather than fail */ } }
  }
  db.prepare('DELETE FROM uploads WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})
