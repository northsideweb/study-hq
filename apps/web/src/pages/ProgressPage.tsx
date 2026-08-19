import { useQuery } from '@tanstack/react-query'
import { LineChart, Line, BarChart, Bar as RBar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { api, fmtDate } from '../lib/api'
import { Stat, Bar, Loading, ErrorBox, Empty } from '../components/ui'

export default function ProgressPage({ subjectId, embedded }: { subjectId?: string; embedded?: boolean }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['progress', subjectId || 'all'],
    queryFn: () => api.get(`/progress/overview${subjectId ? `?subject_id=${subjectId}` : ''}`),
  })

  if (isLoading) return <Loading />
  if (error) return <ErrorBox error={error} retry={refetch} />

  const accuracySeries = (data.daily || []).filter((d: any) => d.accuracy !== null)
  const minutesSeries = data.minutes_daily || []
  const axis = { stroke: 'var(--ink-4)', fontSize: 11 }

  return (
    <div className={embedded ? '' : 'page'}>
      {!embedded && (
        <div className="page-head">
          <div>
            <h1>Progress</h1>
            <div className="meta">Everything you've done, and where the gaps are.</div>
          </div>
        </div>
      )}

      <div className="metrics">
        <Stat label="Overall mastery" value={data.overall_mastery === null ? '—' : `${data.overall_mastery}%`} meta="accuracy + card maturity" />
        <Stat label="Questions completed" value={data.questions_completed} meta={data.accuracy === null ? '' : `${data.accuracy}% accuracy`} />
        <Stat label="Flashcards mastered" value={data.flashcards.mastered} meta={`of ${data.flashcards.total} · ${data.flashcards.due} due`} />
        <Stat label="Study time" value={`${Math.floor(data.study_minutes / 60)}h ${data.study_minutes % 60}m`} meta={`${data.streak.current} day streak · longest ${data.streak.longest}`} />
      </div>

      <div className="grid-2">
        <div className="card">
          <h3 style={{ marginBottom: 12 }}>Accuracy over time</h3>
          {accuracySeries.length > 1 ? (
            <ResponsiveContainer width="100%" height={210}>
              <LineChart data={accuracySeries}>
                <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" {...axis} tickFormatter={(d) => String(d).slice(5)} />
                <YAxis domain={[0, 100]} {...axis} />
                <Tooltip contentStyle={{ background: 'var(--bg-sunken)', border: '1px solid var(--line-strong)', borderRadius: 8, fontSize: 12 }} />
                <Line type="monotone" dataKey="accuracy" stroke="var(--blue)" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <Empty title="Not enough data yet" message="Answer questions on a few different days and your improvement curve appears here." />
          )}
        </div>

        <div className="card">
          <h3 style={{ marginBottom: 12 }}>Study minutes per day</h3>
          {minutesSeries.length ? (
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={minutesSeries}>
                <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" {...axis} tickFormatter={(d) => String(d).slice(5)} />
                <YAxis {...axis} />
                <Tooltip contentStyle={{ background: 'var(--bg-sunken)', border: '1px solid var(--line-strong)', borderRadius: 8, fontSize: 12 }} />
                <RBar dataKey="minutes" fill="var(--blue)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Empty title="No study time logged yet" message="Time is recorded automatically as you practise and review." />
          )}
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3 style={{ marginBottom: 12 }}>Syllabus &amp; topics</h3>
          <div className="stack" style={{ gap: 14 }}>
            <div>
              <div className="row body" style={{ marginBottom: 4 }}>
                <span>Syllabus completed</span><div className="spacer" />
                <span>{data.syllabus.completed}/{data.syllabus.total}</span>
              </div>
              <Bar value={data.syllabus.percent} color="var(--green)" />
            </div>
            <div className="row wrap" style={{ gap: 8 }}>
              <span className="tag amber pill">{data.syllabus.studying} studying</span>
              <span className="tag red pill">{data.syllabus.needs_revision} need revision</span>
              <span className="tag green pill">{data.syllabus.completed} completed</span>
            </div>
            <div className="row wrap" style={{ gap: 8 }}>
              <span className="tag pill">{data.topics.total} topics</span>
              <span className="tag green pill">{data.topics.completed} done</span>
              <span className="tag red pill">{data.topics.needs_revision} to revise</span>
            </div>
          </div>
        </div>

        <div className="card">
          <h3 style={{ marginBottom: 12 }}>Exam results</h3>
          {data.exams?.length ? (
            <div className="stack" style={{ gap: 7 }}>
              {data.exams.map((e: any) => {
                const pct = e.max_score ? Math.round((e.score / e.max_score) * 100) : 0
                return (
                  <div className="row-item body" key={e.id}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="truncate">{e.name}</div>
                      <div className="micro">{e.subject_name} · {fmtDate(e.submitted_at)}</div>
                    </div>
                    <span className={`tag pill ${pct >= 80 ? 'green' : pct >= 50 ? 'amber' : 'red'}`}>{pct}%</span>
                  </div>
                )
              })}
            </div>
          ) : <Empty title="No exams sat yet" />}
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 12 }}>Mastery by topic</h3>
        {data.mastery?.filter((m: any) => m.mastery !== null).length ? (
          <div className="stack" style={{ gap: 11 }}>
            {data.mastery.filter((m: any) => m.mastery !== null).sort((a: any, b: any) => a.mastery - b.mastery).map((m: any) => (
              <div key={m.id}>
                <div className="row body" style={{ marginBottom: 4 }}>
                  <span className="dot" style={{ background: m.subject_color }} />
                  <span className="truncate" style={{ flex: 1 }}>{m.name}</span>
                  <span className="micro">{m.attempts} answered · {m.cards} cards</span>
                  <strong style={{ color: m.mastery < 60 ? 'var(--bar-red)' : m.mastery < 80 ? 'var(--bar-amber)' : 'var(--bar-green)', width: 42, textAlign: 'right' }}>{m.mastery}%</strong>
                </div>
                <Bar value={m.mastery} color={m.mastery < 60 ? 'var(--bar-red)' : m.mastery < 80 ? 'var(--bar-amber)' : 'var(--bar-green)'} />
              </div>
            ))}
          </div>
        ) : (
          <Empty title="No mastery scores yet" message="Mastery is calculated from your answers and flashcard intervals per topic." />
        )}
      </div>
    </div>
  )
}
