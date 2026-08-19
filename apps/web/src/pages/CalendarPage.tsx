import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, fmtDate } from '../lib/api'
import { Icon } from '../components/Icons'
import { Modal, Field, Loading, useToast, useDialogs, Empty, Segmented } from '../components/ui'

const KIND_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  assessment: { bg: 'var(--red-wash)', fg: 'var(--red)', label: 'Assessment' },
  topic_assessment: { bg: 'var(--red-wash)', fg: 'var(--red)', label: 'Assessment' },
  task: { bg: 'var(--amber-wash)', fg: 'var(--amber)', label: 'Task' },
  revision: { bg: 'var(--blue-wash)', fg: 'var(--blue)', label: 'Revision' },
  deadline: { bg: 'var(--red-wash)', fg: 'var(--red)', label: 'Deadline' },
  class: { bg: 'var(--bg-hover)', fg: 'var(--ink-2)', label: 'Class' },
  event: { bg: 'var(--blue-wash)', fg: 'var(--blue)', label: 'Event' },
  session: { bg: 'var(--green-wash)', fg: 'var(--green)', label: 'Studied' },
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function CalendarPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const dialogs = useDialogs()
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d })
  const [view, setView] = useState<'month' | 'list'>('month')
  const [editing, setEditing] = useState<any>(null)
  const [dayOpen, setDayOpen] = useState<string | null>(null)

  const from = iso(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))
  const to = iso(new Date(cursor.getFullYear(), cursor.getMonth() + 2, 0))

  const { data: events, isLoading, refetch } = useQuery({
    queryKey: ['calendar', from, to],
    queryFn: () => api.get(`/calendar?from=${from}&to=${to}`),
  })
  const { data: subjects } = useQuery({ queryKey: ['subjects'], queryFn: () => api.get('/subjects') })

  const save = useMutation({
    mutationFn: (e: any) => (e.id ? api.put(`/calendar/${e.id}`, e) : api.post('/calendar', e)),
    onSuccess: () => { refetch(); qc.invalidateQueries({ queryKey: ['calendar'] }); setEditing(null); toast('Saved', 'success') },
    onError: (e: any) => toast(e.message, 'error'),
  })
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/calendar/${id}`), onSuccess: () => { refetch(); toast('Deleted', 'success') } })

  const byDay = useMemo(() => {
    const map: Record<string, any[]> = {}
    for (const e of events || []) (map[e.date] ||= []).push(e)
    return map
  }, [events])

  const grid = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const start = new Date(first)
    start.setDate(first.getDate() - ((first.getDay() + 6) % 7)) // weeks start Monday
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      return d
    })
  }, [cursor])

  const today = iso(new Date())
  const monthLabel = cursor.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })

  const upcoming = (events || [])
    .filter((e: any) => e.date >= today && e.kind !== 'session')
    .sort((a: any, b: any) => a.date.localeCompare(b.date))

  if (isLoading) return <Loading />

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Calendar</h1>
          <div className="meta">Assessments, tasks, deadlines, revision sessions and study time in one place.</div>
        </div>
        <div className="row">
          <Segmented value={view} onChange={setView} options={[{ value: 'month', label: 'Month' }, { value: 'list', label: 'Upcoming' }]} />
          <button className="btn primary" onClick={() => setEditing({ title: '', kind: 'revision', event_date: today, subject_id: '', notes: '' })}>
            <Icon name="plus" size={14} /> Add event
          </button>
        </div>
      </div>

      {view === 'month' ? (
        <>
          <div className="row">
            <button className="btn sm icon" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}><Icon name="chevronLeft" size={14} /></button>
            <h2 style={{ minWidth: 168, textAlign: 'center' }}>{monthLabel}</h2>
            <button className="btn sm icon" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}><Icon name="chevronRight" size={14} /></button>
            <button className="btn quiet sm" onClick={() => { const d = new Date(); d.setDate(1); setCursor(d) }}>Today</button>
            <div className="spacer" />
            <div className="row wrap micro ink-3" style={{ gap: 10 }}>
              {['assessment', 'task', 'revision', 'session'].map((k) => (
                <span key={k} className="row" style={{ gap: 4 }}>
                  <span className="dot" style={{ background: KIND_STYLE[k].fg }} /> {KIND_STYLE[k].label}
                </span>
              ))}
            </div>
          </div>

          <div className="cal">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div className="cal-head" key={d}>{d}</div>)}
            {grid.map((d) => {
              const key = iso(d)
              const evs = byDay[key] || []
              const other = d.getMonth() !== cursor.getMonth()
              return (
                <div key={key} className={`cal-cell ${other ? 'other' : ''} ${key === today ? 'today' : ''}`} onClick={() => setDayOpen(key)}>
                  <div className="cal-date">{d.getDate()}</div>
                  {evs.slice(0, 3).map((e: any, i: number) => {
                    const st = KIND_STYLE[e.kind] || KIND_STYLE.event
                    return <div className="cal-ev" key={i} style={{ background: st.bg, color: st.fg }} title={e.title}>{e.title}</div>
                  })}
                  {evs.length > 3 && <div className="micro">+{evs.length - 3} more</div>}
                </div>
              )
            })}
          </div>
        </>
      ) : !upcoming.length ? (
        <Empty title="Nothing coming up" message="Add assessments, tasks or revision sessions and they will appear here."
          action={<button className="btn sm primary" onClick={() => setEditing({ title: '', kind: 'revision', event_date: today })}>Add event</button>} />
      ) : (
        <div className="rows">
          {upcoming.map((e: any, i: number) => {
            const st = KIND_STYLE[e.kind] || KIND_STYLE.event
            return (
              <div className="row-item link" key={i}
                onClick={() => e.kind === 'event' || e.kind === 'revision' ? setEditing({ ...e, event_date: e.date }) : navigate(e.kind === 'task' ? '/tasks' : '/assessments')}>
                <span className="tag pill" style={{ background: st.bg, color: st.fg, minWidth: 84, justifyContent: 'center' }}>{st.label}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="body strong truncate">{e.title}</div>
                  <div className="micro">{e.subject_name || 'General'}{e.start_time ? ` · ${e.start_time}` : ''}</div>
                </div>
                <span className="micro">{fmtDate(e.date)}</span>
              </div>
            )
          })}
        </div>
      )}

      {dayOpen && (
        <Modal
          title={new Date(dayOpen + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}
          onClose={() => setDayOpen(null)}
          footer={
            <>
              <div className="spacer" />
              <button className="btn" onClick={() => setDayOpen(null)}>Close</button>
              <button className="btn primary" onClick={() => { setEditing({ title: '', kind: 'revision', event_date: dayOpen }); setDayOpen(null) }}>Add event</button>
            </>
          }
        >
          {(byDay[dayOpen] || []).length ? (
            <div className="rows">
              {(byDay[dayOpen] || []).map((e: any, i: number) => {
                const st = KIND_STYLE[e.kind] || KIND_STYLE.event
                return (
                  <div className="row-item" key={i}>
                    <span className="tag pill" style={{ background: st.bg, color: st.fg }}>{st.label}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="strong">{e.title}</div>
                      {e.subject_name && <div className="micro">{e.subject_name}</div>}
                    </div>
                    {(e.kind === 'event' || e.kind === 'revision') && (
                      <button className="btn quiet sm" onClick={() => { setEditing({ ...e, event_date: e.date }); setDayOpen(null) }}>Edit</button>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <Empty title="Nothing on this day" message="Add a revision session or an event." />
          )}
        </Modal>
      )}

      {editing && (
        <Modal
          title={editing.id ? 'Edit event' : 'New event'}
          onClose={() => setEditing(null)}
          footer={
            <>
              {editing.id && <button className="btn danger" onClick={async () => {
                if (await dialogs.confirm('Delete event?', editing.title, true)) { remove.mutate(editing.id); setEditing(null) }
              }}>Delete</button>}
              <div className="spacer" />
              <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn primary" disabled={!editing.title?.trim() || !editing.event_date} onClick={() => save.mutate(editing)}>Save</button>
            </>
          }
        >
          <Field label="Title"><input autoFocus value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="e.g. Revise Operations" /></Field>
          <div className="row" style={{ gap: 10 }}>
            <Field label="Date"><input type="date" value={editing.event_date} onChange={(e) => setEditing({ ...editing, event_date: e.target.value })} /></Field>
            <Field label="Type">
              <select value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value })}>
                <option value="revision">Revision</option><option value="event">Event</option>
                <option value="deadline">Deadline</option><option value="class">Class</option>
              </select>
            </Field>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <Field label="Start"><input type="time" value={editing.start_time || ''} onChange={(e) => setEditing({ ...editing, start_time: e.target.value })} /></Field>
            <Field label="End"><input type="time" value={editing.end_time || ''} onChange={(e) => setEditing({ ...editing, end_time: e.target.value })} /></Field>
          </div>
          <Field label="Subject">
            <select value={editing.subject_id || ''} onChange={(e) => setEditing({ ...editing, subject_id: e.target.value })}>
              <option value="">General</option>
              {(subjects || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Notes"><textarea rows={3} value={editing.notes || ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></Field>
        </Modal>
      )}
    </div>
  )
}
