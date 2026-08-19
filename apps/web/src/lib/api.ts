const BASE = '/api'

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

async function handle(res: Response) {
  const text = await res.text()
  let data: any = null
  try { data = text ? JSON.parse(text) : null } catch { data = { error: text } }
  if (!res.ok) throw new ApiError(data?.error || `Request failed (${res.status})`, res.status)
  return data
}

export const api = {
  get: (path: string) => fetch(BASE + path).then(handle),
  post: (path: string, body?: any) =>
    fetch(BASE + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    }).then(handle),
  put: (path: string, body?: any) =>
    fetch(BASE + path, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    }).then(handle),
  del: (path: string) => fetch(BASE + path, { method: 'DELETE' }).then(handle),
  upload: (path: string, form: FormData, onProgress?: (pct: number) => void) =>
    new Promise<any>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', BASE + path)
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100))
      }
      xhr.onload = () => {
        let data: any = null
        try { data = JSON.parse(xhr.responseText) } catch { data = { error: xhr.responseText } }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data)
        else reject(new ApiError(data?.error || `Upload failed (${xhr.status})`, xhr.status))
      }
      xhr.onerror = () => reject(new ApiError('Network error during upload', 0))
      xhr.send(form)
    }),
}

/* ---------------- shared types ---------------- */

export type Subject = {
  id: string; name: string; kind: string; icon: string; color: string
  position: number; archived: number
  stats?: {
    mastery: number | null
    topics: number; syllabus_points: number; syllabus_done: number; uploads: number
    flashcards: number; due: number; questions: number; accuracy: number | null
  }
}

export type Topic = {
  id: string; subject_id: string; parent_id: string | null; name: string
  scope: 'topic' | 'school'; status: TopicStatus; priority: string
  start_date: string | null; assessment_date: string | null
  teacher_instructions: string; notes: string; links: any[]; position: number; archived: number
}

export type TopicStatus = 'not_started' | 'studying' | 'needs_revision' | 'completed'

export type SyllabusPoint = {
  id: string; subject_id: string; section_id: string | null
  code: string; text: string; status: TopicStatus; position: number
}

export type Upload = {
  id: string; subject_id: string | null; topic_id: string | null; subtopic: string
  title: string; work_type: string; year_level: number; term: number
  school: string; teacher: string; work_date: string; source: string
  original_filename: string; stored_name: string; mime: string; size: number
  extracted_text: string; extract_status: string; extract_error: string; extract_engine?: string
  created_at: string; subject_name?: string; subject_color?: string; topic_name?: string; has_text?: boolean
}

export type Flashcard = {
  id: string; subject_id: string; topic_id: string | null; card_kind: string
  front: string; back: string; extra: string; origin: string
  due_at: string; interval_days: number; ease: number; reps: number; lapses: number
  subject_name?: string; subject_color?: string; topic_name?: string
}

export type Question = {
  id: string; set_id: string; subject_id: string; topic_id: string | null
  qtype: string; difficulty: string; prompt: string; stimulus: string
  options: string[]; answer: string; marking_guide: string; marks: number
  working: string; mode: string; origin: string
}

export type Attempt = {
  id: string; question_id: string; response: string; correct: number | null
  score: number; max_score: number; feedback: string; improvement: string
  graded_by: string; model_answer?: string; working?: string; marking_guide?: string
}

export const WORK_TYPES = [
  'Class Notes', 'Homework', 'Worksheet', 'Assessment', 'Teacher Feedback', 'Syllabus',
  'Textbook Notes', 'Revision', 'Essay', 'Practice Questions', 'Other',
]

export const QUESTION_TYPES: Array<{ value: string; label: string }> = [
  { value: 'mixed', label: 'Mixed' },
  { value: 'multiple_choice', label: 'Multiple choice' },
  { value: 'true_false', label: 'True / false' },
  { value: 'fill_blank', label: 'Fill in the blank' },
  { value: 'definition', label: 'Definitions' },
  { value: 'short_answer', label: 'Short answer' },
  { value: 'extended_response', label: 'Extended response' },
  { value: 'essay', label: 'Essay' },
  { value: 'case_study', label: 'Case study' },
  { value: 'scenario', label: 'Scenario' },
  { value: 'explain', label: 'Explain' },
  { value: 'analyse', label: 'Analyse' },
  { value: 'discuss', label: 'Discuss' },
  { value: 'assess', label: 'Assess' },
  { value: 'evaluate', label: 'Evaluate' },
  { value: 'exam_question', label: 'Exam questions' },
]

export const STATUS_LABELS: Record<TopicStatus, string> = {
  not_started: 'Not started',
  studying: 'Currently studying',
  needs_revision: 'Needs revision',
  completed: 'Completed',
}

export const SUBJECT_KINDS = [
  { value: 'generic', label: 'General' },
  { value: 'english', label: 'English' },
  { value: 'maths', label: 'Mathematics' },
  { value: 'music', label: 'Music' },
  { value: 'dt', label: 'Design & Technology' },
  { value: 'legal', label: 'Legal Studies' },
  { value: 'business', label: 'Business Studies' },
  { value: 'science', label: 'Science' },
]

export const ICONS = ['book', 'pen', 'sigma', 'music', 'compass', 'scale', 'briefcase', 'flask', 'globe', 'code', 'palette', 'heart']
export const ICON_GLYPH: Record<string, string> = {
  book: '📘', pen: '✒️', sigma: '∑', music: '🎵', compass: '📐', scale: '⚖️',
  briefcase: '💼', flask: '🧪', globe: '🌏', code: '⌨️', palette: '🎨', heart: '❤️',
}
export const COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#10b981', '#0ea5e9', '#14b8a6', '#a855f7', '#64748b']

export function fmtDate(d?: string | null) {
  if (!d) return ''
  const date = new Date(d.length <= 10 ? d + 'T00:00:00' : d.replace(' ', 'T'))
  if (isNaN(date.getTime())) return d
  return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function daysUntil(d?: string | null) {
  if (!d) return null
  const date = new Date(d + 'T00:00:00')
  if (isNaN(date.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((date.getTime() - today.getTime()) / 86400000)
}

export function fmtBytes(n: number) {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
