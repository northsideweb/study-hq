import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, fmtDate, daysUntil } from '../lib/api'
import { Icon } from '../components/Icons'
import { Bar, Loading, ErrorBox, Empty, Modal, Field, useToast } from '../components/ui'
import { useTimer } from '../components/StudyTimer'

const greeting = () => {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

const longDate = () =>
  new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' }).replace(/^(\w+)\s/, '$1, ')

const fileKind = (u: any) =>
  u.source === 'paste' ? 'Notes' : u.mime?.startsWith('image/') ? 'Image'
  : u.mime === 'application/pdf' ? 'PDF' : /word|document/.test(u.mime || '') ? 'Document'
  : /presentation/.test(u.mime || '') ? 'Slides' : 'File'

const relativeDay = (iso: string) => {
  if (!iso) return ''
  const d = new Date(String(iso).replace(' ', 'T') + (iso.length <= 10 ? 'T00:00:00' : 'Z'))
  const today = new Date()
  const days = Math.floor((today.setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return d.toLocaleDateString('en-AU', { weekday: 'long' })
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

const masteryColour = (m: number) => (m >= 80 ? 'var(--bar-green)' : m >= 60 ? 'var(--bar-amber)' : 'var(--bar-red)')

export default function Dashboard() {
  const navigate = useNavigate()
  const toast = useToast()
  const qc = useQueryClient()
  const timer = useTimer()
  const [planner, setPlanner] = useState(false)
  const [minutes, setMinutes] = useState(45)
  const [focusSubject, setFocusSubject] = useState('')

  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get('/dashboard') })
  const { data: recs } = useQuery({ queryKey: ['recommendations'], queryFn: () => api.get('/recommendations?limit=5') })
  const { data: subjects } = useQuery({ queryKey: ['subjects'], queryFn: () => api.get('/subjects') })
  const { data: tasks } = useQuery({ queryKey: ['tasks', 'all', 'todo'], queryFn: () => api.get('/tasks?status=todo') })

  const startSession = useMutation({
    mutationFn: () => api.post('/session/start', { minutes, subject_id: focusSubject || null }),
    onSuccess: (r) => { setPlanner(false); navigate(`/study/${r.session_id}`) },
    onError: (e: any) => toast(e.message, 'error', 'Could not build a session'),
  })

  const completeTask = useMutation({
    mutationFn: (id: string) => api.put(`/tasks/${id}`, { status: 'done' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })

  if (isLoading) return <div className="page"><Loading /></div>
  if (error) return <div className="page"><ErrorBox error={error} retry={refetch} /></div>
  if (!data) return <div className="page"><Loading /></div>

  const p = data.profile
  const goal = p.daily_goal_minutes || 60
  const session = data.last_session?.plan
  const openRec = (r: any) => {
    if (r.action === 'flashcards') return navigate(r.subject_id ? `/subjects/${r.subject_id}?tab=flashcards` : '/flashcards')
    if (r.action === 'mistakes') return navigate(`/practice?tab=mistakes${r.subject_id ? `&subject=${r.subject_id}` : ''}`)
    if (r.action === 'upload') return navigate(`/uploads${r.subject_id ? `?subject=${r.subject_id}` : ''}`)
    if (r.action === 'syllabus') return navigate(`/subjects/${r.subject_id}?tab=syllabus`)
    if (r.action === 'notes') return navigate(`/subjects/${r.subject_id}?tab=notes`)
    navigate(`/practice?subject=${r.subject_id || ''}&topic=${r.topic_id || ''}&generate=1`)
  }

  return (
    <div className="page">
      {/* ---------- greeting ---------- */}
      <header style={{ marginBottom: 30 }}>
        <h1 className="display">{greeting()}{p.name ? `, ${p.name}` : ''}.</h1>
        <div className="lead" style={{ marginTop: 7 }}>
          Year {p.year_level} · Term {p.term} · {longDate()}
        </div>
      </header>

      <div className="row" style={{ gap: 10, marginBottom: 38 }}>
        <button className="btn primary lg" onClick={() => (session ? navigate(`/study/${data.last_session.id}`) : setPlanner(true))}>
          {session ? 'Continue studying' : 'Start studying'}
          <Icon name="arrowRight" size={15} />
        </button>
        {session && <button className="btn lg" onClick={() => setPlanner(true)}>New session</button>}
        <button className="btn lg" onClick={() => timer.open()}><Icon name="timer" size={15} /> Focus timer</button>
      </div>

      {/* ---------- study summary ---------- */}
      <div className="metrics ruled" style={{ paddingBottom: 26, borderBottom: '1px solid var(--line)', marginBottom: 44 }}>
        <div className="metric">
          <div className="metric-label">Today</div>
          <div className="metric-value">{data.today_minutes}<span className="unit"> / {goal} min</span></div>
          <div style={{ marginTop: 8, maxWidth: 120 }}>
            <Bar value={(data.today_minutes / goal) * 100} color={data.today_minutes >= goal ? 'var(--green)' : undefined} />
          </div>
        </div>
        <div className="metric">
          <div className="metric-label">Questions</div>
          <div className="metric-value">{data.questions_completed}</div>
          <div className="metric-note">completed</div>
        </div>
        <div className="metric">
          <div className="metric-label">Accuracy</div>
          <div className="metric-value">{data.accuracy === null ? '—' : `${data.accuracy}%`}</div>
          <div className="metric-note">{data.accuracy === null ? 'no data yet' : 'across all answers'}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Streak</div>
          <div className="metric-value">{data.streak.current}<span className="unit"> {data.streak.current === 1 ? 'day' : 'days'}</span></div>
          <div className="metric-note">longest {data.streak.longest}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Cards due</div>
          <div className="metric-value" style={data.flashcards_due ? { color: 'var(--amber)' } : undefined}>{data.flashcards_due}</div>
          <div className="metric-note">
            {data.flashcards_due ? <Link className="btn link" to="/flashcards">Review now</Link> : 'all caught up'}
          </div>
        </div>
      </div>

      <div className="split">
        <div>
          {/* ---------- today's plan ---------- */}
          <section className="section">
            <div className="section-head">
              <div>
                <h2>Today's study plan</h2>
                <div className="sub">
                  {session ? session.rationale : 'Built from your weak areas, due cards, class content and upcoming assessments.'}
                </div>
              </div>
              <div className="section-actions">
                <button className="btn sm" onClick={() => setPlanner(true)}>{session ? 'Rebuild' : 'Build plan'}</button>
              </div>
            </div>

            {session?.blocks?.length ? (
              <div className="rows">
                {session.blocks.map((b: any, i: number) => (
                  <div className="row-item link" key={i} onClick={() => navigate(`/study/${data.last_session.id}`)}>
                    <div className="row-time">{b.minutes} min</div>
                    <div className="row-main">
                      <div className="row-title">{b.subject}</div>
                      <div className="row-sub">{b.topic && b.topic !== b.subject ? b.topic : b.detail}</div>
                    </div>
                    <div className="row-aside"><span className="tag">{b.activity}</span></div>
                    <span className="btn link">Start</span>
                    <Icon name="arrowRight" size={15} className="row-go" />
                  </div>
                ))}
              </div>
            ) : (
              <Empty
                title="No plan for today yet"
                message="Study HQ builds a structured session — learn, recall, practise, apply, exam, review — from what you actually need."
                action={<button className="btn sm primary" onClick={() => setPlanner(true)}>Build today's plan</button>}
              />
            )}
          </section>

          {/* ---------- recommendations ---------- */}
          <section className="section">
            <div className="section-head">
              <div>
                <h2>What to study next</h2>
                <div className="sub">Ranked by what will move your marks most.</div>
              </div>
            </div>

            {recs?.length ? (
              <div className="rows">
                {recs.map((r: any, i: number) => (
                  <div className="row-item link" key={i} onClick={() => openRec(r)}>
                    <div className="row-index">{String(i + 1).padStart(2, '0')}</div>
                    <div className="row-main">
                      <div className="row-title">{r.title}</div>
                      <div className="row-sub">{r.why}</div>
                    </div>
                    <div className="row-aside">{r.minutes} min</div>
                    <Icon name="arrowRight" size={15} className="row-go" />
                  </div>
                ))}
              </div>
            ) : (
              <Empty title="Nothing to recommend yet"
                message="Add your syllabus and some school work, then answer a few questions."
                action={<Link className="btn sm primary" to="/uploads">Add school work</Link>} />
            )}
          </section>

          {/* ---------- currently studying ---------- */}
          <section className="section">
            <div className="section-head">
              <div><h2>Currently studying at school</h2></div>
              <div className="section-actions"><Link className="btn link" to="/subjects">All subjects</Link></div>
            </div>

            {data.currently_studying?.length ? (
              <div className="rows">
                {data.currently_studying.slice(0, 5).map((t: any) => {
                  const d = daysUntil(t.assessment_date)
                  return (
                    <Link className="row-item link" key={t.id} to={`/subjects/${t.subject_id}?tab=overview`}>
                      <span className="dot" style={{ background: t.subject_color }} />
                      <div className="row-main">
                        <div className="row-title">{t.name}</div>
                        <div className="row-sub">{t.subject_name}{t.teacher_instructions ? ` · ${t.teacher_instructions.slice(0, 60)}` : ''}</div>
                      </div>
                      {t.assessment_date && (
                        <div className="row-aside" style={d !== null && d <= 7 ? { color: 'var(--red)' } : undefined}>
                          {fmtDate(t.assessment_date)}
                          <div className="micro">{d !== null && d >= 0 ? `${d} days` : 'passed'}</div>
                        </div>
                      )}
                      <Icon name="arrowRight" size={15} className="row-go" />
                    </Link>
                  )
                })}
              </div>
            ) : (
              <Empty title="Nothing recorded yet"
                message="Tell Study HQ what your class is covering and it shapes everything you're recommended."
                action={<Link className="btn sm" to="/subjects">Open subjects</Link>} />
            )}
          </section>
        </div>

        {/* ---------- right rail ---------- */}
        <aside>
          <section className="section">
            <div className="section-head plain">
              <div className="eyebrow">Areas to improve</div>
              <Link className="btn link" to="/practice?tab=weak">All</Link>
            </div>
            {data.weakest_topics?.length ? (
              <div className="stack" style={{ gap: 16, paddingTop: 6 }}>
                {data.weakest_topics.slice(0, 4).map((t: any) => (
                  <div key={t.id} style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/practice?subject=${t.subject_id}&topic=${t.id}&generate=1`)}>
                    <div className="row" style={{ gap: 8, marginBottom: 6 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="body truncate" style={{ fontWeight: 500 }}>{t.name}</div>
                        <div className="micro">{t.subject_name}</div>
                      </div>
                      <span className="num strong" style={{ color: masteryColour(t.mastery) }}>{t.mastery}%</span>
                    </div>
                    <Bar value={t.mastery} color={masteryColour(t.mastery)} />
                  </div>
                ))}
              </div>
            ) : (
              <Empty title="No practice history yet"
                message="Complete your first practice session to begin tracking mastery."
                action={<Link className="btn sm" to="/practice?generate=1">Start practice</Link>} />
            )}
          </section>

          <section className="section">
            <div className="section-head plain">
              <div className="eyebrow">Upcoming</div>
              <Link className="btn link" to="/assessments">All</Link>
            </div>
            {data.upcoming_assessments?.length ? (
              <div className="stack" style={{ gap: 14, paddingTop: 6 }}>
                {data.upcoming_assessments.slice(0, 4).map((a: any) => {
                  const d = daysUntil(a.due_date)
                  return (
                    <Link key={a.id} to="/assessments" className="row top" style={{ gap: 10, alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="micro">{a.subject_name}</div>
                        <div className="body" style={{ fontWeight: 500 }}>{a.name}</div>
                        <div className="micro">{fmtDate(a.due_date)}</div>
                      </div>
                      <span className="num" style={{ fontSize: 13, color: d !== null && d <= 7 ? 'var(--red)' : 'var(--ink-3)' }}>
                        {d === null ? '—' : d < 0 ? 'overdue' : d === 0 ? 'today' : `${d} days`}
                      </span>
                    </Link>
                  )
                })}
              </div>
            ) : (
              <Empty title="Nothing scheduled"
                message="Add assessment dates and study sessions will prioritise them."
                action={<Link className="btn sm" to="/assessments?create=1">Add assessment</Link>} />
            )}
          </section>

          {!!tasks?.length && (
            <section className="section">
              <div className="section-head plain">
                <div className="eyebrow">Tasks</div>
                <Link className="btn link" to="/tasks">All</Link>
              </div>
              <div className="stack tight" style={{ paddingTop: 6 }}>
                {tasks.slice(0, 5).map((t: any) => {
                  const d = daysUntil(t.due_date)
                  return (
                    <div className="row" key={t.id} style={{ gap: 10 }}>
                      <div className="tick" onClick={() => completeTask.mutate(t.id)} title="Mark done" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="body truncate">{t.title}</div>
                        <div className="micro">{t.subject_name || 'No subject'}</div>
                      </div>
                      {t.due_date && (
                        <span className="micro num" style={d !== null && d < 0 ? { color: 'var(--red)' } : undefined}>
                          {d === 0 ? 'today' : d !== null && d < 0 ? 'late' : `${d}d`}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          <section className="section">
            <div className="section-head plain">
              <div className="eyebrow">Recent school work</div>
              <Link className="btn link" to="/uploads">All</Link>
            </div>
            {data.recent_uploads?.length ? (
              <div className="stack" style={{ gap: 14, paddingTop: 6 }}>
                {data.recent_uploads.slice(0, 5).map((u: any) => (
                  <Link className="row" key={u.id} to="/uploads" style={{ gap: 10 }}>
                    <Icon name={u.source === 'photo' ? 'camera' : u.source === 'paste' ? 'clipboard' : 'file'} size={15} className="ink-4" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="micro">{u.subject_name || 'Unassigned'}</div>
                      <div className="body truncate">{u.title}</div>
                      <div className="micro">{relativeDay(u.created_at)} · {fileKind(u)}</div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <Empty title="Nothing uploaded yet"
                message="Photos, PDFs and pasted notes become practice material."
                action={<Link className="btn sm" to="/uploads">Add school work</Link>} />
            )}
          </section>
        </aside>
      </div>

      {planner && (
        <Modal
          title="Start a study session"
          subtitle="A structured session: learn, recall, practise, apply, exam, then review."
          onClose={() => setPlanner(false)}
          footer={
            <>
              <button className="btn" onClick={() => setPlanner(false)}>Cancel</button>
              <button className="btn primary" onClick={() => startSession.mutate()} disabled={startSession.isPending}>
                {startSession.isPending ? <><span className="spinner" /> Building…</> : 'Build my session'}
              </button>
            </>
          }
        >
          <Field label="How long have you got?">
            <div className="row wrap">
              {[20, 30, 45, 60, 90].map((m) => (
                <button key={m} className={`chip ${minutes === m ? 'on' : ''}`} onClick={() => setMinutes(m)}>{m} min</button>
              ))}
            </div>
          </Field>
          <Field label="Focus on one subject (optional)">
            <select value={focusSubject} onChange={(e) => setFocusSubject(e.target.value)}>
              <option value="">All subjects — let Study HQ decide</option>
              {(subjects || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        </Modal>
      )}
    </div>
  )
}
