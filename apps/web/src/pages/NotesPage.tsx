import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, fmtDate } from '../lib/api'
import { Icon } from '../components/Icons'
import { Empty, Loading, SectionHead, useToast, useDialogs, useContextMenu, type MenuItem, Segmented } from '../components/ui'

/** Notes are organised Subject → Topic → Subtopic. */
export default function NotesPage({ subjectId, embedded }: { subjectId?: string; embedded?: boolean }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const dialogs = useDialogs()
  const menu = useContextMenu()
  const [params] = useSearchParams()
  const [view, setView] = useState<'grid' | 'list'>('list')
  const [filterSubject, setFilterSubject] = useState(subjectId || params.get('subject') || '')

  const { data: notes, isLoading, refetch } = useQuery({
    queryKey: ['notes', filterSubject || 'all'],
    queryFn: () => api.get(`/notes${filterSubject ? `?subject_id=${filterSubject}` : ''}`),
  })
  const { data: subjects } = useQuery({ queryKey: ['subjects'], queryFn: () => api.get('/subjects') })

  const create = useMutation({
    mutationFn: (subject: string) => api.post('/notes', { subject_id: subject, title: 'Untitled note', body: '' }),
    onSuccess: (n) => { qc.invalidateQueries({ queryKey: ['notes'] }); navigate(`/notes/${n.id}`) },
    onError: (e: any) => toast(e.message, 'error'),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/notes/${id}`),
    onSuccess: () => { refetch(); toast('Note deleted', 'success') },
  })
  const duplicate = useMutation({
    mutationFn: (n: any) => api.post('/notes', { subject_id: n.subject_id, topic_id: n.topic_id, title: `${n.title} (copy)`, body: n.body }),
    onSuccess: () => refetch(),
  })

  const newNote = async () => {
    const target = filterSubject || subjectId
    if (target) return create.mutate(target)
    if (!subjects?.length) return toast('Add a subject first', 'error')
    const name = await dialogs.prompt('New note', `Which subject? (${subjects.map((s: any) => s.name).join(', ')})`, subjects[0].name)
    const found = subjects.find((s: any) => s.name.toLowerCase() === (name || '').toLowerCase())
    if (found) create.mutate(found.id)
    else if (name) toast('No subject with that name', 'error')
  }

  const noteMenu = (n: any): MenuItem[] => [
    { type: 'label', label: n.title },
    { label: 'Open', onClick: () => navigate(`/notes/${n.id}`) },
    { label: 'Duplicate', onClick: () => duplicate.mutate(n) },
    { type: 'sep' },
    { label: 'Delete', danger: true, onClick: async () => {
      if (await dialogs.confirm('Delete note?', n.title, true)) remove.mutate(n.id)
    } },
  ]

  if (isLoading) return <Loading />
  const list = notes || []
  const plain = (html: string) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

  return (
    <div className={embedded ? '' : 'page'}>
      {!embedded && (
        <div className="page-head">
          <div>
            <h1>Notes</h1>
            <div className="meta">Your own written notes — formatted, searchable, and usable by every AI tool.</div>
          </div>
          <div className="row">
            <Segmented value={view} onChange={setView} options={[{ value: 'list', label: 'List' }, { value: 'grid', label: 'Grid' }]} />
            <button className="btn primary" onClick={newNote}><Icon name="plus" size={14} /> New note</button>
          </div>
        </div>
      )}
      {embedded && <SectionHead title="My notes" action={<button className="btn sm primary" onClick={newNote}>New note</button>} />}

      {!embedded && (
        <div className="row wrap">
          <button className={`chip ${!filterSubject ? 'on' : ''}`} onClick={() => setFilterSubject('')}>All subjects</button>
          {(subjects || []).map((s: any) => (
            <button key={s.id} className={`chip ${filterSubject === s.id ? 'on' : ''}`} onClick={() => setFilterSubject(s.id)}>{s.name}</button>
          ))}
        </div>
      )}

      {!list.length ? (
        <Empty title="No notes yet" message="Write notes here, or paste them in from the Uploads page. Notes feed practice, flashcards and the AI tools."
          action={<button className="btn sm primary" onClick={newNote}>New note</button>} />
      ) : view === 'list' && !embedded ? (
        <div className="card" style={{ padding: 0 }}>
          <table className="data">
            <thead><tr><th>Note</th><th style={{ width: 160 }}>Subject</th><th style={{ width: 130 }}>Topic</th><th style={{ width: 110 }}>Updated</th></tr></thead>
            <tbody>
              {list.map((n: any) => (
                <tr key={n.id} className="link" onClick={() => navigate(`/notes/${n.id}`)} onContextMenu={(e) => menu(e, noteMenu(n))}>
                  <td>
                    <div className="strong">{n.title}</div>
                    <div className="micro ink-4 truncate" style={{ maxWidth: 460 }}>{plain(n.body).slice(0, 120) || 'Empty note'}</div>
                  </td>
                  <td className="meta">{subjects?.find((s: any) => s.id === n.subject_id)?.name || '—'}</td>
                  <td className="meta">{n.subtopic || '—'}</td>
                  <td className="micro">{fmtDate(n.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid-3">
          {list.map((n: any) => (
            <div className="card link" key={n.id} onClick={() => navigate(`/notes/${n.id}`)} onContextMenu={(e) => menu(e, noteMenu(n))}>
              <div className="strong truncate">{n.title}</div>
              <div className="micro" style={{ marginBottom: 6 }}>{fmtDate(n.updated_at)}</div>
              <div className="body ink-3 clamp2">{plain(n.body).slice(0, 140) || 'Empty note'}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
