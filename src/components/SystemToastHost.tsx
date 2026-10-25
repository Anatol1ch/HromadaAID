import { useEffect, useState } from 'react'
import SystemToast, { type SystemNoticeKind } from './SystemToast'

const eventName = 'hromadaaid:system-toast'
type Notice = { id: string; kind: SystemNoticeKind; title: string; message: string; duration: number }
type NoticeDetail = Omit<Notice, 'id' | 'duration'> & { duration?: number }

/** Queue a compact, non-blocking system notification from any client feature. */
export function notifySystemToast(kind: SystemNoticeKind, title: string, message: string, duration = 3_500): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<NoticeDetail>(eventName, { detail: { kind, title, message, duration } }))
}

export default function SystemToastHost() {
  const [queue, setQueue] = useState<Notice[]>([])
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<NoticeDetail>).detail
      if (!detail || !['success', 'error', 'warning', 'info', 'access-denied'].includes(detail.kind) || typeof detail.title !== 'string' || typeof detail.message !== 'string') return
      setQueue(current => [...current, { ...detail, duration: typeof detail.duration === 'number' && detail.duration > 0 ? detail.duration : 3_500, id: crypto.randomUUID() }])
    }
    window.addEventListener(eventName, receive)
    return () => window.removeEventListener(eventName, receive)
  }, [])
  const notice = queue[0]
  if (!notice) return null
  return <SystemToast key={notice.id} kind={notice.kind} title={notice.title} message={notice.message} onClose={() => setQueue(current => current.filter(item => item.id !== notice.id))} duration={notice.duration}/>
}
