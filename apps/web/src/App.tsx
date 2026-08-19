import { useEffect, useState } from 'react'
import { NavLink, Route, Routes, useNavigate, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from './lib/api'
import { Icon } from './components/Icons'
import QuickCapture from './components/QuickCapture'
import { StudyTimerProvider, TimerPill } from './components/StudyTimer'
import Dashboard from './pages/Dashboard'
import Subjects from './pages/Subjects'
import SubjectWorkspace from './pages/SubjectWorkspace'
import UploadPage from './pages/UploadPage'
import PracticePage from './pages/PracticePage'
import PracticeRunner from './pages/PracticeRunner'
import FlashcardsPage from './pages/FlashcardsPage'
import ExamsPage from './pages/ExamsPage'
import ExamRunner from './pages/ExamRunner'
import AssessmentsPage from './pages/AssessmentsPage'
import ProgressPage from './pages/ProgressPage'
import SettingsPage from './pages/SettingsPage'
import SearchPage from './pages/SearchPage'
import StudyMode from './pages/StudyMode'
import NotesPage from './pages/NotesPage'
import NoteEditor from './pages/NoteEditor'
import TasksPage from './pages/TasksPage'
import CalendarPage from './pages/CalendarPage'
import EssayWorkspace from './pages/EssayWorkspace'

const NAV = [
  { to: '/', icon: 'home', label: 'Home', end: true },
  { to: '/subjects', icon: 'book', label: 'Subjects' },
  { to: '/practice', icon: 'pencil', label: 'Practice' },
  { to: '/flashcards', icon: 'cards', label: 'Flashcards', badge: 'due' },
  { to: '/exams', icon: 'clock', label: 'Exams' },
  { to: '/notes', icon: 'note', label: 'Notes' },
  { to: '/uploads', icon: 'upload', label: 'Uploads' },
  { to: '/tasks', icon: 'tasks', label: 'Tasks', badge: 'tasks' },
  { to: '/calendar', icon: 'calendar', label: 'Calendar' },
  { to: '/progress', icon: 'chart', label: 'Progress' },
]

const MOBILE_NAV = [
  { to: '/', icon: 'home', label: 'Home', end: true },
  { to: '/subjects', icon: 'book', label: 'Subjects' },
  { to: '/practice', icon: 'pencil', label: 'Practice' },
  { to: '/uploads', icon: 'upload', label: 'Upload' },
  { to: '/settings', icon: 'more', label: 'More' },
]

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [q, setQ] = useState('')
  const navigate = useNavigate()
  const location = useLocation()

  const { data: profile } = useQuery({ queryKey: ['profile'], queryFn: () => api.get('/profile') })
  const { data: subjects } = useQuery({ queryKey: ['subjects'], queryFn: () => api.get('/subjects') })
  const { data: cardStats } = useQuery({ queryKey: ['flashcard-stats'], queryFn: () => api.get('/flashcards/stats'), refetchInterval: 120_000 })
  const { data: tasks } = useQuery({ queryKey: ['tasks', 'all', 'todo'], queryFn: () => api.get('/tasks?status=todo') })
  const { data: aiStatus } = useQuery({ queryKey: ['ai-status'], queryFn: () => api.get('/ai/status') })

  useEffect(() => { setSidebarOpen(false) }, [location.pathname])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        ;(document.getElementById('global-search') as HTMLInputElement)?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const countFor = (key?: string) => {
    if (key === 'due' && cardStats?.due > 0) return <span className="nav-count alert">{cardStats.due}</span>
    if (key === 'tasks' && tasks?.length > 0) return <span className="nav-count">{tasks.length}</span>
    return null
  }

  return (
    <StudyTimerProvider>
      <div className="app">
        <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
          <div className="brand">
            <div className="brand-name">Study HQ</div>
            <div className="brand-meta">
              {profile ? `Year ${profile.year_level} · Term ${profile.term} · ${profile.calendar_year}` : ''}
            </div>
          </div>

          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <Icon name={n.icon} size={15} />
              {n.label}
              {countFor((n as any).badge)}
            </NavLink>
          ))}

          <div className="nav-section">My subjects</div>
          {(subjects || []).map((s: any) => (
            <NavLink key={s.id} to={`/subjects/${s.id}`} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <span className="nav-swatch" style={{ background: s.color }} />
              <span className="truncate">{s.name}</span>
            </NavLink>
          ))}

          <div className="spacer" style={{ minHeight: 20 }} />
          <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Icon name="settings" size={15} /> Settings
          </NavLink>
        </aside>

        <div className="main">
          <header className="topbar">
            <button className="btn quiet sm icon mobile-only" onClick={() => setSidebarOpen((v) => !v)} aria-label="Menu">
              <Icon name="list" />
            </button>
            <form
              className="search"
              onSubmit={(e) => { e.preventDefault(); if (q.trim().length >= 2) navigate(`/search?q=${encodeURIComponent(q.trim())}`) }}
            >
              <span className="ico"><Icon name="search" size={15} /></span>
              <input id="global-search" placeholder="Search everything" value={q} onChange={(e) => setQ(e.target.value)} />
            </form>
            <div className="spacer" />
            <TimerPill />
            <span
              className={`ai-status ${aiStatus?.configured ? 'on' : ''}`}
              title={aiStatus?.hint || `AI model: ${aiStatus?.model}`}
              style={{ cursor: 'pointer' }}
              onClick={() => navigate('/settings')}
            >
              <i /> <span className="ai-label">
                {aiStatus?.configured ? 'AI on' : aiStatus?.key_present ? 'AI off' : 'AI not set up'}
              </span>
            </span>
          </header>

          <main className="content">
            <div className="fade-in" key={location.pathname}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/subjects" element={<Subjects />} />
                <Route path="/subjects/:id" element={<SubjectWorkspace />} />
                <Route path="/uploads" element={<UploadPage />} />
                <Route path="/upload" element={<UploadPage />} />
                <Route path="/practice" element={<PracticePage />} />
                <Route path="/practice/:setId" element={<PracticeRunner />} />
                <Route path="/flashcards" element={<FlashcardsPage />} />
                <Route path="/exams" element={<ExamsPage />} />
                <Route path="/exams/:examId" element={<ExamRunner />} />
                <Route path="/notes" element={<NotesPage />} />
                <Route path="/notes/:noteId" element={<NoteEditor />} />
                <Route path="/tasks" element={<TasksPage />} />
                <Route path="/calendar" element={<CalendarPage />} />
                <Route path="/assessments" element={<AssessmentsPage />} />
                <Route path="/progress" element={<ProgressPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/search" element={<SearchPage />} />
                <Route path="/study/:sessionId" element={<StudyMode />} />
                <Route path="/essays/:essayId" element={<EssayWorkspace />} />
                <Route path="*" element={<div className="page"><h1>Page not found</h1></div>} />
              </Routes>
            </div>
          </main>

          <nav className="bottom-nav">
            {MOBILE_NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}>
                <Icon name={n.icon} size={18} />
                {n.label}
              </NavLink>
            ))}
          </nav>
        </div>

        <QuickCapture />
      </div>
    </StudyTimerProvider>
  )
}
