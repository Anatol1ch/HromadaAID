import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, CircleAlert, CircleCheck, Info, LoaderCircle, X } from 'lucide-react'

export function IconButton({ label, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button {...props} type="button" className={`sm-icon-button ${props.className ?? ''}`} title={label} aria-label={label}>{children}</button>
}

export function StatusBadge({ tone, children, plain = false }: { tone: string; children: ReactNode; plain?: boolean }) {
  return <span className={`sm-status sm-status-${tone}${plain ? ' sm-status-plain' : ''}`}><span aria-hidden="true"/>{children}</span>
}

export function Modal({ title, icon, children, footer, onClose, busy = false, wide = false, dismissible = true, className = '' }: { title: string; icon?: ReactNode; children: ReactNode; footer?: ReactNode; onClose: () => void; busy?: boolean; wide?: boolean; dismissible?: boolean; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = ref.current
    dialog?.showModal()
    return () => { dialog?.close(); if (previous?.isConnected && previous.getClientRects().length && !previous.matches(':disabled')) previous.focus(); else document.querySelector<HTMLHeadingElement>('h1')?.focus() }
  }, [])
  return createPortal(<dialog ref={ref} className={`sm-modal${wide ? ' sm-modal-wide' : ''}${className ? ` ${className}` : ''}`} aria-labelledby={titleId} aria-busy={busy} onCancel={event => { event.preventDefault(); if (dismissible && !busy) onClose() }} onClick={event => { if (dismissible && event.target === event.currentTarget && !busy) onClose() }}>
    <header className="sm-modal-header"><h2 id={titleId}>{icon}<span>{title}</span></h2>{dismissible && <IconButton label={busy ? 'Дочекайтеся завершення операції' : 'Закрити'} disabled={busy} onClick={onClose}><X size={19}/></IconButton>}</header>
    <div className="sm-modal-body">{children}</div>
    {footer && <footer className="sm-modal-footer">{footer}</footer>}
  </dialog>, document.body)
}

export function OperationProgress({ message, stages, current }: { message: string; stages?: Array<{ id: string; label: string }>; current?: string }) {
  const index = stages?.findIndex(stage => stage.id === current) ?? -1
  return <div className="sm-operation-progress" role="status" aria-live="polite"><LoaderCircle size={32} className="sm-service-spinner" aria-hidden="true"/><strong>{message}</strong><p>Зачекайте завершення операції. Не закривайте Server Manager.</p>{stages && <ol className="sm-operation-stages">{stages.map((stage, i) => <li key={stage.id} className={i === index ? 'active' : index >= 0 && i < index ? 'complete' : ''} aria-current={i === index ? 'step' : undefined}><span>{index >= 0 && i < index ? <Check size={14}/> : i + 1}</span>{stage.label}</li>)}</ol>}</div>
}

export function OperationResult({ success, title, message, details, children }: { success: boolean; title: string; message: string; details?: string; children?: ReactNode }) {
  return <div className={`sm-operation-result ${success ? 'is-success' : 'is-error'}`} role={success ? 'status' : 'alert'}>{success ? <CircleCheck size={44} aria-hidden="true"/> : <CircleAlert size={44} aria-hidden="true"/>}<h3>{title}</h3><p>{message}</p>{children}{details && <details className="sm-update-details"><summary>Технічні подробиці</summary><pre>{details}</pre></details>}</div>
}

export function Toast({ message, tone = 'success', onDismiss }: { message: string; tone?: string; onDismiss: () => void }) {
  const dismiss = useRef(onDismiss)
  dismiss.current = onDismiss
  useEffect(() => { const timer = window.setTimeout(() => dismiss.current(), 6500); return () => window.clearTimeout(timer) }, [message])
  return createPortal(<div className={`sm-toast sm-local-notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{tone === 'error' ? <CircleAlert size={19}/> : tone === 'success' ? <CircleCheck size={19}/> : <Info size={19}/>}<span>{message}</span><IconButton label="Приховати повідомлення" onClick={onDismiss}><X size={16}/></IconButton></div>, document.body)
}
