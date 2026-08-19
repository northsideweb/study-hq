import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { Icon } from './Icons'
import { Modal, Field, useToast } from './ui'

type Sheet = null | 'note' | 'paste' | 'task' | 'flashcard' | 'assessment'

/** Floating capture button — the fastest way to get something into Study HQ. */
export default function QuickCapture() {
  const [open, setOpen] = useState(false)
  const [sheet, setSheet] = useState<Sheet>(null)
  const navigate = useNavigate()
  const toast = useToast()
  const qc = useQueryClient()

  const { data: subjects } = useQuery({ queryKey: ['subjects'], queryFn: () => api.get('/subjects') })
  const [form, setForm] = useState<any>({})

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [open])

  const save = useMutation({
    mutationFn: async () => {
      if (sheet === 'note') return api.post('/notes', { subject_id: form.subject_id, title: form.title || 'Quick note', body: form.body || '' })
      if (sheet === 'paste') return api.post('/uploads/paste', { subject_id: form.subject_id || null, text: form.body, title: form.title || (form.body || '').slice(0, 60), work_type: 'Class Notes', source: 'paste' })
      if (sheet === 'task') return api.post('/tasks', { subject_id: form.subject_id || null, title: form.title, due_date: form.due_date || null, priority: form.priority || 'normal' })
      if (sheet === 'flashcard') return api.post('/flashcards', { subject_id: form.subject_id, front: form.front, back: form.back })
      if (sheet === 'assessment') return api.post('/assessments', { subject_id: form.subject_id || null, name: form.title, due_date: form.due_date || null, weighting: Number(form.weighting || 0) })
    },
    onSuccess: () => {
      qc.invalidateQueries()
      toast('Saved', 'success')
      setSheet(null)
      setForm({})
    },
    onError: (e: any) => toast(e.message, 'error'),
  })

  const items: Array<{ id: string; icon: string; label: string; run: () => void }> = [
    { id: 'note', icon: 'note', label: 'Add note', run: () => setSheet('note') },
    { id: 'photo', icon: 'camera', label: 'Take photo', run: () => navigate('/uploads?method=photo') },
    { id: 'paste', icon: 'clipboard', label: 'Paste text', run: () => setSheet('paste') },
    { id: 'file', icon: 'upload', label: 'Upload file', run: () => navigate('/uploads?method=files') },
    { id: 'flashcard', icon: 'cards', label: 'Create flashcard', run: () => setSheet('flashcard') },
    { id: 'task', icon: 'tasks', label: 'Add task', run: () => setSheet('task') },
    { id: 'assessment', icon: 'calendar', label: 'Add assessment', run: () => setSheet('assessment') },
  ]

  const subjectField = (required = false) => (
    <Field label={`Subject${required ? '' : ' (optional)'}`}>
      <select value={form.subject_id || ''} onChange={(e) => setForm({ ...form, subject_id: e.target.value })}>
        <option value="">{required ? 'Choose…' : 'Unassigned'}</option>
        {(subjects || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </Field>
  )

  const valid =
    sheet === 'note' ? !!form.subject_id :
    sheet === 'paste' ? !!(form.body || '').trim() :
    sheet === 'task' ? !!(form.title || '').trim() :
    sheet === 'flashcard' ? !!(form.subject_id && (form.front || '').trim() && (form.back || '').trim()) :
    sheet === 'assessment' ? !!(form.title || '').trim() : false

  return (
    <>
      <button className="fab" onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }} title="Quick capture" aria-label="Quick capture">
        <Icon name={open ? 'x' : 'plus'} size={20} />
      </button>

      {open && (
        <div className="fab-menu" onClick={(e) => e.stopPropagation()}>
          {items.map((it) => (
            <button key={it.id} className="ctx-item" onClick={() => { setOpen(false); it.run() }}>
              <Icon name={it.icon} size={15} /> {it.label}
            </button>
          ))}
        </div>
      )}

      {sheet && (
        <Modal
          title={
            sheet === 'note' ? 'Quick note' : sheet === 'paste' ? 'Paste text' : sheet === 'task' ? 'New task'
            : sheet === 'flashcard' ? 'New flashcard' : 'New assessment'
          }
          onClose={() => { setSheet(null); setForm({}) }}
          footer={
            <>
              <button className="btn" onClick={() => { setSheet(null); setForm({}) }}>Cancel</button>
              <button className="btn primary" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? 'Saving…' : 'Save'}
              </button>
            </>
          }
        >
          {(sheet === 'note' || sheet === 'flashcard') && subjectField(true)}
          {(sheet === 'paste' || sheet === 'task' || sheet === 'assessment') && subjectField(false)}

          {sheet === 'note' && (
            <>
              <Field label="Title"><input autoFocus value={form.title || ''} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Quick note" /></Field>
              <Field label="Note"><textarea rows={7} value={form.body || ''} onChange={(e) => setForm({ ...form, body: e.target.value })} /></Field>
            </>
          )}
          {sheet === 'paste' && (
            <Field label="Text" hint="Saved to your knowledge base and made searchable straight away.">
              <textarea rows={9} autoFocus value={form.body || ''} onChange={(e) => setForm({ ...form, body: e.target.value })} />
            </Field>
          )}
          {sheet === 'task' && (
            <>
              <Field label="Task"><input autoFocus value={form.title || ''} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Finish Business case study" /></Field>
              <div className="row" style={{ gap: 10 }}>
                <Field label="Due"><input type="date" value={form.due_date || ''} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></Field>
                <Field label="Priority">
                  <select value={form.priority || 'normal'} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                    <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option>
                  </select>
                </Field>
              </div>
            </>
          )}
          {sheet === 'flashcard' && (
            <>
              <Field label="Front"><textarea rows={3} autoFocus value={form.front || ''} onChange={(e) => setForm({ ...form, front: e.target.value })} /></Field>
              <Field label="Back"><textarea rows={4} value={form.back || ''} onChange={(e) => setForm({ ...form, back: e.target.value })} /></Field>
            </>
          )}
          {sheet === 'assessment' && (
            <>
              <Field label="Assessment"><input autoFocus value={form.title || ''} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
              <div className="row" style={{ gap: 10 }}>
                <Field label="Date"><input type="date" value={form.due_date || ''} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></Field>
                <Field label="Weighting %"><input type="number" value={form.weighting || ''} onChange={(e) => setForm({ ...form, weighting: e.target.value })} /></Field>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  )
}
