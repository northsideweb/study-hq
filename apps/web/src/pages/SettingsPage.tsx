import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { Icon } from '../components/Icons'
import { Field, Loading, useToast, SectionHead, Tabs, Bar } from '../components/ui'

export default function SettingsPage() {
  const qc = useQueryClient()
  const toast = useToast()
  const [profile, setProfile] = useState<any>(null)
  const [theme, setTheme] = useState(localStorage.getItem('shq-theme') || 'light')
  const [tab, setTab] = useState('profile')

  const { data, isLoading } = useQuery({ queryKey: ['profile'], queryFn: () => api.get('/profile') })
  const { data: ai } = useQuery({ queryKey: ['ai-status'], queryFn: () => api.get('/ai/status') })
  const { data: progress } = useQuery({ queryKey: ['progress', 'all'], queryFn: () => api.get('/progress/overview') })
  const { data: subjects } = useQuery({ queryKey: ['subjects'], queryFn: () => api.get('/subjects') })

  useEffect(() => { if (data) setProfile(data) }, [data])

  const save = useMutation({
    mutationFn: () => api.put('/profile', profile),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profile'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      toast('Settings saved', 'success')
    },
    onError: (e: any) => toast(e.message, 'error'),
  })

  const toggleAi = useMutation({
    mutationFn: (enabled: boolean) => api.post('/ai/toggle', { enabled }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['ai-status'] })
      toast(r.configured ? 'AI is on' : 'AI is off — nothing will be billed', 'success')
    },
    onError: (e: any) => toast(e.message, 'error'),
  })

  const applyTheme = (t: string) => {
    setTheme(t)
    localStorage.setItem('shq-theme', t)
    document.documentElement.setAttribute('data-theme', t)
  }

  if (isLoading || !profile) return <Loading />

  const weekMinutes = (progress?.minutes_daily || []).slice(-7).reduce((a: number, d: any) => a + (d.minutes || 0), 0)
  const weeklyGoal = profile.weekly_goal_minutes || 420
  const todayMinutes = (progress?.minutes_daily || []).slice(-1)[0]?.minutes || 0

  return (
    <div className="page narrow">
      <div className="page-head">
        <div>
          <h1 className="display">Settings</h1>
          <div className="meta">Your profile, study goals, appearance, AI and data.</div>
        </div>
      </div>

      <Tabs
        tabs={[{ id: 'profile', label: 'Profile' }, { id: 'goals', label: 'Study goals' }, { id: 'appearance', label: 'Appearance' },
               { id: 'ai', label: 'AI' }, { id: 'data', label: 'My data' }]}
        active={tab} onChange={setTab}
      />

      {tab === 'profile' && (
        <section className="section">
          <SectionHead title="My profile" sub="Change your year level when you move into Year 12 — everything carries over." />
          <div className="grid-2" style={{ gap: 12 }}>
            <Field label="Name" hint="Used in the dashboard greeting.">
              <input value={profile.name || ''} onChange={(e) => setProfile({ ...profile, name: e.target.value })} placeholder="Jamie" />
            </Field>
            <Field label="School"><input value={profile.school || ''} onChange={(e) => setProfile({ ...profile, school: e.target.value })} placeholder="optional" /></Field>
            <Field label="Year level">
              <select value={profile.year_level} onChange={(e) => setProfile({ ...profile, year_level: Number(e.target.value) })}>
                {[7, 8, 9, 10, 11, 12].map((y) => <option key={y} value={y}>Year {y}</option>)}
              </select>
            </Field>
            <Field label="Term">
              <select value={profile.term} onChange={(e) => setProfile({ ...profile, term: Number(e.target.value) })}>
                {[1, 2, 3, 4].map((t) => <option key={t} value={t}>Term {t}</option>)}
              </select>
            </Field>
            <Field label="Calendar year"><input type="number" value={profile.calendar_year} onChange={(e) => setProfile({ ...profile, calendar_year: Number(e.target.value) })} /></Field>
            <Field label="State / curriculum"><input value={profile.state || ''} onChange={(e) => setProfile({ ...profile, state: e.target.value })} /></Field>
          </div>
          <div className="row" style={{ marginTop: 20 }}>
            <Link className="btn quiet sm" to="/subjects">Manage subjects</Link>
            <div className="spacer" />
            <button className="btn primary" onClick={() => save.mutate()} disabled={save.isPending}>Save</button>
          </div>
        </section>
      )}

      {tab === 'goals' && (
        <div className="stack" style={{ gap: 14 }}>
          <section className="section">
            <SectionHead title="Study goals" sub="Progress against these shows on your dashboard." />
            <div className="grid-2" style={{ gap: 12 }}>
              <Field label="Daily goal (minutes)">
                <input type="number" min={5} max={600} value={profile.daily_goal_minutes} onChange={(e) => setProfile({ ...profile, daily_goal_minutes: Number(e.target.value) })} />
              </Field>
              <Field label="Weekly goal (minutes)" hint={`${Math.round((profile.weekly_goal_minutes || 420) / 60)} hours a week`}>
                <input type="number" min={30} max={3000} value={profile.weekly_goal_minutes || 420} onChange={(e) => setProfile({ ...profile, weekly_goal_minutes: Number(e.target.value) })} />
              </Field>
              <Field label="Preferred question difficulty" hint="The default when you generate practice.">
                <select value={profile.preferred_difficulty || 'adaptive'} onChange={(e) => setProfile({ ...profile, preferred_difficulty: e.target.value })}>
                  <option value="adaptive">Adaptive</option><option value="easy">Easy</option>
                  <option value="medium">Medium</option><option value="hard">Hard</option><option value="exam">Exam standard</option>
                </select>
              </Field>
            </div>
            <div className="row" style={{ marginTop: 20 }}><div className="spacer" /><button className="btn primary" onClick={() => save.mutate()}>Save goals</button></div>
          </section>

          <section className="section">
            <SectionHead title="How I'm tracking" />
            <div className="stack" style={{ gap: 14 }}>
              <div>
                <div className="row micro" style={{ marginBottom: 4 }}>
                  <span>Today</span><div className="spacer" /><span className="strong">{todayMinutes} / {profile.daily_goal_minutes} min</span>
                </div>
                <Bar value={(todayMinutes / (profile.daily_goal_minutes || 60)) * 100} color={todayMinutes >= profile.daily_goal_minutes ? 'var(--green)' : undefined} />
              </div>
              <div>
                <div className="row micro" style={{ marginBottom: 4 }}>
                  <span>This week</span><div className="spacer" /><span className="strong">{weekMinutes} / {weeklyGoal} min</span>
                </div>
                <Bar value={(weekMinutes / weeklyGoal) * 100} color={weekMinutes >= weeklyGoal ? 'var(--green)' : undefined} />
              </div>
              <div className="metrics ruled">
                <div className="metric"><div className="metric-label">Current streak</div><div className="metric-value">{progress?.streak?.current ?? 0}</div><div className="metric-note">days</div></div>
                <div className="metric"><div className="metric-label">Longest streak</div><div className="metric-value">{progress?.streak?.longest ?? 0}</div><div className="metric-note">days</div></div>
                <div className="metric"><div className="metric-label">Questions</div><div className="metric-value">{progress?.questions_completed ?? 0}</div><div className="metric-note">completed</div></div>
                <div className="metric"><div className="metric-label">Cards mastered</div><div className="metric-value">{progress?.flashcards?.mastered ?? 0}</div><div className="metric-note">of {progress?.flashcards?.total ?? 0}</div></div>
              </div>
            </div>
          </section>
        </div>
      )}

      {tab === 'appearance' && (
        <section className="section">
          <SectionHead title="Appearance" sub="Study HQ is designed for light mode; dark mode is available if you prefer it." />
          <div className="row">
            {['light', 'dark'].map((t) => (
              <button key={t} className={`chip ${theme === t ? 'on' : ''}`} onClick={() => applyTheme(t)}>
                {t === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>
        </section>
      )}

      {tab === 'ai' && (
        <section className="section">
          <SectionHead
            title="AI features"
            sub="Study HQ works either way. Turn AI off and nothing is billed to your account."
          />

          <div className="row" style={{ gap: 14, padding: '18px 0', borderBottom: '1px solid var(--line)' }}>
            <div style={{ flex: 1 }}>
              <div className="body" style={{ fontWeight: 550 }}>
                {ai?.configured ? 'AI is on' : ai?.key_present ? 'AI is off' : 'No API key set up'}
              </div>
              <div className="meta" style={{ marginTop: 3 }}>
                {ai?.configured
                  ? `Using ${ai.model}. Roughly 1–2 cents per practice set.`
                  : ai?.key_present
                    ? 'Nothing is being billed. Maths practice, flashcards and questions from your own notes still work.'
                    : 'Add a key to .env to make this switch available.'}
              </div>
            </div>
            <button
              className={`btn ${ai?.configured ? '' : 'primary'}`}
              disabled={!ai?.key_present || toggleAi.isPending}
              onClick={() => toggleAi.mutate(!ai?.configured)}
            >
              {toggleAi.isPending ? <><span className="spinner" /> Switching…</> : ai?.configured ? 'Turn AI off' : 'Turn AI on'}
            </button>
          </div>

          <div style={{ paddingTop: 20 }}>
            <div className="eyebrow" style={{ marginBottom: 12 }}>What works with AI off</div>
            <div className="split even">
              <div>
                <div className="body" style={{ fontWeight: 550, color: 'var(--green)', marginBottom: 6 }}>Free, always available</div>
                <ul className="meta" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.85 }}>
                  <li>Mathematics practice — randomised, with full working</li>
                  <li>Flashcards and fill-the-blank questions from your own notes</li>
                  <li>Reading PDFs, Word documents and PowerPoints</li>
                  <li>OCR on photos of handwriting</li>
                  <li>Syllabus, notes, uploads, search, progress, spaced repetition</li>
                  <li>Exams built from questions you already have</li>
                  <li>Multiple choice and true/false marked automatically</li>
                </ul>
              </div>
              <div>
                <div className="body" style={{ fontWeight: 550, marginBottom: 6 }}>Needs AI on</div>
                <ul className="meta" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.85 }}>
                  <li>Written questions for English, Legal, Business, Music, D&amp;T</li>
                  <li>Marking written answers and essays</li>
                  <li>Turning a syllabus PDF into tickable points</li>
                  <li>Study plans and the Learn step of a study session</li>
                  <li>Note tools — summarise, explain, study sheet</li>
                  <li>Pulling quotes, cases and examples out of your material</li>
                </ul>
              </div>
            </div>
          </div>

          <div style={{ paddingTop: 24 }}>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Keeping the cost down</div>
            <ul className="meta" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
              <li>Turn AI on only when you need it — flick it off the rest of the time.</li>
              <li>Generated questions are saved, so re-doing a set costs nothing.</li>
              <li>Set a monthly spend limit in the Anthropic console — a hard ceiling.</li>
              <li>
                For a cheaper model, set <code>ANTHROPIC_MODEL=claude-haiku-4-5</code> in <code>.env</code> and restart
                — about a third of the price, fine for questions and flashcards.
              </li>
            </ul>
          </div>

          {!ai?.key_present && (
            <div style={{ paddingTop: 24 }}>
              <div className="eyebrow" style={{ marginBottom: 10 }}>Setting up a key</div>
              <ol className="meta" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
                <li>Get a key from <code>console.anthropic.com</code></li>
                <li>Open <code>.env</code> in the <code>study-hq</code> folder</li>
                <li>Set <code>ANTHROPIC_API_KEY=sk-ant-…</code></li>
                <li>Restart the app</li>
              </ol>
              <div className="hint">The key is only ever read by the server — never sent to the browser or stored in the database.</div>
            </div>
          )}
        </section>
      )}

      {tab === 'data' && (
        <div className="stack" style={{ gap: 14 }}>
          <section className="section">
            <SectionHead title="Export" sub="Everything you own, in formats you can use elsewhere." />
            <div className="grid-2" style={{ gap: 8 }}>
              <a className="btn" href="/api/export" download><Icon name="download" size={14} /> Everything (JSON)</a>
              <a className="btn" href="/api/export/notes.md" download><Icon name="download" size={14} /> Notes (Markdown)</a>
              <a className="btn" href="/api/export/flashcards.csv" download><Icon name="download" size={14} /> Flashcards (CSV)</a>
              <a className="btn" href="/api/export/questions.csv" download><Icon name="download" size={14} /> Questions &amp; results (CSV)</a>
              <a className="btn" href="/api/export/syllabus.csv" download><Icon name="download" size={14} /> Syllabus (CSV)</a>
              <a className="btn" href="/api/export/progress.csv" download><Icon name="download" size={14} /> Progress (CSV)</a>
            </div>
            <div className="hint">The flashcard CSV imports straight into Anki. Uploads stay as original files in <code>data/uploads</code>.</div>
          </section>

          <section className="section">
            <SectionHead title="Where my data lives" />
            <div className="meta">
              Everything is in a SQLite database on this computer at <code>study-hq/data/studyhq.db</code>, with original uploads in
              <code> study-hq/data/uploads</code>. Nothing depends on browser storage, so clearing your browser never loses work.
              To back up, copy the <code>data</code> folder.
            </div>
            <div className="row wrap micro ink-4" style={{ marginTop: 10, gap: 12 }}>
              <span>{subjects?.length ?? 0} subjects</span>
              <span>{progress?.syllabus?.total ?? 0} syllabus points</span>
              <span>{progress?.flashcards?.total ?? 0} flashcards</span>
              <span>{progress?.questions_completed ?? 0} answered questions</span>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
