import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, WORK_TYPES, fmtDate, fmtBytes, type Upload } from '../lib/api'
import { Modal, Field, Empty, useToast, useDialogs, useContextMenu, type MenuItem } from './ui'
import { Icon } from './Icons'
import GenerateModal from '../pages/GenerateModal'

const glyph = (u: Upload) =>
  u.source === 'paste' ? 'clipboard' : u.mime?.startsWith('image/') ? 'image' : u.source === 'photo' ? 'camera' : 'file'

/** Polls extraction progress while a file is still being read. */
function ExtractProgress({ id, onDone }: { id: string; onDone: () => void }) {
  const [state, setState] = useState<{ pct: number; stage: string } | null>(null)
  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const r = await api.get(`/uploads/${id}/progress`)
        if (!alive) return
        setState(r)
        if (r.status === 'pending') setTimeout(tick, 1200)
        else onDone()
      } catch { /* stop polling on error */ }
    }
    tick()
    return () => { alive = false }
  }, [id])
  if (!state) return <span className="tag amber pill">reading…</span>
  return (
    <span className="tag amber pill" title={state.stage}>
      <span className="spinner" style={{ width: 9, height: 9, borderWidth: 1.5 }} /> {state.stage} {state.pct}%
    </span>
  )
}

export default function UploadList({ subjectId, topicId, limit }: { subjectId?: string; topicId?: string; limit?: number }) {
  const qc = useQueryClient()
  const toast = useToast()
  const dialogs = useDialogs()
  const menu = useContextMenu()
  const navigate = useNavigate()

  const [detail, setDetail] = useState<Upload | null>(null)
  const [generate, setGenerate] = useState<{ kind: 'practice' | 'flashcards'; uploadId: string; subjectId: string } | null>(null)
  const [filterType, setFilterType] = useState('')

  const key = ['uploads', subjectId || 'all', topicId || 'all', filterType]
  const { data: uploads, refetch } = useQuery<Upload[]>({
    queryKey: key,
    queryFn: () =>
      api.get(`/uploads?${new URLSearchParams({
        ...(subjectId ? { subject_id: subjectId } : {}),
        ...(topicId ? { topic_id: topicId } : {}),
        ...(filterType ? { work_type: filterType } : {}),
        limit: String(limit || 200),
      })}`),
  })

  const { data: subjects } = useQuery({ queryKey: ['subjects'], queryFn: () => api.get('/subjects') })
  const { data: topics } = useQuery({
    queryKey: ['topics', detail?.subject_id],
    queryFn: () => api.get(`/topics?subject_id=${detail?.subject_id}`),
    enabled: !!detail?.subject_id,
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['uploads'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
    qc.invalidateQueries({ queryKey: ['subjects'] })
  }

  const save = useMutation({
    mutationFn: (u: Partial<Upload>) => api.put(`/uploads/${u.id}`, u),
    onSuccess: () => { invalidate(); toast('Saved', 'success'); setDetail(null) },
    onError: (e: any) => toast(e.message, 'error'),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/uploads/${id}`),
    onSuccess: () => { invalidate(); toast('Deleted', 'success') },
    onError: (e: any) => toast(e.message, 'error'),
  })

  const organise = useMutation({
    mutationFn: (id: string) => api.post(`/uploads/${id}/organise`),
    onError: (e: any) => toast(e.message, 'error', 'Auto-organise failed'),
  })

  const openDetail = async (u: Upload) => {
    const full = await api.get(`/uploads/${u.id}`)
    setDetail(full)
  }

  const autoOrganise = async (u: Upload) => {
    const s = await organise.mutateAsync(u.id)
    const full = await api.get(`/uploads/${u.id}`)
    const ok = await dialogs.confirm(
      'Apply this suggestion?',
      `Title: ${s.title}\nSubject: ${subjects?.find((x: any) => x.id === s.subject_id)?.name || 'unchanged'}\n` +
      `Type: ${s.work_type}\nSubtopic: ${s.subtopic || '—'}\n\nSummary: ${s.summary}\n\n` +
      `Nothing is applied until you confirm, and you can edit all of it afterwards.`
    )
    if (!ok) return
    save.mutate({
      id: u.id, title: s.title || full.title, subject_id: s.subject_id || full.subject_id,
      topic_id: s.topic_id || full.topic_id, work_type: s.work_type || full.work_type, subtopic: s.subtopic || full.subtopic,
    })
  }

  const uploadMenu = (u: Upload): MenuItem[] => [
    { type: 'label', label: u.title || u.original_filename },
    { label: 'Open', onClick: () => openDetail(u) },
    ...(u.stored_name ? [{ label: 'View original file', onClick: () => window.open(`/api/uploads/${u.id}/file`, '_blank') } as MenuItem] : []),
    { label: 'Edit details', onClick: () => openDetail(u) },
    { type: 'sep' },
    { label: 'Generate questions', disabled: !u.subject_id, onClick: () => setGenerate({ kind: 'practice', uploadId: u.id, subjectId: u.subject_id! }) },
    { label: 'Generate flashcards', disabled: !u.subject_id, onClick: () => setGenerate({ kind: 'flashcards', uploadId: u.id, subjectId: u.subject_id! }) },
    { label: 'Auto-organise with AI', onClick: () => autoOrganise(u) },
    ...(u.stored_name ? [{ label: 'Re-read text (OCR)', onClick: async () => { await api.post(`/uploads/${u.id}/reextract`); toast('Re-reading in the background…', 'info'); refetch() } } as MenuItem] : []),
    { type: 'sep' },
    { label: 'Delete', danger: true, onClick: async () => {
      if (await dialogs.confirm('Delete this item?', `"${u.title || u.original_filename}" and its original file will be removed permanently.`, true)) remove.mutate(u.id)
    } },
  ]

  const list = uploads || []

  return (
    <div className="stack">
      <div className="row wrap">
        <button className={`chip ${!filterType ? 'on' : ''}`} onClick={() => setFilterType('')}>All types</button>
        {WORK_TYPES.map((t) => (
          <button key={t} className={`chip ${filterType === t ? 'on' : ''}`} onClick={() => setFilterType(t)}>{t}</button>
        ))}
      </div>

      {!list.length ? (
        <Empty icon="📥" title="Nothing here yet"
          message="Add photos of handwritten work, PDFs, Word docs, PowerPoints or pasted text — Study HQ extracts the text and turns it into study material."
          action={<button className="btn primary" onClick={() => navigate(`/upload${subjectId ? `?subject=${subjectId}` : ''}`)}>+ Add school work</button>} />
      ) : (
        <div className="stack" style={{ gap: 7 }}>
          {list.map((u) => (
            <div key={u.id} className="row-item link" onClick={() => openDetail(u)} onContextMenu={(e) => menu(e, uploadMenu(u))}>
              <Icon name={glyph(u)} size={15} className="ink-3" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="truncate" style={{ fontWeight: 550 }}>{u.title || u.original_filename}</div>
                <div className="micro ink-3 truncate">
                  {u.subject_name || 'Unassigned'}
                  {u.topic_name ? ` · ${u.topic_name}` : ''}
                  {u.subtopic ? ` · ${u.subtopic}` : ''}
                  {u.teacher ? ` · ${u.teacher}` : ''}
                  {` · Y${u.year_level} T${u.term} · ${fmtDate(u.work_date)}`}
                  {u.size ? ` · ${fmtBytes(u.size)}` : ''}
                </div>
              </div>
              <span className="tag pill">{u.work_type}</span>
              {u.extract_status === 'pending' && <ExtractProgress id={u.id} onDone={refetch} />}
              {u.extract_status === 'ok' && <span className="tag green pill" title="Text extracted and searchable">text ✓</span>}
              {(u.extract_status === 'failed' || u.extract_status === 'unsupported') && (
                <span className="tag red pill" title={u.extract_error}>no text</span>
              )}
            </div>
          ))}
        </div>
      )}

      {detail && (
        <Modal
          title={detail.title || detail.original_filename}
          subtitle="Every field is editable — Study HQ never locks your work into its own structure."
          size="wide"
          onClose={() => setDetail(null)}
          footer={
            <>
              <button className="btn danger" onClick={async () => {
                if (await dialogs.confirm('Delete this item?', 'This removes the record and the original file.', true)) { remove.mutate(detail.id); setDetail(null) }
              }}>Delete</button>
              <div className="spacer" />
              <button className="btn" onClick={() => setDetail(null)}>Close</button>
              <button className="btn primary" onClick={() => save.mutate(detail)} disabled={save.isPending}>Save changes</button>
            </>
          }
        >
          <div className="grid-2" style={{ gap: 12 }}>
            <Field label="Title"><input value={detail.title} onChange={(e) => setDetail({ ...detail, title: e.target.value })} /></Field>
            <Field label="Type">
              <select value={detail.work_type} onChange={(e) => setDetail({ ...detail, work_type: e.target.value })}>
                {WORK_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Subject">
              <select value={detail.subject_id || ''} onChange={(e) => setDetail({ ...detail, subject_id: e.target.value || null, topic_id: null })}>
                <option value="">Unassigned</option>
                {(subjects || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Topic">
              <select value={detail.topic_id || ''} onChange={(e) => setDetail({ ...detail, topic_id: e.target.value || null })} disabled={!detail.subject_id}>
                <option value="">No topic</option>
                {(topics || []).map((t: any) => <option key={t.id} value={t.id}>{t.scope === 'school' ? '🏫 ' : ''}{t.name}</option>)}
              </select>
            </Field>
            <Field label="Subtopic"><input value={detail.subtopic} onChange={(e) => setDetail({ ...detail, subtopic: e.target.value })} /></Field>
            <Field label="Teacher"><input value={detail.teacher} onChange={(e) => setDetail({ ...detail, teacher: e.target.value })} /></Field>
            <Field label="School"><input value={detail.school} onChange={(e) => setDetail({ ...detail, school: e.target.value })} /></Field>
            <Field label="Date"><input type="date" value={(detail.work_date || '').slice(0, 10)} onChange={(e) => setDetail({ ...detail, work_date: e.target.value })} /></Field>
            <Field label="Year"><input type="number" value={detail.year_level} onChange={(e) => setDetail({ ...detail, year_level: Number(e.target.value) })} /></Field>
            <Field label="Term"><input type="number" min={1} max={4} value={detail.term} onChange={(e) => setDetail({ ...detail, term: Number(e.target.value) })} /></Field>
          </div>

          {detail.stored_name && (
            <div className="stack" style={{ gap: 8 }}>
              <div className="row">
                <strong className="body">Original file</strong>
                <div className="spacer" />
                <a className="btn sm" href={`/api/uploads/${detail.id}/file`} target="_blank" rel="noreferrer">Open original</a>
              </div>
              {detail.mime?.startsWith('image/') && (
                <img src={`/api/uploads/${detail.id}/file`} alt={detail.title}
                  style={{ maxWidth: '100%', maxHeight: 340, borderRadius: 10, border: '1px solid var(--line)', objectFit: 'contain' }} />
              )}
              <div className="micro">{detail.original_filename} · {fmtBytes(detail.size)} · original is always kept</div>
            </div>
          )}

          <Field label="Extracted text" hint={
            detail.extract_status === 'failed' || detail.extract_status === 'unsupported'
              ? `Extraction problem: ${detail.extract_error}  — you can type or paste the text yourself here.`
              : 'Edit anything the OCR got wrong. This text is what practice and flashcards are generated from.'
          }>
            <textarea rows={12} value={detail.extracted_text || ''} onChange={(e) => setDetail({ ...detail, extracted_text: e.target.value })} />
          </Field>

          <div className="row wrap">
            <button className="btn sm" disabled={!detail.subject_id} onClick={() => setGenerate({ kind: 'practice', uploadId: detail.id, subjectId: detail.subject_id! })}><Icon name="pencil" size={13} /> Generate questions</button>
            <button className="btn sm" disabled={!detail.subject_id} onClick={() => setGenerate({ kind: 'flashcards', uploadId: detail.id, subjectId: detail.subject_id! })}><Icon name="cards" size={13} /> Generate flashcards</button>
            <button className="btn sm" onClick={() => autoOrganise(detail)} disabled={organise.isPending}>
              {organise.isPending ? <><span className="spinner" /> Analysing…</> : <><Icon name="sparkle" size={13} /> Auto-organise</>}
            </button>
            {detail.stored_name && (
              <button className="btn sm" onClick={async () => { await api.post(`/uploads/${detail.id}/reextract`); toast('Re-reading in the background…', 'info') }}><Icon name="refresh" size={13} /> Re-read text</button>
            )}
          </div>
        </Modal>
      )}

      {generate && (
        <GenerateModal kind={generate.kind} subjectId={generate.subjectId} sourceUploadIds={[generate.uploadId]} onClose={() => setGenerate(null)} />
      )}
    </div>
  )
}
