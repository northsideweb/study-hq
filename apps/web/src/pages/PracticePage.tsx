import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, fmtDate, QUESTION_TYPES } from '../lib/api'
import { Icon } from '../components/Icons'
import { Empty, Loading, Modal, Field, Tabs, Bar, useToast, useDialogs, useContextMenu, type MenuItem } from '../components/ui'
import GenerateModal from './GenerateModal'

export default function PracticePage({ subjectId, embedded }: { subjectId?: string; embedded?: boolean }) {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const [tab, setTab] = useState(params.get('tab') || 'sets')
  const [generate, setGenerate] = useState<{ subject?: string; topic?: string } | null>(
    params.get('generate') === '1' ? { subject: params.get('subject') || subjectId, topic: params.get('topic') || undefined } : null
  )

  const scope = subjectId || params.get('subject') || ''

  const tabs = [
    { id: 'sets', label: 'Practice sets' },
    { id: 'skills', label: 'Skills' },
    { id: 'mistakes', label: 'My mistakes' },
    { id: 'weak', label: 'Weak areas' },
    { id: 'infinite', label: 'Infinite practice' },
  ]

  return (
    <div className={embedded ? '' : 'page'}>
      <div className={embedded ? 'section-head' : 'page-head'}>
        <div>
          <h1 style={embedded ? { fontSize: 16 } : undefined}>Practice</h1>
          <div className="meta">Questions from your own material, or HSC-style questions from the syllabus.</div>
        </div>
        <div className="section-actions">
        <button className="btn primary" onClick={() => setGenerate({ subject: scope || undefined })}>
          <Icon name="plus" size={14} /> New practice
        </button>
      </div>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={(t) => { setTab(t); if (!embedded) setParams({ tab: t, ...(scope ? { subject: scope } : {}) }) }} />

      <div className="fade-in" key={tab}>
        {tab === 'sets' && <SetsTab subjectId={scope} onGenerate={() => setGenerate({ subject: scope || undefined })} />}
        {tab === 'skills' && <SkillsTab subjectId={scope} embedded={embedded} />}
        {tab === 'mistakes' && <MistakesTab subjectId={scope} />}
        {tab === 'weak' && <WeakTab subjectId={scope} />}
        {tab === 'infinite' && <InfiniteTab subjectId={scope} />}
      </div>

      {generate && (
        <GenerateModal kind="practice" subjectId={generate.subject} topicId={generate.topic} onClose={() => setGenerate(null)} />
      )}
    </div>
  )
}

/* ---------------- practice sets ---------------- */

function SetsTab({ subjectId, onGenerate }: { subjectId?: string; onGenerate: () => void }) {
  const navigate = useNavigate()
  const toast = useToast()
  const dialogs = useDialogs()
  const menu = useContextMenu()

  const { data: sets, isLoading, refetch } = useQuery({
    queryKey: ['practice-sets', subjectId || 'all'],
    queryFn: () => api.get(`/practice/sets${subjectId ? `?subject_id=${subjectId}` : ''}`),
  })

  const remove = useMutation({ mutationFn: (id: string) => api.del(`/practice/sets/${id}`), onSuccess: () => { refetch(); toast('Deleted', 'success') } })
  const duplicate = useMutation({ mutationFn: (id: string) => api.post(`/practice/sets/${id}/duplicate`), onSuccess: () => { refetch(); toast('Duplicated', 'success') } })
  const rename = useMutation({ mutationFn: ({ id, name }: any) => api.put(`/practice/sets/${id}`, { name }), onSuccess: () => refetch() })

  const setMenu = (s: any): MenuItem[] => [
    { type: 'label', label: s.name },
    { label: 'Open', onClick: () => navigate(`/practice/${s.id}`) },
    { label: 'Continue as infinite practice', onClick: () => navigate(`/practice/${s.id}?infinite=1`) },
    { type: 'sep' },
    { label: 'Rename', onClick: async () => { const n = await dialogs.prompt('Rename set', 'Name', s.name); if (n) rename.mutate({ id: s.id, name: n }) } },
    { label: 'Duplicate', onClick: () => duplicate.mutate(s.id) },
    { type: 'sep' },
    { label: 'Delete', danger: true, onClick: async () => { if (await dialogs.confirm('Delete practice set?', s.name, true)) remove.mutate(s.id) } },
  ]

  if (isLoading) return <Loading />
  const list = sets || []

  if (!list.length) {
    return <Empty title="No practice sets yet"
      message="Generate questions from your notes, uploads and syllabus — or switch to HSC mode for exam-style questions."
      action={<button className="btn sm primary" onClick={onGenerate}>Generate practice</button>} />
  }

  return (
    <div className="card" style={{ padding: 0 }}>
      <table className="data">
        <thead><tr><th>Set</th><th style={{ width: 130 }}>Source</th><th style={{ width: 90 }}>Questions</th><th style={{ width: 90 }}>Answered</th><th style={{ width: 110 }}>Created</th></tr></thead>
        <tbody>
          {list.map((s: any) => (
            <tr key={s.id} className="link" onClick={() => navigate(`/practice/${s.id}`)} onContextMenu={(e) => menu(e, setMenu(s))}>
              <td>
                <div className="row">
                  <span className="dot" style={{ background: s.subject_color || 'var(--ink-4)' }} />
                  <span className="strong">{s.name}</span>
                  {s.kind === 'infinite' && <span className="tag blue pill">Infinite</span>}
                </div>
              </td>
              <td><span className={`tag pill ${s.mode === 'hsc' ? 'blue' : ''}`}>{s.mode === 'hsc' ? 'HSC' : 'My material'}</span></td>
              <td className="ink-3">{s.question_count}</td>
              <td className="ink-3">{s.attempt_count}</td>
              <td className="micro">{fmtDate(s.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ---------------- skills ---------------- */

function SkillsTab({ subjectId, embedded }: { subjectId?: string; embedded?: boolean }) {
  const navigate = useNavigate()
  const toast = useToast()
  const qc = useQueryClient()
  const dialogs = useDialogs()
  const [selected, setSelected] = useState(subjectId || '')
  const [practising, setPractising] = useState<any>(null)

  const { data: subjects } = useQuery({ queryKey: ['subjects'], queryFn: () => api.get('/subjects') })
  const sid = subjectId || selected

  const { data: skills, isLoading, refetch } = useQuery({
    queryKey: ['skills', sid], queryFn: () => api.get(`/skills/${sid}`), enabled: !!sid,
  })

  const seed = useMutation({
    mutationFn: () => api.post(`/skills/${sid}/seed`),
    onSuccess: (r: any) => { refetch(); toast(`Added ${r.added} skills`, 'success') },
  })
  const addSkill = useMutation({
    mutationFn: (b: any) => api.post(`/skills/${sid}`, b),
    onSuccess: () => { refetch(); toast('Skill added', 'success') },
  })
  const removeSkill = useMutation({ mutationFn: (id: string) => api.del(`/skills/entry/${id}`), onSuccess: () => refetch() })

  if (!sid) {
    return (
      <div className="stack">
        <Field label="Choose a subject">
          <select value={selected} onChange={(e) => setSelected(e.target.value)} style={{ maxWidth: 320 }}>
            <option value="">Select…</option>
            {(subjects || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Empty title="Practise one skill at a time" message="Skills break a subject into the specific things you can drill — compound interest, topic sentences, command terms, aural analysis." />
      </div>
    )
  }

  if (isLoading) return <Loading />
  const list = skills || []
  const categories = [...new Set(list.map((s: any) => s.category || 'Skills'))] as string[]

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="row wrap">
        {!subjectId && (
          <select value={selected} onChange={(e) => setSelected(e.target.value)} style={{ maxWidth: 240 }}>
            {(subjects || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        <div className="spacer" />
        <button className="btn sm" onClick={async () => {
          const name = await dialogs.prompt('Add skill', 'Skill name')
          if (!name) return
          const category = await dialogs.prompt('Category', 'Group it under (e.g. Financial Mathematics)', 'Skills')
          addSkill.mutate({ name, category: category || 'Skills' })
        }}><Icon name="plus" size={13} /> Add skill</button>
        <button className="btn sm" onClick={() => seed.mutate()} disabled={seed.isPending}>
          {seed.isPending ? 'Adding…' : 'Add standard skills'}
        </button>
      </div>

      {!list.length ? (
        <Empty title="No skills yet"
          message="Load the standard skill list for this course, then drill any one of them infinitely."
          action={<button className="btn sm primary" onClick={() => seed.mutate()}>Add standard skills</button>} />
      ) : (
        categories.map((cat) => (
          <div key={cat}>
            <div className="section-head"><h2>{cat}</h2></div>
            <div className="grid-3">
              {list.filter((s: any) => (s.category || 'Skills') === cat).map((s: any) => (
                <div className="card link" key={s.id} onClick={() => setPractising(s)}>
                  <div className="row" style={{ marginBottom: 6 }}>
                    <span className="strong body" style={{ flex: 1 }}>{s.name}</span>
                    {s.accuracy !== null && (
                      <span className="tag pill" style={{ color: s.accuracy >= 80 ? 'var(--bar-green)' : s.accuracy >= 60 ? 'var(--bar-amber)' : 'var(--bar-red)' }}>
                        {s.accuracy}%
                      </span>
                    )}
                  </div>
                  <Bar value={s.accuracy ?? 0} color={s.accuracy === null ? 'var(--line-strong)' : s.accuracy >= 80 ? 'var(--bar-green)' : s.accuracy >= 60 ? 'var(--bar-amber)' : 'var(--bar-red)'} />
                  <div className="row micro ink-4" style={{ marginTop: 7 }}>
                    <span>{s.attempts ? `${s.attempts} answered` : 'Not practised yet'}</span>
                    <div className="spacer" />
                    <button className="btn quiet sm" onClick={(e) => { e.stopPropagation(); removeSkill.mutate(s.id) }} title="Remove skill">
                      <Icon name="x" size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {practising && (
        <GenerateModal
          kind="practice"
          subjectId={sid}
          title={`Practise: ${practising.name}`}
          instructions={`Every question must drill this specific skill: "${practising.name}"${practising.category ? ` (${practising.category})` : ''}. Vary the numbers, contexts and wording each time.`}
          skillId={practising.id}
          onClose={() => { setPractising(null); qc.invalidateQueries({ queryKey: ['skills'] }) }}
        />
      )}
    </div>
  )
}

/* ---------------- mistake bank ---------------- */

function MistakesTab({ subjectId }: { subjectId?: string }) {
  const navigate = useNavigate()
  const toast = useToast()
  const [open, setOpen] = useState<any>(null)
  const [showReviewed, setShowReviewed] = useState(false)

  const { data: mistakes, isLoading, refetch } = useQuery({
    queryKey: ['mistakes', subjectId || 'all', showReviewed],
    queryFn: () => api.get(`/mistakes?include_reviewed=${showReviewed}${subjectId ? `&subject_id=${subjectId}` : ''}`),
  })

  const markReviewed = useMutation({
    mutationFn: ({ id, reviewed }: any) => api.put(`/mistakes/${id}`, { reviewed }),
    onSuccess: () => refetch(),
  })
  const practise = useMutation({
    mutationFn: () => api.post('/mistakes/practice', { subject_id: subjectId || null, limit: 10 }),
    onSuccess: (r: any) => navigate(`/practice/${r.set_id}`),
    onError: (e: any) => toast(e.message, 'error'),
  })

  if (isLoading) return <Loading />
  const list = mistakes || []

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row wrap">
        <div className="meta" style={{ flex: 1 }}>
          Every question you scored under 60% on. Re-answering them is the fastest way to lift your marks.
        </div>
        <button className={`chip ${showReviewed ? 'on' : ''}`} onClick={() => setShowReviewed((v) => !v)}>Include resolved</button>
        <button className="btn primary" disabled={!list.length || practise.isPending} onClick={() => practise.mutate()}>
          <Icon name="refresh" size={14} /> {practise.isPending ? 'Building…' : 'Practise my mistakes'}
        </button>
      </div>

      {!list.length ? (
        <Empty title="No mistakes recorded" message="Anything you get wrong in practice or an exam lands here automatically." />
      ) : (
        <div className="rows">
          {list.map((m: any) => (
            <div className="row-item link" key={m.id} onClick={() => setOpen(m)}>
              <span className="dot" style={{ background: m.subject_color || 'var(--ink-4)' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="body truncate">{m.prompt}</div>
                <div className="micro">{m.subject_name}{m.topic_name ? ` · ${m.topic_name}` : ''} · {fmtDate(m.created_at)}</div>
              </div>
              <span className="tag red pill">{m.score}/{m.max_score}</span>
              {!!m.reviewed && <span className="tag green pill">resolved</span>}
            </div>
          ))}
        </div>
      )}

      {open && (
        <Modal
          title="Mistake review"
          subtitle={`${open.subject_name}${open.topic_name ? ` · ${open.topic_name}` : ''}`}
          size="wide"
          onClose={() => setOpen(null)}
          footer={
            <>
              <button className="btn" onClick={() => { markReviewed.mutate({ id: open.id, reviewed: !open.reviewed }); setOpen(null) }}>
                {open.reviewed ? 'Mark unresolved' : 'Mark as resolved'}
              </button>
              <div className="spacer" />
              <button className="btn" onClick={() => setOpen(null)}>Close</button>
              <button className="btn primary" onClick={() => practise.mutate()}>Practise this type</button>
            </>
          }
        >
          {open.stimulus && <div className="stimulus pre-wrap">{open.stimulus}</div>}
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>QUESTION ({open.marks} mark{open.marks === 1 ? '' : 's'})</div>
            <div className="body pre-wrap">{open.prompt}</div>
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 4, color: 'var(--red)' }}>MY ANSWER · {open.score}/{open.max_score}</div>
            <div className="body pre-wrap" style={{ padding: 10, background: 'var(--red-wash)', borderRadius: 8 }}>{open.response || '(blank)'}</div>
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 4, color: 'var(--green)' }}>CORRECT ANSWER</div>
            <div className="body pre-wrap" style={{ padding: 10, background: 'var(--green-wash)', borderRadius: 8 }}>{open.answer}</div>
          </div>
          {open.working && (
            <div>
              <div className="eyebrow" style={{ marginBottom: 4 }}>WORKING</div>
              <div className="body pre-wrap mono" style={{ padding: 10, background: 'var(--bg-sunken)', borderRadius: 8 }}>{open.working}</div>
            </div>
          )}
          {(open.feedback || open.improvement) && (
            <div>
              <div className="eyebrow" style={{ marginBottom: 4 }}>EXPLANATION</div>
              <div className="body pre-wrap">{open.improvement || open.feedback}</div>
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}

/* ---------------- weak areas ---------------- */

function WeakTab({ subjectId }: { subjectId?: string }) {
  const navigate = useNavigate()
  const { data: mastery, isLoading } = useQuery({
    queryKey: ['mastery', subjectId || 'all'],
    queryFn: () => api.get(`/mastery${subjectId ? `?subject_id=${subjectId}` : ''}`),
  })

  if (isLoading) return <Loading />
  const list = (mastery || []).filter((m: any) => m.mastery !== null).sort((a: any, b: any) => a.mastery - b.mastery)

  if (!list.length) {
    return <Empty title="No mastery data yet" message="Complete your first practice set to start tracking which topics need work."
      action={<button className="btn sm primary" onClick={() => navigate('/practice?generate=1')}>Start practice</button>} />
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="meta">Click any topic to start targeted practice on it straight away.</div>
      <div className="rows">
        {list.map((m: any) => (
          <div className="row-item link" key={m.id} onClick={() => navigate(`/practice?subject=${m.subject_id}&topic=${m.id}&generate=1`)}>
            <span className="dot" style={{ background: m.subject_color }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="body strong truncate">{m.name}</div>
              <div className="micro">{m.subject_name} · {m.attempts} answered · {m.cards} cards</div>
            </div>
            <div style={{ width: 120 }}><Bar value={m.mastery} color={m.mastery < 60 ? 'var(--bar-red)' : m.mastery < 80 ? 'var(--bar-amber)' : 'var(--bar-green)'} /></div>
            <span className="strong body" style={{ width: 42, textAlign: 'right', color: m.mastery < 60 ? 'var(--bar-red)' : m.mastery < 80 ? 'var(--bar-amber)' : 'var(--bar-green)' }}>
              {m.mastery}%
            </span>
            <Icon name="arrowRight" size={14} className="ink-4" />
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---------------- infinite practice ---------------- */

function InfiniteTab({ subjectId }: { subjectId?: string }) {
  const navigate = useNavigate()
  const toast = useToast()
  const [subject, setSubject] = useState(subjectId || '')
  const [topic, setTopic] = useState('')
  const [difficulty, setDifficulty] = useState('adaptive')
  const [qtype, setQtype] = useState('mixed')
  const [mode, setMode] = useState<'my_material' | 'hsc'>('my_material')

  const { data: subjects } = useQuery({ queryKey: ['subjects'], queryFn: () => api.get('/subjects') })
  const { data: topics } = useQuery({
    queryKey: ['topics', subject], queryFn: () => api.get(`/topics?subject_id=${subject}`), enabled: !!subject,
  })

  const start = useMutation({
    mutationFn: () => api.post('/practice/generate', {
      subject_id: subject, topic_id: topic || null, difficulty, qtype, mode, count: 3, infinite: true,
      name: `Infinite practice${topics?.find((t: any) => t.id === topic) ? ' — ' + topics.find((t: any) => t.id === topic).name : ''}`,
    }),
    onSuccess: (r: any) => { if (r.notice) toast(r.notice, 'info'); navigate(`/practice/${r.set_id}?infinite=1`) },
    onError: (e: any) => toast(e.message, 'error', 'Could not start'),
  })

  const subjectName = subjects?.find((s: any) => s.id === subject)?.name

  return (
    <div className="card" style={{ maxWidth: 620 }}>
      <div className="row" style={{ marginBottom: 4 }}>
        <Icon name="refresh" size={16} style={{ color: 'var(--blue)' }} />
        <h2>Infinite practice</h2>
      </div>
      <div className="meta" style={{ marginBottom: 14 }}>
        Keeps generating fresh questions — new numbers, scenarios and wording — and adapts to how you go. It never runs out.
      </div>

      <div className="stack" style={{ gap: 12 }}>
        <Field label="Subject">
          <select value={subject} onChange={(e) => { setSubject(e.target.value); setTopic('') }}>
            <option value="">Choose a subject…</option>
            {(subjects || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Topic">
          <select value={topic} onChange={(e) => setTopic(e.target.value)} disabled={!subject}>
            <option value="">Whole subject</option>
            {(topics || []).map((t: any) => <option key={t.id} value={t.id}>{t.scope === 'school' ? '● ' : ''}{t.name}</option>)}
          </select>
        </Field>
        <Field label="Difficulty">
          <div className="row wrap">
            {['easy', 'medium', 'hard', 'adaptive'].map((d) => (
              <button key={d} className={`chip ${difficulty === d ? 'on' : ''}`} onClick={() => setDifficulty(d)}>
                {d[0].toUpperCase() + d.slice(1)}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Question type">
          <div className="row wrap">
            {['mixed', 'multiple_choice', 'short_answer', 'extended_response'].map((t) => (
              <button key={t} className={`chip ${qtype === t ? 'on' : ''}`} onClick={() => setQtype(t)}>
                {QUESTION_TYPES.find((q) => q.value === t)?.label || t}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Source">
          <div className="row">
            <button className={`chip ${mode === 'my_material' ? 'on' : ''}`} onClick={() => setMode('my_material')}>My material</button>
            <button className={`chip ${mode === 'hsc' ? 'on' : ''}`} onClick={() => setMode('hsc')}>HSC practice</button>
          </div>
        </Field>

        <button className="btn primary lg block" disabled={!subject || start.isPending} onClick={() => start.mutate()}>
          {start.isPending ? <><span className="spinner" /> Starting…</> : <><Icon name="play" size={15} /> Start{subjectName ? ` — ${subjectName}` : ''}</>}
        </button>
      </div>
    </div>
  )
}
