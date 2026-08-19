import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, QUESTION_TYPES } from '../lib/api'
import { Modal, Field, useToast } from '../components/ui'

const DIFFICULTIES = [
  { value: 'adaptive', label: 'Adaptive' },
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
  { value: 'exam', label: 'Exam standard' },
]

const CARD_KINDS = [
  { value: 'basic', label: 'Mixed' },
  { value: 'definition', label: 'Definitions' },
  { value: 'quote', label: 'Quotes' },
  { value: 'technique', label: 'Techniques' },
  { value: 'theme', label: 'Themes' },
  { value: 'character', label: 'Characters' },
]

/** Shared generator used by context menus, subject workspaces and the Practice/Flashcards pages. */
export default function GenerateModal({
  kind, subjectId, topicId, sourceUploadIds, onClose,
  instructions, title, presetQtype, presetCardKind, presetMode, skillId,
}: {
  kind: 'practice' | 'flashcards'
  subjectId?: string
  topicId?: string
  sourceUploadIds?: string[]
  onClose: () => void
  /** Extra guidance passed straight to the generator (used by the subject-specific tools). */
  instructions?: string
  title?: string
  /** Drill one specific skill — results are tracked against it. */
  skillId?: string
  presetQtype?: string
  presetCardKind?: string
  presetMode?: 'my_material' | 'hsc'
}) {
  const navigate = useNavigate()
  const toast = useToast()
  const qc = useQueryClient()

  const [subject, setSubject] = useState(subjectId || '')
  const [topic, setTopic] = useState(topicId || '')
  const [mode, setMode] = useState<'my_material' | 'hsc'>(presetMode || 'my_material')
  const [qtype, setQtype] = useState(presetQtype || 'mixed')
  const [difficulty, setDifficulty] = useState('adaptive')
  const [count, setCount] = useState(kind === 'practice' ? 5 : 10)
  const [infinite, setInfinite] = useState(false)
  const [cardKind, setCardKind] = useState(presetCardKind || 'basic')
  const [sources, setSources] = useState<string[]>(sourceUploadIds || [])

  const { data: subjects } = useQuery({ queryKey: ['subjects'], queryFn: () => api.get('/subjects') })
  const { data: topics } = useQuery({
    queryKey: ['topics', subject],
    queryFn: () => api.get(`/topics?subject_id=${subject}`),
    enabled: !!subject,
  })
  const { data: uploads } = useQuery({
    queryKey: ['uploads', subject],
    queryFn: () => api.get(`/uploads?subject_id=${subject}&limit=60`),
    enabled: !!subject,
  })

  const run = useMutation({
    mutationFn: () =>
      kind === 'practice'
        ? api.post('/practice/generate', {
            subject_id: subject, topic_id: topic || null, mode, qtype, difficulty,
            count, infinite, source_upload_ids: sources.length ? sources : undefined, instructions, skill_id: skillId,
          })
        : api.post('/flashcards/generate', {
            subject_id: subject, topic_id: topic || null, count, card_kind: cardKind,
            mode, source_upload_ids: sources.length ? sources : undefined, instructions,
          }),
    onSuccess: (res: any) => {
      if (res.notice) toast(res.notice, 'info')
      if (kind === 'practice') {
        toast(`${res.questions.length} question${res.questions.length === 1 ? '' : 's'} ready`, 'success')
        navigate(`/practice/${res.set_id}${infinite ? '?infinite=1' : ''}`)
      } else {
        toast(`${res.created} flashcard${res.created === 1 ? '' : 's'} created`, 'success')
        qc.invalidateQueries({ queryKey: ['flashcards'] })
        qc.invalidateQueries({ queryKey: ['flashcard-stats'] })
        qc.invalidateQueries({ queryKey: ['subjects'] })
      }
      onClose()
    },
    onError: (e: any) => toast(e.message, 'error', 'Generation failed'),
  })

  return (
    <Modal
      title={title || (kind === 'practice' ? 'Generate practice' : 'Generate flashcards')}
      subtitle={kind === 'practice' ? 'Questions built from your own material or from the HSC syllabus.' : 'Cards built from your notes, uploads and syllabus.'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!subject || run.isPending} onClick={() => run.mutate()}>
            {run.isPending ? <><span className="spinner" /> Generating…</> : kind === 'practice' ? (infinite ? 'Start infinite practice' : 'Generate questions') : 'Generate cards'}
          </button>
        </>
      }
    >
      <Field label="Subject">
        <select value={subject} onChange={(e) => { setSubject(e.target.value); setTopic(''); setSources([]) }}>
          <option value="">Choose a subject…</option>
          {(subjects || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </Field>

      <Field label="Topic (optional)">
        <select value={topic} onChange={(e) => setTopic(e.target.value)} disabled={!subject}>
          <option value="">Whole subject</option>
          {(topics || []).map((t: any) => (
            <option key={t.id} value={t.id}>{t.scope === 'school' ? '● ' : ''}{t.name}</option>
          ))}
        </select>
      </Field>

      <Field label="Source" hint={mode === 'my_material'
        ? 'Questions stay inside what you have actually added — your notes, uploads, syllabus and teacher material.'
        : 'Questions follow the NSW Stage 6 syllabus and HSC exam style, using your material as context.'}>
        <div className="row">
          <button className={`chip ${mode === 'my_material' ? 'on' : ''}`} onClick={() => setMode('my_material')}>My material</button>
          <button className={`chip ${mode === 'hsc' ? 'on' : ''}`} onClick={() => setMode('hsc')}>HSC practice</button>
        </div>
      </Field>

      {kind === 'practice' ? (
        <>
          <Field label="Question type">
            <select value={qtype} onChange={(e) => setQtype(e.target.value)}>
              {QUESTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Difficulty" hint={difficulty === 'adaptive' ? 'Adaptive picks the level from your recent accuracy on this topic.' : undefined}>
            <div className="row wrap">
              {DIFFICULTIES.map((d) => (
                <button key={d.value} className={`chip ${difficulty === d.value ? 'on' : ''}`} onClick={() => setDifficulty(d.value)}>{d.label}</button>
              ))}
            </div>
          </Field>
          <Field label={`Number of questions: ${count}`}>
            <input type="range" min={1} max={20} value={count} onChange={(e) => setCount(Number(e.target.value))} disabled={infinite} />
          </Field>
          <label className="row" style={{ cursor: 'pointer', gap: 8 }}>
            <input type="checkbox" checked={infinite} style={{ width: 16 }} onChange={(e) => setInfinite(e.target.checked)} />
            <div>
              <div style={{ fontWeight: 550 }}>Infinite practice</div>
              <div className="micro">Keeps generating fresh questions — new numbers, scenarios and wording — until you stop.</div>
            </div>
          </label>
        </>
      ) : (
        <>
          <Field label="Card type">
            <div className="row wrap">
              {CARD_KINDS.map((c) => (
                <button key={c.value} className={`chip ${cardKind === c.value ? 'on' : ''}`} onClick={() => setCardKind(c.value)}>{c.label}</button>
              ))}
            </div>
          </Field>
          <Field label="How many cards">
            <div className="row wrap">
              {[10, 25, 50, 100].map((n) => (
                <button key={n} className={`chip ${count === n ? 'on' : ''}`} onClick={() => setCount(n)}>{n}</button>
              ))}
              <input type="number" min={1} max={200} value={count} onChange={(e) => setCount(Number(e.target.value))} style={{ width: 78 }} />
            </div>
          </Field>
        </>
      )}

      {!!uploads?.length && (
        <Field label="Build from specific uploads (optional)" hint="Leave empty to use everything in this subject/topic.">
          <div className="stack" style={{ gap: 4, maxHeight: 170, overflowY: 'auto' }}>
            {uploads.map((u: any) => (
              <label key={u.id} className="row body" style={{ cursor: 'pointer', gap: 8 }}>
                <input
                  type="checkbox"
                  style={{ width: 15 }}
                  checked={sources.includes(u.id)}
                  onChange={(e) => setSources((s) => (e.target.checked ? [...s, u.id] : s.filter((x) => x !== u.id)))}
                />
                <span className="truncate" style={{ flex: 1 }}>{u.title || u.original_filename}</span>
                <span className="tag pill">{u.work_type}</span>
              </label>
            ))}
          </div>
        </Field>
      )}
    </Modal>
  )
}
