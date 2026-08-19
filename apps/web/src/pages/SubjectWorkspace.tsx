import { useState } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api, SUBJECT_KINDS, type Subject } from '../lib/api'
import { Icon } from '../components/Icons'
import { Tabs, Loading, ErrorBox, Bar } from '../components/ui'
import UploadList from '../components/UploadList'
import OverviewTab from './subject/OverviewTab'
import SyllabusTab from './subject/SyllabusTab'
import ToolsTab from './subject/ToolsTab'
import NotesPage from './NotesPage'
import FlashcardsPage from './FlashcardsPage'
import PracticePage from './PracticePage'
import ExamsPage from './ExamsPage'
import AssessmentsPage from './AssessmentsPage'
import ProgressPage from './ProgressPage'
import GenerateModal from './GenerateModal'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'syllabus', label: 'Syllabus' },
  { id: 'school', label: 'School work' },
  { id: 'notes', label: 'Notes' },
  { id: 'practice', label: 'Practice' },
  { id: 'flashcards', label: 'Flashcards' },
  { id: 'exams', label: 'Exams' },
  { id: 'assessments', label: 'Assessments' },
  { id: 'progress', label: 'Progress' },
  { id: 'tools', label: 'Tools' },
]

export default function SubjectWorkspace() {
  const { id } = useParams<{ id: string }>()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const tab = params.get('tab') || 'overview'
  const [generate, setGenerate] = useState<'practice' | 'flashcards' | null>(null)

  const { data: subject, isLoading, error, refetch } = useQuery<Subject>({
    queryKey: ['subject', id], queryFn: () => api.get(`/subjects/${id}`), enabled: !!id,
  })
  const { data: schoolTopics } = useQuery({
    queryKey: ['topics', id, 'school'], queryFn: () => api.get(`/topics?subject_id=${id}&scope=school`), enabled: !!id,
  })
  const { data: syllabus } = useQuery({
    queryKey: ['syllabus', id], queryFn: () => api.get(`/syllabus/${id}`), enabled: !!id,
  })

  if (isLoading) return <Loading />
  if (error) return <ErrorBox error={error} retry={refetch} />
  if (!subject || !id) return null

  const current = (schoolTopics || []).filter((t: any) => t.status === 'studying')
  const points = syllabus?.points || []
  const pct = points.length ? Math.round((points.filter((p: any) => p.status === 'completed').length / points.length) * 100) : 0

  return (
    <div className="page">
      <div className="page-head" style={{ marginBottom: 26 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>{SUBJECT_KINDS.find((k) => k.value === subject.kind)?.label || 'Subject'}</div>
          <h1 className="display">{subject.name}</h1>
          <div className="row wrap" style={{ gap: 22, marginTop: 12 }}>
            {current.length > 0 && (
              <span className="lead">
                <span className="ink-4">Current topic </span>
                <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{current.map((t: any) => t.name).join(', ')}</span>
              </span>
            )}
            {points.length > 0 && (
              <span className="row" style={{ gap: 10 }}>
                <span className="progress-inline"><Bar value={pct} color="var(--bar-green)" /></span>
                <span className="meta num">{pct}% of syllabus complete</span>
              </span>
            )}
          </div>
        </div>
        <div className="section-actions">
          <button className="btn" onClick={() => navigate(`/uploads?subject=${id}`)}>Add work</button>
          <button className="btn" onClick={() => setGenerate('flashcards')}>Flashcards</button>
          <button className="btn primary" onClick={() => setGenerate('practice')}>Practice</button>
        </div>
      </div>

      <Tabs tabs={TABS} active={tab} onChange={(t) => setParams({ tab: t })} />

      <div className="fade-in" key={tab}>
        {tab === 'overview' && <OverviewTab subjectId={id} subject={subject} />}
        {tab === 'syllabus' && <SyllabusTab subjectId={id} subjectName={subject.name} />}
        {tab === 'school' && (
          <div className="section">
            <div className="section-head">
              <div>
                <h2>School work</h2>
                <div className="sub">Photos, PDFs, documents and pasted text. Originals are always kept.</div>
              </div>
              <div className="section-actions">
                <button className="btn sm primary" onClick={() => navigate(`/uploads?subject=${id}`)}>
                  <Icon name="plus" size={13} /> Add school work
                </button>
              </div>
            </div>
            <UploadList subjectId={id} />
          </div>
        )}
        {tab === 'notes' && <NotesPage subjectId={id} embedded />}
        {tab === 'practice' && <PracticePage subjectId={id} embedded />}
        {tab === 'flashcards' && <FlashcardsPage subjectId={id} embedded />}
        {tab === 'exams' && <ExamsPage subjectId={id} embedded />}
        {tab === 'assessments' && <AssessmentsPage subjectId={id} embedded />}
        {tab === 'progress' && <ProgressPage subjectId={id} embedded />}
        {tab === 'tools' && <ToolsTab subjectId={id} kind={subject.kind} subjectName={subject.name} />}
      </div>

      {generate && <GenerateModal kind={generate} subjectId={id} onClose={() => setGenerate(null)} />}
    </div>
  )
}
