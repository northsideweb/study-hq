import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type Question, type Attempt } from '../lib/api'
import { Loading, ErrorBox, useToast, Bar } from '../components/ui'
import { Icon } from '../components/Icons'

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']
const TYPED_LONG = new Set(['extended_response', 'essay', 'case_study', 'discuss', 'assess', 'evaluate', 'analyse', 'explain', 'scenario'])

export default function PracticeRunner() {
  const { setId } = useParams<{ setId: string }>()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()
  const qc = useQueryClient()

  const infinite = params.get('infinite') === '1'
  const [index, setIndex] = useState(0)
  const [response, setResponse] = useState('')
  const [result, setResult] = useState<Attempt | null>(null)
  const [answered, setAnswered] = useState<Record<string, Attempt>>({})
  const startedAt = useRef(Date.now())

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['practice-set', setId],
    queryFn: () => api.get(`/practice/sets/${setId}`),
    enabled: !!setId,
  })

  const questions: Question[] = data?.questions || []
  const q = questions[index]

  useEffect(() => { startedAt.current = Date.now() }, [index])

  const submit = useMutation({
    mutationFn: () => api.post('/attempts', { question_id: q.id, response, duration_ms: Date.now() - startedAt.current }),
    onSuccess: (r: Attempt) => {
      setResult(r)
      setAnswered((a) => ({ ...a, [q.id]: r }))
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['subjects'] })
    },
    onError: (e: any) => toast(e.message, 'error', 'Could not mark this answer'),
  })

  const more = useMutation({
    mutationFn: () => {
      const cfg = JSON.parse(data?.set?.config || '{}')
      return api.post('/practice/generate', {
        ...cfg,
        set_id: setId,
        subject_id: data.set.subject_id,
        topic_id: data.set.topic_id,
        mode: data.set.mode,
        count: 3,
      })
    },
    onSuccess: async (r: any) => {
      if (r.notice) toast(r.notice, 'info')
      await refetch()
      setIndex((i) => i + 1)
      reset()
    },
    onError: (e: any) => toast(e.message, 'error', 'Could not generate more questions'),
  })

  const selfMark = useMutation({
    mutationFn: (correct: boolean) => api.put(`/attempts/${result!.id}/self-mark`, { correct }),
    onSuccess: (r: Attempt) => {
      setResult({ ...result!, ...r })
      setAnswered((a) => ({ ...a, [q.id]: { ...result!, ...r } }))
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['mistakes'] })
      toast(r.correct ? 'Marked correct' : 'Saved to your mistake bank', 'success')
    },
  })

  const reset = () => { setResponse(''); setResult(null) }

  const next = async () => {
    if (index + 1 < questions.length) { setIndex(index + 1); reset(); return }
    if (infinite || data?.set?.kind === 'infinite') { more.mutate(); return }
    toast('That was the last question in this set.', 'info')
  }

  const stats = useMemo(() => {
    const list = Object.values(answered)
    const score = list.reduce((a, r) => a + r.score, 0)
    const max = list.reduce((a, r) => a + r.max_score, 0)
    return { count: list.length, score, max, pct: max ? Math.round((score / max) * 100) : null }
  }, [answered])

  if (isLoading) return <Loading label="Loading practice" />
  if (error) return <ErrorBox error={error} retry={refetch} />
  if (!q) return <ErrorBox error={{ message: 'This practice set has no questions.' }} />

  const isMcq = q.qtype === 'multiple_choice' || q.qtype === 'true_false'
  const options = q.qtype === 'true_false' && !q.options?.length ? ['True', 'False'] : q.options || []

  return (
    <div className="page narrow">
      <div className="row" style={{ marginBottom: 34 }}>
        <button className="btn quiet sm" onClick={() => navigate(-1)}><Icon name="chevronLeft" size={14} /> Back</button>
        <div className="spacer" />
        {stats.count > 0 && <span className="meta num">{stats.count} answered{stats.pct !== null ? ` · ${stats.pct}%` : ''}</span>}
      </div>

      <header style={{ marginBottom: 32 }}>
        <div className="eyebrow">{data.set.name} · {data.set.mode === 'hsc' ? 'HSC practice' : 'My material'}</div>
        <div className="row" style={{ gap: 14, marginTop: 10 }}>
          <span className="display" style={{ fontSize: 23 }}>
            {(infinite || data.set.kind === 'infinite') ? `Question ${index + 1} of ∞` : `Question ${index + 1} of ${questions.length}`}
          </span>
          <div className="spacer" />
          <span className="tag">{q.qtype.replace(/_/g, ' ')}</span>
          <span className="tag">{q.difficulty}</span>
          <span className="tag">{q.marks} {q.marks === 1 ? 'mark' : 'marks'}</span>
          {q.origin === 'local' && <span className="tag amber" title="Generated offline without the AI">offline</span>}
        </div>
        {!(infinite || data.set.kind === 'infinite') && (
          <div style={{ marginTop: 20 }}><Bar value={((index + 1) / questions.length) * 100} /></div>
        )}
      </header>

      <div>
        {q.stimulus && <div className="stimulus pre-wrap" style={{ marginBottom: 24 }}>{q.stimulus}</div>}

        <div className="question-prompt pre-wrap" style={{ marginBottom: 26 }}>{q.prompt}</div>

        {isMcq ? (
          <div className="stack" style={{ gap: 8 }}>
            {options.map((opt, i) => {
              const selected = response === opt
              const showCorrect = !!result && opt === (result.model_answer || q.answer)
              const showWrong = !!result && selected && !showCorrect
              return (
                <button key={i} className={`option ${selected ? 'selected' : ''} ${showCorrect ? 'correct' : ''} ${showWrong ? 'wrong' : ''}`}
                  disabled={!!result} onClick={() => setResponse(opt)}>
                  <span className="option-key">{LETTERS[i]}</span>
                  <span style={{ flex: 1 }}>{opt}</span>
                  {showCorrect && <span>✓</span>}
                  {showWrong && <span>✕</span>}
                </button>
              )
            })}
          </div>
        ) : (
          <textarea
            rows={TYPED_LONG.has(q.qtype) ? 14 : 4}
            value={response}
            disabled={!!result}
            onChange={(e) => setResponse(e.target.value)}
            placeholder={TYPED_LONG.has(q.qtype) ? 'Write your full response…' : 'Your answer…'}
          />
        )}

        {!result ? (
          <div className="row" style={{ marginTop: 24 }}>
            <span className="micro">
              {TYPED_LONG.has(q.qtype) ? `${response.trim().split(/\s+/).filter(Boolean).length} words` : ''}
            </span>
            <div className="spacer" />
            <button className="btn quiet" onClick={next}>Skip</button>
            <button className="btn primary" disabled={!response.trim() || submit.isPending} onClick={() => submit.mutate()}>
              {submit.isPending ? <><span className="spinner" /> Marking…</> : 'Submit answer'}
            </button>
          </div>
        ) : (
          <div className="stack fade-in" style={{ marginTop: 28, gap: 18, paddingTop: 24, borderTop: '1px solid var(--line)' }}>
            <div className="row wrap">
              <span className={`tag pill ${result.max_score === 0 ? '' : result.score === result.max_score ? 'green' : result.score > 0 ? 'amber' : 'red'}`}>
                {result.max_score === 0 ? 'Not auto-marked' : `${result.score} / ${result.max_score}`}
              </span>
              <span className="micro">
                {result.graded_by === 'ai' ? 'Marked against the marking guide' : result.graded_by === 'auto' ? 'Auto-marked' : 'Compare with the model answer, then mark yourself'}
              </span>
              {result.max_score === 0 && (
                <>
                  <div className="spacer" />
                  <span className="micro">Did you get it right?</span>
                  <button className="btn sm" style={{ color: 'var(--green)', borderColor: 'var(--green)' }}
                    onClick={() => selfMark.mutate(true)} disabled={selfMark.isPending}>Got it</button>
                  <button className="btn sm" style={{ color: 'var(--red)', borderColor: 'var(--red)' }}
                    onClick={() => selfMark.mutate(false)} disabled={selfMark.isPending}>Missed it</button>
                </>
              )}
            </div>

            {result.feedback && (
              <div className="notice info" style={{ margin: 0 }}>
                <Icon name="sparkle" size={14} />
                <div><strong>Feedback</strong><div className="pre-wrap" style={{ marginTop: 4 }}>{result.feedback}</div></div>
              </div>
            )}

            {result.improvement && (
              <div style={{ padding: 13, background: 'var(--bg)', borderRadius: 10, borderLeft: '3px solid var(--amber)' }}>
                <div className="micro" style={{ marginBottom: 4 }}>How to improve</div>
                <div className="body pre-wrap">{result.improvement}</div>
              </div>
            )}

            {(result.model_answer || result.working) && (
              <details>
                <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--ink-2)' }}>Model answer & working</summary>
                <div style={{ padding: 13, background: 'var(--bg)', borderRadius: 10, marginTop: 8 }}>
                  {result.model_answer && <div className="body pre-wrap"><strong>Answer:</strong> {result.model_answer}</div>}
                  {result.working && <div className="body pre-wrap mono" style={{ marginTop: 8 }}>{result.working}</div>}
                  {result.marking_guide && <div className="micro ink-3 pre-wrap" style={{ marginTop: 8 }}>Marking guide: {result.marking_guide}</div>}
                </div>
              </details>
            )}

            <div className="row">
              <div className="spacer" />
              <button className="btn primary" onClick={next} disabled={more.isPending}>
                {more.isPending ? <><span className="spinner" /> Generating…</> : (index + 1 < questions.length ? 'Next question' : (infinite || data.set.kind === 'infinite') ? 'Generate more' : 'Finish')}
              </button>
            </div>
          </div>
        )}
      </div>

      {(infinite || data.set.kind === 'infinite') && (
        <div className="micro" style={{ textAlign: 'center' }}>
          Infinite practice — every batch uses new numbers, scenarios and wording, and adapts to how you are going.
        </div>
      )}
    </div>
  )
}
