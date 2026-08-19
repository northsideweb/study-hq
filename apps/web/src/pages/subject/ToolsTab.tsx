import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { api, fmtDate } from '../../lib/api'
import { Icon } from '../../components/Icons'
import { Modal, Field, Empty, Tabs, useToast, useDialogs, SectionHead } from '../../components/ui'
import GenerateModal from '../GenerateModal'
import BankPanel, { BANKS } from './BankPanel'

type Tool = { label: string; kind: 'practice' | 'flashcards'; qtype?: string; cardKind?: string; instructions: string; icon: string }

const TOOLS: Record<string, Tool[]> = {
  english: [
    { label: 'Essay practice', icon: 'note', kind: 'practice', qtype: 'essay', instructions: 'Full HSC-style essay questions on the texts and modules in my material, with a marking guide covering understanding of text, textual evidence and techniques, response to the question, and control of language.' },
    { label: 'Paragraph practice', icon: 'list', kind: 'practice', qtype: 'extended_response', instructions: 'Ask for a single analytical paragraph (PEEL/TEEL). The marking guide should assess topic sentence, evidence, technique analysis and link to the question.' },
    { label: 'Unseen texts', icon: 'file', kind: 'practice', qtype: 'short_answer', instructions: 'Provide a short unseen text in the stimulus field, then ask 1-3 mark comprehension and technique questions about it, HSC Paper 1 style.' },
    { label: 'Thesis practice', icon: 'target', kind: 'practice', qtype: 'short_answer', instructions: 'Give an essay question and ask me to write only a thesis statement. Mark it on precision, argument and direct engagement with the question.' },
    { label: 'Topic sentences', icon: 'pencil', kind: 'practice', qtype: 'short_answer', instructions: 'Give an essay question and ask me to write three topic sentences that would structure the response. Assess argument progression.' },
    { label: 'Evidence finder', icon: 'search', kind: 'practice', qtype: 'short_answer', instructions: 'Give a thematic statement about one of my texts and ask me to supply the quote and technique that proves it. Use only quotes present in my material.' },
    { label: 'Essay planning', icon: 'grid', kind: 'practice', qtype: 'extended_response', instructions: 'Give an essay question and ask for a detailed plan only: thesis, three body paragraph arguments, evidence/techniques and links to the module rubric.' },
  ],
  maths: [
    { label: 'Skill practice', icon: 'sigma', kind: 'practice', qtype: 'short_answer', instructions: 'Computational questions with full step-by-step working. Vary numbers and contexts every time.' },
    { label: 'Exam-style questions', icon: 'clock', kind: 'practice', qtype: 'exam_question', instructions: 'HSC Mathematics Standard exam-style questions with mark allocations and full worked solutions.' },
    { label: 'Multi-step problems', icon: 'target', kind: 'practice', qtype: 'scenario', instructions: 'Multi-step real-world problems (finance, measurement, statistics) requiring several calculations. Show all working.' },
    { label: 'Multiple choice drill', icon: 'check', kind: 'practice', qtype: 'multiple_choice', instructions: 'Exam-style multiple choice with distractors based on common errors, explaining each distractor in the marking guide.' },
    { label: 'Formula cards', icon: 'cards', kind: 'flashcards', cardKind: 'definition', instructions: 'Front = what I need to calculate. Back = the formula, what each symbol means, and a worked example.' },
  ],
  music: [
    { label: 'Concepts of music', icon: 'music', kind: 'practice', qtype: 'explain', instructions: 'Questions on duration, pitch, dynamics and expressive techniques, tone colour, texture and structure, applied to the repertoire in my material.' },
    { label: 'Musicology', icon: 'book', kind: 'practice', qtype: 'discuss', instructions: 'Musicology questions on style, context, composer and genre relating to my topics.' },
    { label: 'Theory', icon: 'sigma', kind: 'practice', qtype: 'short_answer', instructions: 'Music theory: key signatures, intervals, chords, rhythm, notation and transposition. Show workings.' },
    { label: 'Listening analysis', icon: 'eye', kind: 'practice', qtype: 'extended_response', instructions: 'Extended listening-response questions in HSC Music 1 style with a described excerpt and a marking guide.' },
    { label: 'Composition prompts', icon: 'pencil', kind: 'practice', qtype: 'scenario', instructions: 'Composition tasks with clear constraints (instrumentation, length, concepts to feature) and criteria for evaluating the result.' },
    { label: 'Performance prep', icon: 'flag', kind: 'practice', qtype: 'explain', instructions: 'Questions about my performance repertoire: interpretation, technical demands, stylistic conventions and rehearsal strategy.' },
  ],
  dt: [
    { label: 'Theory questions', icon: 'compass', kind: 'practice', qtype: 'short_answer', instructions: 'Design and Technology theory questions from my material.' },
    { label: 'Design process', icon: 'refresh', kind: 'practice', qtype: 'explain', instructions: 'Questions on the design process: identifying needs, research, ideation, development, production, evaluation.' },
    { label: 'Materials', icon: 'grid', kind: 'practice', qtype: 'analyse', instructions: 'Questions on material properties, selection and justification for particular applications.' },
    { label: 'Technologies', icon: 'settings', kind: 'practice', qtype: 'explain', instructions: 'Questions on tools, equipment, techniques and emerging technologies in designing and producing.' },
    { label: 'Case studies', icon: 'folder', kind: 'practice', qtype: 'case_study', instructions: 'Case study questions on designers, innovation and the impact of design on society and the environment.' },
    { label: 'Evaluation', icon: 'check', kind: 'practice', qtype: 'evaluate', instructions: 'Evaluation questions requiring judgement against criteria, with a marking guide.' },
  ],
  legal: [
    { label: 'Define', icon: 'book', kind: 'practice', qtype: 'definition', instructions: 'Define key legal terms from my material precisely.' },
    { label: 'Describe / Explain', icon: 'pencil', kind: 'practice', qtype: 'explain', instructions: 'Describe and explain questions using the NESA glossary, 3-5 marks each.' },
    { label: 'Analyse / Discuss', icon: 'scale', kind: 'practice', qtype: 'discuss', instructions: 'Analyse and discuss questions requiring legal cases, legislation and media examples, 5-8 marks.' },
    { label: 'Assess / Evaluate', icon: 'target', kind: 'practice', qtype: 'evaluate', instructions: 'Assess and evaluate questions about the effectiveness of the legal system, requiring a judgement supported by legislation, cases and media.' },
    { label: 'Case study', icon: 'folder', kind: 'practice', qtype: 'case_study', instructions: 'Give a legal scenario in the stimulus, then ask questions applying the relevant law to it.' },
    { label: 'Extended response', icon: 'note', kind: 'practice', qtype: 'extended_response', instructions: 'Extended response questions worth 15 marks with a full marking guide and criteria bands.' },
  ],
  business: [
    { label: 'Definitions', icon: 'book', kind: 'practice', qtype: 'definition', instructions: 'Define key business terms precisely, using my notes.' },
    { label: 'Multiple choice', icon: 'check', kind: 'practice', qtype: 'multiple_choice', instructions: 'HSC-style multiple choice with plausible distractors.' },
    { label: 'Short answer', icon: 'pencil', kind: 'practice', qtype: 'short_answer', instructions: 'Short answer questions worth 2-4 marks.' },
    { label: '6-mark questions', icon: 'list', kind: 'practice', qtype: 'extended_response', instructions: 'Questions worth exactly 6 marks, with a marking guide showing what earns each mark band.' },
    { label: '10-mark questions', icon: 'grid', kind: 'practice', qtype: 'extended_response', instructions: 'Questions worth exactly 10 marks requiring business examples and a sustained response, with a marking guide.' },
    { label: 'Case studies', icon: 'folder', kind: 'practice', qtype: 'case_study', instructions: 'Provide a business case study in the stimulus field, then ask questions requiring application to that business.' },
    { label: 'Command terms', icon: 'flag', kind: 'practice', qtype: 'mixed', instructions: 'Drill NESA command terms — outline, describe, explain, analyse, assess, evaluate — one question per term, each with a marking guide showing what the verb demands.' },
    { label: 'Essay practice', icon: 'note', kind: 'practice', qtype: 'essay', instructions: 'Full business essay questions requiring real Australian business examples, with a marking guide.' },
  ],
  generic: [
    { label: 'Mixed practice', icon: 'pencil', kind: 'practice', qtype: 'mixed', instructions: 'A spread of question types appropriate to this course.' },
    { label: 'Definitions', icon: 'book', kind: 'practice', qtype: 'definition', instructions: 'Define the key terms in my material.' },
    { label: 'Extended response', icon: 'note', kind: 'practice', qtype: 'extended_response', instructions: 'Extended response questions with marking guides.' },
  ],
}

const BANKS_FOR: Record<string, string[]> = {
  english: ['quote', 'technique', 'theme', 'character'],
  legal: ['case', 'legislation', 'contemporary', 'principle', 'definition'],
  business: ['business_example', 'definition', 'contemporary'],
  dt: ['material', 'project', 'definition'],
  music: ['definition'],
  maths: ['definition'],
  generic: ['definition'],
}

const WRITING_SUBJECTS = ['english', 'legal', 'business', 'generic', 'dt']

const AURAL_FOCUS = [
  'Identify the texture', 'Identify tone colour and instrumentation', 'Identify dynamics and expressive techniques',
  'Identify the structure', 'Identify articulation', 'Describe the rhythm and metre', 'Analyse the melody',
  'Analyse the harmony', 'Analyse duration', 'Analyse how the concepts interact',
]

export default function ToolsTab({ subjectId, kind, subjectName }: { subjectId: string; kind: string; subjectName: string }) {
  const navigate = useNavigate()
  const toast = useToast()
  const [tab, setTab] = useState('tools')
  const [tool, setTool] = useState<Tool | null>(null)
  const [own, setOwn] = useState<any>(null)
  const [aural, setAural] = useState<string | null>(null)

  const tools = TOOLS[kind] || TOOLS.generic
  const banks = BANKS_FOR[kind] || BANKS_FOR.generic

  const { data: essays, refetch: refetchEssays } = useQuery({
    queryKey: ['essays', subjectId], queryFn: () => api.get(`/essays?subject_id=${subjectId}`),
  })

  const createEssay = useMutation({
    mutationFn: () => api.post('/essays', { subject_id: subjectId, title: 'New response' }),
    onSuccess: (e: any) => navigate(`/essays/${e.id}`),
    onError: (e: any) => toast(e.message, 'error'),
  })

  const createOwn = useMutation({
    mutationFn: () => api.post('/practice/custom-question', {
      subject_id: subjectId, prompt: own.prompt, marks: own.marks, marking_guide: own.guide, qtype: 'extended_response',
    }),
    onSuccess: (r: any) => { setOwn(null); navigate(`/practice/${r.set_id}`) },
    onError: (e: any) => toast(e.message, 'error'),
  })

  const tabs = [
    { id: 'tools', label: 'Practice tools' },
    ...(WRITING_SUBJECTS.includes(kind) ? [{ id: 'writing', label: 'Writing' }] : []),
    ...(kind === 'music' ? [{ id: 'aural', label: 'Aural trainer' }] : []),
    ...banks.map((b) => ({ id: `bank:${b}`, label: BANKS[b].label })),
  ]

  return (
    <div className="stack" style={{ gap: 14 }}>
      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'tools' && (
        <div className="stack" style={{ gap: 14 }}>
          <SectionHead title={`${subjectName} practice tools`} sub="Each one generates questions from your own material by default." />
          <div className="grid-3">
            {tools.map((t) => (
              <button key={t.label} className="card link" style={{ textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'pointer' }} onClick={() => setTool(t)}>
                <div className="row" style={{ marginBottom: 5 }}>
                  <Icon name={t.icon} size={15} style={{ color: 'var(--blue)' }} />
                  <span className="strong body">{t.label}</span>
                </div>
                <div className="micro ink-3 clamp2">{t.instructions}</div>
              </button>
            ))}
          </div>

          <div className="card">
            <SectionHead title="Use my own question" sub="Paste a question your teacher set, answer it, and have it marked against HSC criteria." />
            <button className="btn primary" onClick={() => setOwn({ prompt: '', marks: 15, guide: '' })}>
              <Icon name="plus" size={14} /> Add a question
            </button>
          </div>
        </div>
      )}

      {tab === 'writing' && (
        <div className="stack" style={{ gap: 12 }}>
          <SectionHead
            title="Writing workspace"
            sub="Write, paste or upload a response — then get structure, argument, evidence and terminology feedback, and improve it paragraph by paragraph."
            action={<button className="btn primary" onClick={() => createEssay.mutate()}><Icon name="plus" size={14} /> New response</button>}
          />
          {!essays?.length ? (
            <Empty title="No responses yet"
              message="Start a response, or import an essay you have already written as a Word document, PDF or photo of handwriting."
              action={<button className="btn sm primary" onClick={() => createEssay.mutate()}>New response</button>} />
          ) : (
            <div className="rows">
              {essays.map((e: any) => (
                <div className="row-item link" key={e.id} onClick={() => navigate(`/essays/${e.id}`)}>
                  <Icon name="note" size={14} className="ink-3" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="body strong truncate">{e.title}</div>
                    <div className="micro ink-4 truncate">{e.question || 'No question set'} · {e.length || 0} characters</div>
                  </div>
                  {e.analysed ? <span className="tag green pill">Marked</span> : <span className="tag pill">Draft</span>}
                  <span className="micro">{fmtDate(e.updated_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'aural' && (
        <div className="stack" style={{ gap: 12 }}>
          <SectionHead title="Aural trainer" sub="Each question describes an excerpt in technical detail, then asks you to analyse it against the concepts of music." />
          <div className="notice info">
            <Icon name="music" size={15} />
            <div>Audio can't be generated, so excerpts are described precisely in words. Upload your own listening material in Uploads and it will be used as the source.</div>
          </div>
          <div className="grid-3">
            {AURAL_FOCUS.map((f) => (
              <button key={f} className="card link" style={{ textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'pointer' }} onClick={() => setAural(f)}>
                <div className="row"><Icon name="music" size={14} style={{ color: 'var(--blue)' }} /><span className="strong">{f}</span></div>
              </button>
            ))}
          </div>
        </div>
      )}

      {tab.startsWith('bank:') && <BankPanel subjectId={subjectId} spec={BANKS[tab.slice(5)]} />}

      {tool && (
        <GenerateModal kind={tool.kind} subjectId={subjectId} title={tool.label} instructions={tool.instructions}
          presetQtype={tool.qtype} presetCardKind={tool.cardKind} onClose={() => setTool(null)} />
      )}

      {aural && (
        <GenerateModal kind="practice" subjectId={subjectId} title={`Aural: ${aural}`} presetQtype="analyse"
          instructions={`Aural analysis practice. Focus: ${aural}. Describe a specific musical excerpt in vivid technical detail in the stimulus field (instrumentation, tempo, metre, dynamics, articulation, texture, structure), then ask the student to analyse it. Vary style and period between questions.`}
          onClose={() => setAural(null)} />
      )}

      {own && (
        <Modal
          title="Use my own question"
          subtitle="Study HQ marks your response against the criteria and explains how to improve."
          onClose={() => setOwn(null)}
          footer={
            <>
              <button className="btn" onClick={() => setOwn(null)}>Cancel</button>
              <button className="btn primary" disabled={!own.prompt.trim() || createOwn.isPending} onClick={() => createOwn.mutate()}>
                {createOwn.isPending ? 'Creating…' : 'Start answering'}
              </button>
            </>
          }
        >
          <Field label="The question"><textarea rows={4} autoFocus value={own.prompt} onChange={(e) => setOwn({ ...own, prompt: e.target.value })} /></Field>
          <Field label="Marks"><input type="number" min={1} max={40} value={own.marks} onChange={(e) => setOwn({ ...own, marks: Number(e.target.value) })} /></Field>
          <Field label="Marking criteria (optional)" hint="Paste your teacher's rubric and marking will follow it.">
            <textarea rows={4} value={own.guide} onChange={(e) => setOwn({ ...own, guide: e.target.value })} />
          </Field>
        </Modal>
      )}
    </div>
  )
}
