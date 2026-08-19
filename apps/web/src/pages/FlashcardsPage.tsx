import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type Flashcard } from '../lib/api'
import { Modal, Field, Empty, Loading, useToast, useDialogs, useContextMenu, type MenuItem, Tabs } from '../components/ui'
import { Icon } from '../components/Icons'
import GenerateModal from './GenerateModal'

const GRADES = [
  { g: 'again', label: 'Again', hint: '<10 min', color: 'var(--red)' },
  { g: 'hard', label: 'Hard', hint: 'sooner', color: 'var(--amber)' },
  { g: 'good', label: 'Good', hint: 'on track', color: 'var(--green)' },
  { g: 'easy', label: 'Easy', hint: 'much later', color: 'var(--blue)' },
]

export default function FlashcardsPage({ subjectId, embedded }: { subjectId?: string; embedded?: boolean }) {
  const qc = useQueryClient()
  const toast = useToast()
  const dialogs = useDialogs()
  const menu = useContextMenu()

  const [tab, setTab] = useState('review')
  const [generate, setGenerate] = useState(false)
  const [editing, setEditing] = useState<any>(null)

  const { data: stats } = useQuery({ queryKey: ['flashcard-stats'], queryFn: () => api.get('/flashcards/stats') })
  const { data: due, isLoading: dueLoading, refetch: refetchDue } = useQuery<Flashcard[]>({
    queryKey: ['flashcards', 'due', subjectId || 'all'],
    queryFn: () => api.get(`/flashcards?due=true&limit=200${subjectId ? `&subject_id=${subjectId}` : ''}`),
  })
  const { data: all, refetch: refetchAll } = useQuery<Flashcard[]>({
    queryKey: ['flashcards', 'all', subjectId || 'all'],
    queryFn: () => api.get(`/flashcards?limit=500${subjectId ? `&subject_id=${subjectId}` : ''}`),
  })
  const { data: subjects } = useQuery({ queryKey: ['subjects'], queryFn: () => api.get('/subjects') })
  const { data: topics } = useQuery({
    queryKey: ['topics', editing?.subject_id],
    queryFn: () => api.get(`/topics?subject_id=${editing?.subject_id}`),
    enabled: !!editing?.subject_id,
  })

  const invalidate = () => {
    refetchDue(); refetchAll()
    qc.invalidateQueries({ queryKey: ['flashcard-stats'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
    qc.invalidateQueries({ queryKey: ['subjects'] })
  }

  const save = useMutation({
    mutationFn: (c: any) => (c.id ? api.put(`/flashcards/${c.id}`, c) : api.post('/flashcards', c)),
    onSuccess: () => { invalidate(); setEditing(null); toast('Card saved', 'success') },
    onError: (e: any) => toast(e.message, 'error'),
  })
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/flashcards/${id}`), onSuccess: () => { invalidate(); toast('Deleted', 'success') } })

  const cardMenu = (c: Flashcard): MenuItem[] => [
    { type: 'label', label: c.front.slice(0, 44) },
    { label: 'Edit', onClick: () => setEditing(c) },
    { label: 'Duplicate', onClick: () => save.mutate({ subject_id: c.subject_id, topic_id: c.topic_id, front: c.front, back: c.back, extra: c.extra, card_kind: c.card_kind }) },
    { label: 'Suspend', onClick: () => save.mutate({ id: c.id, suspended: true }) },
    { label: 'Reset progress', onClick: async () => { await api.put(`/flashcards/${c.id}`, {}); toast('Card will come up again in the next review', 'info') } },
    { type: 'sep' },
    { label: 'Delete', danger: true, onClick: async () => {
      if (await dialogs.confirm('Delete card?', c.front, true)) remove.mutate(c.id)
    } },
  ]

  return (
    <div className={embedded ? '' : 'page'}>
      <div className={embedded ? 'section-head' : 'page-head'}>
        <div>
          <h1 style={embedded ? { fontSize: 19 } : undefined}>Flashcards</h1>
          <div className="meta">Spaced repetition — cards come back exactly when you're about to forget them.</div>
        </div>
        <div className="section-actions">
          <button className="btn" onClick={() => setEditing({ subject_id: subjectId || '', front: '', back: '', extra: '', card_kind: 'basic' })}>
            <Icon name="plus" size={14} /> New card
          </button>
          <button className="btn primary" onClick={() => setGenerate(true)}><Icon name="sparkle" size={14} /> Generate cards</button>
        </div>
      </div>

      {stats && (
        <div className="metrics ruled" style={{ paddingBottom: 24, borderBottom: '1px solid var(--line)', marginBottom: 30 }}>
          <div className="metric">
            <div className="metric-label">Due now</div>
            <div className="metric-value" style={{ color: stats.due ? 'var(--amber)' : undefined }}>{stats.due}</div>
            <div className="metric-note">{stats.due ? 'ready to review' : 'all caught up'}</div>
          </div>
          <div className="metric"><div className="metric-label">Total cards</div><div className="metric-value">{stats.total}</div></div>
          <div className="metric"><div className="metric-label">Mastered</div><div className="metric-value" style={{ color: 'var(--green)' }}>{stats.mastered}</div><div className="metric-note">21+ day interval</div></div>
          <div className="metric"><div className="metric-label">Learning</div><div className="metric-value">{Math.max(0, stats.total - stats.mastered)}</div></div>
        </div>
      )}

      <Tabs
        tabs={[{ id: 'review', label: 'Study due cards', badge: due?.length || 0 }, { id: 'manage', label: 'All cards', badge: all?.length || 0 }]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'review' ? (
        dueLoading ? <Loading /> : <Review key={subjectId || 'all'} cards={due || []} onGraded={invalidate} />
      ) : (
        <div className="stack" style={{ gap: 7 }}>
          {!all?.length ? (
            <Empty title="No cards yet" message="Generate cards from your notes, uploads or syllabus — or write them yourself."
              action={<button className="btn sm primary" onClick={() => setGenerate(true)}>Generate flashcards</button>} />
          ) : (
            all.map((c) => (
              <div className="row-item link" key={c.id} onClick={() => setEditing(c)} onContextMenu={(e) => menu(e, cardMenu(c))}>
                <span className="dot" style={{ background: c.subject_color }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="truncate" style={{ fontWeight: 550 }}>{c.front}</div>
                  <div className="micro ink-3 truncate">{c.back}</div>
                </div>
                <span className="tag pill">{c.card_kind}</span>
                <span className="micro" style={{ width: 78, textAlign: 'right' }}>
                  {c.interval_days >= 1 ? `${Math.round(c.interval_days)}d` : c.reps ? 'learning' : 'new'}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      {generate && <GenerateModal kind="flashcards" subjectId={subjectId} onClose={() => { setGenerate(false); invalidate() }} />}

      {editing && (
        <Modal
          title={editing.id ? 'Edit card' : 'New card'}
          onClose={() => setEditing(null)}
          footer={
            <>
              {editing.id && <button className="btn danger" onClick={async () => {
                if (await dialogs.confirm('Delete card?', editing.front, true)) { remove.mutate(editing.id); setEditing(null) }
              }}>Delete</button>}
              <div className="spacer" />
              <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn primary" disabled={!editing.front?.trim() || !editing.back?.trim() || !editing.subject_id} onClick={() => save.mutate(editing)}>Save card</button>
            </>
          }
        >
          {!subjectId && (
            <Field label="Subject">
              <select value={editing.subject_id || ''} onChange={(e) => setEditing({ ...editing, subject_id: e.target.value, topic_id: null })}>
                <option value="">Choose…</option>
                {(subjects || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Topic">
            <select value={editing.topic_id || ''} onChange={(e) => setEditing({ ...editing, topic_id: e.target.value || null })} disabled={!editing.subject_id}>
              <option value="">No topic</option>
              {(topics || []).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="Front"><textarea rows={3} autoFocus value={editing.front} onChange={(e) => setEditing({ ...editing, front: e.target.value })} /></Field>
          <Field label="Back"><textarea rows={5} value={editing.back} onChange={(e) => setEditing({ ...editing, back: e.target.value })} /></Field>
          <Field label="Extra (optional)"><textarea rows={2} value={editing.extra || ''} onChange={(e) => setEditing({ ...editing, extra: e.target.value })} /></Field>
        </Modal>
      )}
    </div>
  )
}

function Review({ cards, onGraded }: { cards: Flashcard[]; onGraded: () => void }) {
  const [queue, setQueue] = useState<Flashcard[]>(cards)
  const [flipped, setFlipped] = useState(false)
  const [done, setDone] = useState(0)
  const [start, setStart] = useState(Date.now())
  const seeded = useRef(cards.length > 0)

  // Seed the session queue once. After that it stays authoritative, so grading a card
  // doesn't reshuffle the review or reset the counter when the due list refetches.
  useEffect(() => {
    if (!seeded.current && cards.length) { setQueue(cards); seeded.current = true }
  }, [cards])

  const card = queue[0]

  const grade = useMutation({
    mutationFn: (g: string) => api.post(`/flashcards/${card.id}/review`, { grade: g, seconds: (Date.now() - start) / 1000 }),
    onSuccess: (_r, g) => {
      // "Again" puts the card back near the end of this session.
      setQueue((q) => (g === 'again' ? [...q.slice(1), q[0]] : q.slice(1)))
      setFlipped(false)
      setDone((d) => d + 1)
      setStart(Date.now())
      onGraded()
    },
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!card) return
      if (e.code === 'Space') { e.preventDefault(); setFlipped((f) => !f); return }
      if (!flipped) return
      const map: Record<string, string> = { Digit1: 'again', Digit2: 'hard', Digit3: 'good', Digit4: 'easy' }
      if (map[e.code]) grade.mutate(map[e.code])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [card, flipped])

  if (!card) {
    return (
      <Empty title={done ? 'Review complete' : 'Nothing due right now'}
        message={done ? `You reviewed ${done} card${done === 1 ? '' : 's'}. Come back when the next batch is due.` : 'Cards appear here when they are scheduled for review.'} />
    )
  }

  return (
    <div className="stack" style={{ gap: 12, maxWidth: 660, margin: '0 auto', width: '100%' }}>
      <div className="row micro ink-3">
        <span className="dot" style={{ background: card.subject_color }} />
        <span>{card.subject_name}{card.topic_name ? ` · ${card.topic_name}` : ''}</span>
        <div className="spacer" />
        <span>{queue.length} left · {done} done</span>
      </div>

      <div className="flashcard" onClick={() => setFlipped((f) => !f)}>
        {!flipped ? (
          <>
            <div className="flashcard-front pre-wrap">{card.front}</div>
            <div className="micro" style={{ marginTop: 18 }}>Click or press Space to flip</div>
          </>
        ) : (
          <>
            <div className="micro" style={{ marginBottom: 12 }}>{card.front}</div>
            <div className="flashcard-back pre-wrap">{card.back}</div>
            {card.extra && <div className="body ink-3 pre-wrap" style={{ marginTop: 14 }}>{card.extra}</div>}
          </>
        )}
      </div>

      {flipped ? (
        <div className="row" style={{ gap: 8 }}>
          {GRADES.map((g, i) => (
            <button key={g.g} className="btn" style={{ flex: 1, flexDirection: 'column', gap: 2, borderColor: g.color, padding: '10px 8px' }}
              disabled={grade.isPending} onClick={() => grade.mutate(g.g)}>
              <span style={{ color: g.color, fontWeight: 620 }}>{g.label}</span>
              <span className="micro">{i + 1} · {g.hint}</span>
            </button>
          ))}
        </div>
      ) : (
        <button className="btn primary lg block" onClick={() => setFlipped(true)}>Show answer</button>
      )}
    </div>
  )
}
