import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { Icon } from './Icons'
import { Modal, Field } from './ui'

type Mode = 'focus' | 'short' | 'long'
type Ctx = {
  running: boolean; seconds: number; mode: Mode; label: string
  start: (minutes: number, mode?: Mode, subjectId?: string | null) => void
  stop: (log?: boolean) => void
  open: () => void
}

const TimerCtx = createContext<Ctx | null>(null)
export const useTimer = () => useContext(TimerCtx)!

const DURATIONS: Record<Mode, number> = { focus: 25, short: 5, long: 15 }

/** Global study timer. Time is logged to the study log so it counts toward goals and streaks. */
export function StudyTimerProvider({ children }: { children: React.ReactNode }) {
  const [running, setRunning] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [target, setTarget] = useState(25 * 60)
  const [mode, setMode] = useState<Mode>('focus')
  const [subjectId, setSubjectId] = useState<string | null>(null)
  const [showPanel, setShowPanel] = useState(false)
  const [custom, setCustom] = useState(45)
  const logged = useRef(0)

  useEffect(() => {
    if (!running) return
    const iv = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(iv)
  }, [running])

  // Log study time in one-minute increments so a crash never loses the whole session.
  useEffect(() => {
    if (!running || mode !== 'focus') return
    const whole = Math.floor(seconds / 60)
    if (whole > logged.current) {
      const delta = whole - logged.current
      logged.current = whole
      api.post('/study-log', { minutes: delta, subject_id: subjectId, activity: 'focus timer' }).catch(() => {})
    }
  }, [seconds, running, mode, subjectId])

  useEffect(() => {
    if (running && seconds >= target) {
      setRunning(false)
      try { new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=').play() } catch { /* no sound available */ }
    }
  }, [seconds, target, running])

  const start = (minutes: number, m: Mode = 'focus', sid: string | null = null) => {
    setMode(m); setTarget(minutes * 60); setSeconds(0); logged.current = 0; setSubjectId(sid); setRunning(true); setShowPanel(false)
  }
  const stop = () => { setRunning(false); setSeconds(0); logged.current = 0 }

  const remaining = Math.max(0, target - seconds)
  const mm = String(Math.floor(remaining / 60)).padStart(2, '0')
  const ss = String(remaining % 60).padStart(2, '0')

  return (
    <TimerCtx.Provider
      value={{ running, seconds, mode, label: running || seconds > 0 ? `${mm}:${ss}` : 'Timer', start, stop, open: () => setShowPanel(true) }}
    >
      {children}

      {showPanel && (
        <Modal
          title="Study timer"
          subtitle={running ? `${mode === 'focus' ? 'Focus' : 'Break'} in progress` : 'Time is tracked against your daily goal.'}
          onClose={() => setShowPanel(false)}
          footer={
            running ? (
              <>
                <button className="btn danger" onClick={() => { stop(); setShowPanel(false) }}>Stop</button>
                <div className="spacer" />
                <button className="btn" onClick={() => setRunning(false)}>Pause</button>
                <button className="btn primary" onClick={() => setShowPanel(false)}>Keep going</button>
              </>
            ) : (
              <>
                {seconds > 0 && <button className="btn" onClick={stop}>Reset</button>}
                <div className="spacer" />
                {seconds > 0 && <button className="btn primary" onClick={() => { setRunning(true); setShowPanel(false) }}>Resume</button>}
              </>
            )
          }
        >
          <div style={{ textAlign: 'center', padding: '10px 0 4px' }}>
            <div className="timer-display" style={{ color: mode === 'focus' ? 'var(--blue)' : 'var(--amber)' }}>{mm}:{ss}</div>
            <div className="micro">{mode === 'focus' ? 'Focus session' : mode === 'short' ? 'Short break' : 'Long break'}</div>
          </div>

          {!running && (
            <>
              <Field label="Focus">
                <div className="row wrap">
                  {[25, 45, 60].map((m) => (
                    <button key={m} className="chip" onClick={() => start(m, 'focus', subjectId)}>{m} min</button>
                  ))}
                  <span className="row" style={{ gap: 5 }}>
                    <input type="number" min={1} max={240} value={custom} onChange={(e) => setCustom(Number(e.target.value))} style={{ width: 66 }} />
                    <button className="chip" onClick={() => start(custom, 'focus', subjectId)}>Custom</button>
                  </span>
                </div>
              </Field>
              <Field label="Break">
                <div className="row">
                  <button className="chip" onClick={() => start(DURATIONS.short, 'short')}>Short · 5 min</button>
                  <button className="chip" onClick={() => start(DURATIONS.long, 'long')}>Long · 15 min</button>
                </div>
              </Field>
            </>
          )}
        </Modal>
      )}
    </TimerCtx.Provider>
  )
}

/** The timer control itself — rendered in the top bar. */
export function TimerPill() {
  const t = useTimer()
  return (
    <button
      className={`timer-btn ${t.running ? (t.mode === 'focus' ? 'running' : 'break') : ''}`}
      onClick={t.open}
      title="Study timer"
    >
      <Icon name="timer" size={13} />
      {t.label}
    </button>
  )
}
