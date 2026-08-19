import { Router } from 'express'
import { db, uid, plain, plainAll } from '../lib/db.js'
import {
  generateQuestions, generateFlashcards, markResponse, buildContext, aiConfigured, AiNotConfigured,
} from '../lib/ai.js'
import { localMathsQuestions, localQuestionsFromText, localFlashcards } from '../lib/local.js'
import { schedule, type Grade } from '../lib/srs.js'

export const study = Router()
const wrap = (fn: any) => (req: any, res: any, next: any) => Promise.resolve(fn(req, res, next)).catch(next)

const norm = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const AUTO_TYPES = new Set(['multiple_choice', 'true_false'])

function fingerprint(q: any) {
  return norm(String(q.prompt || '')).slice(0, 120)
}

/** Adaptive difficulty from the last 12 attempts in this subject/topic. */
function adaptiveDifficulty(subjectId?: string, topicId?: string) {
  const rows = plainAll(
    db
      .prepare(
        `SELECT score, max_score FROM attempts
         WHERE (? IS NULL OR subject_id=?) AND (? IS NULL OR topic_id=?) AND max_score > 0
         ORDER BY created_at DESC LIMIT 12`
      )
      .all(subjectId ?? null, subjectId ?? null, topicId ?? null, topicId ?? null)
  )
  if (rows.length < 3) return { difficulty: 'medium', accuracy: null as number | null, reason: 'Not enough history yet - starting at medium.' }
  const acc = rows.reduce((a, r) => a + r.score / r.max_score, 0) / rows.length
  if (acc >= 0.85) return { difficulty: 'hard', accuracy: acc, reason: `You are at ${Math.round(acc * 100)}% - stepping the difficulty up.` }
  if (acc < 0.5) return { difficulty: 'easy', accuracy: acc, reason: `You are at ${Math.round(acc * 100)}% - easing back to rebuild the basics.` }
  return { difficulty: 'medium', accuracy: acc, reason: `You are at ${Math.round(acc * 100)}% - holding at medium.` }
}

function insertQuestions(
  setId: string, subjectId: string | null, topicId: string | null, mode: string, origin: string,
  items: any[], skillId: string | null = null
) {
  const stmt = db.prepare(
    `INSERT INTO questions (id,set_id,subject_id,topic_id,skill_id,qtype,difficulty,prompt,stimulus,options,answer,
      marking_guide,marks,working,mode,origin,fingerprint,position) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  )
  const max: any = db.prepare('SELECT COALESCE(MAX(position),-1) p FROM questions WHERE set_id=?').get(setId)
  let pos = (max?.p ?? -1) + 1
  const ids: string[] = []
  for (const q of items) {
    if (!q?.prompt) continue
    const id = uid('q')
    stmt.run(
      id, setId, subjectId, topicId, skillId, q.qtype || 'short_answer', q.difficulty || 'medium',
      String(q.prompt), String(q.stimulus || ''), JSON.stringify(q.options || []), String(q.answer || ''),
      String(q.marking_guide || ''), Number(q.marks || 1), String(q.working || ''), mode, origin,
      fingerprint(q), pos++
    )
    ids.push(id)
  }
  return plainAll(db.prepare(`SELECT * FROM questions WHERE id IN (${ids.map(() => '?').join(',') || "''"})`).all(...ids))
    .sort((a, b) => a.position - b.position)
}

/* ---------------- practice sets ---------------- */

study.get('/practice/sets', (req, res) => {
  const { subject_id } = req.query as any
  const rows = plainAll(
    db
      .prepare(
        `SELECT p.*, s.name AS subject_name, s.color AS subject_color,
          (SELECT COUNT(*) FROM questions q WHERE q.set_id = p.id) AS question_count,
          (SELECT COUNT(*) FROM attempts a JOIN questions q2 ON q2.id=a.question_id WHERE q2.set_id = p.id) AS attempt_count
         FROM practice_sets p LEFT JOIN subjects s ON s.id=p.subject_id
         WHERE (? IS NULL OR p.subject_id=?) AND p.kind != 'exam' ORDER BY p.created_at DESC LIMIT 200`
      )
      .all(subject_id ?? null, subject_id ?? null)
  )
  res.json(rows)
})

study.get('/practice/sets/:id', (req, res) => {
  const set = plain(db.prepare('SELECT * FROM practice_sets WHERE id=?').get(req.params.id))
  if (!set) return res.status(404).json({ error: 'Practice set not found' })
  const questions = plainAll(db.prepare('SELECT * FROM questions WHERE set_id=? ORDER BY position').all(req.params.id))
  const attempts = plainAll(
    db.prepare(`SELECT a.* FROM attempts a JOIN questions q ON q.id=a.question_id WHERE q.set_id=? ORDER BY a.created_at`).all(req.params.id)
  )
  res.json({ set, questions: questions.map((q) => ({ ...q, options: safeArr(q.options) })), attempts })
})

function safeArr(s: any) { try { const v = JSON.parse(s); return Array.isArray(v) ? v : [] } catch { return [] } }

study.put('/practice/sets/:id', (req, res) => {
  const cur: any = plain(db.prepare('SELECT * FROM practice_sets WHERE id=?').get(req.params.id))
  if (!cur) return res.status(404).json({ error: 'Not found' })
  db.prepare('UPDATE practice_sets SET name=? WHERE id=?').run(req.body?.name ?? cur.name, req.params.id)
  res.json(plain(db.prepare('SELECT * FROM practice_sets WHERE id=?').get(req.params.id)))
})

study.delete('/practice/sets/:id', (req, res) => {
  db.prepare('DELETE FROM practice_sets WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

study.post('/practice/sets/:id/duplicate', (req, res) => {
  const cur: any = plain(db.prepare('SELECT * FROM practice_sets WHERE id=?').get(req.params.id))
  if (!cur) return res.status(404).json({ error: 'Not found' })
  const id = uid('set')
  db.prepare('INSERT INTO practice_sets (id,subject_id,topic_id,name,mode,kind,config) VALUES (?,?,?,?,?,?,?)').run(
    id, cur.subject_id, cur.topic_id, `${cur.name} (copy)`, cur.mode, cur.kind, cur.config
  )
  const qs = plainAll(db.prepare('SELECT * FROM questions WHERE set_id=? ORDER BY position').all(cur.id))
  insertQuestions(id, cur.subject_id, cur.topic_id, cur.mode, 'copy', qs.map((q) => ({ ...q, options: safeArr(q.options) })))
  res.json(plain(db.prepare('SELECT * FROM practice_sets WHERE id=?').get(id)))
})

/**
 * Generate practice questions.
 * mode: my_material | hsc      difficulty: easy | medium | hard | exam | adaptive
 * Falls back to offline generators when no API key is configured.
 */
study.post('/practice/generate', wrap(async (req: any, res: any) => {
  const b = req.body || {}
  const subjectId = b.subject_id || null
  const topicId = b.topic_id || null
  const count = Math.min(Math.max(Number(b.count || 5), 1), 20)
  const mode = b.mode === 'hsc' ? 'hsc' : 'my_material'
  const subject: any = subjectId ? plain(db.prepare('SELECT * FROM subjects WHERE id=?').get(subjectId)) : null

  let difficulty = b.difficulty || 'medium'
  let adaptiveNote = ''
  if (difficulty === 'adaptive') {
    const a = adaptiveDifficulty(subjectId, topicId)
    difficulty = a.difficulty
    adaptiveNote = a.reason
  }

  // Reuse an existing set (infinite practice appends to it) or create one.
  let setId: string = b.set_id
  if (!setId) {
    setId = uid('set')
    const topic: any = topicId ? plain(db.prepare('SELECT name FROM topics WHERE id=?').get(topicId)) : null
    db.prepare('INSERT INTO practice_sets (id,subject_id,topic_id,name,mode,kind,config) VALUES (?,?,?,?,?,?,?)').run(
      setId, subjectId, topicId,
      b.name || `${subject?.name || 'Practice'}${topic ? ' - ' + topic.name : ''}`,
      mode, b.infinite ? 'infinite' : 'set', JSON.stringify({ ...b, difficulty })
    )
  }

  const asked = plainAll(db.prepare('SELECT prompt FROM questions WHERE set_id=? ORDER BY position DESC LIMIT 40').all(setId))
    .map((r) => r.prompt)

  let items: any[] = []
  let origin = 'ai'
  let notice = adaptiveNote

  if (aiConfigured()) {
    const r = await generateQuestions({
      subjectId, topicId, mode, qtype: b.qtype || 'mixed', difficulty, count,
      sourceUploadIds: b.source_upload_ids, avoid: asked, extraInstructions: b.instructions,
    })
    items = r.questions
  } else {
    origin = 'local'
    if (subject?.kind === 'maths') {
      items = localMathsQuestions(count, difficulty)
      notice = `Offline generator (no ANTHROPIC_API_KEY set): randomised Mathematics Standard questions with full working. ${adaptiveNote}`
    } else {
      const ctx = buildContext({ subjectId, topicId, sourceUploadIds: b.source_upload_ids, charBudget: 40000 })
      items = localQuestionsFromText(ctx.text, count, difficulty)
      if (!items.length) throw new AiNotConfigured()
      notice = `Offline generator (no ANTHROPIC_API_KEY set): recall questions built directly from your own notes. ${adaptiveNote}`
    }
  }

  const saved = insertQuestions(setId, subjectId, topicId, mode, origin, items, b.skill_id || null)
  if (!saved.length) return res.status(502).json({ error: 'The generator returned no usable questions. Try again or reduce the count.' })
  res.json({
    set_id: setId, difficulty, notice, origin,
    questions: saved.map((q) => ({ ...q, options: safeArr(q.options) })),
  })
}))

/** Save a question the student wrote themselves (e.g. a past paper or teacher question) so it can be answered and marked. */
study.post('/practice/custom-question', (req, res) => {
  const b = req.body || {}
  if (!b.subject_id || !String(b.prompt || '').trim())
    return res.status(400).json({ error: 'subject_id and prompt are required' })
  const subject: any = plain(db.prepare('SELECT * FROM subjects WHERE id=?').get(b.subject_id))
  const setId = uid('set')
  db.prepare('INSERT INTO practice_sets (id,subject_id,topic_id,name,mode,kind,config) VALUES (?,?,?,?,?,?,?)').run(
    setId, b.subject_id, b.topic_id || null, b.name || `My own question - ${subject?.name || ''}`.trim(),
    'my_material', 'set', JSON.stringify({ own: true })
  )
  const saved = insertQuestions(setId, b.subject_id, b.topic_id || null, 'my_material', 'student', [
    {
      qtype: b.qtype || 'extended_response',
      difficulty: 'exam',
      prompt: b.prompt,
      stimulus: b.stimulus || '',
      options: [],
      answer: b.answer || '',
      marking_guide: b.marking_guide || 'Mark against the standard NSW HSC criteria for this question type and mark value.',
      marks: Number(b.marks || 10),
    },
  ])
  res.json({ set_id: setId, questions: saved.map((q) => ({ ...q, options: safeArr(q.options) })) })
})

/* ---------------- attempts + marking ---------------- */

study.post('/attempts', wrap(async (req: any, res: any) => {
  const b = req.body || {}
  const q: any = plain(db.prepare('SELECT * FROM questions WHERE id=?').get(b.question_id))
  if (!q) return res.status(404).json({ error: 'Question not found' })
  const response = String(b.response ?? '')
  const subject: any = q.subject_id ? plain(db.prepare('SELECT * FROM subjects WHERE id=?').get(q.subject_id)) : null

  let score = 0, maxScore = Number(q.marks || 1), correct: number | null = null
  let feedback = '', improvement = '', gradedBy = 'auto'

  if (AUTO_TYPES.has(q.qtype)) {
    const ok = norm(response) === norm(q.answer)
    correct = ok ? 1 : 0
    score = ok ? maxScore : 0
    feedback = ok ? 'Correct.' : `Not quite - the correct answer is: ${q.answer}`
    improvement = ok ? '' : q.working || q.marking_guide || ''
  } else if (aiConfigured() && response.trim()) {
    try {
      const ctx = buildContext({ subjectId: q.subject_id, topicId: q.topic_id, charBudget: 15000 })
      const marked = await markResponse({
        question: q, response, subjectKind: subject?.kind || 'generic', contextText: ctx.text,
      })
      score = Math.max(0, Math.min(Number(marked.score ?? 0), maxScore))
      maxScore = Number(marked.max_score || maxScore)
      correct = marked.correct === true ? 1 : marked.correct === false ? 0 : null
      feedback = String(marked.feedback || '')
      improvement = String(marked.improvement || '')
      gradedBy = 'ai'
    } catch (err: any) {
      // Never lose the student's answer because marking failed.
      feedback = `Could not mark automatically: ${err?.message || err}`
      improvement = q.marking_guide || ''
      gradedBy = 'self'
      maxScore = 0
    }
  } else {
    const ok = response.trim() && norm(response).includes(norm(q.answer).slice(0, 40))
    correct = ok ? 1 : null
    score = ok ? maxScore : 0
    feedback = response.trim()
      ? 'Marked offline by keyword match - compare your answer with the model answer below and self-mark.'
      : 'No response given.'
    improvement = q.working || q.marking_guide || ''
    gradedBy = 'self'
    if (!ok) maxScore = 0 // do not count an unmarked answer against mastery
  }

  const id = uid('att')
  db.prepare(
    `INSERT INTO attempts (id,question_id,exam_id,subject_id,topic_id,skill_id,response,correct,score,max_score,feedback,
      improvement,graded_by,duration_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(id, q.id, b.exam_id || null, q.subject_id, q.topic_id, q.skill_id || null, response, correct, score, maxScore,
        feedback, improvement, gradedBy, Number(b.duration_ms || 0))

  logStudy(q.subject_id, Number(b.duration_ms || 0) / 60000, 'practice')

  res.json({
    ...plain(db.prepare('SELECT * FROM attempts WHERE id=?').get(id)),
    model_answer: q.answer, working: q.working, marking_guide: q.marking_guide,
  })
}))

/** Self-mark an answer that could not be auto-marked, so it counts toward mastery and mistakes. */
study.put('/attempts/:id/self-mark', (req, res) => {
  const a: any = plain(db.prepare('SELECT * FROM attempts WHERE id=?').get(req.params.id))
  if (!a) return res.status(404).json({ error: 'Attempt not found' })
  const q: any = plain(db.prepare('SELECT marks FROM questions WHERE id=?').get(a.question_id))
  const marks = Number(q?.marks || 1)
  const correct = req.body?.correct ? 1 : 0
  const partial = req.body?.score
  const score = partial != null ? Math.max(0, Math.min(Number(partial), marks)) : correct ? marks : 0
  db.prepare(`UPDATE attempts SET correct=?, score=?, max_score=?, graded_by='self' WHERE id=?`)
    .run(correct, score, marks, req.params.id)
  res.json(plain(db.prepare('SELECT * FROM attempts WHERE id=?').get(req.params.id)))
})

export function logStudy(subjectId: string | null, minutes: number, activity: string) {
  if (!minutes || minutes <= 0) return
  const day = new Date().toISOString().slice(0, 10)
  db.prepare('INSERT INTO study_log (id,day,subject_id,minutes,activity) VALUES (?,?,?,?,?)').run(
    uid('log'), day, subjectId, Math.min(minutes, 240), activity
  )
}

study.post('/study-log', (req, res) => {
  logStudy(req.body?.subject_id || null, Number(req.body?.minutes || 0), req.body?.activity || 'study')
  res.json({ ok: true })
})

/* ---------------- flashcards ---------------- */

study.get('/flashcards', (req, res) => {
  const { subject_id, topic_id, due, limit } = req.query as any
  const rows = plainAll(
    db
      .prepare(
        `SELECT f.*, s.name AS subject_name, s.color AS subject_color, t.name AS topic_name
         FROM flashcards f LEFT JOIN subjects s ON s.id=f.subject_id LEFT JOIN topics t ON t.id=f.topic_id
         WHERE (? IS NULL OR f.subject_id=?) AND (? IS NULL OR f.topic_id=?) AND f.suspended=0
           AND (? != 'true' OR f.due_at <= datetime('now'))
         ORDER BY ${due === 'true' ? 'f.due_at' : 'f.created_at DESC'} LIMIT ?`
      )
      .all(subject_id ?? null, subject_id ?? null, topic_id ?? null, topic_id ?? null, due ?? 'false', Number(limit || 500))
  )
  res.json(rows)
})

study.get('/flashcards/stats', (_req, res) => {
  const due: any = db.prepare(`SELECT COUNT(*) n FROM flashcards WHERE suspended=0 AND due_at <= datetime('now')`).get()
  const total: any = db.prepare('SELECT COUNT(*) n FROM flashcards WHERE suspended=0').get()
  const mastered: any = db.prepare('SELECT COUNT(*) n FROM flashcards WHERE suspended=0 AND interval_days >= 21').get()
  res.json({ due: due?.n ?? 0, total: total?.n ?? 0, mastered: mastered?.n ?? 0 })
})

study.post('/flashcards', (req, res) => {
  const b = req.body || {}
  if (!b.subject_id || !b.front?.trim() || !b.back?.trim())
    return res.status(400).json({ error: 'subject_id, front and back are required' })
  const id = uid('card')
  db.prepare(
    `INSERT INTO flashcards (id,subject_id,topic_id,card_kind,front,back,extra,origin,source_upload_id)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(id, b.subject_id, b.topic_id || null, b.card_kind || 'basic', b.front.trim(), b.back.trim(),
        b.extra || '', b.origin || 'manual', b.source_upload_id || null)
  res.status(201).json(plain(db.prepare('SELECT * FROM flashcards WHERE id=?').get(id)))
})

study.put('/flashcards/:id', (req, res) => {
  const cur: any = plain(db.prepare('SELECT * FROM flashcards WHERE id=?').get(req.params.id))
  if (!cur) return res.status(404).json({ error: 'Card not found' })
  const b = req.body || {}
  db.prepare('UPDATE flashcards SET front=?, back=?, extra=?, topic_id=?, card_kind=?, suspended=? WHERE id=?').run(
    b.front ?? cur.front, b.back ?? cur.back, b.extra ?? cur.extra,
    b.topic_id === undefined ? cur.topic_id : b.topic_id || null,
    b.card_kind ?? cur.card_kind, b.suspended === undefined ? cur.suspended : b.suspended ? 1 : 0, req.params.id
  )
  res.json(plain(db.prepare('SELECT * FROM flashcards WHERE id=?').get(req.params.id)))
})

study.delete('/flashcards/:id', (req, res) => {
  db.prepare('DELETE FROM flashcards WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

/** Grade a card: again | hard | good | easy */
study.post('/flashcards/:id/review', (req, res) => {
  const cur: any = plain(db.prepare('SELECT * FROM flashcards WHERE id=?').get(req.params.id))
  if (!cur) return res.status(404).json({ error: 'Card not found' })
  const grade = String(req.body?.grade || 'good') as Grade
  const next = schedule(cur, grade)
  db.prepare('UPDATE flashcards SET interval_days=?, ease=?, reps=?, lapses=?, due_at=?, last_grade=? WHERE id=?').run(
    next.interval_days, next.ease, next.reps, next.lapses, next.due_at, grade, req.params.id
  )
  logStudy(cur.subject_id, Number(req.body?.seconds || 0) / 60, 'flashcards')
  res.json({ ...plain(db.prepare('SELECT * FROM flashcards WHERE id=?').get(req.params.id)), next_interval_days: next.interval_days })
})

study.post('/flashcards/generate', wrap(async (req: any, res: any) => {
  const b = req.body || {}
  if (!b.subject_id) return res.status(400).json({ error: 'subject_id required' })
  const count = Math.min(Math.max(Number(b.count || 10), 1), 100)
  let cards: any[] = []
  let origin = 'ai'
  let notice = ''

  if (aiConfigured()) {
    cards = await generateFlashcards({
      subjectId: b.subject_id, topicId: b.topic_id, count,
      sourceUploadIds: b.source_upload_ids, cardKind: b.card_kind, mode: b.mode,
    })
  } else {
    origin = 'local'
    const ctx = buildContext({ subjectId: b.subject_id, topicId: b.topic_id, sourceUploadIds: b.source_upload_ids })
    cards = localFlashcards(ctx.text, count)
    if (!cards.length) throw new AiNotConfigured()
    notice = 'Offline generator (no ANTHROPIC_API_KEY set): cards built from definition-style lines in your own material.'
  }

  const stmt = db.prepare(
    `INSERT INTO flashcards (id,subject_id,topic_id,card_kind,front,back,extra,origin,source_upload_id)
     VALUES (?,?,?,?,?,?,?,?,?)`
  )
  const ids: string[] = []
  for (const c of cards) {
    if (!c?.front || !c?.back) continue
    const id = uid('card')
    stmt.run(id, b.subject_id, b.topic_id || null, c.card_kind || b.card_kind || 'basic',
             String(c.front), String(c.back), String(c.extra || ''), origin,
             b.source_upload_ids?.[0] || null)
    ids.push(id)
  }
  if (!ids.length) return res.status(502).json({ error: 'No usable flashcards were produced. Try a different topic or source.' })
  res.json({
    created: ids.length, notice, origin,
    cards: plainAll(db.prepare(`SELECT * FROM flashcards WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids)),
  })
}))

/* ---------------- exams ---------------- */

study.get('/exams', (req, res) => {
  const { subject_id } = req.query as any
  res.json(
    plainAll(
      db
        .prepare(
          `SELECT e.*, s.name AS subject_name, s.color AS subject_color FROM exams e
           LEFT JOIN subjects s ON s.id=e.subject_id WHERE (? IS NULL OR e.subject_id=?)
           ORDER BY e.started_at DESC LIMIT 100`
        )
        .all(subject_id ?? null, subject_id ?? null)
    )
  )
})

study.get('/exams/:id', (req, res) => {
  const exam: any = plain(db.prepare('SELECT * FROM exams WHERE id=?').get(req.params.id))
  if (!exam) return res.status(404).json({ error: 'Exam not found' })
  const questions = plainAll(db.prepare('SELECT * FROM questions WHERE set_id=? ORDER BY position').all(exam.set_id))
  const attempts = plainAll(db.prepare('SELECT * FROM attempts WHERE exam_id=?').all(exam.id))
  res.json({
    exam: { ...exam, config: JSON.parse(exam.config || '{}'), breakdown: JSON.parse(exam.breakdown || '{}') },
    questions: questions.map((q) => ({ ...q, options: safeArr(q.options) })),
    attempts,
  })
})

/** Build an exam paper: mixed question types scaled to the requested length. */
study.post('/exams/generate', wrap(async (req: any, res: any) => {
  const b = req.body || {}
  if (!b.subject_id) return res.status(400).json({ error: 'Choose a subject for the exam.' })
  const subject: any = plain(db.prepare('SELECT * FROM subjects WHERE id=?').get(b.subject_id))
  const count = Math.min(Math.max(Number(b.count || 8), 1), 25)
  const duration = Math.min(Math.max(Number(b.duration_min || 40), 5), 240)
  const mode = b.mode === 'my_material' ? 'my_material' : 'hsc'
  const topicIds: string[] = b.topic_ids || []
  const qtypes: string[] = Array.isArray(b.qtypes) ? b.qtypes : []
  const totalMarks = Math.min(Math.max(Number(b.total_marks || Math.round(duration * 1.2)), 5), 120)

  const setId = uid('set')
  db.prepare('INSERT INTO practice_sets (id,subject_id,topic_id,name,mode,kind,config) VALUES (?,?,?,?,?,?,?)').run(
    setId, b.subject_id, topicIds[0] || null, b.name || `${subject?.name || 'Subject'} exam`, mode, 'exam', JSON.stringify(b)
  )

  const topicNames = topicIds.length
    ? plainAll(db.prepare(`SELECT name FROM topics WHERE id IN (${topicIds.map(() => '?').join(',')})`).all(...topicIds)).map((t) => t.name)
    : []

  let items: any[] = []
  let origin = 'ai'
  let notice = ''
  if (aiConfigured()) {
    const r = await generateQuestions({
      subjectId: b.subject_id, topicId: topicIds[0] || undefined, mode,
      qtype: 'mixed', difficulty: b.difficulty || 'exam', count,
      extraInstructions:
        `Build a complete exam paper worth ${totalMarks} marks in total over ${duration} minutes. ` +
        `Order it as an HSC paper: Section I multiple choice (1 mark each), then Section II short answer, ` +
        `then Section III extended response/essay last. ` +
        (qtypes.length ? `Use only these question types: ${qtypes.join(', ')}. ` : '') +
        (topicNames.length ? `Restrict content to these topics: ${topicNames.join('; ')}. ` : '') +
        `The marks across all questions must add up to about ${totalMarks}. Every question needs a marking guide.`,
    })
    items = r.questions
  } else {
    origin = 'local'
    if (subject?.kind === 'maths') {
      items = localMathsQuestions(count, b.difficulty || 'exam')
      notice = 'Offline exam (no ANTHROPIC_API_KEY set): randomised Mathematics Standard questions.'
    } else {
      const ctx = buildContext({ subjectId: b.subject_id, topicId: topicIds[0] })
      items = localQuestionsFromText(ctx.text, count, b.difficulty || 'exam')
      if (!items.length) throw new AiNotConfigured()
      notice = 'Offline exam (no ANTHROPIC_API_KEY set): recall questions from your own material.'
    }
  }

  const saved = insertQuestions(setId, b.subject_id, topicIds[0] || null, mode, origin, items)
  if (!saved.length) return res.status(502).json({ error: 'Exam generation returned no questions. Try again.' })

  const examId = uid('exam')
  const maxScore = saved.reduce((a, q) => a + Number(q.marks || 1), 0)
  db.prepare(
    'INSERT INTO exams (id,subject_id,set_id,name,duration_min,config,status,max_score) VALUES (?,?,?,?,?,?,?,?)'
  ).run(examId, b.subject_id, setId, b.name || `${subject?.name || 'Subject'} exam`, duration, JSON.stringify(b), 'in_progress', maxScore)

  res.json({
    exam_id: examId, notice, origin,
    exam: plain(db.prepare('SELECT * FROM exams WHERE id=?').get(examId)),
    questions: saved.map((q) => ({ ...q, options: safeArr(q.options) })),
  })
}))

/** Submit an exam: mark everything, score it, and recommend what to study next. */
study.post('/exams/:id/submit', wrap(async (req: any, res: any) => {
  const exam: any = plain(db.prepare('SELECT * FROM exams WHERE id=?').get(req.params.id))
  if (!exam) return res.status(404).json({ error: 'Exam not found' })
  const responses: Record<string, string> = req.body?.responses || {}
  const questions = plainAll(db.prepare('SELECT * FROM questions WHERE set_id=? ORDER BY position').all(exam.set_id))
  const subject: any = plain(db.prepare('SELECT * FROM subjects WHERE id=?').get(exam.subject_id))

  let total = 0, maxTotal = 0
  // Marks we could not mark automatically (long responses with no AI available).
  // They are excluded from the score rather than counted as zero, which would
  // misrepresent the result and drag topic mastery down unfairly.
  let unmarkedMarks = 0
  const perTopic: Record<string, { score: number; max: number; name: string }> = {}
  const results: any[] = []

  for (const q of questions) {
    const response = String(responses[q.id] ?? '')
    let score = 0, maxScore = Number(q.marks || 1), correct: number | null = null
    let feedback = '', improvement = '', gradedBy = 'auto'

    if (AUTO_TYPES.has(q.qtype)) {
      const ok = norm(response) === norm(q.answer)
      correct = ok ? 1 : 0
      score = ok ? maxScore : 0
      feedback = ok ? 'Correct.' : `Correct answer: ${q.answer}`
    } else if (aiConfigured() && response.trim()) {
      try {
        const marked = await markResponse({ question: q, response, subjectKind: subject?.kind || 'generic' })
        score = Math.max(0, Math.min(Number(marked.score ?? 0), maxScore))
        correct = marked.correct === true ? 1 : marked.correct === false ? 0 : null
        feedback = String(marked.feedback || '')
        improvement = String(marked.improvement || '')
        gradedBy = 'ai'
      } catch (err: any) {
        feedback = `Not marked automatically: ${err?.message || err}`
        gradedBy = 'self'
      }
    } else {
      feedback = response.trim()
        ? 'Not auto-marked (AI is off) - self-mark this against the model answer below.'
        : 'No response given.'
      gradedBy = 'self'
      unmarkedMarks += maxScore
      maxScore = 0
    }

    total += score
    maxTotal += maxScore
    const key = q.topic_id || 'general'
    const tname = q.topic_id
      ? ((plain(db.prepare('SELECT name FROM topics WHERE id=?').get(q.topic_id)) as any)?.name ?? 'General')
      : 'General'
    perTopic[key] = perTopic[key] || { score: 0, max: 0, name: tname }
    perTopic[key].score += score
    perTopic[key].max += maxScore

    db.prepare(
      `INSERT INTO attempts (id,question_id,exam_id,subject_id,topic_id,response,correct,score,max_score,feedback,improvement,graded_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(uid('att'), q.id, exam.id, q.subject_id, q.topic_id, response, correct, score, maxScore, feedback, improvement, gradedBy)

    results.push({ question_id: q.id, score, max_score: maxScore, correct, feedback, improvement, model_answer: q.answer, working: q.working })
  }

  const weak = Object.values(perTopic)
    .filter((t) => t.max > 0)
    .sort((a, b) => a.score / a.max - b.score / b.max)
    .slice(0, 3)

  const selfMarkNote = unmarkedMarks
    ? ` ${unmarkedMarks} mark${unmarkedMarks === 1 ? '' : 's'} could not be marked automatically - check those answers against the model answers yourself.`
    : ''
  const recommendations =
    (weak.length
      ? `Focus next on: ${weak.map((w) => `${w.name} (${Math.round((w.score / w.max) * 100)}%)`).join(', ')}. ` +
        `Run adaptive practice on the weakest topic, then re-sit a short exam in a few days.`
      : maxTotal
        ? 'Solid across the board - keep the flashcard reviews going and step up the difficulty.'
        : 'Nothing could be auto-marked. Mark your answers against the model answers, or turn on AI marking for full feedback.') + selfMarkNote

  db.prepare(
    `UPDATE exams SET status='submitted', submitted_at=datetime('now'), score=?, max_score=?, breakdown=?, recommendations=? WHERE id=?`
  ).run(total, maxTotal, JSON.stringify({ topics: perTopic, unmarked_marks: unmarkedMarks }), recommendations, exam.id)

  logStudy(exam.subject_id, Number(req.body?.minutes_taken || exam.duration_min || 0), 'exam')

  res.json({
    score: total, max_score: maxTotal,
    percent: maxTotal ? Math.round((total / maxTotal) * 100) : null,
    unmarked_marks: unmarkedMarks,
    breakdown: perTopic, recommendations, results,
  })
}))

study.delete('/exams/:id', (req, res) => {
  const exam: any = plain(db.prepare('SELECT * FROM exams WHERE id=?').get(req.params.id))
  if (exam?.set_id) db.prepare('DELETE FROM practice_sets WHERE id=?').run(exam.set_id)
  db.prepare('DELETE FROM exams WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})
