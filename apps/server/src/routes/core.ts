import { Router } from 'express'
import { db, uid, plain, plainAll } from '../lib/db.js'
import { parseSyllabusText } from '../lib/ai.js'

export const core = Router()
const wrap = (fn: any) => (req: any, res: any, next: any) => Promise.resolve(fn(req, res, next)).catch(next)

/* ---------------- profile + settings ---------------- */

core.get('/profile', (_req, res) => {
  res.json(plain(db.prepare('SELECT * FROM profile WHERE id = 1').get()))
})

core.put('/profile', (req, res) => {
  const cur: any = plain(db.prepare('SELECT * FROM profile WHERE id = 1').get())
  const b = req.body || {}
  db.prepare(
    `UPDATE profile SET name=?, school=?, year_level=?, term=?, calendar_year=?, state=?, daily_goal_minutes=? WHERE id=1`
  ).run(
    b.name ?? cur.name,
    b.school ?? cur.school,
    Number(b.year_level ?? cur.year_level),
    Number(b.term ?? cur.term),
    Number(b.calendar_year ?? cur.calendar_year),
    b.state ?? cur.state,
    Number(b.daily_goal_minutes ?? cur.daily_goal_minutes)
  )
  res.json(plain(db.prepare('SELECT * FROM profile WHERE id = 1').get()))
})

core.get('/settings', (_req, res) => {
  const rows = plainAll(db.prepare('SELECT * FROM settings').all())
  res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])))
})
core.put('/settings/:key', (req, res) => {
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(
    req.params.key,
    String(req.body?.value ?? '')
  )
  res.json({ ok: true })
})

/* ---------------- subjects ---------------- */

core.get('/subjects', (req, res) => {
  const includeArchived = req.query.archived === 'true'
  const rows = plainAll(
    db
      .prepare(`SELECT * FROM subjects ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY archived, position, created_at`)
      .all()
  )
  // Attach light stats so subject cards can render without N extra requests.
  for (const s of rows) {
    const t: any = db.prepare(`SELECT COUNT(*) n FROM topics WHERE subject_id=? AND scope='topic' AND archived=0`).get(s.id)
    const sp: any = db.prepare('SELECT COUNT(*) n, SUM(status = ?) done FROM syllabus_points WHERE subject_id=?').get('completed', s.id)
    const up: any = db.prepare('SELECT COUNT(*) n FROM uploads WHERE subject_id=?').get(s.id)
    const fc: any = db.prepare(`SELECT COUNT(*) n FROM flashcards WHERE subject_id=? AND suspended=0`).get(s.id)
    const due: any = db
      .prepare(`SELECT COUNT(*) n FROM flashcards WHERE subject_id=? AND suspended=0 AND due_at <= datetime('now')`)
      .get(s.id)
    const at: any = db
      .prepare('SELECT COUNT(*) n, SUM(score) s, SUM(max_score) m FROM attempts WHERE subject_id=?')
      .get(s.id)
    // Mastery = answer accuracy weighted with flashcard maturity, matching the Progress page.
    const cardMaturity: any = db
      .prepare('SELECT COUNT(*) n, AVG(interval_days) avg_int FROM flashcards WHERE subject_id=? AND suspended=0')
      .get(s.id)
    const accuracy = at?.m ? at.s / at.m : null
    const cardScore = cardMaturity?.n ? Math.min(1, (cardMaturity.avg_int || 0) / 21) : null
    const mastery =
      accuracy !== null && cardScore !== null ? accuracy * 0.75 + cardScore * 0.25
      : accuracy !== null ? accuracy
      : cardScore !== null ? cardScore * 0.6
      : null

    s.stats = {
      mastery: mastery === null ? null : Math.round(mastery * 100),
      topics: t?.n ?? 0,
      syllabus_points: sp?.n ?? 0,
      syllabus_done: sp?.done ?? 0,
      uploads: up?.n ?? 0,
      flashcards: fc?.n ?? 0,
      due: due?.n ?? 0,
      questions: at?.n ?? 0,
      accuracy: at?.m ? Math.round(((at.s ?? 0) / at.m) * 100) : null,
    }
  }
  res.json(rows)
})

core.get('/subjects/:id', (req, res) => {
  const s = plain(db.prepare('SELECT * FROM subjects WHERE id=?').get(req.params.id))
  if (!s) return res.status(404).json({ error: 'Subject not found' })
  res.json(s)
})

core.post('/subjects', (req, res) => {
  const b = req.body || {}
  if (!b.name?.trim()) return res.status(400).json({ error: 'Subject name is required' })
  const max: any = db.prepare('SELECT COALESCE(MAX(position), -1) p FROM subjects').get()
  const id = uid('sub')
  db.prepare('INSERT INTO subjects (id,name,kind,icon,color,position) VALUES (?,?,?,?,?,?)').run(
    id, b.name.trim(), b.kind || 'generic', b.icon || 'book', b.color || '#6366f1', (max?.p ?? -1) + 1
  )
  res.status(201).json(plain(db.prepare('SELECT * FROM subjects WHERE id=?').get(id)))
})

core.put('/subjects/:id', (req, res) => {
  const cur: any = plain(db.prepare('SELECT * FROM subjects WHERE id=?').get(req.params.id))
  if (!cur) return res.status(404).json({ error: 'Subject not found' })
  const b = req.body || {}
  db.prepare('UPDATE subjects SET name=?, kind=?, icon=?, color=?, archived=? WHERE id=?').run(
    (b.name ?? cur.name).trim(), b.kind ?? cur.kind, b.icon ?? cur.icon, b.color ?? cur.color,
    b.archived === undefined ? cur.archived : b.archived ? 1 : 0, req.params.id
  )
  res.json(plain(db.prepare('SELECT * FROM subjects WHERE id=?').get(req.params.id)))
})

core.post('/subjects/reorder', (req, res) => {
  const ids: string[] = req.body?.ids || []
  const stmt = db.prepare('UPDATE subjects SET position=? WHERE id=?')
  ids.forEach((id, i) => stmt.run(i, id))
  res.json({ ok: true })
})

core.delete('/subjects/:id', (req, res) => {
  db.prepare('DELETE FROM subjects WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

/* ---------------- topics (own topic tree + school content) ---------------- */

core.get('/topics', (req, res) => {
  const { subject_id, scope, archived } = req.query as any
  const rows = plainAll(
    db
      .prepare(
        `SELECT * FROM topics WHERE (? IS NULL OR subject_id = ?) AND (? IS NULL OR scope = ?)
         AND (? = 'true' OR archived = 0) ORDER BY position, created_at`
      )
      .all(subject_id ?? null, subject_id ?? null, scope ?? null, scope ?? null, archived ?? 'false')
  )
  res.json(rows.map((t) => ({ ...t, links: safeJson(t.links, []) })))
})

function safeJson(s: any, fallback: any) {
  try { return JSON.parse(s) } catch { return fallback }
}

core.post('/topics', (req, res) => {
  const b = req.body || {}
  if (!b.subject_id || !b.name?.trim()) return res.status(400).json({ error: 'subject_id and name are required' })
  const max: any = db.prepare('SELECT COALESCE(MAX(position),-1) p FROM topics WHERE subject_id=?').get(b.subject_id)
  const id = uid('top')
  db.prepare(
    `INSERT INTO topics (id,subject_id,parent_id,name,scope,status,priority,start_date,assessment_date,
      teacher_instructions,notes,links,position) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id, b.subject_id, b.parent_id || null, b.name.trim(), b.scope || 'topic', b.status || 'not_started',
    b.priority || 'normal', b.start_date || null, b.assessment_date || null,
    b.teacher_instructions || '', b.notes || '', JSON.stringify(b.links || []), (max?.p ?? -1) + 1
  )
  res.status(201).json(plain(db.prepare('SELECT * FROM topics WHERE id=?').get(id)))
})

core.put('/topics/:id', (req, res) => {
  const cur: any = plain(db.prepare('SELECT * FROM topics WHERE id=?').get(req.params.id))
  if (!cur) return res.status(404).json({ error: 'Topic not found' })
  const b = req.body || {}
  db.prepare(
    `UPDATE topics SET name=?, parent_id=?, scope=?, status=?, priority=?, start_date=?, assessment_date=?,
      teacher_instructions=?, notes=?, links=?, archived=? WHERE id=?`
  ).run(
    (b.name ?? cur.name).trim(), b.parent_id === undefined ? cur.parent_id : b.parent_id || null,
    b.scope ?? cur.scope, b.status ?? cur.status, b.priority ?? cur.priority,
    b.start_date === undefined ? cur.start_date : b.start_date || null,
    b.assessment_date === undefined ? cur.assessment_date : b.assessment_date || null,
    b.teacher_instructions ?? cur.teacher_instructions, b.notes ?? cur.notes,
    b.links ? JSON.stringify(b.links) : cur.links,
    b.archived === undefined ? cur.archived : b.archived ? 1 : 0, req.params.id
  )
  res.json(plain(db.prepare('SELECT * FROM topics WHERE id=?').get(req.params.id)))
})

core.post('/topics/reorder', (req, res) => {
  const ids: string[] = req.body?.ids || []
  const stmt = db.prepare('UPDATE topics SET position=? WHERE id=?')
  ids.forEach((id, i) => stmt.run(i, id))
  res.json({ ok: true })
})

core.delete('/topics/:id', (req, res) => {
  db.prepare('DELETE FROM topics WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

/* ---------------- syllabus ---------------- */

core.get('/syllabus/:subjectId', (req, res) => {
  const sid = req.params.subjectId
  const sections = plainAll(db.prepare('SELECT * FROM syllabus_sections WHERE subject_id=? ORDER BY position').all(sid))
  const points = plainAll(db.prepare('SELECT * FROM syllabus_points WHERE subject_id=? ORDER BY position').all(sid))
  const docs = plainAll(db.prepare('SELECT * FROM syllabus_docs WHERE subject_id=? ORDER BY created_at DESC').all(sid))
  res.json({ sections, points, docs })
})

core.post('/syllabus/:subjectId/sections', (req, res) => {
  const sid = req.params.subjectId
  const max: any = db.prepare('SELECT COALESCE(MAX(position),-1) p FROM syllabus_sections WHERE subject_id=?').get(sid)
  const id = uid('sec')
  db.prepare('INSERT INTO syllabus_sections (id,subject_id,title,description,position) VALUES (?,?,?,?,?)').run(
    id, sid, (req.body?.title || 'New section').trim(), req.body?.description || '', (max?.p ?? -1) + 1
  )
  res.status(201).json(plain(db.prepare('SELECT * FROM syllabus_sections WHERE id=?').get(id)))
})

core.put('/syllabus/sections/:id', (req, res) => {
  const cur: any = plain(db.prepare('SELECT * FROM syllabus_sections WHERE id=?').get(req.params.id))
  if (!cur) return res.status(404).json({ error: 'Section not found' })
  db.prepare('UPDATE syllabus_sections SET title=?, description=? WHERE id=?').run(
    req.body?.title ?? cur.title, req.body?.description ?? cur.description, req.params.id
  )
  res.json(plain(db.prepare('SELECT * FROM syllabus_sections WHERE id=?').get(req.params.id)))
})

core.delete('/syllabus/sections/:id', (req, res) => {
  db.prepare('DELETE FROM syllabus_sections WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

core.post('/syllabus/:subjectId/points', (req, res) => {
  const sid = req.params.subjectId
  const b = req.body || {}
  const max: any = db.prepare('SELECT COALESCE(MAX(position),-1) p FROM syllabus_points WHERE subject_id=?').get(sid)
  const id = uid('pt')
  db.prepare('INSERT INTO syllabus_points (id,subject_id,section_id,code,text,status,position) VALUES (?,?,?,?,?,?,?)').run(
    id, sid, b.section_id || null, b.code || '', (b.text || '').trim(), b.status || 'not_started', (max?.p ?? -1) + 1
  )
  res.status(201).json(plain(db.prepare('SELECT * FROM syllabus_points WHERE id=?').get(id)))
})

core.put('/syllabus/points/:id', (req, res) => {
  const cur: any = plain(db.prepare('SELECT * FROM syllabus_points WHERE id=?').get(req.params.id))
  if (!cur) return res.status(404).json({ error: 'Point not found' })
  const b = req.body || {}
  db.prepare('UPDATE syllabus_points SET text=?, code=?, status=?, section_id=? WHERE id=?').run(
    b.text ?? cur.text, b.code ?? cur.code, b.status ?? cur.status,
    b.section_id === undefined ? cur.section_id : b.section_id || null, req.params.id
  )
  res.json(plain(db.prepare('SELECT * FROM syllabus_points WHERE id=?').get(req.params.id)))
})

core.delete('/syllabus/points/:id', (req, res) => {
  db.prepare('DELETE FROM syllabus_points WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

/** Bulk-add points from pasted text: one point per line (no AI required). */
core.post('/syllabus/:subjectId/bulk', (req, res) => {
  const sid = req.params.subjectId
  const lines: string[] = String(req.body?.text || '')
    .split(/\r?\n/).map((l) => l.replace(/^[\s•\-*]+/, '').trim()).filter(Boolean)
  const sectionId = req.body?.section_id || null
  let max: any = db.prepare('SELECT COALESCE(MAX(position),-1) p FROM syllabus_points WHERE subject_id=?').get(sid)
  let pos = (max?.p ?? -1) + 1
  const stmt = db.prepare('INSERT INTO syllabus_points (id,subject_id,section_id,code,text,position) VALUES (?,?,?,?,?,?)')
  for (const line of lines) stmt.run(uid('pt'), sid, sectionId, '', line, pos++)
  res.json({ added: lines.length })
})

/** AI-structured import: turn a raw syllabus dump into sections + points. */
core.post('/syllabus/:subjectId/parse', wrap(async (req: any, res: any) => {
  const sid = req.params.subjectId
  const subject: any = plain(db.prepare('SELECT * FROM subjects WHERE id=?').get(sid))
  if (!subject) return res.status(404).json({ error: 'Subject not found' })
  const text = String(req.body?.text || '')
  if (text.trim().length < 20) return res.status(400).json({ error: 'Not enough syllabus text to parse.' })

  const parsed = await parseSyllabusText(text, subject.name)
  const sectionIds = new Map<string, string>()
  const existing = plainAll(db.prepare('SELECT * FROM syllabus_sections WHERE subject_id=?').all(sid))
  for (const s of existing) sectionIds.set(String(s.title).toLowerCase(), s.id)

  let secMax: any = db.prepare('SELECT COALESCE(MAX(position),-1) p FROM syllabus_sections WHERE subject_id=?').get(sid)
  let secPos = (secMax?.p ?? -1) + 1
  let ptMax: any = db.prepare('SELECT COALESCE(MAX(position),-1) p FROM syllabus_points WHERE subject_id=?').get(sid)
  let ptPos = (ptMax?.p ?? -1) + 1

  const insSec = db.prepare('INSERT INTO syllabus_sections (id,subject_id,title,position) VALUES (?,?,?,?)')
  const insPt = db.prepare('INSERT INTO syllabus_points (id,subject_id,section_id,code,text,position) VALUES (?,?,?,?,?,?)')

  for (const row of parsed) {
    const title = String(row.section || 'General').trim() || 'General'
    const key = title.toLowerCase()
    if (!sectionIds.has(key)) {
      const secId = uid('sec')
      insSec.run(secId, sid, title, secPos++)
      sectionIds.set(key, secId)
    }
    const text2 = String(row.text || '').trim()
    if (text2) insPt.run(uid('pt'), sid, sectionIds.get(key)!, String(row.code || ''), text2, ptPos++)
  }
  res.json({ sections: sectionIds.size, points: parsed.length })
}))

core.post('/syllabus/:subjectId/docs', (req, res) => {
  const id = uid('sdoc')
  db.prepare('INSERT INTO syllabus_docs (id,subject_id,title,content,upload_id) VALUES (?,?,?,?,?)').run(
    id, req.params.subjectId, req.body?.title || 'Syllabus', req.body?.content || '', req.body?.upload_id || null
  )
  res.status(201).json(plain(db.prepare('SELECT * FROM syllabus_docs WHERE id=?').get(id)))
})

core.put('/syllabus/docs/:id', (req, res) => {
  const cur: any = plain(db.prepare('SELECT * FROM syllabus_docs WHERE id=?').get(req.params.id))
  if (!cur) return res.status(404).json({ error: 'Not found' })
  db.prepare('UPDATE syllabus_docs SET title=?, content=? WHERE id=?').run(
    req.body?.title ?? cur.title, req.body?.content ?? cur.content, req.params.id
  )
  res.json(plain(db.prepare('SELECT * FROM syllabus_docs WHERE id=?').get(req.params.id)))
})

core.delete('/syllabus/docs/:id', (req, res) => {
  db.prepare('DELETE FROM syllabus_docs WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

/* ---------------- notes ---------------- */

core.get('/notes', (req, res) => {
  const { subject_id, topic_id } = req.query as any
  res.json(
    plainAll(
      db
        .prepare(
          `SELECT * FROM notes WHERE (? IS NULL OR subject_id=?) AND (? IS NULL OR topic_id=?) ORDER BY updated_at DESC`
        )
        .all(subject_id ?? null, subject_id ?? null, topic_id ?? null, topic_id ?? null)
    )
  )
})

core.get('/notes/:id', (req, res) => {
  const n = plain(db.prepare('SELECT * FROM notes WHERE id=?').get(req.params.id))
  if (!n) return res.status(404).json({ error: 'Note not found' })
  res.json(n)
})

core.post('/notes', (req, res) => {
  const b = req.body || {}
  if (!b.subject_id) return res.status(400).json({ error: 'subject_id required' })
  const id = uid('note')
  db.prepare('INSERT INTO notes (id,subject_id,topic_id,title,body,subtopic,format) VALUES (?,?,?,?,?,?,?)').run(
    id, b.subject_id, b.topic_id || null, b.title || 'Untitled note', b.body || '', b.subtopic || '', b.format || 'html'
  )
  res.status(201).json(plain(db.prepare('SELECT * FROM notes WHERE id=?').get(id)))
})

core.put('/notes/:id', (req, res) => {
  const cur: any = plain(db.prepare('SELECT * FROM notes WHERE id=?').get(req.params.id))
  if (!cur) return res.status(404).json({ error: 'Note not found' })
  const b = req.body || {}
  db.prepare(
    `UPDATE notes SET title=?, body=?, topic_id=?, subtopic=?, format=?, pinned=?, updated_at=datetime('now') WHERE id=?`
  ).run(
    b.title ?? cur.title, b.body ?? cur.body,
    b.topic_id === undefined ? cur.topic_id : b.topic_id || null,
    b.subtopic ?? cur.subtopic, b.format ?? cur.format,
    b.pinned === undefined ? cur.pinned : b.pinned ? 1 : 0, req.params.id
  )
  res.json(plain(db.prepare('SELECT * FROM notes WHERE id=?').get(req.params.id)))
})

core.delete('/notes/:id', (req, res) => {
  db.prepare('DELETE FROM notes WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

/* ---------------- assessments ---------------- */

core.get('/assessments', (req, res) => {
  const { subject_id } = req.query as any
  res.json(
    plainAll(
      db
        .prepare(
          `SELECT a.*, s.name AS subject_name, s.color AS subject_color FROM assessments a
           LEFT JOIN subjects s ON s.id = a.subject_id
           WHERE (? IS NULL OR a.subject_id=?) ORDER BY a.due_date IS NULL, a.due_date`
        )
        .all(subject_id ?? null, subject_id ?? null)
    )
  )
})

core.post('/assessments', (req, res) => {
  const b = req.body || {}
  if (!b.name?.trim()) return res.status(400).json({ error: 'Assessment name required' })
  const id = uid('ass')
  db.prepare('INSERT INTO assessments (id,subject_id,name,topic,due_date,weighting,notes,status) VALUES (?,?,?,?,?,?,?,?)').run(
    id, b.subject_id || null, b.name.trim(), b.topic || '', b.due_date || null,
    Number(b.weighting || 0), b.notes || '', b.status || 'upcoming'
  )
  res.status(201).json(plain(db.prepare('SELECT * FROM assessments WHERE id=?').get(id)))
})

core.put('/assessments/:id', (req, res) => {
  const cur: any = plain(db.prepare('SELECT * FROM assessments WHERE id=?').get(req.params.id))
  if (!cur) return res.status(404).json({ error: 'Not found' })
  const b = req.body || {}
  db.prepare('UPDATE assessments SET subject_id=?, name=?, topic=?, due_date=?, weighting=?, notes=?, status=? WHERE id=?').run(
    b.subject_id === undefined ? cur.subject_id : b.subject_id, b.name ?? cur.name, b.topic ?? cur.topic,
    b.due_date === undefined ? cur.due_date : b.due_date || null, Number(b.weighting ?? cur.weighting),
    b.notes ?? cur.notes, b.status ?? cur.status, req.params.id
  )
  res.json(plain(db.prepare('SELECT * FROM assessments WHERE id=?').get(req.params.id)))
})

core.delete('/assessments/:id', (req, res) => {
  db.prepare('DELETE FROM assessments WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

/* ---------------- links (knowledge graph) ---------------- */

core.get('/links', (req, res) => {
  const { from_type, from_id } = req.query as any
  res.json(plainAll(db.prepare('SELECT * FROM links WHERE from_type=? AND from_id=?').all(from_type, from_id)))
})

core.post('/links', (req, res) => {
  const b = req.body || {}
  try {
    db.prepare('INSERT INTO links (id,from_type,from_id,to_type,to_id) VALUES (?,?,?,?,?)').run(
      uid('lnk'), b.from_type, b.from_id, b.to_type, b.to_id
    )
  } catch { /* duplicate link - already connected */ }
  res.json({ ok: true })
})

core.delete('/links/:id', (req, res) => {
  db.prepare('DELETE FROM links WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

/** Everything connected to a syllabus point: notes, uploads, flashcards, questions. */
core.get('/syllabus/points/:id/related', (req, res) => {
  const links = plainAll(db.prepare(`SELECT * FROM links WHERE from_type='syllabus_point' AND from_id=?`).all(req.params.id))
  const out: any = { notes: [], uploads: [], flashcards: [], questions: [] }
  for (const l of links) {
    if (l.to_type === 'note') out.notes.push(plain(db.prepare('SELECT id,title FROM notes WHERE id=?').get(l.to_id)))
    if (l.to_type === 'upload') out.uploads.push(plain(db.prepare('SELECT id,title,original_filename FROM uploads WHERE id=?').get(l.to_id)))
    if (l.to_type === 'flashcard') out.flashcards.push(plain(db.prepare('SELECT id,front FROM flashcards WHERE id=?').get(l.to_id)))
    if (l.to_type === 'question') out.questions.push(plain(db.prepare('SELECT id,prompt FROM questions WHERE id=?').get(l.to_id)))
  }
  for (const k of Object.keys(out)) out[k] = out[k].filter(Boolean)
  res.json(out)
})

/* ---------------- syllabus point <-> material connections ---------------- */

const STOPWORDS = new Set([
  'about','above','after','against','among','around','because','been','before','being','below','between','both',
  'could','during','each','from','have','into','more','most','other','over','same','should','some','such','than',
  'that','their','them','then','there','these','they','this','those','through','under','until','were','what','when',
  'where','which','while','with','would','your','students','learn','identify','describe','discuss','explain','outline',
  'investigate','examine','analyse','evaluate','assess','including','their','using','role','issues','types','process',
])

/** Distinctive words from a syllabus point, used to find related material. */
function keyTerms(text: string, max = 3): string[] {
  const words = String(text || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 4 && !STOPWORDS.has(w))
  const unique = [...new Set(words)].sort((a, b) => b.length - a.length)
  return unique.slice(0, max)
}

function matchClause(column: string, terms: string[]) {
  if (!terms.length) return { sql: '0', params: [] as string[] }
  return {
    sql: terms.map(() => `${column} LIKE ? ESCAPE '\\'`).join(' AND '),
    params: terms.map((t) => `%${t}%`),
  }
}

/** Counts of everything connected to each syllabus point: explicit links + keyword matches. */
core.get('/syllabus/:subjectId/counts', (req, res) => {
  const sid = req.params.subjectId
  const points = plainAll(db.prepare('SELECT id, text FROM syllabus_points WHERE subject_id=? ORDER BY position LIMIT 300').all(sid))
  const out: Record<string, any> = {}

  const linkCount = db.prepare(`SELECT to_type, COUNT(*) n FROM links WHERE from_type='syllabus_point' AND from_id=? GROUP BY to_type`)

  for (const p of points) {
    const terms = keyTerms(p.text)
    const counts = { notes: 0, uploads: 0, flashcards: 0, questions: 0, exam_questions: 0, linked: 0 }

    if (terms.length) {
      const noteM = matchClause('(n.title || \' \' || n.body)', terms)
      counts.notes = (db.prepare(`SELECT COUNT(*) n FROM notes n WHERE n.subject_id=? AND ${noteM.sql}`).get(sid, ...noteM.params) as any)?.n ?? 0

      const upM = matchClause('(u.title || \' \' || u.subtopic || \' \' || u.extracted_text)', terms)
      counts.uploads = (db.prepare(`SELECT COUNT(*) n FROM uploads u WHERE u.subject_id=? AND ${upM.sql}`).get(sid, ...upM.params) as any)?.n ?? 0

      const fcM = matchClause('(f.front || \' \' || f.back)', terms)
      counts.flashcards = (db.prepare(`SELECT COUNT(*) n FROM flashcards f WHERE f.subject_id=? AND ${fcM.sql}`).get(sid, ...fcM.params) as any)?.n ?? 0

      const qM = matchClause('(q.prompt || \' \' || q.answer)', terms)
      counts.questions = (db.prepare(
        `SELECT COUNT(*) n FROM questions q JOIN practice_sets ps ON ps.id=q.set_id
         WHERE q.subject_id=? AND ps.kind != 'exam' AND ${qM.sql}`
      ).get(sid, ...qM.params) as any)?.n ?? 0
      counts.exam_questions = (db.prepare(
        `SELECT COUNT(*) n FROM questions q JOIN practice_sets ps ON ps.id=q.set_id
         WHERE q.subject_id=? AND ps.kind = 'exam' AND ${qM.sql}`
      ).get(sid, ...qM.params) as any)?.n ?? 0
    }

    for (const row of plainAll(linkCount.all(p.id))) counts.linked += row.n
    out[p.id] = { ...counts, terms }
  }

  res.json(out)
})

/** Everything connected to one syllabus point, for the detail drawer. */
core.get('/syllabus/points/:id/material', (req, res) => {
  const point: any = plain(db.prepare('SELECT * FROM syllabus_points WHERE id=?').get(req.params.id))
  if (!point) return res.status(404).json({ error: 'Point not found' })
  const terms = keyTerms(point.text)
  const sid = point.subject_id
  const empty = { notes: [], uploads: [], flashcards: [], questions: [] }
  if (!terms.length) return res.json({ point, terms, ...empty })

  const nm = matchClause("(n.title || ' ' || n.body)", terms)
  const um = matchClause("(u.title || ' ' || u.subtopic || ' ' || u.extracted_text)", terms)
  const fm = matchClause("(f.front || ' ' || f.back)", terms)
  const qm = matchClause("(q.prompt || ' ' || q.answer)", terms)

  res.json({
    point,
    terms,
    notes: plainAll(db.prepare(`SELECT n.id, n.title FROM notes n WHERE n.subject_id=? AND ${nm.sql} LIMIT 40`).all(sid, ...nm.params)),
    uploads: plainAll(db.prepare(
      `SELECT u.id, u.title, u.original_filename, u.work_type FROM uploads u WHERE u.subject_id=? AND ${um.sql} LIMIT 40`
    ).all(sid, ...um.params)),
    flashcards: plainAll(db.prepare(`SELECT f.id, f.front FROM flashcards f WHERE f.subject_id=? AND ${fm.sql} LIMIT 60`).all(sid, ...fm.params)),
    questions: plainAll(db.prepare(
      `SELECT q.id, q.prompt, q.set_id, ps.kind FROM questions q JOIN practice_sets ps ON ps.id=q.set_id
       WHERE q.subject_id=? AND ${qm.sql} LIMIT 60`
    ).all(sid, ...qm.params)),
  })
})
