import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api, fmtDate, daysUntil } from '../../lib/api'
import { Icon } from '../../components/Icons'
import { Bar, Empty, SectionHead } from '../../components/ui'
import SchoolTab from './SchoolTab'
import TopicsTab from './TopicsTab'

export default function OverviewTab({ subjectId, subject }: { subjectId: string; subject: any }) {
  const navigate = useNavigate()

  const { data: progress } = useQuery({
    queryKey: ['progress', subjectId], queryFn: () => api.get(`/progress/overview?subject_id=${subjectId}`),
  })
  const { data: uploads } = useQuery({
    queryKey: ['uploads', subjectId, 'overview'], queryFn: () => api.get(`/uploads?subject_id=${subjectId}&limit=5`),
  })
  const { data: assessments } = useQuery({
    queryKey: ['assessments', subjectId], queryFn: () => api.get(`/assessments?subject_id=${subjectId}`),
  })
  const { data: tasks } = useQuery({
    queryKey: ['tasks', subjectId, 'page'], queryFn: () => api.get(`/tasks?subject_id=${subjectId}&status=todo`),
  })

  const weak = (progress?.weakest || []).filter((w: any) => w.mastery !== null)
  const upcoming = (assessments || []).filter((a: any) => a.status !== 'done')

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="metrics ruled" style={{ paddingBottom: 26, borderBottom: '1px solid var(--line)', marginBottom: 8 }}>
        <div className="metric">
          <div className="metric-label">Mastery</div>
          <div className="metric-value">{progress?.overall_mastery === null || progress?.overall_mastery === undefined ? '—' : `${progress.overall_mastery}%`}</div>
          <div className="metric-note">{progress?.questions_completed ?? 0} questions answered</div>
        </div>
        <div className="metric">
          <div className="metric-label">Syllabus</div>
          <div className="metric-value">{progress?.syllabus?.percent ?? 0}%</div>
          <div className="metric-note">{progress?.syllabus?.completed ?? 0} of {progress?.syllabus?.total ?? 0} points</div>
        </div>
        <div className="metric">
          <div className="metric-label">Flashcards</div>
          <div className="metric-value" style={{ color: progress?.flashcards?.due ? 'var(--amber)' : undefined }}>{progress?.flashcards?.due ?? 0}</div>
          <div className="metric-note">due of {progress?.flashcards?.total ?? 0}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Accuracy</div>
          <div className="metric-value">{progress?.accuracy === null || progress?.accuracy === undefined ? '—' : `${progress.accuracy}%`}</div>
          <div className="metric-note">across all questions</div>
        </div>
        <div className="metric">
          <div className="metric-label">Study time</div>
          <div className="metric-value">{Math.floor((progress?.study_minutes ?? 0) / 60)}<span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-3)' }}>h </span>{(progress?.study_minutes ?? 0) % 60}<span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-3)' }}>m</span></div>
          <div className="metric-note">logged on this subject</div>
        </div>
      </div>

      <SchoolTab subjectId={subjectId} />

      <div className="split">
        <TopicsTab subjectId={subjectId} />

        <div className="stack" style={{ gap: 16 }}>
          <div>
            <SectionHead title="Weak areas" />
            {weak.length ? (
              <div className="card stack tight">
                {weak.slice(0, 5).map((t: any) => (
                  <div key={t.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/practice?subject=${subjectId}&topic=${t.id}&generate=1`)}>
                    <div className="row micro" style={{ marginBottom: 3 }}>
                      <span className="truncate" style={{ flex: 1 }}>{t.name}</span>
                      <span className="strong" style={{ color: t.mastery < 60 ? 'var(--bar-red)' : t.mastery < 80 ? 'var(--bar-amber)' : 'var(--bar-green)' }}>{t.mastery}%</span>
                    </div>
                    <Bar value={t.mastery} color={t.mastery < 60 ? 'var(--bar-red)' : t.mastery < 80 ? 'var(--bar-amber)' : 'var(--bar-green)'} />
                  </div>
                ))}
              </div>
            ) : (
              <Empty title="No practice data yet" message="Answer some questions and weak topics appear here."
                action={<Link className="btn sm primary" to={`/practice?subject=${subjectId}&generate=1`}>Start practice</Link>} />
            )}
          </div>

          <div>
            <SectionHead title="Assessments" action={<Link className="btn quiet sm" to="/assessments">All</Link>} />
            {upcoming.length ? (
              <div className="rows">
                {upcoming.slice(0, 4).map((a: any) => {
                  const d = daysUntil(a.due_date)
                  return (
                    <Link className="row-item link" key={a.id} to="/assessments">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="body strong truncate">{a.name}</div>
                        <div className="micro">{a.topic || 'No topic'}{a.weighting ? ` · ${a.weighting}%` : ''}</div>
                      </div>
                      <span className={`tag pill ${d !== null && d <= 7 ? 'red' : d !== null && d <= 21 ? 'amber' : ''}`}>
                        {d === null ? '—' : d < 0 ? 'Overdue' : d === 0 ? 'Today' : `${d}d`}
                      </span>
                    </Link>
                  )
                })}
              </div>
            ) : <Empty title="Nothing scheduled" message="Add assessment dates to prioritise your study." />}
          </div>

          {!!tasks?.length && (
            <div>
              <SectionHead title="Tasks" action={<Link className="btn quiet sm" to="/tasks">All</Link>} />
              <div className="rows">
                {tasks.slice(0, 4).map((t: any) => (
                  <Link className="row-item link" key={t.id} to="/tasks">
                    <Icon name="tasks" size={13} className="ink-3" />
                    <span className="body truncate" style={{ flex: 1 }}>{t.title}</span>
                    {t.due_date && <span className="micro">{fmtDate(t.due_date)}</span>}
                  </Link>
                ))}
              </div>
            </div>
          )}

          <div>
            <SectionHead title="Recent school work" action={<Link className="btn quiet sm" to={`/uploads?subject=${subjectId}`}>All</Link>} />
            {uploads?.length ? (
              <div className="rows">
                {uploads.map((u: any) => (
                  <div className="row-item" key={u.id}>
                    <Icon name={u.source === 'photo' ? 'camera' : u.source === 'paste' ? 'clipboard' : 'file'} size={13} className="ink-3" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="body truncate">{u.title || u.original_filename}</div>
                      <div className="micro">{u.work_type}{u.topic_name ? ` · ${u.topic_name}` : ''}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty title="No school work yet" message="Photos, PDFs and pasted notes become practice material."
                action={<Link className="btn sm primary" to={`/uploads?subject=${subjectId}`}>Add school work</Link>} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
