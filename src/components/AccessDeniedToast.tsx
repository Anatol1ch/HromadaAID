import { useEffect } from 'react'
import { LockKeyhole, X } from 'lucide-react'

export default function AccessDeniedToast({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const timeout = window.setTimeout(onClose, 3500)
    return () => window.clearTimeout(timeout)
  }, [onClose])

  return <aside className="access-denied-toast" role="alert" aria-live="assertive" aria-atomic="true">
    <LockKeyhole size={19} aria-hidden="true"/>
    <div><strong>Доступ обмежено</strong><p>Для роботи з цим розділом недостатньо прав вашого облікового запису.</p></div>
    <button type="button" className="icon-button" aria-label="Закрити повідомлення про доступ" onClick={onClose}><X size={17} aria-hidden="true"/></button>
  </aside>
}
