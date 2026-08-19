import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { Icon } from '../components/Icons'
import { Loading, ErrorBox, Modal, Field, useToast, useDialogs } from '../components/ui'
import GenerateModal from './GenerateModal'

const cmd = (name: string, value?: string) => document.execCommand(name, false, value)

export default function NoteEditor() {
  const { noteId } = useParams<{ noteId: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const dialogs = useDialogs()
  const qc = useQueryClient()
  const editorRef = useRef<HTMLDivElement>(null)

  const [title, setTitle] = useState('')
  const [subtopic, setSubtopic] = useState('')
  const [topicId, setTopicId] = useState('')
  const [dirty, setDirty] = useState(false)
  const [aiOutput, setAiOutput] = useState<{ tool: string; text: string } | null>(null)
  const [generate, setGenerate] = useState<'practice' | 'flashcards' | null>(null)
  const loaded = useRef(false)

  const { data: current, isLoading, error, refetch } = useQuery({
    queryKey: ['note', noteId],
    queryFn: () => api.get(`/notes/${noteId}`),
    enabled: !!noteId,
  })
  const { data: subjects } = useQuery({ queryKey: ['subjects'], queryFn: () => api.get('/subjects') })
  const { data: topics } = useQuery({
    queryKey: ['topics', current?.subject_id],
    queryFn: () => api.get(`/topics?subject_id=${current?.subject_id}`),
    enabled: !!current?.subject_id,
  })
  const { data: tools } = useQuery({ queryKey: ['note-tools'], queryFn: () => api.get('/note-tools') })

  useEffect(() => {
    if (!current || loaded.current) return
    loaded.current = true
    setTitle(current.title)
    setSubtopic(current.subtopic || '')
    setTopicId(current.topic_id || '')
    if (editorRef.current) editorRef.current.innerHTML = current.body || ''
  }, [current])

  const save = useMutation({
    mutationFn: () => api.put(`/notes/${noteId}`, {
      title, subtopic, topic_id: topicId || null, body: editorRef.current?.innerHTML || '', format: 'html',
    }),
    onSuccess: () => {
      setDirty(false)
      qc.invalidateQueries({ queryKey: ['notes'] })
      qc.invalidateQueries({ queryKey: ['note', noteId] })
    },
    onError: (e: any) => toast(e.message, 'error'),
  })

  // Autosave two seconds after typing stops.
  useEffect(() => {
    if (!dirty) return
    const t = setTimeout(() => save.mutate(), 2000)
    return () => clearTimeout(t)
  }, [dirty, title, subtopic, topicId])

  const runTool = useMutation({
    mutationFn: (tool: string) => api.post(`/notes/${noteId}/tool`, { tool }),
    onSuccess: (r, tool) => setAiOutput({ tool, text: r.output }),
    onError: (e: any) => toast(e.message, 'error', 'AI tool failed'),
  })

  const insertImage = async (file: File) => {
    const form = new FormData()
    form.append('files', file)
    if (current?.subject_id) form.append('subject_id', current.subject_id)
    form.append('work_type', 'Class Notes')
    form.append('title', file.name)
    try {
      const res = await api.upload('/uploads', form)
      cmd('insertHTML', `<img src="/api/uploads/${res.ids[0]}/file" alt="${file.name}" />`)
      setDirty(true)
      toast('Image attached (original kept in Uploads)', 'success')
    } catch (e: any) { toast(e.message, 'error') }
  }

  const insertTable = () => {
    const rows = 3, cols = 3
    let html = '<table><tbody>'
    for (let r = 0; r < rows; r++) {
      html += '<tr>'
      for (let c = 0; c < cols; c++) html += r === 0 ? '<th>Heading</th>' : '<td>&nbsp;</td>'
      html += '</tr>'
    }
    html += '</tbody></table><p><br/></p>'
    cmd('insertHTML', html)
    setDirty(true)
  }

  const addLink = async () => {
    const url = await dialogs.prompt('Insert link', 'URL', 'https://')
    if (url) cmd('createLink', url)
    setDirty(true)
  }

  if (isLoading) return <Loading />
  if (error) return <ErrorBox error={error} retry={refetch} />
  if (!current) return <ErrorBox error={{ message: 'This note no longer exists.' }} />

  const T = ({ label, action, title: tip }: { label: string; action: () => void; title: string }) => (
    <button title={tip} onMouseDown={(e) => { e.preventDefault(); action(); setDirty(true) }}>{label}</button>
  )

  return (
    <div className="page wide">
      <div className="row" style={{ marginBottom: 26 }}>
        <div className="meta">
          <span style={{ cursor: 'pointer' }} onClick={() => navigate('/notes')}>Notes</span>
          <span className="ink-4"> / </span>
          <span style={{ cursor: 'pointer' }} onClick={() => current?.subject_id && navigate(`/subjects/${current.subject_id}`)}>
            {subjects?.find((s: any) => s.id === current?.subject_id)?.name || 'Subject'}
          </span>
          {topics?.find((t: any) => t.id === topicId) && (
            <><span className="ink-4"> / </span><span>{topics.find((t: any) => t.id === topicId).name}</span></>
          )}
          {subtopic && <><span className="ink-4"> / </span><span>{subtopic}</span></>}
        </div>
        <div className="spacer" />
        <span className="micro">{dirty ? 'Unsaved changes…' : save.isPending ? 'Saving…' : 'Saved'}</span>
        <button className="btn sm" onClick={() => setGenerate('flashcards')}><Icon name="cards" size={13} /> Flashcards</button>
        <button className="btn sm" onClick={() => setGenerate('practice')}><Icon name="pencil" size={13} /> Practice</button>
        <button className="btn sm primary" onClick={() => save.mutate()} disabled={save.isPending}>Save</button>
      </div>

      <div className="split">
        <div>
          <input
            value={title}
            onChange={(e) => { setTitle(e.target.value); setDirty(true) }}
            placeholder="Untitled note"
            style={{ fontSize: 30, fontWeight: 600, letterSpacing: '-0.028em', border: 'none', padding: 0, marginBottom: 14, background: 'transparent' }}
          />
          <div className="row wrap" style={{ marginBottom: 10, gap: 8 }}>
            <select value={topicId} onChange={(e) => { setTopicId(e.target.value); setDirty(true) }} style={{ width: 190 }}>
              <option value="">No topic</option>
              {(topics || []).map((t: any) => <option key={t.id} value={t.id}>{t.scope === 'school' ? '● ' : ''}{t.name}</option>)}
            </select>
            <input value={subtopic} onChange={(e) => { setSubtopic(e.target.value); setDirty(true) }} placeholder="Subtopic (optional)" style={{ width: 190 }} />
            <span className="micro">{subjects?.find((s: any) => s.id === current?.subject_id)?.name}</span>
          </div>

          <div className="editor-bar">
            <T label="H1" title="Heading 1" action={() => cmd('formatBlock', '<h1>')} />
            <T label="H2" title="Heading 2" action={() => cmd('formatBlock', '<h2>')} />
            <T label="H3" title="Heading 3" action={() => cmd('formatBlock', '<h3>')} />
            <T label="¶" title="Paragraph" action={() => cmd('formatBlock', '<p>')} />
            <span className="sep" />
            <T label="B" title="Bold" action={() => cmd('bold')} />
            <T label="I" title="Italic" action={() => cmd('italic')} />
            <T label="U" title="Underline" action={() => cmd('underline')} />
            <T label="H" title="Highlight" action={() => cmd('hiliteColor', '#fef08a')} />
            <span className="sep" />
            <T label="•" title="Bullet list" action={() => cmd('insertUnorderedList')} />
            <T label="1." title="Numbered list" action={() => cmd('insertOrderedList')} />
            <T label="❝" title="Quote" action={() => cmd('formatBlock', '<blockquote>')} />
            <T label="{ }" title="Code" action={() => cmd('formatBlock', '<pre>')} />
            <span className="sep" />
            <button title="Table" onMouseDown={(e) => { e.preventDefault(); insertTable() }}>▦</button>
            <button title="Link" onMouseDown={(e) => { e.preventDefault(); addLink() }}><Icon name="link" size={14} /></button>
            <label title="Image" style={{ display: 'grid', placeItems: 'center', minWidth: 28, height: 28, cursor: 'pointer', borderRadius: 5 }}>
              <Icon name="image" size={14} />
              <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && insertImage(e.target.files[0])} />
            </label>
            <span className="sep" />
            <T label="⌫" title="Clear formatting" action={() => cmd('removeFormat')} />
          </div>
          <div
            ref={editorRef}
            className="prose"
            style={{ minHeight: 420 }}
            contentEditable
            suppressContentEditableWarning
            data-placeholder="Start writing…"
            onInput={() => setDirty(true)}
          />
        </div>

        <div className="stack" style={{ gap: 10, position: 'sticky', top: 0 }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>AI tools</div>
            <div className="stack tight">
              {(tools || []).map((t: any) => (
                <button key={t.id} className="btn sm block" style={{ justifyContent: 'flex-start' }}
                  disabled={runTool.isPending} onClick={() => runTool.mutate(t.id)}>
                  {runTool.isPending && runTool.variables === t.id ? <span className="spinner" /> : <Icon name="sparkle" size={12} />}
                  {t.label}
                </button>
              ))}
              <div className="divider" />
              <button className="btn sm block" style={{ justifyContent: 'flex-start' }} onClick={() => setGenerate('flashcards')}>
                <Icon name="cards" size={12} /> Make flashcards
              </button>
              <button className="btn sm block" style={{ justifyContent: 'flex-start' }} onClick={() => setGenerate('practice')}>
                <Icon name="pencil" size={12} /> Make questions
              </button>
            </div>
            <div className="hint">Output opens in a panel — nothing is written into your note unless you insert it.</div>
          </div>
        </div>
      </div>

      {aiOutput && (
        <Modal
          title={aiOutput.tool.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())}
          subtitle="Generated from this note. Insert it or copy what you need."
          size="wide"
          onClose={() => setAiOutput(null)}
          footer={
            <>
              <button className="btn" onClick={() => { navigator.clipboard?.writeText(aiOutput.text); toast('Copied', 'success') }}>Copy</button>
              <div className="spacer" />
              <button className="btn" onClick={() => setAiOutput(null)}>Close</button>
              <button className="btn primary" onClick={() => {
                editorRef.current?.focus()
                cmd('insertHTML', `<hr/><h3>${aiOutput.tool.replace(/_/g, ' ')}</h3>` + mdToHtml(aiOutput.text))
                setDirty(true)
                setAiOutput(null)
                toast('Inserted at the end of your note', 'success')
              }}>Insert into note</button>
            </>
          }
        >
          <div className="prose" dangerouslySetInnerHTML={{ __html: mdToHtml(aiOutput.text) }} />
        </Modal>
      )}

      {generate && current && (
        <GenerateModal kind={generate} subjectId={current.subject_id} topicId={current.topic_id || undefined}
          instructions={`Base everything on this note titled "${current.title}".`} onClose={() => setGenerate(null)} />
      )}
    </div>
  )
}

/** Minimal markdown → HTML for AI output (headings, bold, italics, lists). */
export function mdToHtml(md: string) {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const lines = esc(md).split(/\r?\n/)
  let html = ''
  let list: 'ul' | 'ol' | null = null
  const inline = (t: string) =>
    t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
     .replace(/(^|\W)\*(?!\s)(.+?)\*(?=\W|$)/g, '$1<em>$2</em>')
     .replace(/`(.+?)`/g, '<code>$1</code>')
  const closeList = () => { if (list) { html += `</${list}>`; list = null } }
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) { closeList(); continue }
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) { closeList(); const lvl = Math.min(3, h[1].length); html += `<h${lvl}>${inline(h[2])}</h${lvl}>`; continue }
    const ul = line.match(/^[-*•]\s+(.*)$/)
    if (ul) { if (list !== 'ul') { closeList(); html += '<ul>'; list = 'ul' } html += `<li>${inline(ul[1])}</li>`; continue }
    const ol = line.match(/^\d+[.)]\s+(.*)$/)
    if (ol) { if (list !== 'ol') { closeList(); html += '<ol>'; list = 'ol' } html += `<li>${inline(ol[1])}</li>`; continue }
    if (/^>\s?/.test(line)) { closeList(); html += `<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`; continue }
    closeList()
    html += `<p>${inline(line)}</p>`
  }
  closeList()
  return html
}
