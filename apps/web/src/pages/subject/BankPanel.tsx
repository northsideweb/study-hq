import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { Icon } from '../../components/Icons'
import { Modal, Field, Empty, Loading, useToast, useDialogs, useContextMenu, type MenuItem } from '../../components/ui'
import GenerateModal from '../GenerateModal'

export type BankKind = {
  kind: string; label: string; singular: string
  titleLabel: string; bodyLabel: string; detailLabel: string; sourceLabel: string
  hint?: string
}

/** Generic store behind every subject bank: quotes, cases, legislation, business examples… */
export default function BankPanel({ subjectId, spec }: { subjectId: string; spec: BankKind }) {
  const toast = useToast()
  const dialogs = useDialogs()
  const menu = useContextMenu()
  const [editing, setEditing] = useState<any>(null)
  const [search, setSearch] = useState('')
  const [makeCards, setMakeCards] = useState(false)

  const { data: entries, isLoading, refetch } = useQuery({
    queryKey: ['banks', subjectId, spec.kind],
    queryFn: () => api.get(`/banks/${subjectId}?kind=${spec.kind}`),
  })
  const { data: topics } = useQuery({ queryKey: ['topics', subjectId], queryFn: () => api.get(`/topics?subject_id=${subjectId}`) })

  const save = useMutation({
    mutationFn: (e: any) => (e.id ? api.put(`/banks/entry/${e.id}`, e) : api.post(`/banks/${subjectId}`, { ...e, kind: spec.kind })),
    onSuccess: () => { refetch(); setEditing(null); toast('Saved', 'success') },
    onError: (e: any) => toast(e.message, 'error'),
  })
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/banks/entry/${id}`), onSuccess: () => { refetch(); toast('Deleted', 'success') } })
  const extract = useMutation({
    mutationFn: () => api.post(`/banks/${subjectId}/extract`, { kind: spec.kind, count: 15 }),
    onSuccess: (r: any) => { refetch(); toast(`Found ${r.added} ${spec.label.toLowerCase()} in your material`, 'success') },
    onError: (e: any) => toast(e.message, 'error', 'Could not extract'),
  })

  const entryMenu = (e: any): MenuItem[] => [
    { type: 'label', label: e.title },
    { label: 'Edit', onClick: () => setEditing(e) },
    { label: 'Duplicate', onClick: () => save.mutate({ ...e, id: undefined, title: `${e.title} (copy)` }) },
    { type: 'sep' },
    { label: 'Delete', danger: true, onClick: async () => { if (await dialogs.confirm(`Delete this ${spec.singular}?`, e.title, true)) remove.mutate(e.id) } },
  ]

  if (isLoading) return <Loading />

  const list = (entries || []).filter((e: any) =>
    !search || `${e.title} ${e.body} ${e.detail} ${e.source}`.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row wrap">
        <div style={{ flex: 1, minWidth: 180 }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${spec.label.toLowerCase()}…`} />
        </div>
        <button className="btn sm" onClick={() => extract.mutate()} disabled={extract.isPending}>
          {extract.isPending ? <><span className="spinner" /> Reading your work…</> : <><Icon name="sparkle" size={13} /> Find in my material</>}
        </button>
        <button className="btn sm" disabled={!entries?.length} onClick={() => setMakeCards(true)}>
          <Icon name="cards" size={13} /> Make flashcards
        </button>
        <button className="btn sm primary" onClick={() => setEditing({ title: '', body: '', detail: '', source: '', topic_id: '' })}>
          <Icon name="plus" size={13} /> Add {spec.singular}
        </button>
      </div>

      {spec.hint && <div className="meta">{spec.hint}</div>}

      {!list.length ? (
        <Empty
          title={search ? 'No matches' : `No ${spec.label.toLowerCase()} yet`}
          message={search ? 'Try a different search.' : `Add your own, or pull them straight out of the notes and school work you've already uploaded.`}
          action={!search ? <button className="btn sm primary" onClick={() => setEditing({ title: '', body: '', detail: '', source: '', topic_id: '' })}>Add {spec.singular}</button> : undefined}
        />
      ) : (
        <div className="grid-2" style={{ gap: 10 }}>
          {list.map((e: any) => (
            <div className="card link" key={e.id} onClick={() => setEditing(e)} onContextMenu={(ev) => menu(ev, entryMenu(e))}>
              <div className="row" style={{ marginBottom: 4 }}>
                <span className="strong body" style={{ flex: 1 }}>{e.title}</span>
                {e.origin === 'ai' && <span className="tag blue pill">found</span>}
              </div>
              {e.body && <div className="body dim clamp2">{e.body}</div>}
              {e.detail && <div className="micro ink-3 clamp2" style={{ marginTop: 4 }}>{e.detail}</div>}
              <div className="row micro ink-4" style={{ marginTop: 6, gap: 8 }}>
                {e.source && <span>{e.source}</span>}
                {e.topic_name && <span>· {e.topic_name}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <Modal
          title={editing.id ? `Edit ${spec.singular}` : `Add ${spec.singular}`}
          size="wide"
          onClose={() => setEditing(null)}
          footer={
            <>
              {editing.id && <button className="btn danger" onClick={async () => {
                if (await dialogs.confirm(`Delete this ${spec.singular}?`, editing.title, true)) { remove.mutate(editing.id); setEditing(null) }
              }}>Delete</button>}
              <div className="spacer" />
              <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn primary" disabled={!editing.title?.trim()} onClick={() => save.mutate(editing)}>Save</button>
            </>
          }
        >
          <Field label={spec.titleLabel}><input autoFocus value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></Field>
          <Field label={spec.bodyLabel}><textarea rows={3} value={editing.body || ''} onChange={(e) => setEditing({ ...editing, body: e.target.value })} /></Field>
          <Field label={spec.detailLabel}><textarea rows={4} value={editing.detail || ''} onChange={(e) => setEditing({ ...editing, detail: e.target.value })} /></Field>
          <div className="row" style={{ gap: 10 }}>
            <Field label={spec.sourceLabel}><input value={editing.source || ''} onChange={(e) => setEditing({ ...editing, source: e.target.value })} /></Field>
            <Field label="Topic">
              <select value={editing.topic_id || ''} onChange={(e) => setEditing({ ...editing, topic_id: e.target.value })}>
                <option value="">No topic</option>
                {(topics || []).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
          </div>
        </Modal>
      )}

      {makeCards && (
        <GenerateModal
          kind="flashcards"
          subjectId={subjectId}
          title={`Flashcards from my ${spec.label.toLowerCase()}`}
          instructions={`Build cards from these ${spec.label.toLowerCase()} the student has saved:\n` +
            (entries || []).slice(0, 40).map((e: any) => `- ${e.title}: ${e.body} ${e.detail}`).join('\n')}
          onClose={() => setMakeCards(false)}
        />
      )}
    </div>
  )
}

export const BANKS: Record<string, BankKind> = {
  quote: { kind: 'quote', label: 'Quotes', singular: 'quote', titleLabel: 'The quote', bodyLabel: 'Technique and effect', detailLabel: 'Where it appears / how to use it', sourceLabel: 'Text', hint: 'Quotes you can actually use in an essay, with the technique and effect attached.' },
  technique: { kind: 'technique', label: 'Techniques', singular: 'technique', titleLabel: 'Technique', bodyLabel: 'Definition', detailLabel: 'Example from my texts + effect', sourceLabel: 'Text' },
  theme: { kind: 'theme', label: 'Themes', singular: 'theme', titleLabel: 'Theme', bodyLabel: 'How the text explores it', detailLabel: 'Supporting evidence', sourceLabel: 'Text' },
  character: { kind: 'character', label: 'Characters', singular: 'character', titleLabel: 'Character', bodyLabel: 'Role and development', detailLabel: 'Key quotes', sourceLabel: 'Text' },
  case: { kind: 'case', label: 'Legal cases', singular: 'case', titleLabel: 'Case name and year', bodyLabel: 'Facts', detailLabel: 'Legal principle and significance', sourceLabel: 'Court / jurisdiction', hint: 'Your own case bank — add cases from class and pull the rest out of your notes.' },
  legislation: { kind: 'legislation', label: 'Legislation', singular: 'Act', titleLabel: 'Act name and year', bodyLabel: 'Purpose', detailLabel: 'Key provisions and effectiveness', sourceLabel: 'NSW / Cth' },
  contemporary: { kind: 'contemporary', label: 'Contemporary examples', singular: 'example', titleLabel: 'The example', bodyLabel: 'What happened', detailLabel: 'The issue it illustrates', sourceLabel: 'Media source' },
  business_example: { kind: 'business_example', label: 'My business examples', singular: 'business', titleLabel: 'Business name', bodyLabel: 'What it does / the situation', detailLabel: 'Which syllabus point it supports and how to use it', sourceLabel: 'Industry', hint: 'The businesses you use in assessments — keep the detail here so you can reuse them under exam pressure.' },
  definition: { kind: 'definition', label: 'Definitions', singular: 'definition', titleLabel: 'Term', bodyLabel: 'Definition', detailLabel: 'Example or common misuse', sourceLabel: 'Source' },
  principle: { kind: 'principle', label: 'Legal principles', singular: 'principle', titleLabel: 'Principle', bodyLabel: 'What it means', detailLabel: 'Cases or legislation that establish it', sourceLabel: 'Area of law' },
  material: { kind: 'material', label: 'Materials', singular: 'material', titleLabel: 'Material', bodyLabel: 'Properties', detailLabel: 'Where and why you would use it', sourceLabel: 'Category' },
  project: { kind: 'project', label: 'Major project', singular: 'project entry', titleLabel: 'Stage or entry', bodyLabel: 'What I did', detailLabel: 'Evaluation and next steps', sourceLabel: 'Date / stage', hint: 'Track your major design project stage by stage. Attach photos of physical work from the Uploads page.' },
}
