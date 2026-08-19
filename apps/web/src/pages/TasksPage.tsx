import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, fmtDate, daysUntil } from '../lib/api'
import { Icon } from '../components/Icons'
import { Modal, Field, Empty, Loading, useToast, useDialogs, useContextMenu, type MenuItem, Segmented } from '../components/ui'

const PRIORITIES = [
  { value: 'high', label: 'High' }, { value: 'normal', label: 'Normal' }, { value: 'low', label: 'Low' },
]

export default function TasksPage({ subjectId, embedded }: { subjectId?: string; embedded?: boolean }) {
  const qc = useQueryClient()
  const toast = useToast()
  const dialogs = useDialogs()
  const menu = useContextMenu()
  const [editing, setEditing] = useState<any>(null)
  const [filter, setFilter] = useState<'open' | 'all' | 'done'>('open')

  const { data: tasks, isLoading, refetch } = useQuery({
    queryKey: ['tasks', subjectId || 'all', 'page'],
    queryFn: () => api.get(`/tasks${subjectId ? `?subject_id=${subjectId}` : ''}`),
  })
  const { data: subjects } = useQuery({ queryKey: ['subjects'], queryFn: () => api.get('/subjects') })

  const invalidate = () => { refetch(); qc.invalidateQueries({ queryKey: ['tasks'] }); qc.invalidateQueries({ queryKey: ['calendar'] }) }
  const save = useMutation({
    mutationFn: (t: any) => (t.id ? api.put(`/tasks/${t.id}`, t) : api.post('/tasks', t)),
    onSuccess: () => { invalidate(); setEditing(null) },
    onError: (e: any) => toast(e.message, 'error'),
  })
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/tasks/${id}`), onSuccess: () => { invalidate(); toast('Task deleted', 'success') } })

  const blank = () => ({ subject_id: subjectId || '', title: '', notes: '', due_date: '', priority: 'normal', status: 'todo' })

  const taskMenu = (t: any): MenuItem[] => [
    { type: 'label', label: t.title },
    { label: 'Edit', onClick: () => setEditing(t) },
    { label: t.status === 'done' ? 'Mark as to-do' : 'Mark as done', onClick: () => save.mutate({ ...t, status: t.status === 'done' ? 'todo' : 'done' }) },
    { label: t.status === 'doing' ? 'Stop working on it' : 'Mark as in progress', onClick: () => save.mutate({ ...t, status: t.status === 'doing' ? 'todo' : 'doing' }) },
    { type: 'sep' },
    { label: 'Delete', danger: true, onClick: async () => { if (await dialogs.confirm('Delete task?', t.title, true)) remove.mutate(t.id) } },
  ]

  if (isLoading) return <Loading />

  const all = tasks || []
  const list = filter === 'all' ? all : filter === 'done' ? all.filter((t: any) => t.status === 'done') : all.filter((t: any) => t.status !== 'done')
  const overdue = list.filter((t: any) => t.status !== 'done' && daysUntil(t.due_date) !== null && daysUntil(t.due_date)! < 0)

  return (
    <div className={embedded ? '' : 'page'}>
      <div className={embedded ? 'section-head' : 'page-head'}>
        <div>
          <h1 style={embedded ? { fontSize: 16 } : undefined}>Tasks</h1>
          <div className="meta">Homework and to-dos. Anything with a date also shows on your calendar and dashboard.</div>
        </div>
        <div className="section-actions">
          <Segmented value={filter} onChange={setFilter}
            options={[{ value: 'open', label: 'Open' }, { value: 'done', label: 'Done' }, { value: 'all', label: 'All' }]} />
          <button className="btn primary" onClick={() => setEditing(blank())}><Icon name="plus" size={14} /> Add task</button>
        </div>
      </div>

      {!!overdue.length && (
        <div className="notice warn">
          <Icon name="alert" size={15} />
          <div>{overdue.length} task{overdue.length === 1 ? ' is' : 's are'} overdue.</div>
        </div>
      )}

      {!list.length ? (
        <Empty title={filter === 'done' ? 'Nothing completed yet' : 'No tasks'}
          message="Add homework, worksheets and anything else you need to get done."
          action={<button className="btn sm primary" onClick={() => setEditing(blank())}>Add task</button>} />
      ) : (
        <div className="rows">
          {list.map((t: any) => {
            const d = daysUntil(t.due_date)
            const done = t.status === 'done'
            return (
              <div className="row-item" key={t.id} onContextMenu={(e) => menu(e, taskMenu(t))}>
                <div className={`tick ${done ? 'completed' : ''}`} onClick={() => save.mutate({ ...t, status: done ? 'todo' : 'done' })}>
                  {done ? '✓' : ''}
                </div>
                <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => setEditing(t)}>
                  <div className={`body ${done ? 'ink-3' : 'strong'}`} style={{ textDecoration: done ? 'line-through' : 'none' }}>{t.title}</div>
                  <div className="micro ink-4 truncate">
                    {t.subject_name || 'No subject'}{t.notes ? ` · ${t.notes.slice(0, 60)}` : ''}
                  </div>
                </div>
                {t.status === 'doing' && <span className="tag blue pill">In progress</span>}
                {t.priority === 'high' && !done && <span className="tag red pill">High</span>}
                {t.due_date && (
                  <span className={`tag pill ${!done && d !== null && d < 0 ? 'red' : !done && d !== null && d <= 2 ? 'amber' : ''}`}>
                    {d === 0 ? 'Today' : d !== null && d < 0 ? `${Math.abs(d)}d late` : fmtDate(t.due_date)}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {editing && (
        <Modal
          title={editing.id ? 'Edit task' : 'New task'}
          onClose={() => setEditing(null)}
          footer={
            <>
              {editing.id && <button className="btn danger" onClick={async () => {
                if (await dialogs.confirm('Delete task?', editing.title, true)) { remove.mutate(editing.id); setEditing(null) }
              }}>Delete</button>}
              <div className="spacer" />
              <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn primary" disabled={!editing.title?.trim()} onClick={() => save.mutate(editing)}>Save</button>
            </>
          }
        >
          <Field label="Task"><input autoFocus value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })}
            placeholder="e.g. Finish Business Studies case study" /></Field>
          <Field label="Subject">
            <select value={editing.subject_id || ''} onChange={(e) => setEditing({ ...editing, subject_id: e.target.value })}>
              <option value="">No subject</option>
              {(subjects || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <div className="row" style={{ gap: 10 }}>
            <Field label="Due date"><input type="date" value={editing.due_date || ''} onChange={(e) => setEditing({ ...editing, due_date: e.target.value })} /></Field>
            <Field label="Priority">
              <select value={editing.priority} onChange={(e) => setEditing({ ...editing, priority: e.target.value })}>
                {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>
                <option value="todo">To do</option><option value="doing">In progress</option><option value="done">Done</option>
              </select>
            </Field>
          </div>
          <Field label="Notes"><textarea rows={3} value={editing.notes || ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></Field>
        </Modal>
      )}
    </div>
  )
}
