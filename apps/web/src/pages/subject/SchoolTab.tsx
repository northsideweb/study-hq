import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, STATUS_LABELS, fmtDate, daysUntil, type Topic } from '../../lib/api'
import { Modal, Field, Empty, Loading, useToast, useDialogs, useContextMenu, type MenuItem } from '../../components/ui'
import UploadList from '../../components/UploadList'
import GenerateModal from '../GenerateModal'

const blank = (subject_id: string): Partial<Topic> => ({
  subject_id, name: '', scope: 'school', status: 'studying', priority: 'normal',
  start_date: new Date().toISOString().slice(0, 10), assessment_date: null,
  teacher_instructions: '', notes: '', links: [],
})

/** "WHAT I'M DOING AT SCHOOL" — deliberately separate from the official syllabus. */
export default function SchoolTab({ subjectId }: { subjectId: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const dialogs = useDialogs()
  const menu = useContextMenu()

  const [editing, setEditing] = useState<Partial<Topic> | null>(null)
  const [generate, setGenerate] = useState<{ kind: 'practice' | 'flashcards'; topic: Topic } | null>(null)

  const { data: topics, isLoading, refetch } = useQuery<Topic[]>({
    queryKey: ['topics', subjectId, 'school'],
    queryFn: () => api.get(`/topics?subject_id=${subjectId}&scope=school`),
  })

  const invalidate = () => {
    refetch()
    qc.invalidateQueries({ queryKey: ['topics'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const save = useMutation({
    mutationFn: (t: Partial<Topic>) => (t.id ? api.put(`/topics/${t.id}`, t) : api.post('/topics', t)),
    onSuccess: () => { invalidate(); setEditing(null); toast('Saved', 'success') },
    onError: (e: any) => toast(e.message, 'error'),
  })
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/topics/${id}`), onSuccess: () => { invalidate(); toast('Deleted', 'success') } })

  const topicMenu = (t: Topic): MenuItem[] => [
    { type: 'label', label: t.name },
    { label: 'Edit details', onClick: () => setEditing(t) },
    { label: 'Generate practice', onClick: () => setGenerate({ kind: 'practice', topic: t }) },
    { label: 'Generate flashcards', onClick: () => setGenerate({ kind: 'flashcards', topic: t }) },
    { type: 'sep' },
    ...(['studying', 'needs_revision', 'completed', 'not_started'] as const).map((s) => ({
      label: `Mark ${STATUS_LABELS[s].toLowerCase()}`, onClick: () => save.mutate({ id: t.id, status: s }),
    })),
    { type: 'sep' },
    { label: t.archived ? 'Unarchive' : 'Archive', onClick: () => save.mutate({ id: t.id, archived: !t.archived } as any) },
    { label: 'Delete', danger: true, onClick: async () => {
      if (await dialogs.confirm('Delete this school topic?', t.name, true)) remove.mutate(t.id)
    } },
  ]

  if (isLoading) return <Loading />

  const list = topics || []

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="section-head">
        <div>
          <h2>What I'm doing at school</h2>
          <div className="sub">Kept separate from the official syllabus — this is what your class is actually covering right now.</div>
        </div>
        <div className="section-actions">
          <button className="btn sm primary" onClick={() => setEditing(blank(subjectId))}>Add current content</button>
        </div>
      </div>

      {!list.length ? (
        <Empty title="Nothing recorded yet"
          message="Add the topic your class is on, when it started, what your teacher told you and when the assessment is. Study sessions use all of it."
          action={<button className="btn primary" onClick={() => setEditing(blank(subjectId))}>+ Add current content</button>} />
      ) : (
        <div className="rows">
          {list.map((t) => {
            const d = daysUntil(t.assessment_date)
            return (
              <div className="card link" key={t.id} onClick={() => setEditing(t)} onContextMenu={(e) => menu(e, topicMenu(t))}>
                <div className="row" style={{ marginBottom: 8 }}>
                  <span className={`dot status-${t.status}`} />
                  <div className="row-title" style={{ flex: 1 }}>{t.name}</div>
                  {t.priority === 'high' && <span className="tag red pill">high priority</span>}
                  {t.priority === 'low' && <span className="tag pill">low</span>}
                </div>
                <div className="body dim stack" style={{ gap: 3 }}>
                  <div>Status: {STATUS_LABELS[t.status]}</div>
                  {t.start_date && <div>Started {fmtDate(t.start_date)}</div>}
                  {t.assessment_date && (
                    <div style={{ color: d !== null && d <= 7 ? 'var(--red)' : 'var(--amber)' }}>
                      Assessment {fmtDate(t.assessment_date)}{d !== null && d >= 0 ? ` · ${d} day${d === 1 ? '' : 's'}` : ''}
                    </div>
                  )}
                </div>
                {t.teacher_instructions && (
                  <div className="body" style={{ marginTop: 9, padding: 9, background: 'var(--bg)', borderRadius: 8, borderLeft: '2px solid var(--blue)' }}>
                    <div className="micro" style={{ marginBottom: 2 }}>Teacher instructions</div>
                    <div className="clamp2">{t.teacher_instructions}</div>
                  </div>
                )}
                {t.notes && <div className="micro ink-3 clamp2" style={{ marginTop: 8 }}>{t.notes}</div>}
                {!!t.links?.length && (
                  <div className="row wrap micro" style={{ marginTop: 8, gap: 6 }}>
                    {t.links.map((l: any, i: number) => (
                      <a key={i} className="tag blue pill" href={l.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{l.label || l.url}</a>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {editing && <SchoolEditor topic={editing} onChange={setEditing} onClose={() => setEditing(null)}
        onSave={() => save.mutate(editing)} saving={save.isPending} subjectId={subjectId} />}

      {generate && (
        <GenerateModal kind={generate.kind} subjectId={subjectId} topicId={generate.topic.id} onClose={() => setGenerate(null)} />
      )}
    </div>
  )
}

function SchoolEditor({
  topic, onChange, onClose, onSave, saving, subjectId,
}: {
  topic: Partial<Topic>; onChange: (t: Partial<Topic>) => void; onClose: () => void
  onSave: () => void; saving: boolean; subjectId: string
}) {
  const [linkLabel, setLinkLabel] = useState('')
  const [linkUrl, setLinkUrl] = useState('')

  return (
    <Modal
      title={topic.id ? 'Edit current school content' : 'Add current school content'}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!topic.name?.trim() || saving} onClick={onSave}>{saving ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <div className="grid-2" style={{ gap: 12 }}>
        <Field label="Topic"><input autoFocus value={topic.name || ''} onChange={(e) => onChange({ ...topic, name: e.target.value })} placeholder="e.g. Legal Regulations" /></Field>
        <Field label="Status">
          <select value={topic.status} onChange={(e) => onChange({ ...topic, status: e.target.value as any })}>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Start date"><input type="date" value={topic.start_date || ''} onChange={(e) => onChange({ ...topic, start_date: e.target.value })} /></Field>
        <Field label="Assessment date"><input type="date" value={topic.assessment_date || ''} onChange={(e) => onChange({ ...topic, assessment_date: e.target.value })} /></Field>
        <Field label="Priority">
          <select value={topic.priority} onChange={(e) => onChange({ ...topic, priority: e.target.value })}>
            <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option>
          </select>
        </Field>
      </div>

      <Field label="Teacher instructions" hint="Exactly what your teacher said to do — this is fed to the AI when generating practice.">
        <textarea rows={3} value={topic.teacher_instructions || ''} onChange={(e) => onChange({ ...topic, teacher_instructions: e.target.value })} />
      </Field>

      <Field label="My notes">
        <textarea rows={4} value={topic.notes || ''} onChange={(e) => onChange({ ...topic, notes: e.target.value })} />
      </Field>

      <Field label="Links">
        <div className="stack" style={{ gap: 6 }}>
          {(topic.links || []).map((l: any, i: number) => (
            <div className="row-item body" key={i}>
              <a href={l.url} target="_blank" rel="noreferrer" className="truncate" style={{ flex: 1, color: 'var(--blue)' }}>{l.label || l.url}</a>
              <button className="btn quiet sm" onClick={() => onChange({ ...topic, links: (topic.links || []).filter((_: any, j: number) => j !== i) })}>Remove</button>
            </div>
          ))}
          <div className="row">
            <input placeholder="Label" value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} style={{ maxWidth: 160 }} />
            <input placeholder="https://…" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} />
            <button className="btn sm" disabled={!linkUrl.trim()} onClick={() => {
              onChange({ ...topic, links: [...(topic.links || []), { label: linkLabel || linkUrl, url: linkUrl }] })
              setLinkLabel(''); setLinkUrl('')
            }}>Add</button>
          </div>
        </div>
      </Field>

      {topic.id && (
        <div>
          <div className="row" style={{ marginBottom: 8 }}>
            <strong className="body">Files &amp; photos for this topic</strong>
          </div>
          <UploadList subjectId={subjectId} topicId={topic.id} limit={50} />
        </div>
      )}
    </Modal>
  )
}
