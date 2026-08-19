import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, STATUS_LABELS, type SyllabusPoint } from '../../lib/api'
import { Icon } from '../../components/Icons'
import { Modal, Field, Empty, StatusTick, nextStatus, useToast, useDialogs, useContextMenu, type MenuItem, Bar, Loading } from '../../components/ui'
import GenerateModal from '../GenerateModal'

const STATUS_TEXT: Record<string, { label: string; colour: string }> = {
  completed: { label: 'Complete', colour: 'var(--green)' },
  studying: { label: 'In progress', colour: 'var(--amber)' },
  needs_revision: { label: 'Needs revision', colour: 'var(--red)' },
  not_started: { label: 'Not started', colour: 'var(--ink-4)' },
}

export default function SyllabusTab({ subjectId, subjectName }: { subjectId: string; subjectName: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const dialogs = useDialogs()
  const menu = useContextMenu()

  const [paste, setPaste] = useState<{ text: string } | null>(null)
  const [adding, setAdding] = useState<any>(null)
  const [generate, setGenerate] = useState<{ kind: 'practice' | 'flashcards'; point: SyllabusPoint } | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [filter, setFilter] = useState('')

  const { data, refetch, isLoading } = useQuery({ queryKey: ['syllabus', subjectId], queryFn: () => api.get(`/syllabus/${subjectId}`) })
  const { data: counts } = useQuery({ queryKey: ['syllabus-counts', subjectId], queryFn: () => api.get(`/syllabus/${subjectId}/counts`) })

  const invalidate = () => {
    refetch()
    qc.invalidateQueries({ queryKey: ['syllabus-counts', subjectId] })
    qc.invalidateQueries({ queryKey: ['subjects'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const setStatus = useMutation({ mutationFn: ({ id, status }: any) => api.put(`/syllabus/points/${id}`, { status }), onSuccess: invalidate })
  const savePoint = useMutation({
    mutationFn: (p: any) => (p.id ? api.put(`/syllabus/points/${p.id}`, p) : api.post(`/syllabus/${subjectId}/points`, p)),
    onSuccess: () => { invalidate(); setAdding(null) }, onError: (e: any) => toast(e.message, 'error'),
  })
  const delPoint = useMutation({ mutationFn: (id: string) => api.del(`/syllabus/points/${id}`), onSuccess: invalidate })
  const addSection = useMutation({ mutationFn: (title: string) => api.post(`/syllabus/${subjectId}/sections`, { title }), onSuccess: invalidate })
  const delSection = useMutation({ mutationFn: (id: string) => api.del(`/syllabus/sections/${id}`), onSuccess: invalidate })
  const delDoc = useMutation({ mutationFn: (id: string) => api.del(`/syllabus/docs/${id}`), onSuccess: invalidate })

  const bulkAdd = useMutation({
    mutationFn: ({ text, ai }: any) => ai ? api.post(`/syllabus/${subjectId}/parse`, { text }) : api.post(`/syllabus/${subjectId}/bulk`, { text }),
    onSuccess: (r: any) => {
      invalidate(); setPaste(null)
      toast(r.points != null ? `Imported ${r.points} points into ${r.sections} sections` : `Added ${r.added} syllabus points`, 'success')
    },
    onError: (e: any) => toast(e.message, 'error', 'Import failed'),
  })

  const uploadSyllabus = async (files: FileList | null) => {
    if (!files?.length) return
    setUploading(true)
    try {
      const form = new FormData()
      Array.from(files).forEach((f) => form.append('files', f))
      form.append('subject_id', subjectId)
      form.append('work_type', 'Syllabus')
      const res = await api.upload('/uploads', form)
      const id = res.ids[0]
      toast('Uploaded — reading the text…', 'info')
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 1500))
        const p = await api.get(`/uploads/${id}/progress`)
        if (p.status !== 'pending') break
      }
      const full = await api.get(`/uploads/${id}`)
      await api.post(`/syllabus/${subjectId}/docs`, { title: full.original_filename || 'Syllabus', content: full.extracted_text || '', upload_id: id })
      invalidate()
      toast(full.extracted_text ? 'Syllabus saved — use "Structure with AI" to turn it into tickable points.'
        : `Saved, but no text could be read (${full.extract_error}).`, full.extracted_text ? 'success' : 'error')
    } catch (e: any) { toast(e.message, 'error', 'Upload failed') } finally { setUploading(false) }
  }

  const pointMenu = (p: SyllabusPoint): MenuItem[] => [
    { type: 'label', label: 'Syllabus point' },
    { label: 'Show connected material', onClick: () => setExpanded(expanded === p.id ? null : p.id) },
    { type: 'sep' },
    { label: 'Mark in progress', onClick: () => setStatus.mutate({ id: p.id, status: 'studying' }) },
    { label: 'Mark needs revision', onClick: () => setStatus.mutate({ id: p.id, status: 'needs_revision' }) },
    { label: 'Mark complete', onClick: () => setStatus.mutate({ id: p.id, status: 'completed' }) },
    { label: 'Reset to not started', onClick: () => setStatus.mutate({ id: p.id, status: 'not_started' }) },
    { type: 'sep' },
    { label: 'Generate practice', onClick: () => setGenerate({ kind: 'practice', point: p }) },
    { label: 'Generate flashcards', onClick: () => setGenerate({ kind: 'flashcards', point: p }) },
    { type: 'sep' },
    { label: 'Edit', onClick: async () => {
      const text = await dialogs.prompt('Edit syllabus point', 'Text', p.text, true)
      if (text) savePoint.mutate({ id: p.id, text })
    } },
    { label: 'Delete', danger: true, onClick: async () => { if (await dialogs.confirm('Delete syllabus point?', p.text, true)) delPoint.mutate(p.id) } },
  ]

  if (isLoading) return <Loading />

  const sections = data?.sections || []
  const allPoints: SyllabusPoint[] = data?.points || []
  const docs = data?.docs || []
  const points = filter ? allPoints.filter((p) => p.status === filter) : allPoints
  const done = allPoints.filter((p) => p.status === 'completed').length
  const pct = allPoints.length ? Math.round((done / allPoints.length) * 100) : 0
  const orphans = points.filter((p) => !p.section_id)
  const counted = (id: string) => counts?.[id] || { notes: 0, uploads: 0, flashcards: 0, questions: 0, exam_questions: 0 }

  const groups = [
    ...sections.map((s: any) => ({ section: s, pts: points.filter((p) => p.section_id === s.id) })),
    ...(orphans.length ? [{ section: null, pts: orphans }] : []),
  ].filter((g) => g.pts.length || !filter)

  return (
    <div>
      {/* progress + actions, no container */}
      <div className="row wrap" style={{ gap: 26, alignItems: 'flex-end', marginBottom: 30 }}>
        <div style={{ minWidth: 190 }}>
          <div className="eyebrow">Syllabus complete</div>
          <div className="row" style={{ gap: 12, marginTop: 8 }}>
            <span className="num" style={{ fontSize: 27, fontWeight: 600, letterSpacing: '-0.03em' }}>{pct}%</span>
            <span className="meta">{done} of {allPoints.length} points</span>
          </div>
          <div style={{ marginTop: 10 }}><Bar value={pct} color="var(--bar-green)" /></div>
        </div>
        <div className="spacer" />
        <div className="row wrap" style={{ gap: 7 }}>
          <button className="btn sm primary" onClick={() => setAdding({ section_id: sections[0]?.id || null, text: '', code: '' })}>
            <Icon name="plus" size={13} /> Add point
          </button>
          <button className="btn sm" onClick={async () => { const t = await dialogs.prompt('New section', 'Section title (e.g. Operations)'); if (t) addSection.mutate(t) }}>Add section</button>
          <button className="btn sm" onClick={() => setPaste({ text: '' })}>Paste syllabus</button>
          <label className="btn sm" style={{ cursor: 'pointer' }}>
            {uploading ? <><span className="spinner" /> Uploading…</> : 'Upload PDF'}
            <input type="file" hidden multiple accept=".pdf,image/*" onChange={(e) => uploadSyllabus(e.target.files)} />
          </label>
          <label className="btn sm" style={{ cursor: 'pointer' }}>
            Photo
            <input type="file" hidden accept="image/*" capture="environment" onChange={(e) => uploadSyllabus(e.target.files)} />
          </label>
        </div>
      </div>

      {!!allPoints.length && (
        <div className="row wrap" style={{ gap: 7, marginBottom: 26 }}>
          {(['', 'studying', 'needs_revision', 'completed'] as const).map((f) => (
            <button key={f || 'all'} className={`chip ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>
              {f === '' ? `All ${allPoints.length}` : `${STATUS_TEXT[f].label} ${allPoints.filter((p) => p.status === f).length}`}
            </button>
          ))}
        </div>
      )}

      {!allPoints.length && !docs.length ? (
        <Empty title="No syllabus yet"
          message={`Paste your ${subjectName} syllabus, upload the PDF, or photograph the pages. Every point you add becomes the spine of your practice, flashcards and progress.`}
          action={<button className="btn sm primary" onClick={() => setPaste({ text: '' })}>Paste syllabus</button>} />
      ) : (
        groups.map(({ section, pts }: any, gi: number) => (
          <section className="section" key={section?.id || `g-${gi}`} style={{ marginBottom: 44 }}>
            <div className="section-head">
              <div className="row" style={{ gap: 10 }}>
                <div className="eyebrow" style={{ fontSize: 11.5, color: 'var(--ink-2)' }}>{section?.title || 'Ungrouped'}</div>
                <span className="micro num">{pts.filter((p: SyllabusPoint) => p.status === 'completed').length}/{pts.length}</span>
              </div>
              <div className="section-actions">
                <button className="btn quiet sm" onClick={() => setAdding({ section_id: section?.id || null, text: '', code: '' })}>
                  <Icon name="plus" size={13} />
                </button>
                {section && (
                  <button className="btn quiet sm" onClick={async () => {
                    if (await dialogs.confirm('Delete section?', `"${section.title}" and its ${pts.length} points will be deleted.`, true)) delSection.mutate(section.id)
                  }}><Icon name="trash" size={13} /></button>
                )}
              </div>
            </div>

            {!pts.length && <div className="meta" style={{ padding: '14px 0' }}>No points in this section yet.</div>}

            <div className="rows">
              {pts.map((p: SyllabusPoint, i: number) => {
                const c = counted(p.id)
                const total = c.notes + c.uploads + c.flashcards + c.questions + c.exam_questions
                const open = expanded === p.id
                const st = STATUS_TEXT[p.status]
                return (
                  <div key={p.id} style={{ borderBottom: '1px solid var(--line-soft)' }}>
                    <div className="row top" style={{ gap: 16, padding: '15px 12px', margin: '0 -12px', borderRadius: 6, cursor: 'pointer' }}
                      onClick={() => setExpanded(open ? null : p.id)}
                      onContextMenu={(e) => menu(e, pointMenu(p))}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <div className="row-index" style={{ paddingTop: 2 }}>{String(i + 1).padStart(2, '0')}</div>
                      <StatusTick status={p.status} onClick={() => setStatus.mutate({ id: p.id, status: nextStatus(p.status) })} />
                      <div className="row-main">
                        <div className="body" style={{ fontWeight: 450, opacity: p.status === 'completed' ? 0.62 : 1 }}>
                          {p.code && <span className="mono ink-4" style={{ marginRight: 7 }}>{p.code}</span>}
                          {p.text}
                        </div>
                        {total > 0 && !open && (
                          <div className="micro" style={{ marginTop: 3 }}>
                            {[c.uploads && `${c.uploads} school work`, c.notes && `${c.notes} notes`,
                              c.flashcards && `${c.flashcards} flashcards`, c.questions && `${c.questions} questions`]
                              .filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </div>
                      <div style={{ flex: '0 0 auto', fontSize: 12.5, color: st.colour, minWidth: 96, textAlign: 'right' }}>{st.label}</div>
                      <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} className="ink-4" />
                    </div>

                    {open && <PointDetail point={p} onGenerate={(kind) => setGenerate({ kind, point: p })} />}
                  </div>
                )
              })}
            </div>
          </section>
        ))
      )}

      {!!docs.length && (
        <section className="section">
          <div className="section-head"><h2>Syllabus documents</h2></div>
          <div className="rows">
            {docs.map((d: any) => (
              <div className="row-item" key={d.id}>
                <Icon name="file" size={15} className="ink-4" />
                <div className="row-main">
                  <div className="row-title">{d.title}</div>
                  <div className="row-sub">{(d.content || '').length.toLocaleString()} characters extracted</div>
                </div>
                {d.upload_id && <a className="btn quiet sm" href={`/api/uploads/${d.upload_id}/file`} target="_blank" rel="noreferrer">Original</a>}
                <button className="btn sm" disabled={!d.content} onClick={() => setPaste({ text: d.content })}>Structure with AI</button>
                <button className="btn quiet sm icon" onClick={async () => { if (await dialogs.confirm('Delete document?', d.title, true)) delDoc.mutate(d.id) }}>
                  <Icon name="trash" size={13} />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {paste && (
        <Modal
          title="Add syllabus content"
          subtitle="Paste from the NESA syllabus, your school's program, or your own notes."
          size="wide"
          onClose={() => setPaste(null)}
          footer={
            <>
              <button className="btn" onClick={() => setPaste(null)}>Cancel</button>
              <button className="btn" disabled={!paste.text.trim() || bulkAdd.isPending} onClick={() => bulkAdd.mutate({ text: paste.text, ai: false })}>
                One point per line
              </button>
              <button className="btn primary" disabled={!paste.text.trim() || bulkAdd.isPending} onClick={() => bulkAdd.mutate({ text: paste.text, ai: true })}>
                {bulkAdd.isPending ? <><span className="spinner" /> Working…</> : 'Structure with AI'}
              </button>
            </>
          }
        >
          <Field label="Syllabus text" hint="“Structure with AI” splits it into sections and points. “One point per line” works without an API key.">
            <textarea rows={15} value={paste.text} autoFocus onChange={(e) => setPaste({ text: e.target.value })}
              placeholder={'Operations\nRole of operations management\nStrategic role of operations management\n…'} />
          </Field>
        </Modal>
      )}

      {adding && (
        <Modal
          title="Add syllabus point"
          onClose={() => setAdding(null)}
          footer={
            <>
              <button className="btn" onClick={() => setAdding(null)}>Cancel</button>
              <button className="btn primary" disabled={!adding.text.trim()} onClick={() => savePoint.mutate(adding)}>Add point</button>
            </>
          }
        >
          <Field label="Section">
            <select value={adding.section_id || ''} onChange={(e) => setAdding({ ...adding, section_id: e.target.value || null })}>
              <option value="">Ungrouped</option>
              {sections.map((s: any) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </Field>
          <Field label="Outcome code (optional)"><input value={adding.code} onChange={(e) => setAdding({ ...adding, code: e.target.value })} placeholder="e.g. P2.1" /></Field>
          <Field label="Syllabus point"><textarea rows={3} autoFocus value={adding.text} onChange={(e) => setAdding({ ...adding, text: e.target.value })} /></Field>
        </Modal>
      )}

      {generate && (
        <GenerateModal kind={generate.kind} subjectId={subjectId}
          title={`${generate.kind === 'practice' ? 'Practice' : 'Flashcards'} for this syllabus point`}
          instructions={`Focus entirely on this syllabus point: "${generate.point.text}".`}
          onClose={() => setGenerate(null)} />
      )}
    </div>
  )
}

/** Inline expansion: everything connected to one syllabus point. */
function PointDetail({ point, onGenerate }: { point: SyllabusPoint; onGenerate: (k: 'practice' | 'flashcards') => void }) {
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({
    queryKey: ['syllabus-material', point.id], queryFn: () => api.get(`/syllabus/points/${point.id}/material`),
  })

  if (isLoading) return <div style={{ padding: '4px 0 18px 42px' }}><Loading label="Finding connected material" /></div>

  const groups = [
    { key: 'uploads', label: 'School work', items: data.uploads, icon: 'file', go: () => navigate(`/subjects/${point.subject_id}?tab=school`) },
    { key: 'notes', label: 'Notes', items: data.notes, icon: 'note', go: (x: any) => navigate(`/notes/${x.id}`) },
    { key: 'flashcards', label: 'Flashcards', items: data.flashcards, icon: 'cards', go: () => navigate(`/subjects/${point.subject_id}?tab=flashcards`) },
    { key: 'questions', label: 'Practice questions', items: data.questions, icon: 'pencil', go: (x: any) => navigate(`/practice/${x.set_id}`) },
  ]

  return (
    <div className="fade-in" style={{ padding: '2px 0 22px 42px' }}>
      <div className="row wrap" style={{ gap: 34, marginBottom: 16 }}>
        {groups.map((g) => (
          <div key={g.key}>
            <div className="micro">{g.label}</div>
            <div className="num" style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.02em' }}>{g.items.length}</div>
          </div>
        ))}
        <div className="spacer" />
        <div className="row" style={{ gap: 7 }}>
          <button className="btn sm" onClick={() => onGenerate('flashcards')}>Make flashcards</button>
          <button className="btn sm primary" onClick={() => onGenerate('practice')}>Practise this point</button>
        </div>
      </div>

      {groups.filter((g) => g.items.length).map((g) => (
        <div key={g.key} style={{ marginBottom: 12 }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>{g.label}</div>
          <div className="stack tight">
            {g.items.slice(0, 5).map((x: any) => (
              <div className="row" key={x.id} style={{ gap: 9, cursor: 'pointer' }} onClick={() => g.go(x)}>
                <Icon name={g.icon} size={13} className="ink-4" />
                <span className="meta truncate">{x.title || x.front || x.prompt || x.original_filename}</span>
              </div>
            ))}
            {g.items.length > 5 && <div className="micro">+{g.items.length - 5} more</div>}
          </div>
        </div>
      ))}

      {!groups.some((g) => g.items.length) && (
        <div className="meta">Nothing connected yet — add notes or school work mentioning {data.terms?.slice(0, 2).join(' or ') || 'this topic'}.</div>
      )}
    </div>
  )
}
