import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { api, fmtDate } from '../lib/api'
import { Icon } from '../components/Icons'
import { Modal, Field, Empty, Loading, useToast, useDialogs, useContextMenu, type MenuItem, Tabs, Bar } from '../components/ui'

const QTYPES = [
  { value: 'multiple_choice', label: 'Multiple choice' },
  { value: 'short_answer', label: 'Short answer' },
  { value: 'extended_response', label: 'Extended response' },
  { value: 'essay', label: 'Essay' },
  { value: 'case_study', label: 'Case study' },
]

export default function ExamsPage({ subjectId, embedded }: { subjectId?: string; embedded?: boolean }) {
  const navigate = useNavigate()
  const toast = useToast()
  const dialogs = useDialogs()
  const menu = useContextMenu()
  const [params] = useSearchParams()
  const [tab, setTab] = useState('history')
  const [setup, setSetup] = useState<any>(params.get('create') === '1' ? blankSetup(subjectId) : null)

  const { data: exams, isLoading, refetch } = useQuery({
    queryKey: ['exams', subjectId || 'all'], queryFn: () => api.get(`/exams${subjectId ? `?subject_id=${subjectId}` : ''}`),
  })
  const { data: subjects } = useQuery({ queryKey: ['subjects'], queryFn: () => api.get('/subjects') })
  const { data: topics } = useQuery({
    queryKey: ['topics', setup?.subject_id], queryFn: () => api.get(`/topics?subject_id=${setup?.subject_id}`), enabled: !!setup?.subject_id,
  })

  const generate = useMutation({
    mutationFn: () => api.post('/exams/generate', setup),
    onSuccess: (r: any) => { if (r.notice) toast(r.notice, 'info'); setSetup(null); navigate(`/exams/${r.exam_id}`) },
    onError: (e: any) => toast(e.message, 'error', 'Could not build the exam'),
  })
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/exams/${id}`), onSuccess: () => { refetch(); toast('Deleted', 'success') } })

  const examMenu = (e: any): MenuItem[] => [
    { type: 'label', label: e.name },
    { label: e.status === 'submitted' ? 'View results' : 'Continue exam', onClick: () => navigate(`/exams/${e.id}`) },
    { type: 'sep' },
    { label: 'Delete', danger: true, onClick: async () => { if (await dialogs.confirm('Delete exam?', e.name, true)) remove.mutate(e.id) } },
  ]

  if (isLoading) return <Loading />
  const list = exams || []
  const done = list.filter((e: any) => e.status === 'submitted')
  const inProgress = list.filter((e: any) => e.status !== 'submitted')
  const avg = done.length ? Math.round(done.reduce((a: number, e: any) => a + (e.max_score ? (e.score / e.max_score) * 100 : 0), 0) / done.length) : null

  return (
    <div className={embedded ? '' : 'page'}>
      <div className={embedded ? 'section-head' : 'page-head'}>
        <div>
          <h1 style={embedded ? { fontSize: 16 } : undefined}>Exams</h1>
          <div className="meta">Timed papers with sections, auto-marking and weak-area analysis.</div>
        </div>
        <div className="section-actions">
        <button className="btn primary" onClick={() => setSetup(blankSetup(subjectId))}><Icon name="plus" size={14} /> New exam</button>
      </div>
      </div>

      {!!done.length && (
        <div className="metrics ruled">
          <div className="metric"><div className="metric-label">Exams sat</div><div className="metric-value">{done.length}</div></div>
          <div className="metric"><div className="metric-label">Average</div><div className="metric-value" style={{ color: avg! >= 80 ? 'var(--green)' : avg! >= 60 ? 'var(--amber)' : 'var(--red)' }}>{avg}%</div></div>
          <div className="metric"><div className="metric-label">Best</div><div className="metric-value">{Math.max(...done.map((e: any) => e.max_score ? Math.round((e.score / e.max_score) * 100) : 0))}%</div></div>
          <div className="metric"><div className="metric-label">In progress</div><div className="metric-value">{inProgress.length}</div></div>
        </div>
      )}

      <Tabs tabs={[{ id: 'history', label: 'My exam results', badge: done.length }, { id: 'open', label: 'In progress', badge: inProgress.length }]} active={tab} onChange={setTab} />

      {tab === 'open' ? (
        !inProgress.length ? <Empty title="No exams in progress" message="Create an exam and it stays here until you submit it." />
          : <ExamTable rows={inProgress} onOpen={(e: any) => navigate(`/exams/${e.id}`)} menu={menu} examMenu={examMenu} />
      ) : !done.length ? (
        <Empty title="No exams sat yet" message="Build a timed paper from your topics and sit it under exam conditions."
          action={<button className="btn sm primary" onClick={() => setSetup(blankSetup(subjectId))}>Create an exam</button>} />
      ) : (
        <ExamTable rows={done} onOpen={(e: any) => navigate(`/exams/${e.id}`)} menu={menu} examMenu={examMenu} />
      )}

      {setup && (
        <Modal
          title="Create an exam"
          subtitle="Study HQ writes a sectioned paper and marks it when you submit."
          onClose={() => setSetup(null)}
          footer={
            <>
              <button className="btn" onClick={() => setSetup(null)}>Cancel</button>
              <button className="btn primary" disabled={!setup.subject_id || generate.isPending} onClick={() => generate.mutate()}>
                {generate.isPending ? <><span className="spinner" /> Writing the paper…</> : 'Create exam'}
              </button>
            </>
          }
        >
          <Field label="Subject">
            <select value={setup.subject_id} onChange={(e) => setSetup({ ...setup, subject_id: e.target.value, topic_ids: [] })}>
              <option value="">Choose a subject…</option>
              {(subjects || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Exam name (optional)"><input value={setup.name} onChange={(e) => setSetup({ ...setup, name: e.target.value })} placeholder="e.g. Term 3 practice paper" /></Field>
          <Field label="Topics" hint="Leave empty to cover the whole subject.">
            <div className="row wrap">
              {(topics || []).map((t: any) => {
                const on = setup.topic_ids.includes(t.id)
                return (
                  <button key={t.id} className={`chip ${on ? 'on' : ''}`}
                    onClick={() => setSetup({ ...setup, topic_ids: on ? setup.topic_ids.filter((x: string) => x !== t.id) : [...setup.topic_ids, t.id] })}>
                    {t.name}
                  </button>
                )
              })}
              {!topics?.length && <span className="micro">No topics yet for this subject.</span>}
            </div>
          </Field>
          <Field label="Question types">
            <div className="row wrap">
              {QTYPES.map((q) => {
                const on = setup.qtypes.includes(q.value)
                return (
                  <button key={q.value} className={`chip ${on ? 'on' : ''}`}
                    onClick={() => setSetup({ ...setup, qtypes: on ? setup.qtypes.filter((x: string) => x !== q.value) : [...setup.qtypes, q.value] })}>
                    {q.label}
                  </button>
                )
              })}
            </div>
          </Field>
          <div className="row" style={{ gap: 12 }}>
            <Field label={`Duration: ${setup.duration_min} min`}>
              <input type="range" min={10} max={180} step={5} value={setup.duration_min} onChange={(e) => setSetup({ ...setup, duration_min: Number(e.target.value) })} />
            </Field>
            <Field label={`Questions: ${setup.count}`}>
              <input type="range" min={3} max={25} value={setup.count} onChange={(e) => setSetup({ ...setup, count: Number(e.target.value) })} />
            </Field>
          </div>
          <div className="row" style={{ gap: 12 }}>
            <Field label="Total marks"><input type="number" min={5} max={120} value={setup.total_marks} onChange={(e) => setSetup({ ...setup, total_marks: Number(e.target.value) })} /></Field>
            <Field label="Difficulty">
              <select value={setup.difficulty} onChange={(e) => setSetup({ ...setup, difficulty: e.target.value })}>
                <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option><option value="exam">Exam standard</option>
              </select>
            </Field>
            <Field label="Source">
              <select value={setup.mode} onChange={(e) => setSetup({ ...setup, mode: e.target.value })}>
                <option value="hsc">HSC syllabus</option><option value="my_material">My material</option>
              </select>
            </Field>
          </div>
        </Modal>
      )}
    </div>
  )
}

function blankSetup(subjectId?: string) {
  return {
    subject_id: subjectId || '', topic_ids: [], qtypes: ['multiple_choice', 'short_answer', 'extended_response'],
    duration_min: 45, count: 8, total_marks: 40, difficulty: 'exam', mode: 'hsc', name: '',
  }
}

function ExamTable({ rows, onOpen, menu, examMenu }: any) {
  return (
    <div className="card" style={{ padding: 0 }}>
      <table className="data">
        <thead><tr><th>Exam</th><th style={{ width: 140 }}>Subject</th><th style={{ width: 130 }}>Result</th><th style={{ width: 120 }}>Marks</th><th style={{ width: 110 }}>Date</th></tr></thead>
        <tbody>
          {rows.map((e: any) => {
            const pct = e.max_score ? Math.round((e.score / e.max_score) * 100) : null
            return (
              <tr key={e.id} className="link" onClick={() => onOpen(e)} onContextMenu={(ev) => menu(ev, examMenu(e))}>
                <td>
                  <div className="row">
                    <span className="dot" style={{ background: e.subject_color || 'var(--ink-4)' }} />
                    <span className="strong">{e.name}</span>
                  </div>
                  <div className="micro">{e.duration_min} minutes</div>
                </td>
                <td className="meta">{e.subject_name}</td>
                <td>
                  {e.status === 'submitted' && pct !== null ? (
                    <div className="row" style={{ gap: 7 }}>
                      <div style={{ width: 54 }}><Bar value={pct} color={pct >= 80 ? 'var(--bar-green)' : pct >= 50 ? 'var(--bar-amber)' : 'var(--bar-red)'} /></div>
                      <span className="strong body" style={{ color: pct >= 80 ? 'var(--bar-green)' : pct >= 50 ? 'var(--bar-amber)' : 'var(--bar-red)' }}>{pct}%</span>
                    </div>
                  ) : <span className="tag amber pill">In progress</span>}
                </td>
                <td className="meta">{e.status === 'submitted' ? `${e.score}/${e.max_score}` : '—'}</td>
                <td className="micro">{fmtDate(e.submitted_at || e.started_at)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
