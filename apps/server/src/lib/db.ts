import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './config.js'

fs.mkdirSync(DATA_DIR, { recursive: true })
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true })

export const db = new DatabaseSync(path.join(DATA_DIR, 'studyhq.db'))

db.exec(`PRAGMA journal_mode = WAL;`)
db.exec(`PRAGMA foreign_keys = ON;`)

db.exec(`
CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT DEFAULT '',
  school TEXT DEFAULT '',
  year_level INTEGER DEFAULT 11,
  term INTEGER DEFAULT 3,
  calendar_year INTEGER DEFAULT 2026,
  state TEXT DEFAULT 'NSW',
  daily_goal_minutes INTEGER DEFAULT 60
);

CREATE TABLE IF NOT EXISTS subjects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT DEFAULT 'generic',          -- english | maths | music | dt | legal | business | generic
  icon TEXT DEFAULT 'book',
  color TEXT DEFAULT '#6366f1',
  position INTEGER DEFAULT 0,
  archived INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Topics: hierarchical (parent_id) and dual-purpose.
-- scope='syllabus_topic' = my own topic tree; scope='school' = WHAT I'M DOING AT SCHOOL
CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES topics(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  scope TEXT DEFAULT 'topic',           -- topic | school
  status TEXT DEFAULT 'not_started',    -- not_started | studying | needs_revision | completed
  priority TEXT DEFAULT 'normal',       -- low | normal | high
  start_date TEXT,
  assessment_date TEXT,
  teacher_instructions TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  links TEXT DEFAULT '[]',              -- JSON array of {label,url}
  position INTEGER DEFAULT 0,
  archived INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS syllabus_sections (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  position INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS syllabus_points (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  section_id TEXT REFERENCES syllabus_sections(id) ON DELETE CASCADE,
  code TEXT DEFAULT '',
  text TEXT NOT NULL,
  status TEXT DEFAULT 'not_started',    -- not_started | studying | needs_revision | completed
  position INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Raw syllabus source material (pasted text / uploaded PDF / photos)
CREATE TABLE IF NOT EXISTS syllabus_docs (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  title TEXT DEFAULT 'Syllabus',
  content TEXT DEFAULT '',
  upload_id TEXT REFERENCES uploads(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
  title TEXT DEFAULT 'Untitled note',
  body TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  subject_id TEXT REFERENCES subjects(id) ON DELETE SET NULL,
  topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
  subtopic TEXT DEFAULT '',
  title TEXT DEFAULT '',
  work_type TEXT DEFAULT 'Other',
  year_level INTEGER,
  term INTEGER,
  school TEXT DEFAULT '',
  teacher TEXT DEFAULT '',
  work_date TEXT,
  source TEXT DEFAULT 'file',           -- paste | file | photo
  original_filename TEXT DEFAULT '',
  stored_name TEXT DEFAULT '',
  mime TEXT DEFAULT '',
  size INTEGER DEFAULT 0,
  extracted_text TEXT DEFAULT '',
  extract_status TEXT DEFAULT 'none',   -- none | pending | ok | failed | unsupported
  extract_error TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Generic relationship graph: syllabus point <-> note / upload / flashcard / question / topic
CREATE TABLE IF NOT EXISTS links (
  id TEXT PRIMARY KEY,
  from_type TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_type TEXT NOT NULL,
  to_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS links_unique ON links(from_type, from_id, to_type, to_id);

CREATE TABLE IF NOT EXISTS flashcards (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
  card_kind TEXT DEFAULT 'basic',       -- basic | quote | technique | theme | character | definition
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  extra TEXT DEFAULT '',
  origin TEXT DEFAULT 'manual',         -- manual | ai | local
  source_upload_id TEXT REFERENCES uploads(id) ON DELETE SET NULL,
  -- SM-2 spaced repetition state
  due_at TEXT DEFAULT (datetime('now')),
  interval_days REAL DEFAULT 0,
  ease REAL DEFAULT 2.5,
  reps INTEGER DEFAULT 0,
  lapses INTEGER DEFAULT 0,
  last_grade TEXT DEFAULT '',
  suspended INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS practice_sets (
  id TEXT PRIMARY KEY,
  subject_id TEXT REFERENCES subjects(id) ON DELETE CASCADE,
  topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
  name TEXT DEFAULT 'Practice set',
  mode TEXT DEFAULT 'my_material',      -- my_material | hsc
  kind TEXT DEFAULT 'set',              -- set | infinite | exam | session
  config TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  set_id TEXT REFERENCES practice_sets(id) ON DELETE CASCADE,
  subject_id TEXT REFERENCES subjects(id) ON DELETE CASCADE,
  topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
  syllabus_point_id TEXT REFERENCES syllabus_points(id) ON DELETE SET NULL,
  qtype TEXT DEFAULT 'short_answer',
  difficulty TEXT DEFAULT 'medium',     -- easy | medium | hard | exam
  prompt TEXT NOT NULL,
  stimulus TEXT DEFAULT '',
  options TEXT DEFAULT '[]',            -- JSON array for MCQ
  answer TEXT DEFAULT '',
  marking_guide TEXT DEFAULT '',
  marks INTEGER DEFAULT 1,
  working TEXT DEFAULT '',
  mode TEXT DEFAULT 'my_material',
  origin TEXT DEFAULT 'ai',
  fingerprint TEXT DEFAULT '',
  position INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  question_id TEXT REFERENCES questions(id) ON DELETE CASCADE,
  exam_id TEXT,
  subject_id TEXT REFERENCES subjects(id) ON DELETE CASCADE,
  topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
  response TEXT DEFAULT '',
  correct INTEGER,                      -- 1 / 0 / NULL when graded by rubric only
  score REAL DEFAULT 0,
  max_score REAL DEFAULT 1,
  feedback TEXT DEFAULT '',
  improvement TEXT DEFAULT '',
  graded_by TEXT DEFAULT 'auto',        -- auto | ai | self
  duration_ms INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS exams (
  id TEXT PRIMARY KEY,
  subject_id TEXT REFERENCES subjects(id) ON DELETE CASCADE,
  set_id TEXT REFERENCES practice_sets(id) ON DELETE SET NULL,
  name TEXT DEFAULT 'Exam',
  duration_min INTEGER DEFAULT 40,
  config TEXT DEFAULT '{}',
  status TEXT DEFAULT 'in_progress',    -- in_progress | submitted
  started_at TEXT DEFAULT (datetime('now')),
  submitted_at TEXT,
  score REAL DEFAULT 0,
  max_score REAL DEFAULT 0,
  breakdown TEXT DEFAULT '{}',
  recommendations TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS assessments (
  id TEXT PRIMARY KEY,
  subject_id TEXT REFERENCES subjects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  topic TEXT DEFAULT '',
  due_date TEXT,
  weighting REAL DEFAULT 0,
  notes TEXT DEFAULT '',
  status TEXT DEFAULT 'upcoming',       -- upcoming | done
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS study_sessions (
  id TEXT PRIMARY KEY,
  plan TEXT DEFAULT '{}',
  started_at TEXT DEFAULT (datetime('now')),
  ended_at TEXT,
  minutes REAL DEFAULT 0,
  summary TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS study_log (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,                    -- YYYY-MM-DD
  subject_id TEXT,
  minutes REAL DEFAULT 0,
  activity TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);


-- ===== v2: tasks, banks, skills, essays, calendar =====

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  subject_id TEXT REFERENCES subjects(id) ON DELETE SET NULL,
  topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  notes TEXT DEFAULT '',
  due_date TEXT,
  priority TEXT DEFAULT 'normal',       -- low | normal | high
  status TEXT DEFAULT 'todo',           -- todo | doing | done
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

-- One flexible store behind every subject-specific "bank":
-- quotes, techniques, themes, characters, legal cases, legislation, contemporary examples,
-- business examples, definitions, materials, DT projects.
CREATE TABLE IF NOT EXISTS bank_entries (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  detail TEXT DEFAULT '',
  source TEXT DEFAULT '',
  tags TEXT DEFAULT '',
  meta TEXT DEFAULT '{}',
  origin TEXT DEFAULT 'manual',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  category TEXT DEFAULT '',
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  position INTEGER DEFAULT 0,
  archived INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS essays (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
  title TEXT DEFAULT 'Untitled response',
  question TEXT DEFAULT '',
  body TEXT DEFAULT '',
  marks INTEGER DEFAULT 0,
  analysis TEXT DEFAULT '',             -- JSON feedback from the marker
  improvements TEXT DEFAULT '[]',       -- JSON [{original, improved, note}]
  upload_id TEXT REFERENCES uploads(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY,
  subject_id TEXT REFERENCES subjects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  kind TEXT DEFAULT 'event',            -- event | revision | deadline | class
  event_date TEXT NOT NULL,
  start_time TEXT DEFAULT '',
  end_time TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_bank_subject ON bank_entries(subject_id, kind);
CREATE INDEX IF NOT EXISTS idx_skills_subject ON skills(subject_id);
CREATE INDEX IF NOT EXISTS idx_events_date ON calendar_events(event_date);

CREATE INDEX IF NOT EXISTS idx_topics_subject ON topics(subject_id);
CREATE INDEX IF NOT EXISTS idx_uploads_subject ON uploads(subject_id);
CREATE INDEX IF NOT EXISTS idx_cards_due ON flashcards(due_at);
CREATE INDEX IF NOT EXISTS idx_attempts_topic ON attempts(topic_id);
CREATE INDEX IF NOT EXISTS idx_questions_set ON questions(set_id);
`)


/** Add a column to an existing table only when it isn't there yet (safe on every boot). */
function addColumn(table: string, column: string, definition: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as any[]
  if (cols.some((c) => c.name === column)) return
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

addColumn('profile', 'weekly_goal_minutes', 'INTEGER DEFAULT 420')
addColumn('profile', 'preferred_difficulty', "TEXT DEFAULT 'adaptive'")
addColumn('notes', 'format', "TEXT DEFAULT 'html'")
addColumn('notes', 'subtopic', "TEXT DEFAULT ''")
addColumn('notes', 'pinned', 'INTEGER DEFAULT 0')
addColumn('questions', 'skill_id', 'TEXT')
addColumn('attempts', 'reviewed', 'INTEGER DEFAULT 0')
addColumn('attempts', 'skill_id', 'TEXT')
addColumn('study_sessions', 'stage', "TEXT DEFAULT ''")
addColumn('study_log', 'session_id', 'TEXT')

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`
}

/** node:sqlite returns null-prototype objects; normalise for JSON + spread safety. */
export function plain<T = any>(row: any): T {
  return row == null ? row : ({ ...row } as T)
}
export function plainAll<T = any>(rows: any[]): T[] {
  return rows.map((r) => ({ ...r }) as T)
}

const DEFAULT_SUBJECTS: Array<[string, string, string, string]> = [
  ['English Standard', 'english', 'pen', '#8b5cf6'],
  ['Mathematics Standard', 'maths', 'sigma', '#0ea5e9'],
  ['Music 1', 'music', 'music', '#ec4899'],
  ['Design & Technology', 'dt', 'compass', '#f59e0b'],
  ['Legal Studies', 'legal', 'scale', '#10b981'],
  ['Business Studies', 'business', 'briefcase', '#ef4444'],
]

export function seed() {
  const p = db.prepare('SELECT id FROM profile WHERE id = 1').get()
  if (!p) {
    db.prepare(
      `INSERT INTO profile (id, name, school, year_level, term, calendar_year, state)
       VALUES (1, 'Jamie', '', 11, 3, 2026, 'NSW')`
    ).run()
  }
  const count = db.prepare('SELECT COUNT(*) AS n FROM subjects').get() as any
  if (!count || count.n === 0) {
    const ins = db.prepare(
      `INSERT INTO subjects (id, name, kind, icon, color, position) VALUES (?,?,?,?,?,?)`
    )
    DEFAULT_SUBJECTS.forEach(([name, kind, icon, color], i) => {
      ins.run(uid('sub'), name, kind, icon, color, i)
    })
  }
}
seed()
