import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, fmtDate, daysUntil } from '../lib/api'
import { Modal, Field, Empty, Loading, useToast, useDialogs, useContextMenu, type MenuItem } from '../components/ui'

export default function AssessmentsPage({ subjectId, embedded }: { subjectId?: string; embedded?: boolean }) {
  const qc = useQueryClient()
  const toast = useToast()
  const dialogs = useDialogs()
  const menu = useContextMenu()
  const [editing, setEditing] = useState<any>(null)

  const { data: items, isLoading, refetch } = useQuery({
    queryKey: ['assessments', subjectId || 'all'],
    queryFn: () => api.get(`/assessments${subjectId ? `?subject_id=${subjectId}` : ''}`),
  })
  const { data: subjects } = useQuery({ queryKey: ['subjects'], queryFn: () => api.get('/subjects') })

  const invalidate = () => { refetch(); qc.invalidateQueries({ queryKey: ['dashboard'] }) }
  const save = useMutation({
    mutationFn: (a: any) => (a.id ? api.put(`/assessments/${a.id}`, a) : api.post('/assessments', a)),
    onSuccess: () => { invalidate(); setEditing(null); toast('Assessment saved', 'success') },
    onError: (e: any) => toast(e.message, 'error'),
  })
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/assessments/${id}`), onSuccess: () => { invalidate(); toast('Deleted', 'success') } })

  const blank = () => ({ subject_id: subjectId || '', name: '', topic: '', due_date: '', weighting: 0, notes: '', status: 'upcoming' })

  const itemMenu = (a: any): MenuItem[] => [
    { type: 'label', label: a.name },
    { label: 'Edit', onClick: () => setEditing(a) },
    { label: a.status === 'done' ? 'Mark as upcoming' : 'Mark as done', onClick: () => save.mutate({ ...a, status: a.status === 'done' ? 'upcoming' : 'done' }) },
    { type: 'sep' },
    { label: 'Delete', danger: true, onClick: async () => {
      if (await dialogs.confirm('Delete assessment?', a.name, true)) remove.mutate(a.id)
    } },
  ]

  if (isLoading) return <Loading />

  const list = items || []
  const upcoming = list.filter((a: any) => a.status !== 'done')
  const done = list.filter((a: any) => a.status === 'done')

  const Row = ({ a }: { a: any }) => {
    const d = daysUntil(a.due_date)
    return (
      <div className="row-item link" onClick={() => setEditing(a)} onContextMenu={(e) => menu(e, itemMenu(a))}>
        <span className="dot" style={{ background: a.subject_color || 'var(--ink-4)' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="truncate" style={{ fontWeight: 550, textDecoration: a.status === 'done' ? 'line-through' : 'none' }}>{a.name}</div>
          <div className="micro ink-3 truncate">
            {a.subject_name || 'No subject'}{a.topic ? ` · ${a.topic}` : ''}{a.weighting ? ` · ${a.weighting}% weighting` : ''}
            {a.due_date ? ` · ${fmtDate(a.due_date)}` : ''}
          </div>
        </div>
        {a.status === 'done' ? <span className="tag green pill">done</span> : (
          <span className={`tag pill ${d !== null && d <= 7 ? 'red' : d !== null && d <= 21 ? 'amber' : ''}`}>
            {d === null ? 'no date' : d < 0 ? `${Math.abs(d)}d overdue` : d === 0 ? 'today' : `${d} day${d === 1 ? '' : 's'}`}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className={embedded ? '' : 'page'}>
      <div className={embedded ? 'section-head' : 'page-head'}>
        <div>
          <h1 style={embedded ? { fontSize: 19 } : undefined}>Assessments</h1>
          <div className="meta">Study sessions prioritise whatever is closest and heaviest.</div>
        </div>
        <div className="section-actions">
        <button className="btn primary" onClick={() => setEditing(blank())}>+ Add assessment</button>
      </div>
      </div>

      {!list.length ? (
        <Empty title="No assessments yet" message="Add your assessment schedule — name, subject, date and weighting."
          action={<button className="btn primary" onClick={() => setEditing(blank())}>+ Add assessment</button>} />
      ) : (
        <>
          {!!upcoming.length && (
            <div className="stack" style={{ gap: 7 }}>
              <h3 className="ink-3 micro" style={{ textTransform: 'uppercase', letterSpacing: '0.07em' }}>Upcoming</h3>
              {upcoming.map((a: any) => <Row key={a.id} a={a} />)}
            </div>
          )}
          {!!done.length && (
            <div className="stack" style={{ gap: 7 }}>
              <h3 className="ink-3 micro" style={{ textTransform: 'uppercase', letterSpacing: '0.07em' }}>Completed</h3>
              {done.map((a: any) => <Row key={a.id} a={a} />)}
            </div>
          )}
        </>
      )}

      {editing && (
        <Modal
          title={editing.id ? 'Edit assessment' : 'Add assessment'}
          onClose={() => setEditing(null)}
          footer={
            <>
              {editing.id && <button className="btn danger" onClick={async () => {
                if (await dialogs.confirm('Delete assessment?', editing.name, true)) { remove.mutate(editing.id); setEditing(null) }
              }}>Delete</button>}
              <div className="spacer" />
              <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn primary" disabled={!editing.name?.trim()} onClick={() => save.mutate(editing)}>Save</button>
            </>
          }
        >
          <Field label="Assessment name"><input autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Business Studies Task 3" /></Field>
          <Field label="Subject">
            <select value={editing.subject_id || ''} onChange={(e) => setEditing({ ...editing, subject_id: e.target.value })}>
              <option value="">No subject</option>
              {(subjects || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Topic"><input value={editing.topic} onChange={(e) => setEditing({ ...editing, topic: e.target.value })} placeholder="What it covers" /></Field>
          <div className="row" style={{ gap: 12 }}>
            <Field label="Date"><input type="date" value={editing.due_date || ''} onChange={(e) => setEditing({ ...editing, due_date: e.target.value })} /></Field>
            <Field label="Weighting %"><input type="number" min={0} max={100} value={editing.weighting} onChange={(e) => setEditing({ ...editing, weighting: Number(e.target.value) })} /></Field>
          </div>
          <Field label="Notes"><textarea rows={4} value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} placeholder="Task notification details, marking criteria, what to prepare…" /></Field>
        </Modal>
      )}
    </div>
  )
}
