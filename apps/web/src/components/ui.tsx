import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

/* ================= toasts ================= */

type Toast = { id: number; message: string; kind: 'info' | 'success' | 'error'; title?: string }
const ToastCtx = createContext<(m: string, kind?: Toast['kind'], title?: string) => void>(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((message: string, kind: Toast['kind'] = 'info', title?: string) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, message, kind, title }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 4000)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
            <span style={{ color: t.kind === 'error' ? 'var(--red)' : t.kind === 'success' ? 'var(--green)' : 'var(--blue)', fontWeight: 700, lineHeight: '18px' }}>
              {t.kind === 'error' ? '!' : t.kind === 'success' ? '✓' : 'i'}
            </span>
            <div>
              {t.title && <div style={{ fontWeight: 600, marginBottom: 2 }}>{t.title}</div>}
              <div className="ink-2" style={{ whiteSpace: 'pre-wrap' }}>{t.message}</div>
            </div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

/* ================= context menu ================= */

export type MenuItem =
  | { type: 'sep' }
  | { type: 'label'; label: string }
  | { type?: 'item'; label: string; icon?: string; danger?: boolean; onClick: () => void; disabled?: boolean }

const MenuCtx = createContext<(e: React.MouseEvent, items: MenuItem[]) => void>(() => {})
export const useContextMenu = () => useContext(MenuCtx)

export function ContextMenuProvider({ children }: { children: React.ReactNode }) {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const open = useCallback((e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, items })
  }, [])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('click', close)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
    }
  }, [menu])

  // Keep the menu inside the viewport.
  useEffect(() => {
    if (!menu || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    const nx = Math.min(menu.x, window.innerWidth - r.width - 8)
    const ny = Math.min(menu.y, window.innerHeight - r.height - 8)
    if (nx !== menu.x || ny !== menu.y) setMenu({ ...menu, x: nx, y: ny })
  }, [menu])

  return (
    <MenuCtx.Provider value={open}>
      {children}
      {menu && (
        <div className="ctx-menu" ref={ref} style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          {menu.items.map((it, i) => {
            if ('type' in it && it.type === 'sep') return <div className="ctx-sep" key={i} />
            if ('type' in it && it.type === 'label') return <div className="ctx-label" key={i}>{(it as any).label}</div>
            const item = it as Extract<MenuItem, { onClick: () => void }>
            return (
              <button
                key={i}
                className={`ctx-item ${item.danger ? 'danger' : ''}`}
                disabled={item.disabled}
                onClick={() => { setMenu(null); item.onClick() }}
              >
                {item.icon && <span style={{ width: 16, textAlign: 'center' }}>{item.icon}</span>}
                {item.label}
              </button>
            )
          })}
        </div>
      )}
    </MenuCtx.Provider>
  )
}

/* ================= modal ================= */

export function Modal({
  title, subtitle, children, footer, onClose, size = '',
}: {
  title: string; subtitle?: string; children: React.ReactNode
  footer?: React.ReactNode; onClose: () => void; size?: '' | 'wide' | 'full'
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${size}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: 18 }}>{title}</h2>
            {subtitle && <div className="sub">{subtitle}</div>}
          </div>
          <button className="btn quiet sm icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

/* ================= confirm / prompt ================= */

type Dialog =
  | { kind: 'confirm'; title: string; message: string; danger?: boolean; resolve: (v: boolean) => void }
  | { kind: 'prompt'; title: string; label: string; value: string; multiline?: boolean; resolve: (v: string | null) => void }

const DialogCtx = createContext<{
  confirm: (title: string, message: string, danger?: boolean) => Promise<boolean>
  prompt: (title: string, label: string, value?: string, multiline?: boolean) => Promise<string | null>
}>({ confirm: async () => false, prompt: async () => null })
export const useDialogs = () => useContext(DialogCtx)

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [value, setValue] = useState('')

  const confirm = useCallback(
    (title: string, message: string, danger?: boolean) =>
      new Promise<boolean>((resolve) => setDialog({ kind: 'confirm', title, message, danger, resolve })),
    []
  )
  const promptFn = useCallback(
    (title: string, label: string, initial = '', multiline = false) =>
      new Promise<string | null>((resolve) => {
        setValue(initial)
        setDialog({ kind: 'prompt', title, label, value: initial, multiline, resolve })
      }),
    []
  )

  const close = (result: any) => {
    ;(dialog?.resolve as ((v: any) => void) | undefined)?.(result)
    setDialog(null)
  }

  return (
    <DialogCtx.Provider value={{ confirm, prompt: promptFn }}>
      {children}
      {dialog?.kind === 'confirm' && (
        <Modal
          title={dialog.title}
          onClose={() => close(false)}
          footer={
            <>
              <button className="btn" onClick={() => close(false)}>Cancel</button>
              <button className={`btn ${dialog.danger ? 'danger' : 'primary'}`} onClick={() => close(true)} autoFocus>
                {dialog.danger ? 'Delete' : 'Confirm'}
              </button>
            </>
          }
        >
          <div className="dim pre-wrap">{dialog.message}</div>
        </Modal>
      )}
      {dialog?.kind === 'prompt' && (
        <Modal
          title={dialog.title}
          onClose={() => close(null)}
          footer={
            <>
              <button className="btn" onClick={() => close(null)}>Cancel</button>
              <button className="btn primary" onClick={() => close(value.trim() ? value : null)}>Save</button>
            </>
          }
        >
          <label className="field">
            <span>{dialog.label}</span>
            {dialog.multiline ? (
              <textarea value={value} onChange={(e) => setValue(e.target.value)} autoFocus rows={8} />
            ) : (
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && value.trim() && close(value)}
              />
            )}
          </label>
        </Modal>
      )}
    </DialogCtx.Provider>
  )
}

/* ================= small pieces ================= */

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </label>
  )
}

export function Stat({ label, value, meta, accent }: { label: string; value: React.ReactNode; meta?: React.ReactNode; accent?: string }) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value" style={accent ? { color: accent } : undefined}>{value}</div>
      {meta && <div className="metric-note">{meta}</div>}
    </div>
  )
}

export function Bar({ value, color, thick }: { value: number; color?: string; thick?: boolean }) {
  return (
    <div className={`progress ${thick ? 'thick' : ''}`}>
      <span style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} />
    </div>
  )
}

export function Empty({ title, message, action }: { icon?: string; title: string; message?: string; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <div className="t">{title}</div>
      {message && <div className="m">{message}</div>}
      {action && <div className="a">{action}</div>}
    </div>
  )
}

/** Section heading with an optional action on the right. */
export function SectionHead({ title, sub, action, plain }: { title: string; sub?: string; action?: React.ReactNode; plain?: boolean }) {
  return (
    <div className={`section-head ${plain ? 'plain' : ''}`}>
      <div>
        <h2>{title}</h2>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {action && <div className="section-actions">{action}</div>}
    </div>
  )
}

/** Segmented control - used for view switches and small option sets. */
export function Segmented<T extends string>({ value, options, onChange }: {
  value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  )
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="row" style={{ padding: '40px 0', justifyContent: 'center', gap: 10 }}>
      <div className="spinner" /> <span className="meta">{label}…</span>
    </div>
  )
}

export function ErrorBox({ error, retry }: { error: any; retry?: () => void }) {
  return (
    <div className="notice error">
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, marginBottom: 2 }}>Something went wrong</div>
        <div className="pre-wrap">{error?.message || String(error)}</div>
        {retry && <button className="btn sm" style={{ marginTop: 8 }} onClick={retry}>Try again</button>}
      </div>
    </div>
  )
}

export function Tabs({ tabs, active, onChange }: { tabs: Array<{ id: string; label: string; badge?: React.ReactNode }>; active: string; onChange: (id: string) => void }) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button key={t.id} className={`tab ${active === t.id ? 'active' : ''}`} onClick={() => onChange(t.id)}>
          {t.label}
          {t.badge != null && t.badge !== 0 && <span className="count">{t.badge}</span>}
        </button>
      ))}
    </div>
  )
}

export function StatusTick({ status, onClick }: { status: string; onClick?: () => void }) {
  const glyph = status === 'completed' ? '✓' : status === 'studying' ? '◐' : status === 'needs_revision' ? '!' : ''
  return (
    <div
      className={`tick ${status}`}
      onClick={(e) => { e.stopPropagation(); onClick?.() }}
      title="Click to cycle: not started → studying → needs revision → completed"
      role="button"
    >
      {glyph}
    </div>
  )
}

export const nextStatus = (s: string) =>
  s === 'not_started' ? 'studying' : s === 'studying' ? 'needs_revision' : s === 'needs_revision' ? 'completed' : 'not_started'
