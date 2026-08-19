import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type Question } from '../lib/api'
import { Loading, ErrorBox, Bar, useToast, useDialogs } from '../components/ui'
import { Icon } from '../components/Icons'
import MathText from '../components/MathText'

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']

export default function ExamRunner() {
  const { examId } = useParams<{ examId: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const dialogs = useDialogs()
  const qc = useQueryClient()

  const [responses, setResponses] = useState<Record<string, string>>({})
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const [results, setResults] = useState<any>(null)

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['exam', examId],
    queryFn: () => api.get(`/exams/${examId}`),
    enabled: !!examId,
  })

  const exam = data?.exam
  const questions: Question[] = data?.questions || []
  const submitted = exam?.status === 'submitted'

  useEffect(() => {
    if (!exam || submitted) return
    const started = new Date(String(exam.started_at).replace(' ', 'T') + 'Z').getTime()
    const endsAt = started + exam.duration_min * 60000
    const tick = () => setSecondsLeft(Math.max(0, Math.round((endsAt - Date.now()) / 1000)))
    tick()
    const iv = setInterval(tick, 1000)
    return () => clearInterval(iv)
  }, [exam, submitted])

  const submit = useMutation({
    mutationFn: () => api.post(`/exams/${examId}/submit`, { responses, minutes_taken: exam.duration_min - (secondsLeft ?? 0) / 60 }),
    onSuccess: (r) => {
      setResults(r)
      refetch()
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['exams'] })
    },
    onError: (e: any) => toast(e.message, 'error', 'Submission failed'),
  })

  // Auto-submit when the clock runs out.
  useEffect(() => {
    if (secondsLeft === 0 && !submitted && !submit.isPending && !results) {
      toast("Time's up — submitting your paper.", 'info')
      submit.mutate()
    }
  }, [secondsLeft])

  const answeredCount = useMemo(() => Object.values(responses).filter((v) => v?.trim()).length, [responses])

  if (isLoading) return <Loading label="Loading exam" />
  if (error) return <ErrorBox error={error} retry={refetch} />
  if (!exam) return null

  const shown = results || (submitted ? {
    score: exam.score,
    max_score: exam.max_score,
    breakdown: exam.breakdown,
    unmarked_marks: exam.breakdown?.unmarked_marks ?? 0,
    recommendations: exam.recommendations,
    results: data.attempts?.map((a: any) => ({
      question_id: a.question_id, score: a.score, max_score: a.max_score,
      feedback: a.feedback, improvement: a.improvement,
    })),
  } : null)

  // Breakdown is { topics: {...}, unmarked_marks } — older rows stored the topic map directly.
  const topicBreakdown: any[] = shown ? Object.values(shown.breakdown?.topics ?? shown.breakdown ?? {}).filter((t: any) => t && typeof t === 'object' && 'max' in t) : []

  const SECTION_OF = (t: string) =>
    t === 'multiple_choice' || t === 'true_false' ? 0
    : t === 'extended_response' || t === 'essay' ? 2
    : 1
  const SECTION_TITLES = ['Section I — Multiple choice', 'Section II — Short answer', 'Section III — Extended response']
  const sections = SECTION_TITLES
    .map((title, idx) => {
      const items = questions.map((q, i) => ({ q, i })).filter(({ q }) => SECTION_OF(q.qtype) === idx)
      return { title, items, marks: items.reduce((a, { q }) => a + Number(q.marks || 0), 0) }
    })
    .filter((s) => s.items.length)

  const mm = secondsLeft !== null ? Math.floor(secondsLeft / 60) : 0
  const ss = secondsLeft !== null ? secondsLeft % 60 : 0
  const timerClass = secondsLeft === null ? '' : secondsLeft < 120 ? 'danger' : secondsLeft < 300 ? 'warn' : ''

  return (
    <div className="stack page narrow" style={{ gap: 16 }}>
      <div className="row">
        <button className="btn quiet sm" onClick={() => navigate('/exams')}><Icon name="chevronLeft" size={14} /> Exams</button>
        <div className="spacer" />
        {!shown && (
          <>
            <span className="tag pill">{answeredCount}/{questions.length} answered</span>
            <span className={`num ${timerClass}`}>{String(mm).padStart(2, '0')}:{String(ss).padStart(2, '0')}</span>
          </>
        )}
      </div>

      <div style={{ marginBottom: 36, paddingBottom: 24, borderBottom: '1px solid var(--line)' }}>
        <div className="row top">
          <div>
            <h1 className="display">{exam.name}</h1>
            <div className="lead" style={{ marginTop: 7 }}>{exam.duration_min} minutes · {questions.length} questions · {exam.max_score} marks</div>
          </div>
          <div className="spacer" />
          {shown && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 27, fontWeight: 700 }}>
                {shown.max_score ? `${Math.round((shown.score / shown.max_score) * 100)}%` : '—'}
              </div>
              <div className="micro">
                {shown.max_score ? `${shown.score} / ${shown.max_score} marks auto-marked` : 'nothing auto-marked'}
              </div>
              {!!shown.unmarked_marks && <div className="micro" style={{ color: 'var(--amber)' }}>{shown.unmarked_marks} marks to self-mark</div>}
            </div>
          )}
        </div>
      </div>

      {shown && (
        <div className="stack" style={{ gap: 12 }}>
          <div className="section">
            <div className="section-head"><h2>Topic breakdown</h2></div>
            {!topicBreakdown.length && <div className="meta">No auto-marked questions to break down.</div>}
            {topicBreakdown.map((t: any, i: number) => {
              const pct = t.max ? Math.round((t.score / t.max) * 100) : 0
              return (
                <div key={i} style={{ marginBottom: 10 }}>
                  <div className="row body" style={{ marginBottom: 4 }}>
                    <span>{t.name}</span><div className="spacer" /><span>{t.score}/{t.max} · {pct}%</span>
                  </div>
                  <Bar value={pct} color={pct >= 80 ? 'var(--bar-green)' : pct >= 50 ? 'var(--bar-amber)' : 'var(--bar-red)'} />
                </div>
              )
            })}
          </div>
          <div className="notice info" style={{ margin: 0 }}>
            <Icon name="target" size={15} />
            <div><strong>What to study next</strong><div style={{ marginTop: 4 }}>{shown.recommendations}</div></div>
          </div>
        </div>
      )}

      {sections.map((sec) => (
        <div className="stack" key={sec.title} style={{ gap: 10 }}>
          <div className="section-head" style={{ marginTop: 6 }}>
            <h2>{sec.title}</h2>
            <span className="tag pill">{sec.items.length} question{sec.items.length === 1 ? '' : 's'} · {sec.marks} mark{sec.marks === 1 ? '' : 's'}</span>
          </div>
          {sec.items.map(({ q, i }: { q: Question; i: number }) => {
        const r = shown?.results?.find((x: any) => x.question_id === q.id)
        const options = q.qtype === 'true_false' && !q.options?.length ? ['True', 'False'] : q.options || []
        return (
          <div key={q.id} style={{ paddingBottom: 28, marginBottom: 28, borderBottom: '1px solid var(--line-soft)' }}>
            <div className="row" style={{ marginBottom: 10 }}>
              <span className="tag pill">Q{i + 1}</span>
              <span className="tag pill">{q.qtype.replace(/_/g, ' ')}</span>
              <div className="spacer" />
              {r ? (
                r.max_score === 0
                  ? <span className="tag amber pill">self-mark · {q.marks} mark{q.marks === 1 ? '' : 's'}</span>
                  : <span className={`tag pill ${r.score === r.max_score ? 'green' : r.score > 0 ? 'amber' : 'red'}`}>{r.score}/{r.max_score}</span>
              ) : (
                <span className="tag pill">{q.marks} mark{q.marks === 1 ? '' : 's'}</span>
              )}
            </div>

            {q.stimulus && (
              <div className="stimulus pre-wrap" style={{ marginBottom: 12 }}><MathText fractions>{q.stimulus}</MathText></div>
            )}

            <div className="question-prompt pre-wrap" style={{ marginBottom: 12 }}><MathText fractions>{q.prompt}</MathText></div>

            {options.length ? (
              <div className="stack" style={{ gap: 7 }}>
                {options.map((opt: string, oi: number) => {
                  const selected = (shown ? (data.attempts?.find((a: any) => a.question_id === q.id)?.response) : responses[q.id]) === opt
                  const correct = shown && opt === q.answer
                  return (
                    <button key={oi} className={`option ${selected ? 'selected' : ''} ${correct ? 'correct' : ''} ${shown && selected && !correct ? 'wrong' : ''}`}
                      disabled={!!shown} onClick={() => setResponses({ ...responses, [q.id]: opt })}>
                      <span className="option-key">{LETTERS[oi]}</span>
                      <span style={{ flex: 1 }}><MathText fractions>{opt}</MathText></span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <textarea
                rows={q.marks > 6 ? 12 : q.marks > 2 ? 6 : 3}
                value={shown ? (data.attempts?.find((a: any) => a.question_id === q.id)?.response || '') : responses[q.id] || ''}
                disabled={!!shown}
                onChange={(e) => setResponses({ ...responses, [q.id]: e.target.value })}
                placeholder="Your answer…"
              />
            )}

            {r && (
              <div className="stack" style={{ gap: 9, marginTop: 12 }}>
                {r.feedback && <div className="body pre-wrap" style={{ padding: 11, background: 'var(--bg-sunken)', borderRadius: 8 }}><strong>Feedback: </strong>{r.feedback}</div>}
                {r.improvement && <div className="body pre-wrap" style={{ padding: 11, background: 'var(--amber-wash)', borderRadius: 8 }}>{r.improvement}</div>}
                <details>
                  <summary style={{ cursor: 'pointer', fontSize: 12.5, color: 'var(--ink-2)' }}>Model answer</summary>
                  <div className="body pre-wrap" style={{ padding: 11, background: 'var(--bg-sunken)', borderRadius: 8, marginTop: 6 }}>
                    <MathText fractions>{q.answer}</MathText>
                    {q.working && <div style={{ marginTop: 8, lineHeight: 2 }}><MathText fractions>{q.working}</MathText></div>}
                  </div>
                </details>
              </div>
            )}
          </div>
        )
      })}
        </div>
      ))}

      {!shown && (
        <button className="btn primary lg block" disabled={submit.isPending} onClick={async () => {
          const missing = questions.length - answeredCount
          const ok = await dialogs.confirm('Submit exam?',
            missing > 0 ? `${missing} question${missing === 1 ? ' is' : 's are'} unanswered. Submit anyway?` : 'Your paper will be marked now.')
          if (ok) submit.mutate()
        }}>
          {submit.isPending ? <><span className="spinner" /> Marking your paper…</> : 'Submit exam'}
        </button>
      )}
    </div>
  )
}
