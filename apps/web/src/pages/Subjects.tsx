import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ICONS, COLORS, SUBJECT_KINDS, type Subject } from '../lib/api'
import { Icon, SUBJECT_ICONS } from '../components/Icons'
import { Modal, Field, Empty, Loading, ErrorBox, Bar, useToast, useDialogs, useContextMenu, type MenuItem } from '../components/ui'
import GenerateModal from './GenerateModal'

const masteryColour = (m: number | null) =>
  m === null ? 'var(--ink-4)' : m >= 80 ? 'var(--bar-green)' : m >= 60 ? 'var(--bar-amber)' : 'var(--bar-red)'

export default function Subjects() {
  const qc = useQueryClient()
  const toast = useToast()
  const dialogs = useDialogs()
  const menu = useContextMenu()
  const navigate = useNavigate()

  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState<Partial<Subject> | null>(null)
  const [generate, setGenerate] = useState<{ kind: 'practice' | 'flashcards'; subjectId: string } | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)

  const { data: subjects, isLoading, error, refetch } = useQuery<Subject[]>({
    queryKey: ['subjects', showArchived],
    queryFn: () => api.get(`/subjects${showArchived ? '?archived=true' : ''}`),
  })
  const { data: schoolTopics } = useQuery({
    queryKey: ['topics', 'all', 'school'], queryFn: () => api.get('/topics?scope=school'),
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['subjects'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const save = useMutation({
    mutationFn: (s: Partial<Subject>) => (s.id ? api.put(`/subjects/${s.id}`, s) : api.post('/subjects', s)),
    onSuccess: () => { invalidate(); setEditing(null); toast('Subject saved', 'success') },
    onError: (e: any) => toast(e.message, 'error'),
  })
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: any }) => api.put(`/subjects/${id}`, patch),
    onSuccess: invalidate, onError: (e: any) => toast(e.message, 'error'),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/subjects/${id}`),
    onSuccess: () => { invalidate(); toast('Subject deleted', 'success') },
  })
  const reorder = useMutation({ mutationFn: (ids: string[]) => api.post('/subjects/reorder', { ids }), onSuccess: invalidate })

  const addTopic = async (s: Subject) => {
    const name = await dialogs.prompt(`Add topic to ${s.name}`, 'Topic name')
    if (!name) return
    await api.post('/topics', { subject_id: s.id, name, scope: 'topic' })
    toast(`Added "${name}"`, 'success')
    qc.invalidateQueries({ queryKey: ['topics'] })
    invalidate()
  }

  const addSyllabus = async (s: Subject) => {
    const text = await dialogs.prompt(`Add syllabus for ${s.name}`, 'Paste your syllabus — one point per line', '', true)
    if (!text) return
    const r = await api.post(`/syllabus/${s.id}/bulk`, { text })
    toast(`Added ${r.added} syllabus point${r.added === 1 ? '' : 's'}`, 'success')
    invalidate()
    navigate(`/subjects/${s.id}?tab=syllabus`)
  }

  const move = (s: Subject, dir: -1 | 1) => {
    const list = [...(subjects || [])]
    const i = list.findIndex((x) => x.id === s.id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= list.length) return
    ;[list[i], list[j]] = [list[j], list[i]]
    reorder.mutate(list.map((x) => x.id))
  }

  const subjectMenu = (s: Subject): MenuItem[] => [
    { type: 'label', label: s.name },
    { label: 'Open subject', onClick: () => navigate(`/subjects/${s.id}`) },
    { label: 'Add topic', onClick: () => addTopic(s) },
    { label: 'Upload work', onClick: () => navigate(`/uploads?subject=${s.id}`) },
    { label: 'Add syllabus', onClick: () => addSyllabus(s) },
    { type: 'sep' },
    { label: 'Generate practice', onClick: () => setGenerate({ kind: 'practice', subjectId: s.id }) },
    { label: 'Generate flashcards', onClick: () => setGenerate({ kind: 'flashcards', subjectId: s.id }) },
    { type: 'sep' },
    { label: 'Rename', onClick: async () => {
      const name = await dialogs.prompt('Rename subject', 'Subject name', s.name)
      if (name) update.mutate({ id: s.id, patch: { name } })
    } },
    { label: 'Edit icon & colour', onClick: () => setEditing(s) },
    { label: 'Move up', onClick: () => move(s, -1) },
    { label: 'Move down', onClick: () => move(s, 1) },
    { label: s.archived ? 'Unarchive' : 'Archive', onClick: () => update.mutate({ id: s.id, patch: { archived: !s.archived } }) },
    { type: 'sep' },
    { label: 'Delete', danger: true, onClick: async () => {
      const ok = await dialogs.confirm(`Delete ${s.name}?`,
        `This permanently deletes the subject and everything inside it — topics, syllabus, notes, uploads, flashcards, questions and results.\n\nArchive it instead if you just want it out of the way.`, true)
      if (ok) remove.mutate(s.id)
    } },
  ]

  if (isLoading) return <div className="page"><Loading /></div>
  if (error) return <div className="page"><ErrorBox error={error} retry={refetch} /></div>

  const list = subjects || []
  const currentTopic = (id: string) =>
    (schoolTopics || []).find((t: any) => t.subject_id === id && t.status === 'studying')?.name

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Subjects</h1>
          <div className="sub">Six subjects · right-click any row for its full menu, drag to reorder.</div>
        </div>
        <div className="section-actions">
          <button className={`chip ${showArchived ? 'on' : ''}`} onClick={() => setShowArchived((v) => !v)}>Archived</button>
          <button className="btn primary" onClick={() => setEditing({ name: '', kind: 'generic', icon: 'book', color: COLORS[0] })}>
            <Icon name="plus" size={15} /> Add subject
          </button>
        </div>
      </div>

      {!list.length ? (
        <Empty title="No subjects yet" message="Add your first subject to get started."
          action={<button className="btn sm primary" onClick={() => setEditing({ name: '', kind: 'generic', icon: 'book', color: COLORS[0] })}>Add subject</button>} />
      ) : (
        <div className="rows">
          {list.map((s) => {
            const st = s.stats!
            const topic = currentTopic(s.id)
            return (
              <div
                key={s.id}
                className="row-item link"
                draggable
                onDragStart={() => setDragId(s.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (!dragId || dragId === s.id) return
                  const ids = list.map((x) => x.id)
                  const from = ids.indexOf(dragId)
                  const to = ids.indexOf(s.id)
                  ids.splice(to, 0, ids.splice(from, 1)[0])
                  reorder.mutate(ids)
                  setDragId(null)
                }}
                onClick={() => navigate(`/subjects/${s.id}`)}
                onContextMenu={(e) => menu(e, subjectMenu(s))}
                style={{ opacity: s.archived ? 0.55 : 1, paddingTop: 18, paddingBottom: 18 }}
              >
                <span className="nav-swatch" style={{ background: s.color, width: 8, height: 8 }} />

                <div className="row-main">
                  <div className="row" style={{ gap: 9 }}>
                    <span style={{ fontSize: 15.5, fontWeight: 550, letterSpacing: '-0.015em' }}>{s.name}</span>
                    {!!s.archived && <span className="tag pill">archived</span>}
                    {st.due > 0 && <span className="tag amber">{st.due} cards due</span>}
                  </div>
                  <div className="row-sub">
                    {topic ? <>Current topic · <span style={{ color: 'var(--ink-2)' }}>{topic}</span></>
                      : st.syllabus_points ? `${st.syllabus_done} of ${st.syllabus_points} syllabus points complete`
                      : 'No syllabus added yet'}
                  </div>
                </div>

                <div className="micro num" style={{ width: 116, textAlign: 'right' }}>
                  {st.topics} topics · {st.flashcards} cards
                </div>

                <div className="progress-inline">
                  <Bar value={st.mastery ?? 0} color={masteryColour(st.mastery)} />
                </div>

                <div className="num" style={{ width: 46, textAlign: 'right', fontWeight: 600, color: masteryColour(st.mastery) }}>
                  {st.mastery === null ? '—' : `${st.mastery}%`}
                </div>

                <Icon name="arrowRight" size={15} className="row-go" />
              </div>
            )
          })}
        </div>
      )}

      {editing && (
        <Modal
          title={editing.id ? 'Edit subject' : 'Add subject'}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn primary" disabled={!editing.name?.trim() || save.isPending} onClick={() => save.mutate(editing)}>
                {save.isPending ? 'Saving…' : 'Save subject'}
              </button>
            </>
          }
        >
          <Field label="Subject name">
            <input value={editing.name || ''} autoFocus onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Modern History" />
          </Field>
          <Field label="Subject type" hint="Unlocks the specialised tools — maths shows working, English marks essays, Legal uses cases and legislation.">
            <select value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value })}>
              {SUBJECT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </Field>
          <Field label="Icon">
            <div className="row wrap" style={{ gap: 6 }}>
              {ICONS.map((ic) => (
                <button key={ic} className={`chip ${editing.icon === ic ? 'on' : ''}`} style={{ width: 34, padding: 0, justifyContent: 'center' }}
                  onClick={() => setEditing({ ...editing, icon: ic })}>
                  <Icon name={SUBJECT_ICONS[ic] || 'book'} size={14} />
                </button>
              ))}
            </div>
          </Field>
          <Field label="Colour">
            <div className="row wrap" style={{ gap: 7 }}>
              {COLORS.map((c) => (
                <button key={c} onClick={() => setEditing({ ...editing, color: c })} aria-label={c}
                  style={{ width: 22, height: 22, borderRadius: '50%', background: c, cursor: 'pointer',
                    border: editing.color === c ? '2px solid var(--ink)' : '1px solid var(--line)', padding: 0 }} />
              ))}
            </div>
          </Field>
        </Modal>
      )}

      {generate && <GenerateModal kind={generate.kind} subjectId={generate.subjectId} onClose={() => setGenerate(null)} />}
    </div>
  )
}
