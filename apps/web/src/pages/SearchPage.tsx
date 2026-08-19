import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { Empty, Loading } from '../components/ui'
import { Icon } from '../components/Icons'

const TYPE_META: Record<string, { icon: string; label: string }> = {
  note: { icon: 'note', label: 'Note' },
  upload: { icon: 'file', label: 'Upload' },
  flashcard: { icon: 'cards', label: 'Flashcard' },
  question: { icon: 'pencil', label: 'Question' },
  syllabus_point: { icon: 'list', label: 'Syllabus' },
  topic: { icon: 'book', label: 'Topic' },
  assessment: { icon: 'calendar', label: 'Assessment' },
}

export default function SearchPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const q = params.get('q') || ''
  const [filter, setFilter] = useState('')
  const [input, setInput] = useState(q)

  useEffect(() => setInput(q), [q])

  const { data, isLoading } = useQuery({
    queryKey: ['search', q],
    queryFn: () => api.get(`/search?q=${encodeURIComponent(q)}`),
    enabled: q.length >= 2,
  })

  const results = (data?.results || []).filter((r: any) => !filter || r.type === filter)
  const counts: Record<string, number> = {}
  for (const r of data?.results || []) counts[r.type] = (counts[r.type] || 0) + 1

  const open = (r: any) => {
    if (r.type === 'question') return navigate(`/practice/${r.set_id}`)
    if (r.type === 'flashcard') return navigate(r.subject_id ? `/subjects/${r.subject_id}?tab=flashcards` : '/flashcards')
    if (r.type === 'assessment') return navigate('/assessments')
    if (!r.subject_id) return navigate('/upload')
    const tab = r.type === 'note' ? 'notes' : r.type === 'upload' ? 'uploads' : r.type === 'syllabus_point' ? 'syllabus'
      : r.type === 'topic' ? (r.scope === 'school' ? 'school' : 'topics') : 'syllabus'
    navigate(`/subjects/${r.subject_id}?tab=${tab}`)
  }

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ flex: 1 }}>
          <h1>Search</h1>
          <div className="meta">Everything you've ever added — across every subject.</div>
        </div>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); setParams({ q: input }) }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} autoFocus
          placeholder="e.g. Australian Consumer Law" style={{ fontSize: 15, padding: '11px 14px' }} />
      </form>

      {q.length < 2 ? (
        <Empty title="Search your whole knowledge base"
          message="Notes, uploaded work, OCR'd handwriting, flashcards, questions, syllabus points, topics and assessments." />
      ) : isLoading ? (
        <Loading label="Searching" />
      ) : !data?.results?.length ? (
        <Empty title={`No matches for “${q}”`} message="Try a shorter phrase, or check the spelling." />
      ) : (
        <>
          <div className="row wrap">
            <button className={`chip ${!filter ? 'on' : ''}`} onClick={() => setFilter('')}>All {data.count}</button>
            {Object.entries(counts).map(([t, n]) => (
              <button key={t} className={`chip ${filter === t ? 'on' : ''}`} onClick={() => setFilter(t)}>
                {TYPE_META[t]?.label} {n}
              </button>
            ))}
          </div>

          <div className="stack" style={{ gap: 7 }}>
            {results.map((r: any, i: number) => (
              <div className="row-item link" key={`${r.type}-${r.id}-${i}`} onClick={() => open(r)}>
                <Icon name={TYPE_META[r.type]?.icon || 'file'} size={15} className="ink-3" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="truncate" style={{ fontWeight: 550 }}>{r.title}</div>
                  {r.snippet && <div className="micro ink-3 clamp2">{r.snippet}</div>}
                </div>
                {r.subject_name && (
                  <span className="tag pill"><span className="dot" style={{ background: r.color }} /> {r.subject_name}</span>
                )}
                <span className="tag pill">{TYPE_META[r.type]?.label}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
