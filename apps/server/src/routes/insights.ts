import { Router } from 'express'
import { db, uid, plain, plainAll } from '../lib/db.js'
import { generateStudyPlan, aiConfigured } from '../lib/ai.js'

export const insights = Router()
const wrap = (fn: any) => (req: any, res: any, next: any) => Promise.resolve(fn(req, res, next)).catch(next)

/* ---------------- mastery ---------------- */

/** Mastery per topic: accuracy on attempts, nudged by flashcard maturity. */
export function topicMastery(subjectId?: string) {
  const rows = plainAll(
    db
      .prepare(
        `SELECT t.id, t.name, t.subject_id, s.name AS subject_name, s.color AS subject_color, t.status,
           COALESCE(SUM(a.score),0) AS score, COALESCE(SUM(a.max_score),0) AS max_score, COUNT(a.id) AS attempts
         FROM topics t
         LEFT JOIN attempts a ON a.topic_id = t.id
         LEFT JOIN subjects s ON s.id = t.subject_id
         WHERE t.archived = 0 AND (? IS NULL OR t.subject_id = ?)
         GROUP BY t.id ORDER BY t.position`
      )
      .all(subjectId ?? null, subjectId ?? null)
  )
  return rows.map((r) => {
    const cards: any = db
      .prepare('SELECT COUNT(*) n, AVG(interval_days) avg_int FROM flashcards WHERE topic_id=? AND suspended=0')
      .get(r.id)
    const accuracy = r.max_score > 0 ? r.score / r.max_score : null
    const cardScore = cards?.n ? Math.min(1, (cards.avg_int || 0) / 21) : null
    let mastery: number | null = null
    if (accuracy !== null && cardScore !== null) mastery = accuracy * 0.75 + cardScore * 0.25
    else if (accuracy !== null) mastery = accuracy
    else if (cardScore !== null) mastery = cardScore * 0.6
    return {
      ...r,
      accuracy: accuracy === null ? null : Math.round(accuracy * 100),
      mastery: mastery === null ? null : Math.round(mastery * 100),
      cards: cards?.n ?? 0,
    }
  })
}

insights.get('/mastery', (req, res) => {
  res.json(topicMastery((req.query.subject_id as string) || undefined))
})

/* ---------------- streak + study time ---------------- */

function streakDays() {
  const days = plainAll(
    db
      .prepare(
        `SELECT DISTINCT day FROM (
           SELECT day FROM study_log
           UNION SELECT date(created_at) AS day FROM attempts
         ) ORDER BY day DESC LIMIT 400`
      )
      .all()
  ).map((r) => r.day)
  if (!days.length) return { current: 0, longest: 0, days: [] as string[] }

  const set = new Set(days)
  const today = new Date()
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  let current = 0
  const cursor = new Date(today)
  // A streak survives "not yet studied today" until the day ends.
  if (!set.has(iso(cursor))) cursor.setDate(cursor.getDate() - 1)
  while (set.has(iso(cursor))) { current++; cursor.setDate(cursor.getDate() - 1) }

  let longest = 0, run = 0
  let prev: Date | null = null
  for (const d of [...days].sort()) {
    const cur = new Date(d + 'T00:00:00Z')
    if (prev && (cur.getTime() - prev.getTime()) / 86400000 === 1) run++
    else run = 1
    longest = Math.max(longest, run)
    prev = cur
  }
  return { current, longest, days }
}

insights.get('/progress/overview', (req, res) => {
  const subjectId = (req.query.subject_id as string) || null

  const attempts: any = db
    .prepare('SELECT COUNT(*) n, COALESCE(SUM(score),0) s, COALESCE(SUM(max_score),0) m FROM attempts WHERE (? IS NULL OR subject_id=?)')
    .get(subjectId, subjectId)
  const syllabus: any = db
    .prepare(`SELECT COUNT(*) n, SUM(status='completed') done, SUM(status='needs_revision') revise, SUM(status='studying') studying
              FROM syllabus_points WHERE (? IS NULL OR subject_id=?)`)
    .get(subjectId, subjectId)
  const topics: any = db
    .prepare(`SELECT COUNT(*) n, SUM(status='completed') done, SUM(status='needs_revision') revise
              FROM topics WHERE archived=0 AND (? IS NULL OR subject_id=?)`)
    .get(subjectId, subjectId)
  const cards: any = db
    .prepare(`SELECT COUNT(*) n, SUM(interval_days >= 21) mastered, SUM(due_at <= datetime('now')) due
              FROM flashcards WHERE suspended=0 AND (? IS NULL OR subject_id=?)`)
    .get(subjectId, subjectId)
  const time: any = db
    .prepare('SELECT COALESCE(SUM(minutes),0) m FROM study_log WHERE (? IS NULL OR subject_id=?)')
    .get(subjectId, subjectId)
  const exams = plainAll(
    db
      .prepare(
        `SELECT e.id, e.name, e.score, e.max_score, e.submitted_at, s.name AS subject_name FROM exams e
         LEFT JOIN subjects s ON s.id=e.subject_id
         WHERE e.status='submitted' AND (? IS NULL OR e.subject_id=?) ORDER BY e.submitted_at DESC LIMIT 20`
      )
      .all(subjectId, subjectId)
  )

  // Accuracy over time (14 day rolling), for the improvement chart.
  const daily = plainAll(
    db
      .prepare(
        `SELECT date(created_at) day, COALESCE(SUM(score),0) s, COALESCE(SUM(max_score),0) m, COUNT(*) n
         FROM attempts WHERE (? IS NULL OR subject_id=?) GROUP BY day ORDER BY day DESC LIMIT 60`
      )
      .all(subjectId, subjectId)
  )
    .reverse()
    .map((d) => ({ day: d.day, accuracy: d.m ? Math.round((d.s / d.m) * 100) : null, questions: d.n }))

  const minutesDaily = plainAll(
    db
      .prepare(`SELECT day, ROUND(SUM(minutes)) minutes FROM study_log WHERE (? IS NULL OR subject_id=?) GROUP BY day ORDER BY day DESC LIMIT 60`)
      .all(subjectId, subjectId)
  ).reverse()

  const mastery = topicMastery(subjectId || undefined)
  const scored = mastery.filter((m) => m.mastery !== null)

  res.json({
    questions_completed: attempts?.n ?? 0,
    accuracy: attempts?.m ? Math.round((attempts.s / attempts.m) * 100) : null,
    overall_mastery: scored.length ? Math.round(scored.reduce((a, m) => a + (m.mastery ?? 0), 0) / scored.length) : null,
    syllabus: {
      total: syllabus?.n ?? 0, completed: syllabus?.done ?? 0,
      studying: syllabus?.studying ?? 0, needs_revision: syllabus?.revise ?? 0,
      percent: syllabus?.n ? Math.round(((syllabus.done ?? 0) / syllabus.n) * 100) : 0,
    },
    topics: { total: topics?.n ?? 0, completed: topics?.done ?? 0, needs_revision: topics?.revise ?? 0 },
    flashcards: { total: cards?.n ?? 0, mastered: cards?.mastered ?? 0, due: cards?.due ?? 0 },
    study_minutes: Math.round(time?.m ?? 0),
    streak: streakDays(),
    exams,
    daily,
    minutes_daily: minutesDaily,
    mastery,
    weakest: [...scored].sort((a, b) => (a.mastery ?? 0) - (b.mastery ?? 0)).slice(0, 6),
  })
})

/* ---------------- dashboard ---------------- */

insights.get('/dashboard', (_req, res) => {
  const profile = plain(db.prepare('SELECT * FROM profile WHERE id=1').get())
  const subjects = plainAll(db.prepare('SELECT * FROM subjects WHERE archived=0 ORDER BY position').all())
  const attempts: any = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(score),0) s, COALESCE(SUM(max_score),0) m FROM attempts').get()
  const due: any = db.prepare(`SELECT COUNT(*) n FROM flashcards WHERE suspended=0 AND due_at <= datetime('now')`).get()
  const syllabus: any = db.prepare(`SELECT COUNT(*) n, SUM(status='completed') done FROM syllabus_points`).get()
  const todayMinutes: any = db.prepare(`SELECT COALESCE(SUM(minutes),0) m FROM study_log WHERE day = date('now')`).get()

  const upcoming = plainAll(
    db
      .prepare(
        `SELECT a.*, s.name AS subject_name, s.color AS subject_color FROM assessments a
         LEFT JOIN subjects s ON s.id=a.subject_id
         WHERE a.status='upcoming' AND (a.due_date IS NULL OR a.due_date >= date('now'))
         ORDER BY a.due_date IS NULL, a.due_date LIMIT 6`
      )
      .all()
  )
  const recentUploads = plainAll(
    db
      .prepare(
        `SELECT u.id,u.title,u.work_type,u.created_at,u.extract_status,u.source,s.name AS subject_name,s.color AS subject_color
         FROM uploads u LEFT JOIN subjects s ON s.id=u.subject_id ORDER BY u.created_at DESC LIMIT 6`
      )
      .all()
  )
  const currentlyStudying = plainAll(
    db
      .prepare(
        `SELECT t.*, s.name AS subject_name, s.color AS subject_color FROM topics t
         LEFT JOIN subjects s ON s.id=t.subject_id
         WHERE t.archived=0 AND (t.scope='school' OR t.status='studying') ORDER BY
           CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, t.assessment_date IS NULL, t.assessment_date LIMIT 8`
      )
      .all()
  )
  const weakest = topicMastery().filter((m) => m.mastery !== null).sort((a, b) => (a.mastery ?? 0) - (b.mastery ?? 0)).slice(0, 5)
  const lastSession = plain(db.prepare('SELECT * FROM study_sessions ORDER BY started_at DESC LIMIT 1').get()) as any

  res.json({
    profile,
    subjects: subjects.length,
    questions_completed: attempts?.n ?? 0,
    accuracy: attempts?.m ? Math.round((attempts.s / attempts.m) * 100) : null,
    flashcards_due: due?.n ?? 0,
    overall_progress: syllabus?.n ? Math.round(((syllabus.done ?? 0) / syllabus.n) * 100) : 0,
    syllabus_total: syllabus?.n ?? 0,
    today_minutes: Math.round(todayMinutes?.m ?? 0),
    streak: streakDays(),
    upcoming_assessments: upcoming,
    recent_uploads: recentUploads,
    currently_studying: currentlyStudying,
    weakest_topics: weakest,
    last_session: lastSession ? { ...lastSession, plan: safe(lastSession.plan) } : null,
    ai_configured: aiConfigured(),
  })
})

function safe(s: any) { try { return JSON.parse(s) } catch { return null } }

/* ---------------- study session ---------------- */

insights.post('/session/start', wrap(async (req: any, res: any) => {
  const profile: any = plain(db.prepare('SELECT * FROM profile WHERE id=1').get())
  const minutes = Math.min(Math.max(Number(req.body?.minutes || 45), 10), 240)
  const subjects = plainAll(db.prepare('SELECT id,name,kind FROM subjects WHERE archived=0 ORDER BY position').all())
  const mastery = topicMastery()
  const due = plainAll(
    db
      .prepare(
        `SELECT s.id subject_id, s.name subject, COUNT(*) n FROM flashcards f JOIN subjects s ON s.id=f.subject_id
         WHERE f.suspended=0 AND f.due_at <= datetime('now') GROUP BY f.subject_id`
      )
      .all()
  )
  const assessments = plainAll(
    db
      .prepare(
        `SELECT a.name, a.due_date, a.weighting, a.topic, s.name subject, s.id subject_id FROM assessments a
         LEFT JOIN subjects s ON s.id=a.subject_id WHERE a.status='upcoming' AND (a.due_date IS NULL OR a.due_date >= date('now'))
         ORDER BY a.due_date LIMIT 10`
      )
      .all()
  )
  const school = plainAll(
    db
      .prepare(
        `SELECT t.id, t.name, t.priority, t.status, t.assessment_date, t.teacher_instructions, s.name subject, s.id subject_id
         FROM topics t LEFT JOIN subjects s ON s.id=t.subject_id
         WHERE t.archived=0 AND (t.scope='school' OR t.status IN ('studying','needs_revision')) LIMIT 20`
      )
      .all()
  )
  const recentUploads = plainAll(
    db.prepare(`SELECT u.title, u.work_type, s.name subject FROM uploads u LEFT JOIN subjects s ON s.id=u.subject_id
                ORDER BY u.created_at DESC LIMIT 10`).all()
  )

  const payload = {
    today: new Date().toISOString().slice(0, 10),
    available_minutes: minutes,
    profile, subjects,
    flashcards_due: due,
    upcoming_assessments: assessments,
    currently_studying_at_school: school,
    topic_mastery: mastery
      .filter((m) => m.mastery !== null)
      .map((m) => ({ topic_id: m.id, topic: m.name, subject: m.subject_name, subject_id: m.subject_id, mastery: m.mastery })),
    recent_uploads: recentUploads,
    focus_subject_id: req.body?.subject_id || null,
  }

  let plan: any
  if (aiConfigured()) {
    plan = await generateStudyPlan(payload)
  } else {
    plan = heuristicPlan(payload, minutes)
  }

  const id = uid('sess')
  db.prepare('INSERT INTO study_sessions (id, plan) VALUES (?,?)').run(id, JSON.stringify(plan))
  res.json({ session_id: id, plan, ai: aiConfigured() })
}))

/** Offline planner: due cards first, then weakest topics, then imminent assessments. */
function heuristicPlan(p: any, minutes: number) {
  const blocks: any[] = []
  let left = minutes
  const totalDue = p.flashcards_due.reduce((a: number, d: any) => a + d.n, 0)
  if (totalDue > 0) {
    const m = Math.min(left, Math.max(10, Math.min(25, Math.ceil(totalDue / 3))))
    blocks.push({ minutes: m, subject: p.flashcards_due[0].subject, subject_id: p.flashcards_due[0].subject_id, topic: 'Due cards', topic_id: null,
      activity: 'flashcards', detail: `Clear ${totalDue} due flashcard${totalDue === 1 ? '' : 's'}.`, why: 'Spaced repetition works only if reviews happen on time.' })
    left -= m
  }
  const soon = p.upcoming_assessments[0]
  if (soon && left >= 15) {
    const m = Math.min(left, 25)
    blocks.push({ minutes: m, subject: soon.subject, subject_id: soon.subject_id, topic: soon.topic || soon.name, topic_id: null,
      activity: 'practice', detail: `Practice questions for "${soon.name}"${soon.due_date ? ` (due ${soon.due_date})` : ''}.`, why: 'Closest assessment - highest payoff right now.' })
    left -= m
  }
  for (const t of p.topic_mastery.sort((a: any, b: any) => a.mastery - b.mastery).slice(0, 3)) {
    if (left < 15) break
    const m = Math.min(left, 20)
    blocks.push({ minutes: m, subject: t.subject, subject_id: t.subject_id, topic: t.topic, topic_id: t.topic_id,
      activity: 'practice', detail: `Adaptive practice on ${t.topic}.`, why: `Weakest measured topic at ${t.mastery}%.` })
    left -= m
  }
  if (!blocks.length || left >= 15) {
    const first = p.currently_studying_at_school[0]
    blocks.push({ minutes: Math.max(15, left), subject: first?.subject || p.subjects[0]?.name || 'Study',
      subject_id: first?.subject_id || p.subjects[0]?.id || null, topic: first?.name || 'Current content', topic_id: first?.id || null,
      activity: 'notes', detail: first ? `Review and summarise ${first.name}.` : 'Add your current school topics so the planner can target them.',
      why: 'Keeps the plan tied to what your class is actually doing.' })
  }
  return {
    title: `${minutes}-minute study session`,
    total_minutes: blocks.reduce((a, b) => a + b.minutes, 0),
    rationale: 'Built offline from your due cards, weakest topics and nearest assessment. Add an ANTHROPIC_API_KEY for AI-planned sessions.',
    blocks,
  }
}

insights.get('/session/:id', (req, res) => {
  const s: any = plain(db.prepare('SELECT * FROM study_sessions WHERE id=?').get(req.params.id))
  if (!s) return res.status(404).json({ error: 'Session not found' })
  res.json({ ...s, plan: safe(s.plan) })
})

insights.post('/session/:id/finish', (req, res) => {
  const minutes = Number(req.body?.minutes || 0)
  db.prepare(`UPDATE study_sessions SET ended_at=datetime('now'), minutes=?, summary=? WHERE id=?`).run(
    minutes, req.body?.summary || '', req.params.id
  )
  if (minutes > 0) {
    db.prepare('INSERT INTO study_log (id,day,subject_id,minutes,activity) VALUES (?,?,?,?,?)').run(
      uid('log'), new Date().toISOString().slice(0, 10), null, minutes, 'session'
    )
  }
  res.json({ ok: true })
})

/* ---------------- global search ---------------- */

insights.get('/search', (req, res) => {
  const qRaw = String(req.query.q || '').trim()
  if (qRaw.length < 2) return res.json({ results: [], query: qRaw })
  const like = `%${qRaw.replace(/[%_]/g, (m) => '\\' + m)}%`
  const limit = Number(req.query.limit || 60)
  const results: any[] = []

  const add = (type: string, rows: any[], map: (r: any) => any) => rows.forEach((r) => results.push({ type, ...map(r) }))

  add('note', plainAll(db.prepare(
    `SELECT n.*, s.name subject_name, s.color subject_color FROM notes n LEFT JOIN subjects s ON s.id=n.subject_id
     WHERE n.title LIKE ? ESCAPE '\\' OR n.body LIKE ? ESCAPE '\\' LIMIT ?`).all(like, like, limit)),
    (r) => ({ id: r.id, title: r.title, snippet: snippet(r.body, qRaw), subject_id: r.subject_id, subject_name: r.subject_name, color: r.subject_color }))

  add('upload', plainAll(db.prepare(
    `SELECT u.*, s.name subject_name, s.color subject_color FROM uploads u LEFT JOIN subjects s ON s.id=u.subject_id
     WHERE u.title LIKE ? ESCAPE '\\' OR u.extracted_text LIKE ? ESCAPE '\\' OR u.original_filename LIKE ? ESCAPE '\\'
     OR u.subtopic LIKE ? ESCAPE '\\' LIMIT ?`).all(like, like, like, like, limit)),
    (r) => ({ id: r.id, title: r.title || r.original_filename, snippet: snippet(r.extracted_text, qRaw),
              subject_id: r.subject_id, subject_name: r.subject_name, color: r.subject_color, work_type: r.work_type, source: r.source }))

  add('flashcard', plainAll(db.prepare(
    `SELECT f.*, s.name subject_name, s.color subject_color FROM flashcards f LEFT JOIN subjects s ON s.id=f.subject_id
     WHERE f.front LIKE ? ESCAPE '\\' OR f.back LIKE ? ESCAPE '\\' LIMIT ?`).all(like, like, limit)),
    (r) => ({ id: r.id, title: r.front, snippet: snippet(r.back, qRaw), subject_id: r.subject_id, subject_name: r.subject_name, color: r.subject_color }))

  add('question', plainAll(db.prepare(
    `SELECT q.*, s.name subject_name, s.color subject_color FROM questions q LEFT JOIN subjects s ON s.id=q.subject_id
     WHERE q.prompt LIKE ? ESCAPE '\\' OR q.answer LIKE ? ESCAPE '\\' OR q.stimulus LIKE ? ESCAPE '\\' LIMIT ?`).all(like, like, like, limit)),
    (r) => ({ id: r.id, set_id: r.set_id, title: r.prompt, snippet: snippet(r.answer, qRaw), subject_id: r.subject_id, subject_name: r.subject_name, color: r.subject_color }))

  add('syllabus_point', plainAll(db.prepare(
    `SELECT p.*, s.name subject_name, s.color subject_color FROM syllabus_points p LEFT JOIN subjects s ON s.id=p.subject_id
     WHERE p.text LIKE ? ESCAPE '\\' OR p.code LIKE ? ESCAPE '\\' LIMIT ?`).all(like, like, limit)),
    (r) => ({ id: r.id, title: r.text, snippet: `Status: ${r.status}`, subject_id: r.subject_id, subject_name: r.subject_name, color: r.subject_color }))

  add('topic', plainAll(db.prepare(
    `SELECT t.*, s.name subject_name, s.color subject_color FROM topics t LEFT JOIN subjects s ON s.id=t.subject_id
     WHERE t.name LIKE ? ESCAPE '\\' OR t.notes LIKE ? ESCAPE '\\' OR t.teacher_instructions LIKE ? ESCAPE '\\' LIMIT ?`).all(like, like, like, limit)),
    (r) => ({ id: r.id, title: r.name, snippet: snippet(r.notes || r.teacher_instructions, qRaw), subject_id: r.subject_id, subject_name: r.subject_name, color: r.subject_color, scope: r.scope }))

  add('assessment', plainAll(db.prepare(
    `SELECT a.*, s.name subject_name, s.color subject_color FROM assessments a LEFT JOIN subjects s ON s.id=a.subject_id
     WHERE a.name LIKE ? ESCAPE '\\' OR a.notes LIKE ? ESCAPE '\\' OR a.topic LIKE ? ESCAPE '\\' LIMIT ?`).all(like, like, like, limit)),
    (r) => ({ id: r.id, title: r.name, snippet: `${r.topic || ''} ${r.due_date ? 'due ' + r.due_date : ''}`.trim(), subject_id: r.subject_id, subject_name: r.subject_name, color: r.subject_color }))

  res.json({ query: qRaw, count: results.length, results })
})

function snippet(text: string, term: string, radius = 90) {
  const t = String(text || '')
  if (!t) return ''
  const i = t.toLowerCase().indexOf(term.toLowerCase())
  if (i === -1) return t.slice(0, radius * 2).trim()
  return (i > radius ? '...' : '') + t.slice(Math.max(0, i - radius), i + term.length + radius).trim() + (t.length > i + radius ? '...' : '')
}

/* ---------------- export ---------------- */

insights.get('/export', (_req, res) => {
  const tables = ['profile', 'subjects', 'topics', 'syllabus_sections', 'syllabus_points', 'syllabus_docs',
    'notes', 'uploads', 'links', 'flashcards', 'practice_sets', 'questions', 'attempts', 'exams',
    'assessments', 'study_sessions', 'study_log', 'settings']
  const dump: any = { exported_at: new Date().toISOString(), version: 1 }
  for (const t of tables) dump[t] = plainAll(db.prepare(`SELECT * FROM ${t}`).all())
  res.setHeader('Content-Disposition', `attachment; filename="study-hq-export-${new Date().toISOString().slice(0, 10)}.json"`)
  res.json(dump)
})

/** CSV-safe cell. */
function csv(v: any) {
  const s = String(v ?? '').replace(/\r?\n/g, ' ').trim()
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
function sendCsv(res: any, name: string, header: string[], rows: any[][]) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
  res.send([header.join(','), ...rows.map((r) => r.map(csv).join(','))].join('\n'))
}

/** Flashcards in a format Anki imports directly (front, back, extra, tags). */
insights.get('/export/flashcards.csv', (_req, res) => {
  const rows = plainAll(
    db.prepare(
      `SELECT f.front, f.back, f.extra, s.name subject, t.name topic, f.card_kind, ROUND(f.interval_days) interval_days, f.due_at
       FROM flashcards f LEFT JOIN subjects s ON s.id=f.subject_id LEFT JOIN topics t ON t.id=f.topic_id
       ORDER BY s.name, f.created_at`
    ).all()
  )
  sendCsv(res, 'study-hq-flashcards.csv',
    ['front', 'back', 'extra', 'subject', 'topic', 'type', 'interval_days', 'due'],
    rows.map((r) => [r.front, r.back, r.extra, r.subject, r.topic, r.card_kind, r.interval_days, r.due_at]))
})

insights.get('/export/questions.csv', (_req, res) => {
  const rows = plainAll(
    db.prepare(
      `SELECT s.name subject, t.name topic, q.qtype, q.difficulty, q.marks, q.prompt, q.answer, q.marking_guide,
              a.response, a.score, a.max_score, a.feedback, a.created_at
       FROM questions q
       LEFT JOIN subjects s ON s.id=q.subject_id
       LEFT JOIN topics t ON t.id=q.topic_id
       LEFT JOIN attempts a ON a.question_id=q.id
       ORDER BY q.created_at DESC`
    ).all()
  )
  sendCsv(res, 'study-hq-questions.csv',
    ['subject', 'topic', 'type', 'difficulty', 'marks', 'question', 'model_answer', 'marking_guide', 'my_answer', 'score', 'out_of', 'feedback', 'answered_at'],
    rows.map((r) => [r.subject, r.topic, r.qtype, r.difficulty, r.marks, r.prompt, r.answer, r.marking_guide,
                     r.response, r.score, r.max_score, r.feedback, r.created_at]))
})

insights.get('/export/syllabus.csv', (_req, res) => {
  const rows = plainAll(
    db.prepare(
      `SELECT s.name subject, sec.title section, p.code, p.text, p.status
       FROM syllabus_points p LEFT JOIN subjects s ON s.id=p.subject_id
       LEFT JOIN syllabus_sections sec ON sec.id=p.section_id ORDER BY s.name, p.position`
    ).all()
  )
  sendCsv(res, 'study-hq-syllabus.csv', ['subject', 'section', 'code', 'point', 'status'],
    rows.map((r) => [r.subject, r.section, r.code, r.text, r.status]))
})

insights.get('/export/progress.csv', (_req, res) => {
  const rows = topicMastery().map((m) => [m.subject_name, m.name, m.mastery ?? '', m.accuracy ?? '', m.attempts, m.cards, m.status])
  sendCsv(res, 'study-hq-progress.csv', ['subject', 'topic', 'mastery_percent', 'accuracy_percent', 'questions_answered', 'flashcards', 'status'], rows)
})

/** Notes as one markdown file, grouped by subject. */
insights.get('/export/notes.md', (_req, res) => {
  const rows = plainAll(
    db.prepare(
      `SELECT n.title, n.body, n.subtopic, n.updated_at, s.name subject, t.name topic
       FROM notes n LEFT JOIN subjects s ON s.id=n.subject_id LEFT JOIN topics t ON t.id=n.topic_id
       ORDER BY s.name, n.updated_at DESC`
    ).all()
  )
  // Notes are stored as HTML; convert the common tags back to markdown.
  const toMd = (html: string) =>
    String(html || '')
      .replace(/<h1[^>]*>(.*?)<\/h1>/gis, '\n# $1\n')
      .replace(/<h2[^>]*>(.*?)<\/h2>/gis, '\n## $1\n')
      .replace(/<h3[^>]*>(.*?)<\/h3>/gis, '\n### $1\n')
      .replace(/<(strong|b)[^>]*>(.*?)<\/\1>/gis, '**$2**')
      .replace(/<(em|i)[^>]*>(.*?)<\/\1>/gis, '*$2*')
      .replace(/<li[^>]*>(.*?)<\/li>/gis, '- $1\n')
      .replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gis, '> $1\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

  let out = `# Study HQ notes\n\nExported ${new Date().toISOString().slice(0, 10)}\n`
  let subject = ''
  for (const n of rows) {
    if (n.subject !== subject) { subject = n.subject; out += `\n\n---\n\n# ${subject || 'Unassigned'}\n` }
    out += `\n## ${n.title}\n`
    const meta = [n.topic, n.subtopic].filter(Boolean).join(' / ')
    if (meta) out += `*${meta}*\n`
    out += `\n${toMd(n.body)}\n`
  }
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename="study-hq-notes.md"')
  res.send(out)
})
