import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, STATUS_LABELS, type Topic } from '../../lib/api'
import { Empty, Loading, StatusTick, nextStatus, useToast, useDialogs, useContextMenu, type MenuItem } from '../../components/ui'
import { Icon } from '../../components/Icons'
import GenerateModal from '../GenerateModal'

/** The subject's own topic tree — unlimited topics and subtopics. */
export default function TopicsTab({ subjectId }: { subjectId: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const dialogs = useDialogs()
  const menu = useContextMenu()
  const [generate, setGenerate] = useState<{ kind: 'practice' | 'flashcards'; topic: Topic } | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)

  const { data: topics, isLoading, refetch } = useQuery<Topic[]>({
    queryKey: ['topics', subjectId, 'topic'],
    queryFn: () => api.get(`/topics?subject_id=${subjectId}&scope=topic`),
  })

  const invalidate = () => { refetch(); qc.invalidateQueries({ queryKey: ['topics'] }); qc.invalidateQueries({ queryKey: ['subjects'] }) }

  const save = useMutation({ mutationFn: (t: any) => (t.id ? api.put(`/topics/${t.id}`, t) : api.post('/topics', t)), onSuccess: invalidate,
    onError: (e: any) => toast(e.message, 'error') })
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/topics/${id}`), onSuccess: invalidate })
  const reorder = useMutation({ mutationFn: (ids: string[]) => api.post('/topics/reorder', { ids }), onSuccess: invalidate })

  const add = async (parentId: string | null) => {
    const name = await dialogs.prompt(parentId ? 'Add subtopic' : 'Add topic', 'Name')
    if (name) save.mutate({ subject_id: subjectId, name, parent_id: parentId, scope: 'topic' })
  }

  const duplicate = (t: Topic) => save.mutate({ subject_id: subjectId, name: `${t.name} (copy)`, parent_id: t.parent_id, scope: 'topic', notes: t.notes })

  const topicMenu = (t: Topic): MenuItem[] => [
    { type: 'label', label: t.name },
    { label: 'Add subtopic', onClick: () => add(t.id) },
    { label: 'Generate questions', onClick: () => setGenerate({ kind: 'practice', topic: t }) },
    { label: 'Generate flashcards', onClick: () => setGenerate({ kind: 'flashcards', topic: t }) },
    { type: 'sep' },
    { label: 'Rename', onClick: async () => {
      const name = await dialogs.prompt('Rename topic', 'Name', t.name)
      if (name) save.mutate({ id: t.id, name })
    } },
    { label: 'Duplicate', onClick: () => duplicate(t) },
    { label: t.parent_id ? 'Move to top level' : 'Move under…', onClick: async () => {
      if (t.parent_id) return save.mutate({ id: t.id, parent_id: null })
      const others = (topics || []).filter((x) => x.id !== t.id && !x.parent_id)
      if (!others.length) return toast('No other top-level topic to move under', 'info')
      const name = await dialogs.prompt('Move under which topic?', `Type the exact name: ${others.map((o) => o.name).join(', ')}`)
      const target = others.find((o) => o.name.toLowerCase() === (name || '').toLowerCase())
      if (target) save.mutate({ id: t.id, parent_id: target.id })
      else if (name) toast('No topic with that name', 'error')
    } },
    { type: 'sep' },
    ...(['studying', 'needs_revision', 'completed', 'not_started'] as const).map((s) => ({
      label: `Mark ${STATUS_LABELS[s].toLowerCase()}`, onClick: () => save.mutate({ id: t.id, status: s }),
    })),
    { type: 'sep' },
    { label: 'Archive', onClick: () => save.mutate({ id: t.id, archived: true }) },
    { label: 'Delete', danger: true, onClick: async () => {
      if (await dialogs.confirm('Delete topic?', `"${t.name}" and its subtopics will be deleted.`, true)) remove.mutate(t.id)
    } },
  ]

  if (isLoading) return <Loading />

  const all = topics || []
  const roots = all.filter((t) => !t.parent_id)
  const children = (id: string) => all.filter((t) => t.parent_id === id)

  const Row = ({ t, depth }: { t: Topic; depth: number }) => (
    <>
      <div
        className="row-item"
        style={{ border: 'none', borderRadius: 7, paddingLeft: 10 + depth * 22 }}
        draggable
        onDragStart={() => setDragId(t.id)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={() => {
          if (!dragId || dragId === t.id) return
          const ids = all.map((x) => x.id)
          const from = ids.indexOf(dragId)
          const to = ids.indexOf(t.id)
          ids.splice(to, 0, ids.splice(from, 1)[0])
          reorder.mutate(ids)
          setDragId(null)
        }}
        onContextMenu={(e) => menu(e, topicMenu(t))}
      >
        <StatusTick status={t.status} onClick={() => save.mutate({ id: t.id, status: nextStatus(t.status) })} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: depth === 0 ? 560 : 400 }}>{t.name}</div>
          {t.status !== 'not_started' && <div className="micro">{STATUS_LABELS[t.status]}</div>}
        </div>
        <button className="btn quiet sm" onClick={() => add(t.id)} title="Add subtopic"><Icon name="plus" size={13} /></button>
        <button className="btn quiet sm icon" onClick={(e) => menu(e as any, topicMenu(t))}><Icon name="more" size={14} /></button>
      </div>
      {children(t.id).map((c) => <Row key={c.id} t={c} depth={depth + 1} />)}
    </>
  )

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="row">
        <div>
          <h2>Topics</h2>
          <div className="meta">Your own topic structure — unlimited topics and subtopics. Drag to reorder, right-click for options.</div>
        </div>
        <div className="spacer" />
        <button className="btn primary" onClick={() => add(null)}>+ Add topic</button>
      </div>

      {!roots.length ? (
        <Empty icon="◱" title="No topics yet"
          message="Add the topics your subject is broken into. Notes, uploads, flashcards, questions and mastery all hang off them."
          action={<button className="btn primary" onClick={() => add(null)}>+ Add topic</button>} />
      ) : (
        <div className="card" style={{ padding: 8 }}>
          {roots.map((t) => <Row key={t.id} t={t} depth={0} />)}
        </div>
      )}

      {generate && (
        <GenerateModal kind={generate.kind} subjectId={subjectId} topicId={generate.topic.id} onClose={() => setGenerate(null)} />
      )}
    </div>
  )
}
