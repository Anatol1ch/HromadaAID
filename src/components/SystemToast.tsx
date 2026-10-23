import { CircleAlert, CircleCheck, Info, LockKeyhole, TriangleAlert, X } from 'lucide-react'
import { useEffect } from 'react'

export type SystemNoticeKind = 'success' | 'error' | 'warning' | 'info' | 'access-denied'

const icons = { success: CircleCheck, error: CircleAlert, warning: TriangleAlert, info: Info, 'access-denied': LockKeyhole }

export default function SystemToast({ kind, title, message, onClose, duration = 4_000 }: { kind: SystemNoticeKind; title: string; message: string; onClose: () => void; duration?: number }) {
  useEffect(() => {
    if (duration <= 0) return
    const timeout = window.setTimeout(onClose, duration)
    return () => window.clearTimeout(timeout)
  }, [onClose, duration])
  const Icon = icons[kind]
  return <aside className={`system-toast system-toast-${kind}`} role={kind === 'error' || kind === 'access-denied' ? 'alert' : 'status'} aria-live={kind === 'error' || kind === 'access-denied' ? 'assertive' : 'polite'} aria-atomic="true">
    <Icon size={19} aria-hidden="true"/>
    <div><strong>{title}</strong><p>{message}</p></div>
    <button type="button" className="icon-button" aria-label="Закрити повідомлення" onClick={onClose}><X size={17} aria-hidden="true"/></button>
  </aside>
}
