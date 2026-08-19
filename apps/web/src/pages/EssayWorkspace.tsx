import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { Icon } from '../components/Icons'
import { Loading, ErrorBox, Bar, Empty, Modal, Field, useToast, useDialogs } from '../components/ui'

export default function EssayWorkspace() {
  const { essayId } = useParams<{ essayId: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const dialogs = useDialogs()
  const qc = useQueryClient()

  const [title, setTitle] = useState('')
  const [question, setQuestion] = useState('')
  const [body, setBody] = useState('')
  const [marks, setMarks] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [selected, setSelected] = useState('')
  const [importing, setImporting] = useState(false)
  const [compare, setCompare] = useState<any>(null)
  const loaded = useState({ done: false })[0]

  const { data: essay, isLoading, error, refetch } = useQuery({
    queryKey: ['essay', essayId], queryFn: () => api.get(`/essays/${essayId}`), enabled: !!essayId,
  })

  useEffect(() => {
    if (!essay || loaded.done) return
    loaded.done = true
    setTitle(essay.title); setQuestion(essay.question); setBody(essay.body); setMarks(essay.marks || 0)
  }, [essay])

  const save = useMutation({
    mutationFn: () => api.put(`/essays/${essayId}`, { title, question, body, marks }),
    onSuccess: () => { setDirty(false); qc.invalidateQueries({ queryKey: ['essays'] }); qc.invalidateQueries({ queryKey: ['essay', essayId] }) },
  })

  useEffect(() => {
    if (!dirty) return
    const t = setTimeout(() => save.mutate(), 1800)
    return () => clearTimeout(t)
  }, [dirty, body, title, question, marks])

  const analyse = useMutation({
    mutationFn: async () => { await save.mutateAsync(); return api.post(`/essays/${essayId}/analyse`) },
    onSuccess: () => { refetch(); toast('Marked', 'success') },
    onError: (e: any) => toast(e.message, 'error', 'Could not mark this response'),
  })

  const improve = useMutation({
    mutationFn: (paragraph: string) => api.post(`/essays/${essayId}/improve`, { paragraph }),
    onSuccess: (r) => { setCompare(r); refetch() },
    onError: (e: any) => toast(e.message, 'error', 'Could not improve that paragraph'),
  })

  /** Import writing from a file — DOCX, PDF or a photo of handwriting (OCR). */
  const importFile = async (file: File) => {
    setImporting(true)
    try {
      const form = new FormData()
      form.append('files', file)
      if (essay?.subject_id) form.append('subject_id', essay.subject_id)
      form.append('work_type', 'Essay')
      form.append('title', file.name)
      const res = await api.upload('/uploads', form)
      const id = res.ids[0]
      toast('Uploaded — reading the text…', 'info')
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 1500))
        const p = await api.get(`/uploads/${id}/progress`)
        if (p.status !== 'pending') break
      }
      const full = await api.get(`/uploads/${id}`)
      if (full.extracted_text) {
        setBody((b) => (b ? b + '\n\n' : '') + full.extracted_text)
        setDirty(true)
        toast('Text imported — the original file is kept in Uploads', 'success')
      } else {
        toast(full.extract_error || 'No text could be read from that file.', 'error')
      }
    } catch (e: any) { toast(e.message, 'error') } finally { setImporting(false) }
  }

  const paragraphs = useMemo(() => body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean), [body])
  const words = body.trim() ? body.trim().split(/\s+/).length : 0

  if (isLoading) return <Loading />
  if (error) return <ErrorBox error={error} retry={refetch} />
  if (!essay) return null

  const a = essay.analysis

  return (
    <div className="page wide">
      <div className="row">
        <button className="btn quiet sm" onClick={() => navigate(`/subjects/${essay.subject_id}?tab=tools`)}>
          <Icon name="chevronLeft" size={14} /> Back
        </button>
        <div className="spacer" />
        <span className="micro">{dirty ? 'Unsaved…' : 'Saved'} · {words} words</span>
        <button className="btn sm" onClick={() => save.mutate()}>Save</button>
        <button className="btn sm primary" onClick={() => analyse.mutate()} disabled={analyse.isPending || !body.trim()}>
          {analyse.isPending ? <><span className="spinner" /> Marking…</> : <><Icon name="sparkle" size={13} /> Analyse my response</>}
        </button>
      </div>

      <div className="split">
        <div className="stack loose">
          <div>
            <input value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true) }} placeholder="Response title"
              style={{ fontSize: 18, fontWeight: 600, border: 'none', padding: '2px 0', marginBottom: 8, background: 'transparent' }} />
            <Field label="The question">
              <textarea rows={2} value={question} onChange={(e) => { setQuestion(e.target.value); setDirty(true) }}
                placeholder="Paste the essay question or task exactly as it was given to you" />
            </Field>
            <div className="row" style={{ gap: 10, marginTop: 10 }}>
              <Field label="Marks"><input type="number" min={0} max={40} value={marks} onChange={(e) => { setMarks(Number(e.target.value)); setDirty(true) }} style={{ width: 90 }} /></Field>
              <div className="spacer" />
              <label className="btn sm" style={{ cursor: 'pointer', alignSelf: 'flex-end' }}>
                {importing ? <><span className="spinner" /> Importing…</> : <><Icon name="upload" size={13} /> Import writing</>}
                <input type="file" hidden accept=".docx,.pdf,.txt,image/*" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
              </label>
            </div>
            <div className="hint">Import a Word document, PDF, or a photo of handwritten work — it is OCR'd and added below.</div>
          </div>

          <div>
            <div className="section-head">
              <h2>My response</h2>
              <div className="spacer" />
              {selected && (
                <button className="btn sm" onClick={() => improve.mutate(selected)} disabled={improve.isPending}>
                  {improve.isPending ? <><span className="spinner" /> Working…</> : <><Icon name="sparkle" size={12} /> Improve selection</>}
                </button>
              )}
            </div>
            <textarea
              className="paper" rows={22} value={body}
              onChange={(e) => { setBody(e.target.value); setDirty(true) }}
              onSelect={(e) => {
                const el = e.target as HTMLTextAreaElement
                setSelected(el.value.slice(el.selectionStart, el.selectionEnd).trim())
              }}
              placeholder="Type or paste your response here…"
            />
            {!!paragraphs.length && (
              <div className="row wrap" style={{ marginTop: 10, gap: 6 }}>
                <span className="micro">Improve a paragraph:</span>
                {paragraphs.map((p, i) => (
                  <button key={i} className="chip" disabled={improve.isPending} onClick={() => improve.mutate(p)}>¶ {i + 1}</button>
                ))}
              </div>
            )}
            <div className="hint">Your original is never overwritten — improvements open side-by-side so you can compare and decide.</div>
          </div>

          {!!essay.improvements?.length && (
            <div className="card">
              <h3 style={{ marginBottom: 8 }}>Improvement history</h3>
              <div className="stack tight">
                {essay.improvements.slice().reverse().map((imp: any) => (
                  <div className="row-item link" key={imp.id} onClick={() => setCompare(imp)}>
                    <Icon name="copy" size={14} className="ink-3" />
                    <span className="body truncate" style={{ flex: 1 }}>{imp.original.slice(0, 80)}…</span>
                    <span className="tag blue pill">Compare</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="stack">
          {analyse.isPending && <div className="card row" style={{ gap: 8 }}><span className="spinner" /> Marking your response…</div>}

          {!a && !analyse.isPending && (
            <div className="card">
              <Empty title="Not marked yet"
                message="Write or import your response, then press Analyse. You get criteria-by-criteria feedback, the weak sections quoted back to you, and what to do next."
              />
            </div>
          )}

          {a && (
            <>
              <div className="card">
                <div className="row" style={{ marginBottom: 8 }}>
                  <h3>Overall</h3>
                  <div className="spacer" />
                  {a.estimated_band && <span className="tag blue pill">{a.estimated_band}</span>}
                  {a.mark != null && <span className="tag pill">{a.mark}/{a.out_of || marks}</span>}
                </div>
                <div className="body pre-wrap">{a.overall}</div>
              </div>

              {!!a.criteria?.length && (
                <div className="card">
                  <h3 style={{ marginBottom: 10 }}>Criteria</h3>
                  <div className="stack" style={{ gap: 11 }}>
                    {a.criteria.map((c: any, i: number) => (
                      <div key={i}>
                        <div className="row micro" style={{ marginBottom: 3 }}>
                          <span style={{ flex: 1 }}>{c.name}</span>
                          <span className="strong" style={{ color: c.score >= 4 ? 'var(--green)' : c.score >= 3 ? 'var(--amber)' : 'var(--red)' }}>{c.score}/5</span>
                        </div>
                        <Bar value={(c.score / 5) * 100} color={c.score >= 4 ? 'var(--green)' : c.score >= 3 ? 'var(--amber)' : 'var(--red)'} />
                        <div className="micro" style={{ marginTop: 4 }}>{c.comment}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!!a.weak_sections?.length && (
                <div className="card">
                  <h3 style={{ marginBottom: 8 }}>Weak sections</h3>
                  <div className="stack tight">
                    {a.weak_sections.map((w: any, i: number) => (
                      <div key={i} style={{ padding: 10, background: 'var(--bg-sunken)', borderRadius: 8 }}>
                        <div className="body" style={{ fontStyle: 'italic', color: 'var(--ink-2)' }}>“{w.quote}”</div>
                        <div className="micro" style={{ color: 'var(--red)', marginTop: 4 }}>{w.issue}</div>
                        <div className="micro" style={{ marginTop: 2 }}>{w.fix}</div>
                        <button className="btn sm" style={{ marginTop: 7 }} disabled={improve.isPending} onClick={() => improve.mutate(w.quote)}>
                          Improve this
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid-2" style={{ gap: 10 }}>
                {!!a.strengths?.length && (
                  <div className="card">
                    <h3 style={{ marginBottom: 6, color: 'var(--green)' }}>Strengths</h3>
                    <ul className="meta" style={{ margin: 0, paddingLeft: 16 }}>{a.strengths.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul>
                  </div>
                )}
                {!!a.weaknesses?.length && (
                  <div className="card">
                    <h3 style={{ marginBottom: 6, color: 'var(--red)' }}>Weaknesses</h3>
                    <ul className="meta" style={{ margin: 0, paddingLeft: 16 }}>{a.weaknesses.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul>
                  </div>
                )}
              </div>

              {!!a.next_steps?.length && (
                <div className="card">
                  <h3 style={{ marginBottom: 6 }}>Next steps</h3>
                  <ol className="meta" style={{ margin: 0, paddingLeft: 18 }}>{a.next_steps.map((s: string, i: number) => <li key={i}>{s}</li>)}</ol>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {compare && (
        <Modal
          title="Original vs improved"
          subtitle="Your original stays exactly as you wrote it. Copy across only what you agree with."
          size="full"
          onClose={() => setCompare(null)}
          footer={
            <>
              <button className="btn" onClick={() => setCompare(null)}>Close</button>
              <div className="spacer" />
              <button className="btn" onClick={() => { navigator.clipboard?.writeText(compare.improved); toast('Improved version copied', 'success') }}>
                Copy improved
              </button>
              <button className="btn primary" onClick={async () => {
                if (!(await dialogs.confirm('Replace this paragraph?', 'Your original stays in the improvement history, so you can always get it back.'))) return
                setBody((b) => b.replace(compare.original, compare.improved))
                setDirty(true)
                setCompare(null)
                toast('Paragraph replaced in your response', 'success')
              }}>Use improved version</button>
            </>
          }
        >
          <div className="grid-2" style={{ gap: 14 }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>MY ORIGINAL</div>
              <div className="body pre-wrap" style={{ padding: 12, background: 'var(--bg-sunken)', borderRadius: 8, lineHeight: 1.65 }}>{compare.original}</div>
            </div>
            <div>
              <div className="eyebrow" style={{ marginBottom: 6, color: 'var(--blue)' }}>IMPROVED</div>
              <div className="body pre-wrap" style={{ padding: 12, background: 'var(--blue-wash)', borderRadius: 8, lineHeight: 1.65 }}>{compare.improved}</div>
            </div>
          </div>
          {!!compare.changes?.length && (
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>WHAT CHANGED</div>
              <div className="stack tight">
                {compare.changes.map((c: any, i: number) => (
                  <div className="body" key={i}><strong>{c.what}</strong> <span className="ink-3">— {c.why}</span></div>
                ))}
              </div>
            </div>
          )}
          {compare.kept && <div className="notice ok"><Icon name="check" size={14} /><div>{compare.kept}</div></div>}
        </Modal>
      )}
    </div>
  )
}
