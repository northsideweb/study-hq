/**
 * AI study engine. All Anthropic calls live here - the API key never leaves the server.
 */
import Anthropic from '@anthropic-ai/sdk'
import { ANTHROPIC_API_KEY, ANTHROPIC_MODEL, ANTHROPIC_FAST_MODEL, hasApiKey } from './config.js'
import { db, plain, plainAll } from './db.js'

export class AiNotConfigured extends Error {
  constructor() {
    super(
      hasApiKey()
        ? 'AI is switched off. Turn it back on in Settings when you want to use it.'
        : 'AI is not set up. Add ANTHROPIC_API_KEY to the .env file in the Study HQ folder, then restart the server.'
    )
    this.name = 'AiNotConfigured'
  }
}

/** True when a key exists AND the student has AI switched on in Settings. */
export function aiConfigured(): boolean {
  if (!hasApiKey()) return false
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'ai_enabled'`).get() as any
  return row?.value !== '0'
}

/** Whether a key is present at all, regardless of the on/off switch. */
export function aiKeyPresent(): boolean {
  return hasApiKey()
}

/** Turn the AI features on or off. Nothing is billed while it is off. */
export function setAiEnabled(on: boolean) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('ai_enabled', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(on ? '1' : '0')
}

let client: Anthropic | null = null
function getClient() {
  if (!aiConfigured()) throw new AiNotConfigured()
  if (!client) client = new Anthropic({ apiKey: ANTHROPIC_API_KEY })
  return client
}

function extractJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = fenced ? fenced[1] : text
  const start = raw.search(/[[{]/)
  if (start === -1) throw new Error('Model did not return JSON.')
  const open = raw[start]
  const close = open === '[' ? ']' : '}'
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < raw.length; i++) {
    const c = raw[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === open) depth++
    else if (c === close) {
      depth--
      if (depth === 0) {
        const block = raw.slice(start, i + 1)
        try {
          return JSON.parse(block)
        } catch {
          // Long answers occasionally contain a quote or newline the model forgot to escape.
          return JSON.parse(repairJson(block))
        }
      }
    }
  }
  throw new Error('Model returned truncated JSON. Try fewer questions at a time.')
}

/** Escape control characters and stray quotes inside JSON strings so a near-miss still parses. */
function repairJson(raw: string): string {
  let out = ''
  let inStr = false
  let esc = false
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    if (!inStr) {
      out += c
      if (c === '"') inStr = true
      continue
    }
    if (esc) { out += c; esc = false; continue }
    if (c === '\\') { out += c; esc = true; continue }
    if (c === '\n') { out += '\\n'; continue }
    if (c === '\r') { out += '\\r'; continue }
    if (c === '\t') { out += '\\t'; continue }
    if (c === '"') {
      // A genuine closing quote is followed by , } ] : or the end of the block.
      let k = i + 1
      while (k < raw.length && /\s/.test(raw[k])) k++
      if (k >= raw.length || [',', '}', ']', ':'].includes(raw[k])) { out += c; inStr = false }
      else out += '\\"'
      continue
    }
    out += c
  }
  return out
}

export async function askJson(opts: {
  system: string
  user: string
  maxTokens?: number
  prefill?: string
  temperature?: number
  /** How hard the model should think. Generation is fine on 'low'; marking wants more. */
  effort?: 'low' | 'medium' | 'high'
  /** Override the model — generation uses the faster one. */
  model?: string
}): Promise<any> {
  const anthropic = getClient()
  // Some models reject an assistant prefill, so ask for raw JSON in the system prompt instead.
  const wants = opts.prefill === '{' ? 'a single JSON object' : 'a JSON array'
  const model = opts.model || ANTHROPIC_MODEL
  // Haiku and older models reject `effort`; it only applies to the reasoning models.
  const supportsEffort = !/haiku|claude-3/i.test(model)
  const res = await anthropic.messages.create({
    model,
    max_tokens: opts.maxTokens ?? 4000,
    temperature: opts.temperature ?? 1,
    system: `${opts.system}\n\nReply with ${wants} and nothing else - no explanation, no markdown code fences.`,
    messages: [{ role: 'user', content: opts.user }],
    ...(opts.effort && supportsEffort ? { output_config: { effort: opts.effort } } : {}),
  } as any)
  const text = res.content.map((b: any) => (b.type === 'text' ? b.text : '')).join('')
  return extractJson(text)
}

export async function askText(opts: { system: string; user: string; maxTokens?: number }): Promise<string> {
  const anthropic = getClient()
  const res = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: opts.maxTokens ?? 2000,
    system: opts.system,
    messages: [{ role: 'user', content: opts.user }],
  })
  return res.content.map((b: any) => (b.type === 'text' ? b.text : '')).join('').trim()
}

/* ------------------------------------------------------------------ */
/* Knowledge base context                                              */
/* ------------------------------------------------------------------ */

export type ContextOpts = {
  subjectId?: string
  topicId?: string
  sourceUploadIds?: string[]
  charBudget?: number
}

export type BuiltContext = {
  subject?: any
  topic?: any
  text: string
  hasMaterial: boolean
  sources: Array<{ type: string; id: string; title: string }>
}

/** Pull the student's own material (syllabus, school content, notes, uploads) into a prompt block. */
export function buildContext(opts: ContextOpts): BuiltContext {
  const budget = opts.charBudget ?? 14000
  const sources: BuiltContext['sources'] = []
  const parts: string[] = []
  let used = 0
  const push = (s: string) => {
    if (used >= budget) return false
    const slice = s.slice(0, Math.max(0, budget - used))
    parts.push(slice)
    used += slice.length
    return true
  }

  const subject = opts.subjectId
    ? (db.prepare('SELECT * FROM subjects WHERE id = ?').get(opts.subjectId) as any)
    : undefined
  const topic = opts.topicId
    ? (db.prepare('SELECT * FROM topics WHERE id = ?').get(opts.topicId) as any)
    : undefined

  if (subject) push(`SUBJECT: ${subject.name} (NSW Stage 6, subject type: ${subject.kind})\n`)
  if (topic) push(`FOCUS TOPIC: ${topic.name} (status: ${topic.status})\n`)

  if (opts.subjectId) {
    // Only the points that matter right now. A full NESA syllabus is hundreds of points -
    // sending all of them on every request is slow and expensive, so prefer what is being
    // studied or needs revision, then fill up with the rest.
    const points = plainAll(
      db
        .prepare(
          `SELECT p.*, s.title AS section FROM syllabus_points p
           LEFT JOIN syllabus_sections s ON s.id = p.section_id
           WHERE p.subject_id = ?
           ORDER BY CASE p.status
             WHEN 'studying' THEN 0 WHEN 'needs_revision' THEN 1 WHEN 'not_started' THEN 2 ELSE 3 END,
             p.position
           LIMIT 45`
        )
        .all(opts.subjectId)
    )
    if (points.length) {
      const total = (db.prepare('SELECT COUNT(*) n FROM syllabus_points WHERE subject_id = ?').get(opts.subjectId) as any)?.n ?? points.length
      push(
        `\n=== MY SYLLABUS ${total > points.length ? `(the ${points.length} most relevant of ${total} points)` : '(entered by me)'} ===\n` +
          points.map((p) => `- [${p.status}] ${p.section ? p.section + ' / ' : ''}${p.code ? p.code + ' ' : ''}${p.text}`).join('\n') +
          '\n'
      )
      sources.push({ type: 'syllabus', id: opts.subjectId, title: `${points.length} syllabus points` })
    }

    // The raw syllabus document is deliberately NOT included: once it has been structured into
    // points above, sending it again just doubles the cost of every request. Only fall back to
    // it when no points have been created yet.
    if (!points.length) {
      const doc: any = plain(
        db.prepare('SELECT * FROM syllabus_docs WHERE subject_id = ? ORDER BY created_at DESC LIMIT 1').get(opts.subjectId)
      )
      if (doc?.content?.trim()) {
        push(`\n=== SYLLABUS DOCUMENT: ${doc.title} ===\n${doc.content.slice(0, 6000)}\n`)
        sources.push({ type: 'syllabus_doc', id: doc.id, title: doc.title })
      }
    }

    const school = plainAll(
      db
        .prepare(
          `SELECT * FROM topics WHERE subject_id = ? AND scope = 'school' AND archived = 0 ORDER BY position LIMIT 50`
        )
        .all(opts.subjectId)
    )
    if (school.length) {
      push(
        `\n=== WHAT I AM CURRENTLY DOING AT SCHOOL ===\n` +
          school
            .map(
              (t) =>
                `- ${t.name} [${t.status}, priority ${t.priority}]` +
                (t.start_date ? ` started ${t.start_date}` : '') +
                (t.assessment_date ? ` assessment ${t.assessment_date}` : '') +
                (t.teacher_instructions ? `\n  Teacher: ${t.teacher_instructions}` : '') +
                (t.notes ? `\n  Notes: ${t.notes}` : '')
            )
            .join('\n') +
          '\n'
      )
    }
  }

  // Notes + uploads, focused on the topic when one is given.
  const noteRows = plainAll(
    opts.topicId
      ? db.prepare('SELECT * FROM notes WHERE topic_id = ? ORDER BY updated_at DESC LIMIT 8').all(opts.topicId)
      : opts.subjectId
        ? db.prepare('SELECT * FROM notes WHERE subject_id = ? ORDER BY updated_at DESC LIMIT 8').all(opts.subjectId)
        : []
  )
  for (const n of noteRows) {
    if (!n.body?.trim()) continue
    push(`\n=== MY NOTE: ${n.title} ===\n${n.body.slice(0, 3500)}\n`)
    sources.push({ type: 'note', id: n.id, title: n.title })
  }

  let uploads: any[] = []
  if (opts.sourceUploadIds?.length) {
    const marks = opts.sourceUploadIds.map(() => '?').join(',')
    uploads = plainAll(db.prepare(`SELECT * FROM uploads WHERE id IN (${marks})`).all(...opts.sourceUploadIds))
  } else if (opts.topicId) {
    uploads = plainAll(
      db.prepare('SELECT * FROM uploads WHERE topic_id = ? ORDER BY created_at DESC LIMIT 8').all(opts.topicId)
    )
  } else if (opts.subjectId) {
    uploads = plainAll(
      db.prepare('SELECT * FROM uploads WHERE subject_id = ? ORDER BY created_at DESC LIMIT 8').all(opts.subjectId)
    )
  }
  for (const u of uploads) {
    const body = (u.extracted_text || '').trim()
    if (!body) continue
    push(
      `\n=== MY ${String(u.work_type).toUpperCase()}: ${u.title || u.original_filename} ` +
        `(${u.subtopic || 'no subtopic'}${u.teacher ? ', teacher ' + u.teacher : ''}) ===\n${body.slice(0, 4000)}\n`
    )
    sources.push({ type: 'upload', id: u.id, title: u.title || u.original_filename })
  }

  const hasMaterial = sources.length > 0
  return { subject, topic, text: parts.join(''), hasMaterial, sources }
}

/** Recent mistakes for a subject/topic, so generation can target real weaknesses. */
export function recentMistakes(subjectId?: string, topicId?: string, limit = 12) {
  const rows = plainAll(
    db
      .prepare(
        `SELECT a.response, a.feedback, q.prompt, q.qtype, q.answer, a.score, a.max_score
         FROM attempts a JOIN questions q ON q.id = a.question_id
         WHERE (? IS NULL OR a.subject_id = ?) AND (? IS NULL OR a.topic_id = ?)
           AND a.max_score > 0 AND (a.score * 1.0 / a.max_score) < 0.6
         ORDER BY a.created_at DESC LIMIT ?`
      )
      .all(subjectId ?? null, subjectId ?? null, topicId ?? null, topicId ?? null, limit)
  )
  return rows
}

/* ------------------------------------------------------------------ */
/* Prompts                                                             */
/* ------------------------------------------------------------------ */

export const QUESTION_TYPES = [
  'multiple_choice', 'true_false', 'fill_blank', 'definition', 'short_answer',
  'extended_response', 'essay', 'case_study', 'scenario', 'explain', 'analyse',
  'discuss', 'assess', 'evaluate', 'exam_question', 'mixed',
] as const

const SUBJECT_GUIDANCE: Record<string, string> = {
  english:
    'NSW English Standard. Use module-style thinking (texts, themes, techniques, context, form). ' +
    'For extended responses give a marking guide referencing understanding of text, use of textual evidence/techniques, ' +
    'response to the question, and control of language. Quote-based and technique-based questions are valuable.',
  maths:
    'NSW Mathematics Standard. Questions must be computational and unambiguous. ALWAYS supply full step-by-step working ' +
    'in the "working" field and the final answer in "answer". Vary the numbers, contexts and units between questions so no ' +
    'two are the same, while testing the same underlying skill. Use realistic Australian contexts (dollars, km, kg) and ' +
    'standard formulas from the Standard course.',
  music:
    'NSW Music 1. Anchor questions in the Concepts of Music (duration, pitch, dynamics and expressive techniques, tone colour, ' +
    'texture, structure). Cover aural analysis, musicology, theory, composition and performance where relevant. ' +
    'For aural questions describe the excerpt in words since no audio is available.',
  dt: 'NSW Design & Technology. Cover the design process, designing and producing, materials, technologies, innovation, ' +
    'case studies of designers/innovation, project documentation, evaluation and WHS.',
  legal:
    'NSW Legal Studies. Use correct NSW/Commonwealth legislation, real legal cases, and contemporary media examples. ' +
    'Match verbs to the NESA glossary (define/describe/explain/analyse/discuss/assess/evaluate) and mark allocation.',
  business:
    'NSW Business Studies. Use correct business terminology and real Australian business examples where appropriate. ' +
    'Include 4/6/10-mark style responses with marking guides matched to the NESA glossary verbs.',
  generic: 'NSW Stage 6 course. Match the NESA glossary verbs and standard exam conventions.',
}

const QUESTION_SCHEMA = `Return ONLY a JSON array. Each element:
{
  "qtype": one of multiple_choice|true_false|fill_blank|definition|short_answer|extended_response|essay|case_study|scenario|explain|analyse|discuss|assess|evaluate|exam_question,
  "difficulty": "easy"|"medium"|"hard"|"exam",
  "prompt": "the question exactly as a student would read it",
  "stimulus": "optional case study / scenario / source text, else \\"\\"",
  "options": ["A text","B text", ...]   // multiple_choice only, else []
  "answer": "correct option text, or the model answer",
  "working": "step-by-step working (REQUIRED for maths), else \\"\\"",
  "marking_guide": "what earns each mark",
  "marks": integer,
  "topic_hint": "the specific topic/syllabus point this tests"
}`

export type GenerateOpts = {
  subjectId?: string
  topicId?: string
  mode: 'my_material' | 'hsc'
  qtype: string
  difficulty: string
  count: number
  sourceUploadIds?: string[]
  avoid?: string[]
  extraInstructions?: string
}

export async function generateQuestions(opts: GenerateOpts) {
  const ctx = buildContext({
    subjectId: opts.subjectId,
    topicId: opts.topicId,
    sourceUploadIds: opts.sourceUploadIds,
  })
  const kind = ctx.subject?.kind || 'generic'
  const guidance = SUBJECT_GUIDANCE[kind] || SUBJECT_GUIDANCE.generic

  if (opts.mode === 'my_material' && !ctx.hasMaterial) {
    throw new Error(
      'MY MATERIAL mode needs your own content first. Add notes, upload schoolwork or enter syllabus points for this subject - or switch to HSC PRACTICE mode.'
    )
  }

  const modeRule =
    opts.mode === 'my_material'
      ? `MODE: MY MATERIAL. Every question MUST be answerable from the student's material below. Use their wording, their ` +
        `case studies, their examples and their teacher's framing. Do NOT introduce content that is absent from their material.`
      : `MODE: HSC PRACTICE. Write questions aligned to the NSW Stage 6 syllabus and HSC exam conventions for this course. ` +
        `The student's material below is context for what they have covered - you may go beyond it, but stay in-course.`

  const mistakes = recentMistakes(opts.subjectId, opts.topicId, 8)
  const weakBlock = mistakes.length
    ? `\n=== RECENT MISTAKES (target these) ===\n` +
      mistakes.map((m) => `- Q: ${String(m.prompt).slice(0, 200)}\n  My answer: ${String(m.response).slice(0, 200)}`).join('\n')
    : ''

  const avoidBlock = opts.avoid?.length
    ? `\n=== ALREADY ASKED - generate genuinely DIFFERENT questions (new numbers, new scenarios, new wording, new examples) ===\n` +
      opts.avoid.slice(-40).map((a) => `- ${a.slice(0, 160)}`).join('\n')
    : ''

  const typeRule =
    opts.qtype === 'mixed'
      ? 'Use a spread of question types appropriate to the course, including at least one extended/analytical question.'
      : `Every question must be of type "${opts.qtype}".`

  const system =
    `You are an expert NSW HSC teacher building practice questions for a Year ${
      (db.prepare('SELECT year_level FROM profile WHERE id=1').get() as any)?.year_level ?? 11
    } student. ${guidance}\n${QUESTION_SCHEMA}\nNo commentary outside the JSON.`

  const BATCH = 4
  const batches: number[] = []
  for (let left = opts.count; left > 0; left -= BATCH) batches.push(Math.min(BATCH, left))

  const askBatch = async (n: number, index: number) => {
    const body =
      `${modeRule}\n\n${typeRule}\nDifficulty: ${difficultyOf(opts)}. Generate exactly ${n} question(s).` +
      (opts.extraInstructions ? `\nExtra instructions: ${opts.extraInstructions}` : '') +
      (batches.length > 1
        ? `\nThis is set ${index + 1} of ${batches.length} being written at the same time, so make these questions distinctly different from the others.`
        : '') +
      `\n\n=== STUDENT MATERIAL ===\n${ctx.text || '(none provided)'}\n${weakBlock}${avoidBlock}`
    const json = await askJson({ system, user: body, maxTokens: Math.min(8000, 900 + n * 900), effort: 'low', model: ANTHROPIC_FAST_MODEL })
    return Array.isArray(json) ? json : json.questions || []
  }

  const results = await Promise.all(batches.map((n, i) => askBatch(n, i)))
  const arr = results.flat()
  return { questions: arr, sources: ctx.sources }
}

/** The difficulty label used in prompts. */
function difficultyOf(opts: GenerateOpts) {
  return opts.difficulty
}

export async function generateFlashcards(opts: {
  subjectId: string
  topicId?: string
  count: number
  sourceUploadIds?: string[]
  cardKind?: string
  mode?: 'my_material' | 'hsc'
}) {
  const ctx = buildContext({
    subjectId: opts.subjectId,
    topicId: opts.topicId,
    sourceUploadIds: opts.sourceUploadIds,
  })
  if ((opts.mode ?? 'my_material') === 'my_material' && !ctx.hasMaterial) {
    throw new Error('No material found for this selection. Add notes or upload schoolwork first, or switch to HSC mode.')
  }
  const kindRule =
    opts.cardKind && opts.cardKind !== 'basic'
      ? `Every card must be a ${opts.cardKind} card (front = the ${opts.cardKind} cue, back = what I must recall about it).`
      : 'Mix definitions, key facts, examples and "explain why" prompts.'

  const system =
    `You write high-quality active-recall flashcards for a NSW HSC student. ${SUBJECT_GUIDANCE[ctx.subject?.kind || 'generic']}\n` +
    `Return ONLY a JSON array of {"front": string, "back": string, "extra": string, "card_kind": "basic|quote|technique|theme|character|definition", "topic_hint": string}.\n` +
    `Fronts must be short and specific (one idea per card). Backs must be complete but concise.`
  const user =
    `Create exactly ${opts.count} flashcards. ${kindRule}\n` +
    `Base them on MY material below wherever possible.\n\n=== MY MATERIAL ===\n${ctx.text || '(none)'}`

  const json = await askJson({ system, user, maxTokens: Math.min(16000, 800 + opts.count * 260), effort: 'low', model: ANTHROPIC_FAST_MODEL })
  return Array.isArray(json) ? json : json.cards || []
}

export async function markResponse(opts: {
  question: any
  response: string
  subjectKind: string
  contextText?: string
}) {
  const { question, response } = opts
  const system =
    `You are a NSW HSC marker. ${SUBJECT_GUIDANCE[opts.subjectKind] || SUBJECT_GUIDANCE.generic}\n` +
    `Mark fairly against the marking guide and the mark allocation. Be specific and constructive - a Year 11 student is reading this.\n` +
    `Return ONLY JSON: {"score": number, "max_score": number, "correct": true|false|null, ` +
    `"feedback": "what you did well / where marks were lost, referencing the response", ` +
    `"improvement": "concrete steps to improve, and for maths: what went wrong, the correct method, full step-by-step working, the final answer", ` +
    `"mistake_summary": "short label for the error type, or empty"}`
  const user =
    `QUESTION (${question.qtype}, ${question.marks} mark${question.marks === 1 ? '' : 's'}):\n${question.prompt}\n` +
    (question.stimulus ? `\nSTIMULUS:\n${question.stimulus}\n` : '') +
    (question.options && question.options !== '[]' ? `\nOPTIONS: ${question.options}\n` : '') +
    `\nMODEL ANSWER: ${question.answer}\n` +
    (question.working ? `\nWORKING: ${question.working}\n` : '') +
    `\nMARKING GUIDE: ${question.marking_guide}\n` +
    (opts.contextText ? `\nSTUDENT'S OWN MATERIAL (for reference):\n${opts.contextText.slice(0, 12000)}\n` : '') +
    `\n=== MY RESPONSE ===\n${response || '(no response given)'}`

  return await askJson({ system, user, maxTokens: 2000, prefill: '{' })
}

export async function generateStudyPlan(payload: any) {
  const system =
    `You are a NSW HSC study coach. Build a focused, realistic study session for today. ` +
    `Return ONLY JSON: {"title": string, "total_minutes": number, "rationale": "why this plan, in 2 sentences", ` +
    `"blocks": [{"minutes": number, "subject_id": string, "subject": string, "topic_id": string|null, "topic": string, ` +
    `"activity": "flashcards|practice|exam|notes|reading|essay", "detail": "exactly what to do", "why": "why this is the priority"}]}`
  const user = `Student profile and current state:\n${JSON.stringify(payload, null, 2)}`
  return await askJson({ system, user, maxTokens: 3000, prefill: '{' })
}

export async function organiseContent(payload: {
  text: string
  subjects: Array<{ id: string; name: string }>
  topics: Array<{ id: string; subject_id: string; name: string }>
}) {
  const system =
    `You classify a NSW high-school student's schoolwork. Return ONLY JSON: ` +
    `{"title": short descriptive title, "subject_id": id or null, "topic_id": existing id or null, ` +
    `"suggested_topic": "new topic name if none fits, else empty", "subtopic": string, ` +
    `"work_type": one of Class Notes|Homework|Worksheet|Assessment|Teacher Feedback|Syllabus|Textbook Notes|Revision|Essay|Practice Questions|Other, ` +
    `"summary": "2-3 sentence summary", "key_points": [up to 6 strings], "confidence": 0-1}\n` +
    `Guess from the content only. It is fine to return null when unsure - the student can fix it.`
  const user =
    `SUBJECTS:\n${payload.subjects.map((s) => `${s.id} = ${s.name}`).join('\n')}\n\n` +
    `EXISTING TOPICS:\n${payload.topics.map((t) => `${t.id} = ${t.name} (subject ${t.subject_id})`).join('\n') || '(none)'}\n\n` +
    `CONTENT:\n${payload.text.slice(0, 20000)}`
  return await askJson({ system, user, maxTokens: 1500, prefill: '{' })
}

/**
 * Turn a raw syllabus document into structured points.
 * A full NESA syllabus is far too long for one reply - the JSON gets truncated - so the text is
 * split on line boundaries and parsed in parallel batches, then merged and de-duplicated.
 */
export async function parseSyllabusText(text: string, subjectName: string) {
  const MAX_CHARS = 200_000   // a whole NESA syllabus, with room to spare
  const CHUNK_CHARS = 7000    // comfortably inside one reply
  const CONCURRENCY = 3

  const chunks: string[] = []
  let current = ''
  for (const line of text.slice(0, MAX_CHARS).split('\n')) {
    if (current.length + line.length > CHUNK_CHARS && current.trim()) {
      chunks.push(current)
      current = ''
    }
    current += line + '\n'
  }
  if (current.trim()) chunks.push(current)

  const system =
    `You convert a raw NSW syllabus extract into structured points. Return ONLY a JSON array of ` +
    `{"section": "section/topic heading", "code": "outcome code if present else empty", "text": "the syllabus point"}.\n` +
    `Preserve the syllabus wording. Split multi-part dot points into separate learnable points. ` +
    `Ignore page furniture (headers, footers, page numbers, copyright notices, contents pages). ` +
    `This is one part of a longer document, so use the section headings visible in this part.`

  const parseChunk = async (chunk: string) => {
    try {
      const json = await askJson({
        system,
        user: `SUBJECT: ${subjectName}\n\nRAW SYLLABUS TEXT:\n${chunk}`,
        maxTokens: 8000,
        effort: 'low',
        model: ANTHROPIC_FAST_MODEL,
      })
      return Array.isArray(json) ? json : []
    } catch {
      return [] // one bad chunk must not lose the rest of the syllabus
    }
  }

  const rows: any[] = []
  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    const batch = await Promise.all(chunks.slice(i, i + CONCURRENCY).map(parseChunk))
    for (const part of batch) rows.push(...part)
  }

  const seen = new Set<string>()
  return rows.filter((r) => {
    const text2 = String(r?.text || '').trim()
    if (!text2) return false
    const key = `${String(r.section || '').toLowerCase()}|${text2.toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}


/* ------------------------------------------------------------------ */
/* v2: note tools, essay marking, study mode                           */
/* ------------------------------------------------------------------ */

export const NOTE_TOOLS: Record<string, { label: string; instruction: string; json?: boolean }> = {
  summarise: { label: 'Summarise', instruction: 'Summarise these notes into the key ideas a student must remember. Use short headed sections and bullet points.' },
  simplify: { label: 'Explain simply', instruction: 'Explain this content in plain, simple language a Year 11 student would immediately understand. Use short sentences and everyday analogies where they genuinely help.' },
  deepen: { label: 'Explain in more depth', instruction: 'Explain this content in more depth than the notes do: the underlying reasoning, how the parts connect, common misconceptions, and how it is examined in the HSC.' },
  key_terms: { label: 'Find key terms', instruction: 'List every key term in this content with a precise one-line definition. Format as "**Term** - definition".' },
  definitions: { label: 'Find definitions', instruction: 'Extract every definition stated or implied in this content, written as syllabus-accurate definitions.' },
  gaps: { label: 'Find weak / unclear areas', instruction: 'Identify what is missing, vague, incomplete or likely to be misunderstood in these notes, and say specifically what the student should add or clarify. Be direct.' },
  study_sheet: { label: 'Create a study sheet', instruction: 'Turn this into a one-page study sheet: key definitions, the core ideas, the examples worth memorising, and the mistakes to avoid. Dense but scannable.' },
  essay_plan: { label: 'Create an essay plan', instruction: 'Build an essay plan from this content: a thesis, three body paragraph arguments with the evidence/examples to use for each, and a conclusion direction.' },
}

export async function runNoteTool(tool: string, text: string, subjectKind: string, subjectName: string) {
  const spec = NOTE_TOOLS[tool]
  if (!spec) throw new Error(`Unknown note tool: ${tool}`)
  const system =
    `You are helping a NSW HSC student work with their own study notes. ${SUBJECT_GUIDANCE[subjectKind] || SUBJECT_GUIDANCE.generic}\n` +
    `Write in clean markdown. Be accurate and concise - never pad. Work only from the content given; ` +
    `if something is missing from their notes, say so rather than inventing it.`
  const user = `SUBJECT: ${subjectName}\nTASK: ${spec.instruction}\n\n=== MY NOTES ===\n${text.slice(0, 40000)}`
  return await askText({ system, user, maxTokens: 3000 })
}

const ESSAY_CRITERIA: Record<string, string[]> = {
  english: ['Understanding of text', 'Response to the question', 'Textual evidence and techniques', 'Analysis and insight', 'Structure', 'Control of language'],
  legal: ['Response to the question', 'Legal terminology', 'Legislation, cases and media (LCM)', 'Analysis and judgement', 'Structure', 'Control of language'],
  business: ['Response to the question', 'Business terminology', 'Business examples', 'Analysis and judgement', 'Structure', 'Control of language'],
  generic: ['Response to the question', 'Subject terminology', 'Evidence and examples', 'Analysis', 'Structure', 'Control of language'],
}

export async function analyseEssay(opts: {
  question: string; body: string; subjectKind: string; subjectName: string; marks?: number; contextText?: string
}) {
  const criteria = ESSAY_CRITERIA[opts.subjectKind] || ESSAY_CRITERIA.generic
  const system =
    `You are an experienced NSW HSC marker giving feedback to a Year 11 student on their own writing. ` +
    `${SUBJECT_GUIDANCE[opts.subjectKind] || SUBJECT_GUIDANCE.generic}\n` +
    `Be specific and quote the student's actual words when pointing at something. Be honest about weaknesses ` +
    `but constructive - they are still learning. Never rewrite the whole response.\n` +
    `Return ONLY JSON: {"overall": "2-4 sentence overall judgement", "estimated_band": "e.g. Band 4-5", ` +
    `"mark": number or null, "out_of": number or null, ` +
    `"criteria": [{"name": string, "score": 0-5, "comment": "specific, referencing their writing"}], ` +
    `"strengths": [string], "weaknesses": [string], ` +
    `"weak_sections": [{"quote": "exact phrase from their response", "issue": string, "fix": string}], ` +
    `"next_steps": [string]}\n` +
    `Use exactly these criteria names: ${criteria.join(', ')}.`
  const user =
    `QUESTION: ${opts.question || '(no question given - judge it as a standalone response)'}\n` +
    (opts.marks ? `MARKS: ${opts.marks}\n` : '') +
    (opts.contextText ? `\nTHE STUDENT'S OWN MATERIAL (their texts/cases/notes, for reference):\n${opts.contextText.slice(0, 12000)}\n` : '') +
    `\n=== MY RESPONSE ===\n${opts.body.slice(0, 30000)}`
  return await askJson({ system, user, maxTokens: 4000, prefill: '{' })
}

export async function improveParagraph(opts: {
  paragraph: string; question: string; subjectKind: string; instruction?: string
}) {
  const system =
    `You are a NSW HSC writing coach. ${SUBJECT_GUIDANCE[opts.subjectKind] || SUBJECT_GUIDANCE.generic}\n` +
    `Improve the student's paragraph while keeping THEIR argument, THEIR evidence and THEIR voice. ` +
    `Do not invent quotes, cases or statistics that are not already there.\n` +
    `Return ONLY JSON: {"improved": "the improved paragraph", ` +
    `"changes": [{"what": "what you changed", "why": "why it earns more marks"}], ` +
    `"kept": "what was already working and was deliberately left alone"}`
  const user =
    `QUESTION: ${opts.question || '(none given)'}\n` +
    (opts.instruction ? `FOCUS ON: ${opts.instruction}\n` : '') +
    `\n=== MY PARAGRAPH ===\n${opts.paragraph.slice(0, 8000)}`
  return await askJson({ system, user, maxTokens: 2500, prefill: '{' })
}

/** Short teaching explanation for the "Learn" stage of Study Mode. */
export async function learnExplainer(opts: { subjectKind: string; subjectName: string; topic: string; contextText: string }) {
  const system =
    `You are teaching a NSW Year 11 student. ${SUBJECT_GUIDANCE[opts.subjectKind] || SUBJECT_GUIDANCE.generic}\n` +
    `Write a tight teaching explanation they can read in about two minutes before practising. Clean markdown, ` +
    `no preamble. Structure: what this topic is, the 3-5 things that must be understood, the detail that earns marks, ` +
    `and the mistake students most often make. Prefer THEIR material where it is given.`
  const user = `SUBJECT: ${opts.subjectName}\nTOPIC: ${opts.topic}\n\n=== MY MATERIAL ===\n${opts.contextText.slice(0, 25000) || '(none yet)'}`
  return await askText({ system, user, maxTokens: 1500 })
}

/** Aural questions for Music 1 - the excerpt is described in words since audio can't be generated. */
export async function auralQuestions(opts: { focus: string; count: number; contextText: string }) {
  const system =
    `You are a NSW Music 1 teacher writing aural-analysis practice. ${SUBJECT_GUIDANCE.music}\n` +
    `Each question must describe a specific musical excerpt in vivid, technically precise words in the "stimulus" field ` +
    `(instrumentation, tempo, metre, dynamics, articulation, texture, structure), then ask the student to analyse it.\n` +
    QUESTION_SCHEMA
  const user =
    `Write exactly ${opts.count} aural questions focused on: ${opts.focus}.\n` +
    `Vary the styles and periods across questions.\n\n=== MY MATERIAL ===\n${opts.contextText.slice(0, 15000) || '(none)'}`
  const json = await askJson({ system, user, maxTokens: Math.min(12000, 900 + opts.count * 800) })
  return Array.isArray(json) ? json : json.questions || []
}

/** Pull bank entries (quotes, cases, business examples...) out of the student's own material. */
export async function extractBankEntries(opts: { kind: string; subjectName: string; subjectKind: string; contextText: string; count: number }) {
  const shapes: Record<string, string> = {
    quote: '{"title": "the quote itself", "body": "technique used + effect", "detail": "which text/character/scene it comes from", "source": "text name"}',
    technique: '{"title": "technique name", "body": "definition", "detail": "example from my texts + its effect", "source": "text name"}',
    theme: '{"title": "theme", "body": "how the text explores it", "detail": "supporting evidence", "source": "text name"}',
    character: '{"title": "character name", "body": "role and development", "detail": "key quotes", "source": "text name"}',
    case: '{"title": "case name and year", "body": "facts", "detail": "legal principle established and why it matters", "source": "court/jurisdiction"}',
    legislation: '{"title": "Act name and year", "body": "purpose", "detail": "key provisions and effectiveness", "source": "NSW or Cth"}',
    contemporary: '{"title": "the example", "body": "what happened", "detail": "the legal/business issue it illustrates", "source": "media source if known"}',
    business_example: '{"title": "business name", "body": "what it does / the situation", "detail": "which syllabus point it supports and how to use it in a response", "source": "industry"}',
    definition: '{"title": "term", "body": "precise definition", "detail": "example or common misuse", "source": ""}',
  }
  const shape = shapes[opts.kind] || shapes.definition
  const system =
    `You extract study material from a NSW HSC student's own notes. ${SUBJECT_GUIDANCE[opts.subjectKind] || SUBJECT_GUIDANCE.generic}\n` +
    `Return ONLY a JSON array of ${shape}.\n` +
    `Only include items genuinely present in their material - never invent quotes, cases, statistics or businesses.`
  const user = `SUBJECT: ${opts.subjectName}\nExtract up to ${opts.count} items.\n\n=== MY MATERIAL ===\n${opts.contextText.slice(0, 40000)}`
  const json = await askJson({ system, user, maxTokens: 8000 })
  return Array.isArray(json) ? json : []
}

/* ------------------------------------------------------------------ */
/* Handwriting transcription                                           */
/* ------------------------------------------------------------------ */

/**
 * Read handwriting (or any photographed page) with Claude's vision.
 * Far more accurate than classical OCR, which is built for printed type.
 */
export async function transcribeImage(opts: {
  base64: string
  mediaType: string
  subjectName?: string
  hint?: string
}): Promise<string> {
  const anthropic = getClient()
  const system =
    `You transcribe photographed schoolwork for a NSW high-school student. Return the text of the page and nothing else.\n` +
    `Rules:\n` +
    `- Transcribe exactly what is written, including the student's own wording, spelling and abbreviations. Do not correct, improve or summarise.\n` +
    `- Preserve the layout: keep line breaks, headings, numbered and bulleted lists, and indentation where it carries meaning.\n` +
    `- Keep tables as simple rows with columns separated by " | ".\n` +
    `- Mathematical work: transcribe each step on its own line, using plain text (x^2, sqrt, <=, pi, fractions as a/b).\n` +
    `- If a word is genuinely illegible, write [?] rather than guessing. If you can make a confident partial reading, write it followed by [?].\n` +
    `- Describe a diagram, graph or drawing briefly inside square brackets, e.g. [diagram: labelled cell membrane].\n` +
    `- Ignore page furniture such as margin holes, shadows and the desk behind the page.\n` +
    `- If the page is blank or nothing is readable, reply with exactly: (no readable text)`
  const user: any[] = [
    { type: 'image', source: { type: 'base64', media_type: opts.mediaType, data: opts.base64 } },
    {
      type: 'text',
      text:
        `Transcribe this page.` +
        (opts.subjectName ? ` It is ${opts.subjectName} schoolwork.` : '') +
        (opts.hint ? ` ${opts.hint}` : ''),
    },
  ]
  const res = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 8000,
    system,
    messages: [{ role: 'user', content: user }],
  })
  const text = res.content.map((b: any) => (b.type === 'text' ? b.text : '')).join('').trim()
  return text === '(no readable text)' ? '' : text
}

