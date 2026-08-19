import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, WORK_TYPES } from '../lib/api'
import { Icon } from '../components/Icons'
import { Modal, Field, useToast, SectionHead } from '../components/ui'
import UploadList from '../components/UploadList'

type Method = 'photo' | 'files' | 'paste' | 'batch'

const METHODS: Array<{ id: Method; icon: string; title: string; blurb: string }> = [
  { id: 'photo', icon: 'camera', title: 'Take photo', blurb: 'Photograph handwritten notes or work. The handwriting is read with OCR and the original photo is kept.' },
  { id: 'files', icon: 'file', title: 'Upload files', blurb: 'PDF, DOCX, PPTX, TXT and images. Text is extracted so questions can be built from it.' },
  { id: 'paste', icon: 'clipboard', title: 'Paste text', blurb: 'Notes, teacher instructions, questions or essays — pasted straight into your knowledge base.' },
  { id: 'batch', icon: 'files', title: 'Import multiple', blurb: 'Drop a whole folder of files or photos at once and sort them afterwards.' },
]

export default function UploadPage() {
  const [params] = useSearchParams()
  const qc = useQueryClient()
  const toast = useToast()

  const { data: profile } = useQuery({ queryKey: ['profile'], queryFn: () => api.get('/profile') })
  const { data: subjects } = useQuery({ queryKey: ['subjects'], queryFn: () => api.get('/subjects') })

  const [method, setMethod] = useState<Method>((params.get('method') as Method) || 'photo')
  const [meta, setMeta] = useState<any>({
    subject_id: params.get('subject') || '', topic_id: '', subtopic: '', title: '',
    work_type: 'Class Notes', teacher: '', school: '', work_date: new Date().toISOString().slice(0, 10),
    year_level: 11, term: 3,
  })
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [progress, setProgress] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [camera, setCamera] = useState(false)
  // getUserMedia only works on https or localhost. On a phone reaching this over the
  // local network we must use the device camera through a file input instead.
  const liveCameraAvailable =
    typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia
  const [review, setReview] = useState<any>(null)

  useEffect(() => {
    if (profile) setMeta((m: any) => ({ ...m, year_level: profile.year_level, term: profile.term, school: m.school || profile.school || '' }))
  }, [profile])

  const { data: topics } = useQuery({
    queryKey: ['topics', meta.subject_id], queryFn: () => api.get(`/topics?subject_id=${meta.subject_id}`), enabled: !!meta.subject_id,
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['uploads'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
    qc.invalidateQueries({ queryKey: ['subjects'] })
  }

  const savePaste = useMutation({
    mutationFn: () => api.post('/uploads/paste', { ...meta, text, source: 'paste', title: meta.title || firstLine(text) }),
    onSuccess: () => { invalidate(); setText(''); setMeta((m: any) => ({ ...m, title: '' })); toast('Saved to your knowledge base', 'success') },
    onError: (e: any) => toast(e.message, 'error'),
  })

  const uploadFiles = useMutation({
    mutationFn: async (list: File[]) => {
      const form = new FormData()
      list.forEach((f) => form.append('files', f))
      Object.entries(meta).forEach(([k, v]) => form.append(k, String(v)))
      form.append('source', list.every((f) => f.type.startsWith('image/')) ? 'photo' : 'file')
      return api.upload('/uploads', form, setProgress)
    },
    onSuccess: (res: any) => {
      invalidate()
      setFiles([])
      setProgress(null)
      toast(`${res.ids.length} file${res.ids.length === 1 ? '' : 's'} uploaded — reading the text now.`, 'success')
      if (res.ids.length > 1) qc.invalidateQueries({ queryKey: ['uploads'] })
      // Single photo → open the review step so the OCR text can be checked and filed.
      if (res.ids.length === 1) setReview({ id: res.ids[0] })
    },
    onError: (e: any) => { setProgress(null); toast(e.message, 'error', 'Upload failed') },
  })

  const capture = (blob: Blob) => {
    const file = new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' })
    setCamera(false)
    uploadFiles.mutate([file])
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="display">Add school work</h1>
          <div className="lead" style={{ marginTop: 7 }}>What would you like to add?</div>
        </div>
      </div>

      <div className="grid-2" style={{ gap: 12, marginBottom: 48 }}>
        {METHODS.map((m) => (
          <button key={m.id} className={`choice ${method === m.id ? 'on' : ''}`} onClick={() => setMethod(m.id)}>
            <span className="ico"><Icon name={m.icon} size={18} /></span>
            <span style={{ minWidth: 0 }}>
              <span className="body" style={{ display: 'block', fontWeight: 550 }}>{m.title}</span>
              <span className="meta" style={{ display: 'block', marginTop: 3, lineHeight: 1.5 }}>{m.blurb}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="split">
        <div className="section" style={{ marginBottom: 0 }}>
          {method === 'paste' && (
            <div className="stack">
              <SectionHead title="Paste text" sub="Notes, teacher explanations, questions, homework, essay plans, feedback." />
              <textarea rows={15} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste anything here…" />
              <div className="row">
                <span className="micro">{text.length.toLocaleString()} characters</span>
                <div className="spacer" />
                <button className="btn primary" disabled={!text.trim() || savePaste.isPending} onClick={() => savePaste.mutate()}>
                  {savePaste.isPending ? <><span className="spinner" /> Saving…</> : 'Save to Study HQ'}
                </button>
              </div>
            </div>
          )}

          {method === 'photo' && (
            <div className="stack">
              <SectionHead title="Take a photo" sub="Best for handwritten notes, worksheets and whiteboards." />

              {liveCameraAvailable ? (
                <div className="dropzone" onClick={() => setCamera(true)} style={{ padding: 34 }}>
                  <Icon name="camera" size={28} style={{ color: 'var(--blue)' }} />
                  <div className="strong" style={{ marginTop: 8 }}>Open camera</div>
                  <div className="meta" style={{ maxWidth: 380, margin: '4px auto 0' }}>
                    Study HQ reads the handwriting, keeps the original photo, and lets you fix anything it got wrong before saving.
                  </div>
                </div>
              ) : (
                <label className="dropzone" style={{ padding: 34, display: 'block', cursor: 'pointer' }}>
                  <Icon name="camera" size={28} style={{ color: 'var(--blue)' }} />
                  <div className="strong" style={{ marginTop: 8 }}>Take a photo</div>
                  <div className="meta" style={{ maxWidth: 380, margin: '4px auto 0' }}>
                    Opens your camera. Study HQ reads the handwriting, keeps the original photo, and lets you
                    fix anything it got wrong before saving.
                  </div>
                  <input
                    type="file" hidden accept="image/*" capture="environment"
                    onChange={(e) => e.target.files?.length && uploadFiles.mutate(Array.from(e.target.files))}
                  />
                </label>
              )}

              <label className="btn block" style={{ cursor: 'pointer' }}>
                <Icon name="image" size={14} /> Choose from photo library
                <input type="file" hidden multiple accept="image/*"
                  onChange={(e) => e.target.files?.length && uploadFiles.mutate(Array.from(e.target.files))} />
              </label>
            </div>
          )}

          {(method === 'files' || method === 'batch') && (
            <div className="stack">
              <SectionHead
                title={method === 'batch' ? 'Import multiple' : 'Upload files'}
                sub={method === 'batch' ? 'Drop as many files or photos as you like — sort them afterwards.' : 'PDF · DOCX · PPTX · TXT · JPG · PNG · screenshots'}
              />
              <label
                className={`dropzone ${dragOver ? 'over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); setFiles((f) => [...f, ...Array.from(e.dataTransfer.files)]) }}
                style={{ display: 'block', cursor: 'pointer' }}
              >
                <input type="file" hidden multiple accept=".pdf,.docx,.pptx,.txt,.md,.csv,image/*"
                  onChange={(e) => setFiles((f) => [...f, ...Array.from(e.target.files || [])])} />
                <Icon name={method === 'batch' ? 'files' : 'upload'} size={26} style={{ color: 'var(--blue)' }} />
                <div className="strong" style={{ marginTop: 8 }}>Drop files here, or click to browse</div>
                <div className="meta">Originals are always kept and stay downloadable</div>
              </label>

              {!!files.length && (
                <div className="rows">
                  {files.map((f, i) => (
                    <div className="row-item" key={i}>
                      <Icon name={f.type.startsWith('image/') ? 'image' : 'file'} size={14} className="ink-3" />
                      <span className="body truncate" style={{ flex: 1 }}>{f.name}</span>
                      <span className="micro">{(f.size / 1024).toFixed(0)} KB</span>
                      <button className="btn quiet sm icon" onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}><Icon name="x" size={12} /></button>
                    </div>
                  ))}
                </div>
              )}

              {progress !== null && (
                <div>
                  <div className="row micro ink-4" style={{ marginBottom: 4 }}><span>Uploading…</span><div className="spacer" /><span>{progress}%</span></div>
                  <div className="progress"><div style={{ width: `${progress}%` }} /></div>
                </div>
              )}

              <button className="btn primary block" disabled={!files.length || uploadFiles.isPending} onClick={() => uploadFiles.mutate(files)}>
                {uploadFiles.isPending ? <><span className="spinner" /> Uploading…</> : `Upload ${files.length || ''} file${files.length === 1 ? '' : 's'}`}
              </button>
            </div>
          )}
        </div>

        <div className="section" style={{ marginBottom: 0 }}>
          <SectionHead title="Details" sub="Applied to what you add now. Everything stays editable." />
          <div className="stack" style={{ gap: 10 }}>
            <Field label="Subject">
              <select value={meta.subject_id} onChange={(e) => setMeta({ ...meta, subject_id: e.target.value, topic_id: '' })}>
                <option value="">Unassigned — sort it later</option>
                {(subjects || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Topic">
              <select value={meta.topic_id} onChange={(e) => setMeta({ ...meta, topic_id: e.target.value })} disabled={!meta.subject_id}>
                <option value="">No topic</option>
                {(topics || []).map((t: any) => <option key={t.id} value={t.id}>{t.scope === 'school' ? '● ' : ''}{t.name}</option>)}
              </select>
            </Field>
            <Field label="Type">
              <select value={meta.work_type} onChange={(e) => setMeta({ ...meta, work_type: e.target.value })}>
                {WORK_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Subtopic"><input value={meta.subtopic} onChange={(e) => setMeta({ ...meta, subtopic: e.target.value })} placeholder="optional" /></Field>
            <Field label="Title"><input value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} placeholder="Auto-filled if left blank" /></Field>
            <div className="row" style={{ gap: 8 }}>
              <Field label="Year"><input type="number" value={meta.year_level} onChange={(e) => setMeta({ ...meta, year_level: Number(e.target.value) })} /></Field>
              <Field label="Term"><input type="number" min={1} max={4} value={meta.term} onChange={(e) => setMeta({ ...meta, term: Number(e.target.value) })} /></Field>
            </div>
            <Field label="Teacher"><input value={meta.teacher} onChange={(e) => setMeta({ ...meta, teacher: e.target.value })} placeholder="optional" /></Field>
            <Field label="Date"><input type="date" value={meta.work_date} onChange={(e) => setMeta({ ...meta, work_date: e.target.value })} /></Field>
          </div>
        </div>
      </div>

      <section className="section" style={{ marginTop: 56 }}>
        <SectionHead title="Everything I've added" />
        <UploadList />
      </section>

      {camera && <CameraModal onCapture={capture} onClose={() => setCamera(false)} />}
      {review && <OcrReview uploadId={review.id} onClose={() => { setReview(null); invalidate() }} />}
    </div>
  )
}

function firstLine(t: string) {
  const line = t.split(/\r?\n/).find((l) => l.trim().length > 3) || 'Pasted note'
  return line.trim().slice(0, 70)
}

/** After a photo upload: show progress, then the extracted text for checking and filing. */
function OcrReview({ uploadId, onClose }: { uploadId: string; onClose: () => void }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [item, setItem] = useState<any>(null)
  const [stage, setStage] = useState('Reading your work…')
  const [pct, setPct] = useState(0)

  const { data: subjects } = useQuery({ queryKey: ['subjects'], queryFn: () => api.get('/subjects') })
  const { data: topics } = useQuery({
    queryKey: ['topics', item?.subject_id], queryFn: () => api.get(`/topics?subject_id=${item?.subject_id}`), enabled: !!item?.subject_id,
  })

  useEffect(() => {
    let alive = true
    const poll = async () => {
      try {
        const p = await api.get(`/uploads/${uploadId}/progress`)
        if (!alive) return
        setPct(p.pct ?? 0)
        setStage(p.stage || 'Reading…')
        if (p.status === 'pending') return setTimeout(poll, 1200)
        setItem(await api.get(`/uploads/${uploadId}`))
      } catch { /* stop polling */ }
    }
    poll()
    return () => { alive = false }
  }, [uploadId])

  const save = useMutation({
    mutationFn: () => api.put(`/uploads/${uploadId}`, item),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['uploads'] })
      const subject = subjects?.find((s: any) => s.id === item.subject_id)?.name
      const topic = topics?.find((t: any) => t.id === item.topic_id)?.name
      toast(subject ? `Added to ${subject}${topic ? ` → ${topic}` : ''}` : 'Saved to Study HQ', 'success')
      onClose()
    },
    onError: (e: any) => toast(e.message, 'error'),
  })

  return (
    <Modal
      title={item ? 'Check the extracted text' : 'Reading your work…'}
      subtitle={item ? 'Fix anything the OCR got wrong, then file it. The original photo is kept either way.' : undefined}
      size="wide"
      onClose={onClose}
      footer={item ? (
        <>
          <button className="btn" onClick={onClose}>Skip for now</button>
          <div className="spacer" />
          <button className="btn primary" onClick={() => save.mutate()} disabled={save.isPending}>Save to Study HQ</button>
        </>
      ) : undefined}
    >
      {!item ? (
        <div className="stack" style={{ padding: '10px 0' }}>
          <div className="row" style={{ gap: 9 }}><span className="spinner" /> <span className="body">{stage}</span></div>
          <div className="progress"><div style={{ width: `${pct}%` }} /></div>
        </div>
      ) : (
        <>
          {item.extract_status !== 'ok' && (
            <div className="notice warn">
              <Icon name="alert" size={14} />
              <div>{item.extract_error || 'No text could be read.'} You can type the text in yourself below.</div>
            </div>
          )}
          <div className="grid-2" style={{ gap: 12 }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 5 }}>ORIGINAL</div>
              <img src={`/api/uploads/${uploadId}/file`} alt="Uploaded work"
                style={{ width: '100%', maxHeight: 300, objectFit: 'contain', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--bg-sunken)' }} />
            </div>
            <Field label="Extracted text">
              <textarea rows={13} value={item.extracted_text || ''} onChange={(e) => setItem({ ...item, extracted_text: e.target.value })} />
            </Field>
          </div>
          <div className="grid-2" style={{ gap: 10 }}>
            <Field label="Subject">
              <select value={item.subject_id || ''} onChange={(e) => setItem({ ...item, subject_id: e.target.value || null, topic_id: null })}>
                <option value="">Unassigned</option>
                {(subjects || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Topic">
              <select value={item.topic_id || ''} onChange={(e) => setItem({ ...item, topic_id: e.target.value || null })} disabled={!item.subject_id}>
                <option value="">No topic</option>
                {(topics || []).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="Type">
              <select value={item.work_type} onChange={(e) => setItem({ ...item, work_type: e.target.value })}>
                {WORK_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Date"><input type="date" value={(item.work_date || '').slice(0, 10)} onChange={(e) => setItem({ ...item, work_date: e.target.value })} /></Field>
          </div>
        </>
      )}
    </Modal>
  )
}

function CameraModal({ onCapture, onClose }: { onCapture: (b: Blob) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    let cancelled = false
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 2560 }, height: { ideal: 1440 } } })
      .then((stream) => {
        if (cancelled) return stream.getTracks().forEach((t) => t.stop())
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play().then(() => setReady(true)).catch(() => setReady(true))
        }
      })
      .catch((e) => setError(e?.message || 'Could not access the camera.'))
    return () => { cancelled = true; streamRef.current?.getTracks().forEach((t) => t.stop()) }
  }, [])

  const shoot = () => {
    const video = videoRef.current
    if (!video) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')!.drawImage(video, 0, 0)
    canvas.toBlob((b) => b && onCapture(b), 'image/jpeg', 0.94)
  }

  return (
    <Modal
      title="Photograph your work"
      subtitle="Fill the frame with the page and keep it flat — that gives the OCR the best chance."
      size="wide"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!ready} onClick={shoot}><Icon name="camera" size={14} /> Capture</button>
        </>
      }
    >
      {error ? (
        <div className="stack">
          <div className="notice error">
            <Icon name="alert" size={15} />
            <div>
              <div className="strong">Live preview unavailable</div>
              <div>{error}</div>
              <div className="body" style={{ marginTop: 5 }}>
                You can still use your device camera — it works exactly the same.
              </div>
            </div>
          </div>
          <label className="btn primary block" style={{ cursor: 'pointer' }}>
            <Icon name="camera" size={15} /> Use my device camera
            <input
              type="file" hidden accept="image/*" capture="environment"
              onChange={(e) => e.target.files?.[0] && onCapture(e.target.files[0])}
            />
          </label>
        </div>
      ) : (
        <div style={{ position: 'relative', background: '#000', borderRadius: 10, overflow: 'hidden' }}>
          <video ref={videoRef} playsInline muted style={{ width: '100%', display: 'block', maxHeight: '58vh', objectFit: 'contain' }} />
          {!ready && <div className="row" style={{ position: 'absolute', inset: 0, justifyContent: 'center', color: '#fff' }}><span className="spinner lg" /></div>}
        </div>
      )}
    </Modal>
  )
}
