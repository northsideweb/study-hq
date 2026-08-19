# Study HQ

A personal HSC study platform. Study HQ takes the work you actually do at school —
photos of handwritten notes, PDFs, Word documents, pasted text, your own syllabus —
and turns it into practice questions, flashcards, exams and progress tracking.

Built for NSW Stage 6, and designed to carry over from Year 11 into Year 12.

## What it does

**Your material, organised**
- Your own syllabus per subject, entered or imported, with every point tickable
- "What I'm doing at school" tracked separately from the official syllabus
- Uploads via camera (OCR for handwriting), file (PDF / DOCX / PPTX / TXT / images) or pasted text
- Originals are always kept; extracted text is always editable
- Every syllabus point shows the notes, school work, flashcards and questions connected to it

**Study**
- Structured study sessions: learn → recall → practise → apply → exam → review
- Practice generated from *your material* or from the HSC syllabus, with adaptive difficulty
- Infinite practice that never repeats a question
- Skill drills (compound interest, topic sentences, command terms, aural analysis, …)
- A mistake bank that turns everything you got wrong into a targeted practice set
- Spaced-repetition flashcards (SM-2)
- Timed exams with HSC-style sections, auto-marking and weak-topic analysis
- An essay workspace that marks against criteria and improves paragraphs side-by-side

**Subject-specific tools**
- English — quote, technique, theme and character banks; thesis and paragraph practice
- Mathematics Standard — full worked solutions, randomised variations of every question
- Music 1 — aural trainer across the concepts of music
- Design & Technology — design process and major project tracking
- Legal Studies — case, legislation and contemporary example banks
- Business Studies — your own real business examples, 6/10-mark and command-term practice

**Everything else**
- Global search across notes, uploads, OCR text, flashcards, questions, syllabus and assessments
- Tasks, assessment calendar, study timer, streaks and goals
- Right-click context menus throughout
- Export to JSON, Markdown and CSV (the flashcard CSV imports straight into Anki)

## Running it

Requires Node 22 or newer (it uses the built-in `node:sqlite`, so there is nothing to compile).

```bash
npm install
cp .env.example .env
npm run dev
```

Then open http://localhost:5220.

The API runs on port 4100 and the web app proxies `/api` to it.

## AI features

Study HQ works without an API key: it generates randomised Mathematics Standard questions with
full working, and builds flashcards and recall questions from your own notes.

Question generation for other subjects, marking, study plans and the note tools use the Claude API.
To switch them on, put a key in `.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-5
```

The key is only ever read by the server — it is never sent to the browser or stored in the database.

## Your data

Everything lives on your own machine:

- `data/studyhq.db` — SQLite database (subjects, syllabus, notes, questions, progress)
- `data/uploads/` — the original files and photos you upload

Neither is committed to git. To back up, copy the `data` folder.

## Project layout

```
apps/server   Express API, SQLite schema, text extraction/OCR, the AI study engine
apps/web      React + Vite front end
data          your database and uploads (git-ignored)
```

## Stack

TypeScript throughout · Express · `node:sqlite` · React 18 · Vite · TanStack Query · Recharts ·
tesseract.js (OCR) · pdfjs / mammoth (text extraction) · Anthropic SDK
