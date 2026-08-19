import { Router } from 'express'
import { db, uid, plain, plainAll } from '../lib/db.js'
import {
  aiConfigured, buildContext, runNoteTool, analyseEssay, improveParagraph,
  learnExplainer, extractBankEntries, NOTE_TOOLS, AiNotConfigured,
} from '../lib/ai.js'

export const extras = Router()
const wrap = (fn: any) => (req: any, res: any, next: any) => Promise.resolve(fn(req, res, next)).catch(next)
const json = (s: any, f: any) => { try { return JSON.parse(s) } catch { return f } }

/* ---------------------------------------------------------------- */
/* Tasks                                                             */
/* ---------------------------------------------------------------- */

extras.get('/tasks', (req, res) => {
  const { subject_id, status } = req.query as any
  res.json(
    plainAll(
      db.prepare(
        `SELECT t.*, s.name AS subject_name, s.color AS subject_color FROM tasks t
         LEFT JOIN subjects s ON s.id = t.subject_id
         WHERE (? IS NULL OR t.subject_id = ?) AND (? IS NULL OR t.status = ?)
         ORDER BY t.status='done', t.due_date IS NULL, t.due_date,
           CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END`
      ).all(subject_id ?? null, subject_id ?? null, status ?? null, status ?? null)
    )
  )
})

extras.post('/tasks', (req, res) => {
  const b = req.body || {}
  if (!String(b.title || '').trim()) return res.status(400).json({ error: 'A task needs a title' })
  const id = uid('task')
  db.prepare(
    `INSERT INTO tasks (id,subject_id,topic_id,title,notes,due_date,priority,status) VALUES (?,?,?,?,?,?,?,?)`
  ).run(id, b.subject_id || null, b.topic_id || null, b.title.trim(), b.notes || '',
        b.due_date || null, b.priority || 'normal', b.status || 'todo')
  res.status(201).json(plain(db.prepare('SELECT * FROM tasks WHERE id=?').get(id)))
})

extras.put('/tasks/:id', (req, res) => {
  const cur: any = plain(db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id))
  if (!cur) return res.status(404).json({ error: 'Task not found' })
  const b = req.body || {}
  const status = b.status ?? cur.status
  db.prepare(
    `UPDATE tasks SET subject_id=?, topic_id=?, title=?, notes=?, due_date=?, priority=?, status=?,
      completed_at=? WHERE id=?`
  ).run(
    b.subject_id === undefined ? cur.subject_id : b.subject_id || null,
    b.topic_id === undefined ? cur.topic_id : b.topic_id || null,
    b.title ?? cur.title, b.notes ?? cur.notes,
    b.due_date === undefined ? cur.due_date : b.due_date || null,
    b.priority ?? cur.priority, status,
    status === 'done' ? (cur.completed_at || new Date().toISOString()) : null,
    req.params.id
  )
  res.json(plain(db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id)))
})

extras.delete('/tasks/:id', (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

/* ---------------------------------------------------------------- */
/* Banks - quotes, techniques, cases, legislation, business examples */
/* ---------------------------------------------------------------- */

extras.get('/banks/:subjectId', (req, res) => {
  const { kind } = req.query as any
  res.json(
    plainAll(
      db.prepare(
        `SELECT b.*, t.name AS topic_name FROM bank_entries b LEFT JOIN topics t ON t.id=b.topic_id
         WHERE b.subject_id=? AND (? IS NULL OR b.kind=?) ORDER BY b.updated_at DESC`
      ).all(req.params.subjectId, kind ?? null, kind ?? null)
    ).map((r) => ({ ...r, meta: json(r.meta, {}) }))
  )
})

extras.post('/banks/:subjectId', (req, res) => {
  const b = req.body || {}
  if (!b.kind || !String(b.title || '').trim()) return res.status(400).json({ error: 'kind and title are required' })
  const id = uid('bank')
  db.prepare(
    `INSERT INTO bank_entries (id,subject_id,topic_id,kind,title,body,detail,source,tags,meta,origin)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(id, req.params.subjectId, b.topic_id || null, b.kind, b.title.trim(), b.body || '',
        b.detail || '', b.source || '', b.tags || '', JSON.stringify(b.meta || {}), b.origin || 'manual')
  res.status(201).json(plain(db.prepare('SELECT * FROM bank_entries WHERE id=?').get(id)))
})

extras.put('/banks/entry/:id', (req, res) => {
  const cur: any = plain(db.prepare('SELECT * FROM bank_entries WHERE id=?').get(req.params.id))
  if (!cur) return res.status(404).json({ error: 'Entry not found' })
  const b = req.body || {}
  db.prepare(
    `UPDATE bank_entries SET title=?, body=?, detail=?, source=?, tags=?, topic_id=?, meta=?,
      updated_at=datetime('now') WHERE id=?`
  ).run(b.title ?? cur.title, b.body ?? cur.body, b.detail ?? cur.detail, b.source ?? cur.source,
        b.tags ?? cur.tags, b.topic_id === undefined ? cur.topic_id : b.topic_id || null,
        b.meta ? JSON.stringify(b.meta) : cur.meta, req.params.id)
  res.json(plain(db.prepare('SELECT * FROM bank_entries WHERE id=?').get(req.params.id)))
})

extras.delete('/banks/entry/:id', (req, res) => {
  db.prepare('DELETE FROM bank_entries WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

/** Pull bank entries out of the student's own uploaded/typed material. */
extras.post('/banks/:subjectId/extract', wrap(async (req: any, res: any) => {
  const subject: any = plain(db.prepare('SELECT * FROM subjects WHERE id=?').get(req.params.subjectId))
  if (!subject) return res.status(404).json({ error: 'Subject not found' })
  if (!aiConfigured()) throw new AiNotConfigured()
  const kind = req.body?.kind || 'definition'
  const ctx = buildContext({ subjectId: subject.id, topicId: req.body?.topic_id })
  if (!ctx.hasMaterial) return res.status(400).json({ error: 'Add some notes or uploads for this subject first.' })

  const items = await extractBankEntries({
    kind, subjectName: subject.name, subjectKind: subject.kind,
    contextText: ctx.text, count: Math.min(Number(req.body?.count || 15), 40),
  })
  const stmt = db.prepare(
    `INSERT INTO bank_entries (id,subject_id,topic_id,kind,title,body,detail,source,origin)
     VALUES (?,?,?,?,?,?,?,?,'ai')`
  )
  let added = 0
  for (const it of items) {
    if (!it?.title) continue
    stmt.run(uid('bank'), subject.id, req.body?.topic_id || null, kind, String(it.title),
             String(it.body || ''), String(it.detail || ''), String(it.source || ''))
    added++
  }
  res.json({ added })
}))

/* ---------------------------------------------------------------- */
/* Skills                                                            */
/* ---------------------------------------------------------------- */

const DEFAULT_SKILLS: Record<string, Array<[string, string]>> = {
  maths: [
    ['Financial Mathematics', 'Simple interest'], ['Financial Mathematics', 'Compound interest'],
    ['Financial Mathematics', 'Depreciation'], ['Financial Mathematics', 'Loans and repayments'],
    ['Financial Mathematics', 'Annuities'], ['Financial Mathematics', 'Earning and managing money'],
    ['Financial Mathematics', 'Budgeting and taxation'],
    ['Measurement', 'Perimeter and area'], ['Measurement', 'Surface area and volume'],
    ['Measurement', 'Pythagoras and trigonometry'], ['Measurement', 'Rates and ratios'],
    ['Measurement', 'Unit conversion and scale'],
    ['Statistical Analysis', 'Classifying and displaying data'], ['Statistical Analysis', 'Summary statistics'],
    ['Statistical Analysis', 'Standard deviation'], ['Statistical Analysis', 'Bivariate data and correlation'],
    ['Algebra', 'Formulae and substitution'], ['Algebra', 'Linear relationships'],
    ['Algebra', 'Simultaneous equations'], ['Algebra', 'Non-linear relationships'],
    ['Probability', 'Theoretical probability'], ['Probability', 'Relative frequency'],
    ['Probability', 'Multi-stage events'],
  ],
  english: [
    ['Writing', 'Thesis statements'], ['Writing', 'Topic sentences'], ['Writing', 'Integrating evidence'],
    ['Writing', 'Technique analysis'], ['Writing', 'Linking to the question'], ['Writing', 'Essay structure'],
    ['Writing', 'Conclusions'], ['Reading', 'Unseen texts'], ['Reading', 'Identifying techniques'],
    ['Reading', 'Comparing texts'], ['Writing', 'Creative writing'], ['Writing', 'Reflection statements'],
  ],
  legal: [
    ['Command terms', 'Define'], ['Command terms', 'Describe'], ['Command terms', 'Explain'],
    ['Command terms', 'Analyse'], ['Command terms', 'Discuss'], ['Command terms', 'Assess'],
    ['Command terms', 'Evaluate'], ['Skills', 'Using legislation'], ['Skills', 'Using legal cases'],
    ['Skills', 'Using media examples'], ['Skills', 'Judging effectiveness'], ['Skills', 'Extended response'],
  ],
  business: [
    ['Skills', 'Definitions'], ['Skills', 'Case study analysis'], ['Skills', 'Using business examples'],
    ['Skills', 'Business terminology'], ['Command terms', 'Outline and describe'],
    ['Command terms', 'Explain'], ['Command terms', 'Analyse'], ['Command terms', 'Assess and evaluate'],
    ['Skills', '6-mark responses'], ['Skills', '10-mark responses'], ['Skills', 'Essay responses'],
    ['Skills', 'Financial calculations'],
  ],
  music: [
    ['Concepts', 'Duration'], ['Concepts', 'Pitch'], ['Concepts', 'Dynamics and expressive techniques'],
    ['Concepts', 'Tone colour'], ['Concepts', 'Texture'], ['Concepts', 'Structure'],
    ['Aural', 'Identifying texture'], ['Aural', 'Identifying tone colour'], ['Aural', 'Identifying structure'],
    ['Aural', 'Describing rhythm'], ['Aural', 'Analysing melody'], ['Aural', 'Analysing harmony'],
    ['Musicology', 'Style and context'], ['Theory', 'Notation and key signatures'],
    ['Theory', 'Intervals and chords'], ['Composition', 'Composition techniques'],
    ['Performance', 'Performance preparation'],
  ],
  dt: [
    ['Design process', 'Identifying needs'], ['Design process', 'Research'], ['Design process', 'Ideation'],
    ['Design process', 'Design development'], ['Design process', 'Production'], ['Design process', 'Evaluation'],
    ['Theory', 'Materials'], ['Theory', 'Technologies'], ['Theory', 'Innovation and emerging technologies'],
    ['Theory', 'Case studies'], ['Theory', 'WHS and risk'], ['Project', 'Project documentation'],
  ],
  generic: [['Skills', 'Definitions'], ['Skills', 'Short answer'], ['Skills', 'Extended response'], ['Skills', 'Analysis']],
}

extras.get('/skills/:subjectId', (req, res) => {
  const rows = plainAll(
    db.prepare('SELECT * FROM skills WHERE subject_id=? AND archived=0 ORDER BY category, position, name').all(req.params.subjectId)
  )
  // Attach measured performance per skill so the UI can show what needs work.
  for (const r of rows) {
    const a: any = db.prepare(
      `SELECT COUNT(*) n, COALESCE(SUM(score),0) s, COALESCE(SUM(max_score),0) m FROM attempts WHERE skill_id=?`
    ).get(r.id)
    r.attempts = a?.n ?? 0
    r.accuracy = a?.m ? Math.round((a.s / a.m) * 100) : null
  }
  res.json(rows)
})

/** Seed the standard skill list for a subject (editable afterwards). */
extras.post('/skills/:subjectId/seed', (req, res) => {
  const subject: any = plain(db.prepare('SELECT * FROM subjects WHERE id=?').get(req.params.subjectId))
  if (!subject) return res.status(404).json({ error: 'Subject not found' })
  const list = DEFAULT_SKILLS[subject.kind] || DEFAULT_SKILLS.generic
  const existing = new Set(
    plainAll(db.prepare('SELECT name FROM skills WHERE subject_id=?').all(subject.id)).map((r) => String(r.name).toLowerCase())
  )
  const stmt = db.prepare('INSERT INTO skills (id,subject_id,category,name,position) VALUES (?,?,?,?,?)')
  let added = 0
  list.forEach(([category, name], i) => {
    if (existing.has(name.toLowerCase())) return
    stmt.run(uid('skill'), subject.id, category, name, i)
    added++
  })
  res.json({ added })
})

extras.post('/skills/:subjectId', (req, res) => {
  const b = req.body || {}
  if (!String(b.name || '').trim()) return res.status(400).json({ error: 'Skill name required' })
  const id = uid('skill')
  const max: any = db.prepare('SELECT COALESCE(MAX(position),-1) p FROM skills WHERE subject_id=?').get(req.params.subjectId)
  db.prepare('INSERT INTO skills (id,subject_id,category,name,description,position) VALUES (?,?,?,?,?,?)').run(
    id, req.params.subjectId, b.category || 'Skills', b.name.trim(), b.description || '', (max?.p ?? -1) + 1
  )
  res.status(201).json(plain(db.prepare('SELECT * FROM skills WHERE id=?').get(id)))
})

extras.put('/skills/entry/:id', (req, res) => {
  const cur: any = plain(db.prepare('SELECT * FROM skills WHERE id=?').get(req.params.id))
  if (!cur) return res.status(404).json({ error: 'Skill not found' })
  const b = req.body || {}
  db.prepare('UPDATE skills SET name=?, category=?, description=?, archived=? WHERE id=?').run(
    b.name ?? cur.name, b.category ?? cur.category, b.description ?? cur.description,
    b.archived === undefined ? cur.archived : b.archived ? 1 : 0, req.params.id
  )
  res.json(plain(db.prepare('SELECT * FROM skills WHERE id=?').get(req.params.id)))
})

extras.delete('/skills/entry/:id', (req, res) => {
  db.prepare('DELETE FROM skills WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

/* ---------------------------------------------------------------- */
/* Mistake bank + weak areas                                         */
/* ---------------------------------------------------------------- */

extras.get('/mistakes', (req, res) => {
  const { subject_id, topic_id, include_reviewed } = req.query as any
  const rows = plainAll(
    db.prepare(
      `SELECT a.id, a.response, a.feedback, a.improvement, a.score, a.max_score, a.created_at, a.reviewed,
              q.id AS question_id, q.prompt, q.answer, q.working, q.qtype, q.marks, q.stimulus, q.options,
              s.name AS subject_name, s.color AS subject_color, s.id AS subject_id,
              t.name AS topic_name, t.id AS topic_id
       FROM attempts a
       JOIN questions q ON q.id = a.question_id
       LEFT JOIN subjects s ON s.id = a.subject_id
       LEFT JOIN topics t ON t.id = a.topic_id
       WHERE (a.correct = 0 OR (a.max_score > 0 AND (a.score * 1.0 / a.max_score) < 0.6))
         AND (? IS NULL OR a.subject_id = ?) AND (? IS NULL OR a.topic_id = ?)
         AND (? = 'true' OR a.reviewed = 0)
       ORDER BY a.created_at DESC LIMIT 300`
    ).all(subject_id ?? null, subject_id ?? null, topic_id ?? null, topic_id ?? null, include_reviewed ?? 'false')
  )
  res.json(rows.map((r) => ({ ...r, options: json(r.options, []) })))
})

extras.put('/mistakes/:attemptId', (req, res) => {
  db.prepare('UPDATE attempts SET reviewed=? WHERE id=?').run(req.body?.reviewed ? 1 : 0, req.params.attemptId)
  res.json({ ok: true })
})

/** Build a fresh practice set from questions previously answered badly. */
extras.post('/mistakes/practice', (req, res) => {
  const b = req.body || {}
  const rows = plainAll(
    db.prepare(
      `SELECT DISTINCT q.* FROM attempts a JOIN questions q ON q.id = a.question_id
       WHERE (a.correct = 0 OR (a.max_score > 0 AND (a.score * 1.0 / a.max_score) < 0.6)) AND a.reviewed = 0
         AND (? IS NULL OR a.subject_id = ?) AND (? IS NULL OR a.topic_id = ?)
       ORDER BY a.created_at DESC LIMIT ?`
    ).all(b.subject_id ?? null, b.subject_id ?? null, b.topic_id ?? null, b.topic_id ?? null, Number(b.limit || 10))
  )
  if (!rows.length) return res.status(400).json({ error: 'No unresolved mistakes to practise yet.' })

  const setId = uid('set')
  const subject: any = b.subject_id ? plain(db.prepare('SELECT name FROM subjects WHERE id=?').get(b.subject_id)) : null
  db.prepare('INSERT INTO practice_sets (id,subject_id,topic_id,name,mode,kind,config) VALUES (?,?,?,?,?,?,?)').run(
    setId, b.subject_id || rows[0].subject_id, b.topic_id || null,
    `My mistakes${subject ? ' - ' + subject.name : ''}`, 'my_material', 'set', JSON.stringify({ from_mistakes: true })
  )
  const stmt = db.prepare(
    `INSERT INTO questions (id,set_id,subject_id,topic_id,skill_id,qtype,difficulty,prompt,stimulus,options,answer,
      marking_guide,marks,working,mode,origin,fingerprint,position) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  )
  rows.forEach((q, i) => {
    stmt.run(uid('q'), setId, q.subject_id, q.topic_id, q.skill_id || null, q.qtype, q.difficulty, q.prompt,
             q.stimulus, q.options, q.answer, q.marking_guide, q.marks, q.working, q.mode, 'mistake', q.fingerprint, i)
  })
  res.json({ set_id: setId, count: rows.length })
})

/* ---------------------------------------------------------------- */
/* Calendar                                                          */
/* ---------------------------------------------------------------- */

/** Assessments, tasks, custom events and study sessions on one timeline. */
extras.get('/calendar', (req, res) => {
  const from = String(req.query.from || '')
  const to = String(req.query.to || '')
  const range = (col: string) => `(${from ? `${col} >= '${from}'` : '1'}) AND (${to ? `${col} <= '${to}'` : '1'})`

  const assessments = plainAll(
    db.prepare(
      `SELECT a.id, a.name AS title, a.due_date AS date, a.weighting, a.notes, s.name AS subject_name, s.color AS subject_color, a.subject_id
       FROM assessments a LEFT JOIN subjects s ON s.id=a.subject_id
       WHERE a.due_date IS NOT NULL AND ${range('a.due_date')}`
    ).all()
  ).map((r) => ({ ...r, kind: 'assessment' }))

  const tasks = plainAll(
    db.prepare(
      `SELECT t.id, t.title, t.due_date AS date, t.status, t.priority, s.name AS subject_name, s.color AS subject_color, t.subject_id
       FROM tasks t LEFT JOIN subjects s ON s.id=t.subject_id
       WHERE t.due_date IS NOT NULL AND ${range('t.due_date')}`
    ).all()
  ).map((r) => ({ ...r, kind: 'task' }))

  const events = plainAll(
    db.prepare(
      `SELECT e.id, e.title, e.event_date AS date, e.kind, e.start_time, e.end_time, e.notes,
              s.name AS subject_name, s.color AS subject_color, e.subject_id
       FROM calendar_events e LEFT JOIN subjects s ON s.id=e.subject_id WHERE ${range('e.event_date')}`
    ).all()
  )

  const sessions = plainAll(
    db.prepare(
      `SELECT id, date(started_at) AS date, ROUND(minutes) AS minutes, summary FROM study_sessions
       WHERE ended_at IS NOT NULL AND ${range('date(started_at)')}`
    ).all()
  ).map((r) => ({ ...r, kind: 'session', title: `Studied ${r.minutes} min` }))

  const schoolTopics = plainAll(
    db.prepare(
      `SELECT t.id, t.name AS title, t.assessment_date AS date, s.name AS subject_name, s.color AS subject_color, t.subject_id
       FROM topics t LEFT JOIN subjects s ON s.id=t.subject_id
       WHERE t.assessment_date IS NOT NULL AND t.archived=0 AND ${range('t.assessment_date')}`
    ).all()
  ).map((r) => ({ ...r, kind: 'topic_assessment' }))

  res.json([...assessments, ...tasks, ...events, ...sessions, ...schoolTopics])
})

extras.post('/calendar', (req, res) => {
  const b = req.body || {}
  if (!String(b.title || '').trim() || !b.event_date) return res.status(400).json({ error: 'Title and date are required' })
  const id = uid('evt')
  db.prepare(
    'INSERT INTO calendar_events (id,subject_id,title,kind,event_date,start_time,end_time,notes) VALUES (?,?,?,?,?,?,?,?)'
  ).run(id, b.subject_id || null, b.title.trim(), b.kind || 'event', b.event_date, b.start_time || '', b.end_time || '', b.notes || '')
  res.status(201).json(plain(db.prepare('SELECT * FROM calendar_events WHERE id=?').get(id)))
})

extras.put('/calendar/:id', (req, res) => {
  const cur: any = plain(db.prepare('SELECT * FROM calendar_events WHERE id=?').get(req.params.id))
  if (!cur) return res.status(404).json({ error: 'Event not found' })
  const b = req.body || {}
  db.prepare('UPDATE calendar_events SET title=?, kind=?, event_date=?, start_time=?, end_time=?, notes=?, subject_id=? WHERE id=?').run(
    b.title ?? cur.title, b.kind ?? cur.kind, b.event_date ?? cur.event_date, b.start_time ?? cur.start_time,
    b.end_time ?? cur.end_time, b.notes ?? cur.notes,
    b.subject_id === undefined ? cur.subject_id : b.subject_id || null, req.params.id
  )
  res.json(plain(db.prepare('SELECT * FROM calendar_events WHERE id=?').get(req.params.id)))
})

extras.delete('/calendar/:id', (req, res) => {
  db.prepare('DELETE FROM calendar_events WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

/* ---------------------------------------------------------------- */
/* Essays                                                            */
/* ---------------------------------------------------------------- */

extras.get('/essays', (req, res) => {
  const { subject_id } = req.query as any
  res.json(
    plainAll(
      db.prepare(
        `SELECT e.id, e.subject_id, e.topic_id, e.title, e.question, e.marks, e.created_at, e.updated_at,
                LENGTH(e.body) AS length, e.analysis != '' AS analysed,
                s.name AS subject_name, s.color AS subject_color
         FROM essays e LEFT JOIN subjects s ON s.id=e.subject_id
         WHERE (? IS NULL OR e.subject_id=?) ORDER BY e.updated_at DESC`
      ).all(subject_id ?? null, subject_id ?? null)
    )
  )
})

extras.get('/essays/:id', (req, res) => {
  const e: any = plain(db.prepare('SELECT * FROM essays WHERE id=?').get(req.params.id))
  if (!e) return res.status(404).json({ error: 'Not found' })
  res.json({ ...e, analysis: json(e.analysis, null), improvements: json(e.improvements, []) })
})

extras.post('/essays', (req, res) => {
  const b = req.body || {}
  if (!b.subject_id) return res.status(400).json({ error: 'subject_id required' })
  const id = uid('essay')
  db.prepare('INSERT INTO essays (id,subject_id,topic_id,title,question,body,marks,upload_id) VALUES (?,?,?,?,?,?,?,?)').run(
    id, b.subject_id, b.topic_id || null, b.title || 'Untitled response', b.question || '', b.body || '',
    Number(b.marks || 0), b.upload_id || null
  )
  res.status(201).json(plain(db.prepare('SELECT * FROM essays WHERE id=?').get(id)))
})

extras.put('/essays/:id', (req, res) => {
  const cur: any = plain(db.prepare('SELECT * FROM essays WHERE id=?').get(req.params.id))
  if (!cur) return res.status(404).json({ error: 'Not found' })
  const b = req.body || {}
  db.prepare(
    `UPDATE essays SET title=?, question=?, body=?, marks=?, topic_id=?, updated_at=datetime('now') WHERE id=?`
  ).run(b.title ?? cur.title, b.question ?? cur.question, b.body ?? cur.body, Number(b.marks ?? cur.marks),
        b.topic_id === undefined ? cur.topic_id : b.topic_id || null, req.params.id)
  res.json(plain(db.prepare('SELECT * FROM essays WHERE id=?').get(req.params.id)))
})

extras.delete('/essays/:id', (req, res) => {
  db.prepare('DELETE FROM essays WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

extras.post('/essays/:id/analyse', wrap(async (req: any, res: any) => {
  const e: any = plain(db.prepare('SELECT * FROM essays WHERE id=?').get(req.params.id))
  if (!e) return res.status(404).json({ error: 'Not found' })
  if (!String(e.body || '').trim()) return res.status(400).json({ error: 'Write or paste your response first.' })
  if (!aiConfigured()) throw new AiNotConfigured()
  const subject: any = plain(db.prepare('SELECT * FROM subjects WHERE id=?').get(e.subject_id))
  const ctx = buildContext({ subjectId: e.subject_id, topicId: e.topic_id, charBudget: 15000 })
  const analysis = await analyseEssay({
    question: e.question, body: e.body, subjectKind: subject?.kind || 'generic',
    subjectName: subject?.name || '', marks: e.marks || undefined, contextText: ctx.text,
  })
  db.prepare(`UPDATE essays SET analysis=?, updated_at=datetime('now') WHERE id=?`).run(JSON.stringify(analysis), e.id)
  res.json(analysis)
}))

/** Improve one paragraph. The original is never overwritten - both versions are kept. */
extras.post('/essays/:id/improve', wrap(async (req: any, res: any) => {
  const e: any = plain(db.prepare('SELECT * FROM essays WHERE id=?').get(req.params.id))
  if (!e) return res.status(404).json({ error: 'Not found' })
  if (!aiConfigured()) throw new AiNotConfigured()
  const paragraph = String(req.body?.paragraph || '')
  if (!paragraph.trim()) return res.status(400).json({ error: 'Select a paragraph to improve.' })
  const subject: any = plain(db.prepare('SELECT * FROM subjects WHERE id=?').get(e.subject_id))
  const result = await improveParagraph({
    paragraph, question: e.question, subjectKind: subject?.kind || 'generic', instruction: req.body?.instruction,
  })
  const list = json(e.improvements, [])
  list.push({ id: uid('imp'), original: paragraph, improved: result.improved, changes: result.changes, kept: result.kept, at: new Date().toISOString() })
  db.prepare(`UPDATE essays SET improvements=?, updated_at=datetime('now') WHERE id=?`).run(JSON.stringify(list), e.id)
  res.json({ ...result, improvements: list })
}))

/* ---------------------------------------------------------------- */
/* Note AI tools                                                     */
/* ---------------------------------------------------------------- */

extras.get('/note-tools', (_req, res) => {
  res.json(Object.entries(NOTE_TOOLS).map(([id, v]) => ({ id, label: v.label })))
})

extras.post('/notes/:id/tool', wrap(async (req: any, res: any) => {
  const note: any = plain(db.prepare('SELECT * FROM notes WHERE id=?').get(req.params.id))
  if (!note) return res.status(404).json({ error: 'Note not found' })
  if (!aiConfigured()) throw new AiNotConfigured()
  const subject: any = plain(db.prepare('SELECT * FROM subjects WHERE id=?').get(note.subject_id))
  const text = String(note.body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  if (text.length < 20) return res.status(400).json({ error: 'This note is too short to work with.' })
  const output = await runNoteTool(String(req.body?.tool || 'summarise'), text, subject?.kind || 'generic', subject?.name || '')
  res.json({ output })
}))

/* ---------------------------------------------------------------- */
/* Study Mode                                                        */
/* ---------------------------------------------------------------- */

/** The "Learn" stage: a short teaching explainer before practice starts. */
extras.post('/study/learn', wrap(async (req: any, res: any) => {
  const subject: any = plain(db.prepare('SELECT * FROM subjects WHERE id=?').get(req.body?.subject_id))
  if (!subject) return res.status(404).json({ error: 'Subject not found' })
  const topic: any = req.body?.topic_id ? plain(db.prepare('SELECT * FROM topics WHERE id=?').get(req.body.topic_id)) : null
  if (!aiConfigured()) throw new AiNotConfigured()
  const ctx = buildContext({ subjectId: subject.id, topicId: req.body?.topic_id, charBudget: 25000 })
  const text = await learnExplainer({
    subjectKind: subject.kind, subjectName: subject.name,
    topic: topic?.name || req.body?.topic || subject.name, contextText: ctx.text,
  })
  res.json({ text })
}))

/* ---------------------------------------------------------------- */
/* Study recommendations - computed locally so they always work      */
/* ---------------------------------------------------------------- */

function daysUntil(date?: string | null) {
  if (!date) return null
  const d = new Date(date + 'T00:00:00')
  if (isNaN(d.getTime())) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - today.getTime()) / 86400000)
}

export function buildRecommendations(limit = 6) {
  const recs: any[] = []

  const mastery = plainAll(
    db.prepare(
      `SELECT t.id, t.name, t.subject_id, t.status, s.name subject_name, s.color subject_color,
              COALESCE(SUM(a.score),0) score, COALESCE(SUM(a.max_score),0) max_score, COUNT(a.id) attempts
       FROM topics t LEFT JOIN attempts a ON a.topic_id=t.id LEFT JOIN subjects s ON s.id=t.subject_id
       WHERE t.archived=0 GROUP BY t.id`
    ).all()
  ).map((r) => ({ ...r, pct: r.max_score > 0 ? Math.round((r.score / r.max_score) * 100) : null }))

  const assessments = plainAll(
    db.prepare(
      `SELECT a.*, s.name subject_name, s.color subject_color FROM assessments a
       LEFT JOIN subjects s ON s.id=a.subject_id
       WHERE a.status='upcoming' AND a.due_date IS NOT NULL AND a.due_date >= date('now')
       ORDER BY a.due_date LIMIT 10`
    ).all()
  )

  // 1. Weak topic that also has an assessment coming up - the highest-value thing to do.
  for (const a of assessments) {
    const d = daysUntil(a.due_date)
    const weak = mastery
      .filter((m) => m.subject_id === a.subject_id && m.pct !== null && m.pct < 75)
      .sort((x, y) => (x.pct ?? 0) - (y.pct ?? 0))[0]
    if (weak) {
      recs.push({
        kind: 'weak_with_assessment', subject_id: a.subject_id, subject: a.subject_name, color: a.subject_color,
        topic_id: weak.id, topic: weak.name, minutes: 30, action: 'practice',
        title: `Study ${a.subject_name} — ${weak.name}`,
        why: `You've scored ${weak.pct}% on this topic and have "${a.name}"${d !== null ? ` in ${d} day${d === 1 ? '' : 's'}` : ''}.`,
        urgency: d !== null ? Math.max(0, 100 - d * 4) + (75 - (weak.pct ?? 0)) : 40,
      })
    }
  }

  // 2. Flashcards that are actually due.
  const due = plainAll(
    db.prepare(
      `SELECT s.id subject_id, s.name subject_name, s.color, COUNT(*) n FROM flashcards f
       JOIN subjects s ON s.id=f.subject_id
       WHERE f.suspended=0 AND f.due_at <= datetime('now') GROUP BY f.subject_id ORDER BY n DESC`
    ).all()
  )
  for (const d of due.slice(0, 2)) {
    recs.push({
      kind: 'flashcards', subject_id: d.subject_id, subject: d.subject_name, color: d.color,
      topic: 'Due cards', minutes: Math.min(30, Math.max(5, Math.ceil(d.n / 3))), action: 'flashcards',
      title: `Review ${d.n} ${d.subject_name} flashcard${d.n === 1 ? '' : 's'}`,
      why: `${d.n} card${d.n === 1 ? ' is' : 's are'} due today — spaced repetition only works if you clear them.`,
      urgency: 60 + Math.min(30, d.n),
    })
  }

  // 3. Unresolved mistakes.
  const mistakes = plainAll(
    db.prepare(
      `SELECT s.id subject_id, s.name subject_name, s.color, COUNT(*) n FROM attempts a
       JOIN subjects s ON s.id=a.subject_id
       WHERE (a.correct = 0 OR (a.max_score > 0 AND (a.score*1.0/a.max_score) < 0.6)) AND a.reviewed=0
       GROUP BY a.subject_id ORDER BY n DESC LIMIT 2`
    ).all()
  )
  for (const m of mistakes) {
    recs.push({
      kind: 'mistakes', subject_id: m.subject_id, subject: m.subject_name, color: m.color,
      topic: 'My mistakes', minutes: 20, action: 'mistakes',
      title: `Redo ${m.n} ${m.subject_name} question${m.n === 1 ? '' : 's'} you got wrong`,
      why: `You have ${m.n} unresolved mistake${m.n === 1 ? '' : 's'} — re-answering them is the fastest way to lift your mark.`,
      urgency: 55 + Math.min(25, m.n * 2),
    })
  }

  // 4. What the class is doing right now.
  const school = plainAll(
    db.prepare(
      `SELECT t.*, s.name subject_name, s.color subject_color FROM topics t LEFT JOIN subjects s ON s.id=t.subject_id
       WHERE t.archived=0 AND t.scope='school' AND t.status IN ('studying','needs_revision')
       ORDER BY CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                t.assessment_date IS NULL, t.assessment_date LIMIT 3`
    ).all()
  )
  for (const t of school) {
    const d = daysUntil(t.assessment_date)
    recs.push({
      kind: 'school', subject_id: t.subject_id, subject: t.subject_name, color: t.subject_color,
      topic_id: t.id, topic: t.name, minutes: 25, action: 'practice',
      title: `Work on ${t.subject_name} — ${t.name}`,
      why: t.status === 'needs_revision'
        ? `You flagged this for revision${d !== null ? `, and the assessment is in ${d} day${d === 1 ? '' : 's'}` : ''}.`
        : `This is what your class is covering right now${d !== null ? `, assessed in ${d} day${d === 1 ? '' : 's'}` : ''}.`,
      urgency: (t.priority === 'high' ? 70 : 45) + (d !== null ? Math.max(0, 30 - d) : 0),
    })
  }

  // 5. Weakest topics overall.
  for (const m of mastery.filter((x) => x.pct !== null && x.pct < 70).sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0)).slice(0, 3)) {
    recs.push({
      kind: 'weak', subject_id: m.subject_id, subject: m.subject_name, color: m.subject_color,
      topic_id: m.id, topic: m.name, minutes: 25, action: 'practice',
      title: `Practise ${m.subject_name} — ${m.name}`,
      why: `Your weakest measured topic at ${m.pct}%, from ${m.attempts} question${m.attempts === 1 ? '' : 's'}.`,
      urgency: 50 + (70 - (m.pct ?? 0)),
    })
  }

  // 6. Syllabus points marked as needing revision.
  const revise = plainAll(
    db.prepare(
      `SELECT p.*, s.name subject_name, s.color subject_color, s.id subject_id FROM syllabus_points p
       LEFT JOIN subjects s ON s.id=p.subject_id WHERE p.status='needs_revision' LIMIT 3`
    ).all()
  )
  for (const p of revise) {
    recs.push({
      kind: 'syllabus', subject_id: p.subject_id, subject: p.subject_name, color: p.subject_color,
      topic: p.text.slice(0, 60), minutes: 20, action: 'practice',
      title: `Revise ${p.subject_name} — ${p.text.slice(0, 50)}`,
      why: 'You marked this syllabus point as needing revision.',
      urgency: 48,
    })
  }

  // Syllabus points already flagged as "currently studying" are a strong signal.
  if (recs.length < 3) {
    const studying = plainAll(
      db.prepare(
        `SELECT p.*, s.name subject_name, s.color subject_color, s.id subject_id FROM syllabus_points p
         LEFT JOIN subjects s ON s.id=p.subject_id WHERE p.status='studying' LIMIT 3`
      ).all()
    )
    for (const p of studying) {
      recs.push({
        kind: 'syllabus', subject_id: p.subject_id, subject: p.subject_name, color: p.subject_color,
        topic: p.text.slice(0, 60), minutes: 25, action: 'practice',
        title: `Practise ${p.subject_name} - ${p.text.slice(0, 50)}`,
        why: 'You marked this syllabus point as currently studying.', urgency: 44,
      })
    }
  }

  // Still thin? Point at the subjects that have material but no practice yet.
  if (recs.length < 3) {
    const untested = plainAll(
      db.prepare(
        `SELECT s.id, s.name, s.color,
           (SELECT COUNT(*) FROM uploads u WHERE u.subject_id=s.id) + (SELECT COUNT(*) FROM notes n WHERE n.subject_id=s.id) AS material,
           (SELECT COUNT(*) FROM attempts a WHERE a.subject_id=s.id) AS answered,
           (SELECT COUNT(*) FROM syllabus_points p WHERE p.subject_id=s.id) AS points
         FROM subjects s WHERE s.archived=0 ORDER BY material DESC LIMIT 4`
      ).all()
    )
    for (const u of untested) {
      if (u.material > 0 && u.answered === 0) {
        recs.push({
          kind: 'untested', subject_id: u.id, subject: u.name, color: u.color,
          topic: 'First practice', minutes: 20, action: 'practice',
          title: `Test yourself on ${u.name}`,
          why: `You have ${u.material} piece${u.material === 1 ? '' : 's'} of material here but haven't answered a question yet - practice is what starts your mastery tracking.`,
          urgency: 42,
        })
      } else if (u.points === 0) {
        recs.push({
          kind: 'setup', subject_id: u.id, subject: u.name, color: u.color,
          topic: 'Add syllabus', minutes: 10, action: 'syllabus',
          title: `Add your ${u.name} syllabus`,
          why: 'Syllabus points drive practice, flashcards and progress tracking for this subject.', urgency: 34,
        })
      } else if (u.material === 0) {
        recs.push({
          kind: 'setup', subject_id: u.id, subject: u.name, color: u.color,
          topic: 'Add school work', minutes: 10, action: 'upload',
          title: `Add some ${u.name} school work`,
          why: 'Photos, PDFs and notes become practice questions and flashcards.', urgency: 32,
        })
      }
    }
  }

  // Nothing at all yet - give a genuinely useful first step instead of an empty panel.
  if (!recs.length) {
    const anySubject: any = plain(db.prepare('SELECT * FROM subjects WHERE archived=0 ORDER BY position LIMIT 1').get())
    const hasMaterial: any = db.prepare('SELECT COUNT(*) n FROM uploads').get()
    const hasSyllabus: any = db.prepare('SELECT COUNT(*) n FROM syllabus_points').get()
    if (anySubject && !hasSyllabus?.n) {
      recs.push({
        kind: 'setup', subject_id: anySubject.id, subject: anySubject.name, color: anySubject.color,
        topic: 'Set up your syllabus', minutes: 10, action: 'syllabus',
        title: 'Add your syllabus so Study HQ knows what to teach you',
        why: 'Syllabus points drive practice, flashcards and progress tracking.', urgency: 30,
      })
    } else if (anySubject && !hasMaterial?.n) {
      recs.push({
        kind: 'setup', subject_id: anySubject.id, subject: anySubject.name, color: anySubject.color,
        topic: 'Add your school work', minutes: 10, action: 'upload',
        title: 'Add some school work to study from',
        why: 'Photos, PDFs and notes become practice questions and flashcards.', urgency: 30,
      })
    }
  }

  // Strongest first, one per subject+topic.
  const seen = new Set<string>()
  return recs
    .sort((a, b) => b.urgency - a.urgency)
    .filter((r) => {
      const key = `${r.subject_id}:${r.topic}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, limit)
}

extras.get('/recommendations', (req, res) => {
  res.json(buildRecommendations(Number(req.query.limit || 6)))
})
