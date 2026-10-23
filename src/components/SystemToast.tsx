import { CircleAlert, CircleCheck, Info, LockKeyhole, TriangleAlert, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'

export type SystemNoticeKind = 'success' | 'error' | 'warning' | 'info' | 'access-denied'

const icons = { success: CircleCheck, error: CircleAlert, warning: TriangleAlert, info: Info, 'access-denied': LockKeyhole }

export default function SystemToast({ kind, title, message, onClose, duration = 5_000 }: { kind: SystemNoticeKind; title: string; message: string; onClose: () => void; duration?: number }) {
  const [closing, setClosing] = useState(false)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (duration <= 0) return
    const timeout = window.setTimeout(() => setClosing(true), duration)
    return () => window.clearTimeout(timeout)
  }, [duration])
  useEffect(() => {
    if (!closing) return
    const timeout = window.setTimeout(() => closeRef.current(), 180)
    return () => window.clearTimeout(timeout)
  }, [closing])
  const Icon = icons[kind]
  return createPortal(<aside className={`system-toast system-toast-${kind}${closing ? ' is-closing' : ''}`} role={kind === 'error' || kind === 'access-denied' ? 'alert' : 'status'} aria-live={kind === 'error' || kind === 'access-denied' ? 'assertive' : 'polite'} aria-atomic="true">
    <span className="system-toast-icon"><Icon size={19} aria-hidden="true"/></span>
    <div><strong>{title}</strong><p>{message}</p></div>
    <button type="button" className="icon-button" aria-label="Закрити повідомлення" onClick={() => setClosing(true)}><X size={17} aria-hidden="true"/></button>
  </aside>, document.body)
}
