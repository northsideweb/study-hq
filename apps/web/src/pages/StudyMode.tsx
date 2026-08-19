import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type Question, type Attempt, type Flashcard } from '../lib/api'
import { Icon } from '../components/Icons'
import { Loading, ErrorBox, Bar, Empty, useToast } from '../components/ui'
import { mdToHtml } from './NoteEditor'

type StageId = 'learn' | 'recall' | 'practice' | 'apply' | 'exam' | 'review'

const STAGES: Array<{ id: StageId; label: string; blurb: string; icon: string }> = [
  { id: 'learn', icon: 'book', label: 'Learn', blurb: 'Read the key ideas before you practise' },
  { id: 'recall', icon: 'cards', label: 'Recall', blurb: 'Flashcards and quick recall' },
  { id: 'practice', icon: 'pencil', label: 'Practice', blurb: 'Questions on this topic' },
  { id: 'apply', icon: 'target', label: 'Apply', blurb: 'A scenario or case study' },
  { id: 'exam', icon: 'clock', label: 'Exam', blurb: 'One exam-style question' },
  { id: 'review', icon: 'refresh', label: 'Review', blurb: 'What to fix and what is next' },
]

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']
const LONG = new Set(['extended_response', 'essay', 'case_study', 'discuss', 'assess', 'evaluate', 'analyse', 'explain', 'scenario'])

export default function StudyMode() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const qc = useQueryClient()

  const [stage, setStage] = useState<StageId>('learn')
  const [blockIndex, setBlockIndex] = useState(0)
  const [results, setResults] = useState<Attempt[]>([])
  const [elapsed, setElapsed] = useState(0)
  const startedAt = useRef(Date.now())

  const { data: session, isLoading, error, refetch } = useQuery({
    queryKey: ['session', sessionId], queryFn: () => api.get(`/session/${sessionId}`), enabled: !!sessionId,
  })

  useEffect(() => { const iv = setInterval(() => setElapsed((e) => e + 1), 1000); return () => clearInterval(iv) }, [])

  const blocks = session?.plan?.blocks || []
  const block = blocks[blockIndex] || {}
  const subjectId: string | null = block.subject_id || null
  const topicId: string | null = block.topic_id || null

  const finish = useMutation({
    mutationFn: () => api.post(`/session/${sessionId}/finish`, {
      minutes: Math.round(elapsed / 60),
      summary: `${results.length} questions answered across ${STAGES.findIndex((s) => s.id === stage) + 1} stages`,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      toast(`Session logged — ${Math.round(elapsed / 60)} minutes`, 'success')
      navigate('/')
    },
  })

  if (isLoading) return <Loading label="Loading your session" />
  if (error) return <ErrorBox error={error} retry={refetch} />
  if (!blocks.length) return <ErrorBox error={{ message: 'This session has no plan.' }} />

  const stageIndex = STAGES.findIndex((s) => s.id === stage)
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const ss = String(elapsed % 60).padStart(2, '0')
  const next = () => {
    const i = STAGES.findIndex((s) => s.id === stage)
    if (i < STAGES.length - 1) setStage(STAGES[i + 1].id)
  }

  return (
    <div className="stack page narrow" style={{ gap: 16 }}>
      <div className="row" style={{ marginBottom: 28 }}>
        <button className="btn quiet sm" onClick={() => navigate('/')}><Icon name="chevronLeft" size={14} /> Dashboard</button>
        <div className="spacer" />
        <span className="tag pill">{mm}:{ss}</span>
        <button className="btn sm" onClick={() => finish.mutate()} disabled={finish.isPending}>Finish session</button>
      </div>

      <div style={{ marginBottom: 34 }}>
        <div className="row top" style={{ marginBottom: 4 }}>
          <div>
            <h1 className="display" style={{ fontSize: 24 }}>{block.subject || 'Study session'}{block.topic && block.topic !== block.subject ? ` — ${block.topic}` : ''}</h1>
            <div className="meta">{session.plan.rationale}</div>
          </div>
          <div className="spacer" />
          {blocks.length > 1 && (
            <select value={blockIndex} onChange={(e) => { setBlockIndex(Number(e.target.value)); setStage('learn') }} style={{ width: 200 }}>
              {blocks.map((b: any, i: number) => <option key={i} value={i}>{i + 1}. {b.subject} — {b.topic}</option>)}
            </select>
          )}
        </div>
        <div style={{ marginTop: 18 }}><Bar value={((stageIndex + 1) / STAGES.length) * 100} /></div>
        <div className="row wrap" style={{ marginTop: 16, gap: 6 }}>
          {STAGES.map((s, i) => (
            <button key={s.id} className={`chip ${stage === s.id ? 'on' : ''}`} onClick={() => setStage(s.id)}
              style={i < stageIndex ? { borderColor: 'var(--green)', color: stage === s.id ? '#fff' : 'var(--green)' } : undefined}>
              {i < stageIndex ? '✓ ' : ''}{i + 1}. {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="fade-in" key={stage + blockIndex}>
        {stage === 'learn' && <LearnStage subjectId={subjectId} topicId={topicId} topic={block.topic} detail={block.detail} onNext={next} />}
        {stage === 'recall' && <RecallStage subjectId={subjectId} topicId={topicId} onNext={next} />}
        {stage === 'practice' && <QuestionStage key="practice" subjectId={subjectId} topicId={topicId} count={3} qtype="mixed" difficulty="adaptive"
          heading="Practice" blurb="Questions on this topic, adapting to how you go." onResult={(r: Attempt) => setResults((x) => [...x, r])} onNext={next} />}
        {stage === 'apply' && <QuestionStage key="apply" subjectId={subjectId} topicId={topicId} count={1} qtype="case_study" difficulty="hard"
          heading="Apply" blurb="Use what you know in an unfamiliar scenario." onResult={(r: Attempt) => setResults((x) => [...x, r])} onNext={next} />}
        {stage === 'exam' && <QuestionStage key="exam" subjectId={subjectId} topicId={topicId} count={1} qtype="exam_question" difficulty="exam"
          heading="Exam" blurb="One exam-style question, marked against the criteria." onResult={(r: Attempt) => setResults((x) => [...x, r])} onNext={next} />}
        {stage === 'review' && <ReviewStage results={results} subjectId={subjectId} minutes={Math.round(elapsed / 60)} onFinish={() => finish.mutate()} />}
      </div>
    </div>
  )
}

/* ---------------- stage 1: learn ---------------- */

function LearnStage({ subjectId, topicId, topic, detail, onNext }: any) {
  const { data: ai } = useQuery({ queryKey: ['ai-status'], queryFn: () => api.get('/ai/status') })
  const { data: notes } = useQuery({
    queryKey: ['notes', subjectId], queryFn: () => api.get(`/notes?subject_id=${subjectId}`), enabled: !!subjectId,
  })
  const { data: uploads } = useQuery({
    queryKey: ['uploads', subjectId, 'learn'], queryFn: () => api.get(`/uploads?subject_id=${subjectId}&limit=8`), enabled: !!subjectId,
  })

  const explain = useMutation({ mutationFn: () => api.post('/study/learn', { subject_id: subjectId, topic_id: topicId, topic }) })

  useEffect(() => { if (subjectId && ai?.configured) explain.mutate() }, [subjectId, ai?.configured])

  return (
    <div className="stack">
      <div>
        <div className="section-head">
          <h2>Learn</h2>
          <span className="meta">Step 1 of 6</span>
        </div>
        {detail && <div className="notice info" style={{ marginBottom: 12 }}><Icon name="target" size={14} /><div>{detail}</div></div>}

        {explain.isPending && <div className="row ink-3" style={{ gap: 8 }}><span className="spinner" /> Writing your explainer…</div>}
        {explain.data?.text && <div className="prose" dangerouslySetInnerHTML={{ __html: mdToHtml(explain.data.text) }} />}
        {explain.isError && (
          <div className="notice warn"><Icon name="alert" size={14} /><div>{(explain.error as any)?.message}</div></div>
        )}
        {!ai?.configured && (
          <div className="stack" style={{ gap: 10 }}>
            <div className="notice info">
              <Icon name="book" size={14} />
              <div>AI explainers need an API key. Here is your own material on this topic to read through first.</div>
            </div>
            {notes?.length ? (
              <div className="rows">
                {notes.slice(0, 5).map((n: any) => (
                  <a className="row-item link" key={n.id} href={`/notes/${n.id}`}>
                    <Icon name="note" size={14} className="ink-3" />
                    <span className="body truncate" style={{ flex: 1 }}>{n.title}</span>
                  </a>
                ))}
              </div>
            ) : null}
            {uploads?.length ? (
              <div className="rows">
                {uploads.slice(0, 5).map((u: any) => (
                  <div className="row-item" key={u.id}>
                    <Icon name="file" size={14} className="ink-3" />
                    <span className="body truncate" style={{ flex: 1 }}>{u.title || u.original_filename}</span>
                    <span className="tag pill">{u.work_type}</span>
                  </div>
                ))}
              </div>
            ) : null}
            {!notes?.length && !uploads?.length && (
              <Empty title="No material for this topic yet" message="Add notes or upload school work so the Learn stage has something to show." />
            )}
          </div>
        )}
      </div>
      <div className="row"><div className="spacer" /><button className="btn primary" onClick={onNext}>Start recall <Icon name="arrowRight" size={14} /></button></div>
    </div>
  )
}

/* ---------------- stage 2: recall ---------------- */

function RecallStage({ subjectId, topicId, onNext }: any) {
  const qc = useQueryClient()
  const [flipped, setFlipped] = useState(false)
  const [queue, setQueue] = useState<Flashcard[] | null>(null)
  const [done, setDone] = useState(0)

  const { data: cards, isLoading } = useQuery<Flashcard[]>({
    queryKey: ['flashcards', 'due', subjectId, topicId, 'study'],
    queryFn: () => api.get(`/flashcards?due=true&limit=20${subjectId ? `&subject_id=${subjectId}` : ''}${topicId ? `&topic_id=${topicId}` : ''}`),
    enabled: !!subjectId,
  })

  useEffect(() => { if (cards && queue === null) setQueue(cards) }, [cards])

  const grade = useMutation({
    mutationFn: ({ id, g }: any) => api.post(`/flashcards/${id}/review`, { grade: g }),
    onSuccess: (_r, v: any) => {
      setQueue((q) => (v.g === 'again' ? [...(q || []).slice(1), (q || [])[0]] : (q || []).slice(1)))
      setFlipped(false)
      setDone((d) => d + 1)
      qc.invalidateQueries({ queryKey: ['flashcard-stats'] })
    },
  })

  const generate = useMutation({
    mutationFn: () => api.post('/flashcards/generate', { subject_id: subjectId, topic_id: topicId, count: 8 }),
    onSuccess: (r: any) => { setQueue(r.cards); qc.invalidateQueries({ queryKey: ['flashcards'] }) },
  })

  if (isLoading) return <Loading />
  const card = queue?.[0]

  return (
    <div className="stack">
      <div>
        <div className="section-head">
          <h2>Recall</h2>
          <span className="meta">{done} done{queue?.length ? ` · ${queue.length} left` : ''}</span>
        </div>

        {!card ? (
          <Empty
            title={done ? 'Recall complete' : 'No cards due for this topic'}
            message={done ? `You reviewed ${done} card${done === 1 ? '' : 's'}.` : 'Generate a quick set to warm up, or move straight to practice.'}
            action={!done ? (
              <button className="btn sm primary" onClick={() => generate.mutate()} disabled={generate.isPending}>
                {generate.isPending ? <><span className="spinner" /> Generating…</> : 'Generate 8 cards'}
              </button>
            ) : undefined}
          />
        ) : (
          <>
            <div className="flashcard" onClick={() => setFlipped((f) => !f)}>
              {!flipped ? (
                <>
                  <div className="flashcard-front pre-wrap">{card.front}</div>
                  <div className="micro" style={{ marginTop: 16 }}>Click to flip</div>
                </>
              ) : (
                <>
                  <div className="micro" style={{ marginBottom: 10 }}>{card.front}</div>
                  <div className="flashcard-back pre-wrap">{card.back}</div>
                </>
              )}
            </div>
            {flipped ? (
              <div className="row" style={{ gap: 7, marginTop: 12 }}>
                {[['again', 'Again', 'var(--red)'], ['hard', 'Hard', 'var(--amber)'], ['good', 'Good', 'var(--green)'], ['easy', 'Easy', 'var(--blue)']].map(([g, label, color]) => (
                  <button key={g} className="btn" style={{ flex: 1, color, borderColor: color }} onClick={() => grade.mutate({ id: card.id, g })}>{label}</button>
                ))}
              </div>
            ) : (
              <button className="btn primary block" style={{ marginTop: 12 }} onClick={() => setFlipped(true)}>Show answer</button>
            )}
          </>
        )}
      </div>
      <div className="row"><div className="spacer" /><button className="btn primary" onClick={onNext}>Go to practice <Icon name="arrowRight" size={14} /></button></div>
    </div>
  )
}

/* ---------------- stages 3-5: questions ---------------- */

function QuestionStage({ subjectId, topicId, count, qtype, difficulty, heading, blurb, onResult, onNext }: any) {
  const toast = useToast()
  const [index, setIndex] = useState(0)
  const [response, setResponse] = useState('')
  const [result, setResult] = useState<Attempt | null>(null)
  const started = useRef(Date.now())

  const gen = useMutation({
    mutationFn: () => api.post('/practice/generate', { subject_id: subjectId, topic_id: topicId, count, qtype, difficulty, mode: 'my_material' }),
    onError: (e: any) => toast(e.message, 'error', 'Could not generate questions'),
  })

  useEffect(() => { if (subjectId) gen.mutate() }, [subjectId])

  const questions: Question[] = gen.data?.questions || []
  const q = questions[index]

  const submit = useMutation({
    mutationFn: () => api.post('/attempts', { question_id: q.id, response, duration_ms: Date.now() - started.current }),
    onSuccess: (r: Attempt) => { setResult(r); onResult(r) },
    onError: (e: any) => toast(e.message, 'error'),
  })

  const selfMark = useMutation({
    mutationFn: (correct: boolean) => api.put(`/attempts/${result!.id}/self-mark`, { correct }),
    onSuccess: (r: Attempt) => { setResult({ ...result!, ...r }); onResult({ ...result!, ...r }) },
  })

  const advance = () => {
    if (index + 1 < questions.length) { setIndex(index + 1); setResponse(''); setResult(null); started.current = Date.now() }
    else onNext()
  }

  if (gen.isPending) return <div className="card row" style={{ gap: 9 }}><span className="spinner" /> Writing your questions…</div>
  if (gen.isError) {
    return (
      <div className="stack">
        <div className="notice error"><Icon name="alert" size={15} /><div>{(gen.error as any)?.message}</div></div>
        <div className="row">
          <button className="btn" onClick={() => gen.mutate()}>Try again</button>
          <div className="spacer" />
          <button className="btn primary" onClick={onNext}>Skip this stage <Icon name="arrowRight" size={14} /></button>
        </div>
      </div>
    )
  }
  if (!q) return (
    <div className="stack">
      <Empty title="No questions available" message="Add material for this topic, or move on to the next stage." />
      <div className="row"><div className="spacer" /><button className="btn primary" onClick={onNext}>Next stage</button></div>
    </div>
  )

  const options = q.qtype === 'true_false' && !q.options?.length ? ['True', 'False'] : q.options || []

  return (
    <div className="stack">
      <div>
        <div className="section-head">
          <div>
            <h2>{heading}</h2>
            <div className="sub">{blurb}</div>
          </div>
          <div className="section-actions">
            <span className="meta num">{index + 1} / {questions.length}</span>
            <span className="tag">{q.marks} {q.marks === 1 ? 'mark' : 'marks'}</span>
          </div>
        </div>

        {q.stimulus && <div className="stimulus pre-wrap" style={{ marginBottom: 12 }}>{q.stimulus}</div>}
        <div className="question-prompt pre-wrap" style={{ marginBottom: 12 }}>{q.prompt}</div>

        {options.length ? (
          <div className="stack tight">
            {options.map((opt, i) => {
              const selected = response === opt
              const correct = !!result && opt === (result.model_answer || q.answer)
              return (
                <button key={i} className={`option ${selected ? 'selected' : ''} ${correct ? 'correct' : ''} ${result && selected && !correct ? 'wrong' : ''}`}
                  disabled={!!result} onClick={() => setResponse(opt)}>
                  <span className="option-key">{LETTERS[i]}</span><span style={{ flex: 1 }}>{opt}</span>
                </button>
              )
            })}
          </div>
        ) : (
          <textarea rows={LONG.has(q.qtype) ? 12 : 4} value={response} disabled={!!result}
            onChange={(e) => setResponse(e.target.value)} placeholder="Your answer…" />
        )}

        {!result ? (
          <div className="row" style={{ marginTop: 12 }}>
            <div className="spacer" />
            <button className="btn quiet" onClick={advance}>Skip</button>
            <button className="btn primary" disabled={!response.trim() || submit.isPending} onClick={() => submit.mutate()}>
              {submit.isPending ? <><span className="spinner" /> Marking…</> : 'Submit'}
            </button>
          </div>
        ) : (
          <div className="stack fade-in" style={{ marginTop: 14 }}>
            <div className="row wrap">
              <span className={`tag pill ${result.max_score === 0 ? '' : result.score === result.max_score ? 'green' : result.score > 0 ? 'amber' : 'red'}`}>
                {result.max_score === 0 ? 'Self-mark' : `${result.score} / ${result.max_score}`}
              </span>
              <span className="micro">{result.graded_by === 'ai' ? 'Marked against the criteria' : result.graded_by === 'auto' ? 'Auto-marked' : 'Compare with the model answer'}</span>
              {result.max_score === 0 && (
                <>
                  <div className="spacer" />
                  <button className="btn sm" style={{ color: 'var(--green)', borderColor: 'var(--green)' }} onClick={() => selfMark.mutate(true)}>Got it</button>
                  <button className="btn sm" style={{ color: 'var(--red)', borderColor: 'var(--red)' }} onClick={() => selfMark.mutate(false)}>Missed it</button>
                </>
              )}
            </div>
            {result.feedback && <div className="notice info"><Icon name="sparkle" size={14} /><div className="pre-wrap">{result.feedback}</div></div>}
            {result.improvement && (
              <div style={{ padding: 11, background: 'var(--amber-wash)', borderRadius: 8, color: 'var(--ink)' }}>
                <div className="eyebrow" style={{ color: 'var(--amber)', marginBottom: 3 }}>How to improve</div>
                <div className="body pre-wrap">{result.improvement}</div>
              </div>
            )}
            {(result.model_answer || result.working) && (
              <details>
                <summary className="meta" style={{ cursor: 'pointer' }}>Model answer & working</summary>
                <div className="body pre-wrap" style={{ padding: 11, background: 'var(--bg-sunken)', borderRadius: 8, marginTop: 6 }}>
                  {result.model_answer}
                  {result.working && <div className="mono" style={{ marginTop: 8 }}>{result.working}</div>}
                </div>
              </details>
            )}
            <div className="row"><div className="spacer" />
              <button className="btn primary" onClick={advance}>{index + 1 < questions.length ? 'Next question' : 'Next stage'} <Icon name="arrowRight" size={14} /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------------- stage 6: review ---------------- */

function ReviewStage({ results, subjectId, minutes, onFinish }: any) {
  const navigate = useNavigate()
  const { data: recs } = useQuery({ queryKey: ['recommendations'], queryFn: () => api.get('/recommendations?limit=3') })

  const scored = results.filter((r: Attempt) => r.max_score > 0)
  const score = scored.reduce((a: number, r: Attempt) => a + r.score, 0)
  const max = scored.reduce((a: number, r: Attempt) => a + r.max_score, 0)
  const pct = max ? Math.round((score / max) * 100) : null
  const wrong = results.filter((r: Attempt) => r.max_score > 0 && r.score < r.max_score)

  return (
    <div className="stack">
      <div>
        <div className="section-head"><h2>Review</h2></div>
        <div className="metrics ruled" style={{ marginBottom: 14 }}>
          <div className="metric"><div className="metric-label">Questions</div><div className="metric-value">{results.length}</div></div>
          <div className="metric"><div className="metric-label">Score</div><div className="metric-value">{pct === null ? '—' : `${pct}%`}</div>
            <div className="metric-note">{max ? `${score}/${max} marks` : 'nothing auto-marked'}</div></div>
          <div className="metric"><div className="metric-label">Time</div><div className="metric-value">{minutes}<span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-3)' }}> min</span></div></div>
        </div>

        {wrong.length ? (
          <>
            <h3 style={{ marginBottom: 8 }}>What to fix</h3>
            <div className="stack tight">
              {wrong.map((r: Attempt, i: number) => (
                <div className="panel" key={i} style={{ background: 'var(--bg-sunken)' }}>
                  <div className="row micro" style={{ marginBottom: 4 }}>
                    <span className="tag red pill">{r.score}/{r.max_score}</span>
                    <span className="ink-4">Your answer: {(r.response || '').slice(0, 70) || '(blank)'}</span>
                  </div>
                  <div className="body pre-wrap">{r.improvement || r.feedback}</div>
                </div>
              ))}
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn sm" onClick={() => navigate(`/practice?tab=mistakes${subjectId ? `&subject=${subjectId}` : ''}`)}>
                <Icon name="refresh" size={13} /> Practise these mistakes
              </button>
            </div>
          </>
        ) : (
          <div className="notice ok"><Icon name="check" size={15} /><div>Nothing wrong this session. Step the difficulty up next time.</div></div>
        )}
      </div>

      <div className="section">
        <div className="section-head"><h2>What to do next</h2></div>
        <div className="stack tight">
          {(recs || []).map((r: any, i: number) => (
            <div className="row-item link" key={i} onClick={() => navigate(`/practice?subject=${r.subject_id}&topic=${r.topic_id || ''}&generate=1`)}>
              <Icon name="target" size={14} style={{ color: 'var(--blue)' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="body strong truncate">{r.title}</div>
                <div className="micro ink-4 truncate">{r.why}</div>
              </div>
              <span className="tag pill">{r.minutes} min</span>
            </div>
          ))}
        </div>
      </div>

      <button className="btn primary lg block" onClick={onFinish}>Finish session · log {minutes} min</button>
    </div>
  )
}
