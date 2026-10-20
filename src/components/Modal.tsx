import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { activeKeyboardScope, focusableElements, isAvailable, primaryFields, resetKeyboardMode } from '../lib/keyboardNavigation'
import { X } from 'lucide-react'
import { cancelCloseConfirmation, confirmModalClose } from './closeConfirmation'

export { confirmModalClose } from './closeConfirmation'

type ModalProps = {
  title: string
  description?: string
  children: ReactNode
  onClose: () => void
  dirty?: boolean
  size?: 'compact' | 'wide' | 'large'
  labelledBy?: string
  role?: 'dialog' | 'alertdialog'
  className?: string
  describedBy?: string
  headerIcon?: ReactNode
  busy?: boolean
}

let modalSequence = 0
const openModalStack: number[] = []
let initialBodyOverflow = ''

export default function Modal({ title, description, children, onClose, dirty = false, size = 'compact', labelledBy, role = 'dialog', className = '', describedBy, headerIcon, busy = false }: ModalProps) {
  const id = useId()
  const titleId = labelledBy ?? `modal-title-${id}`
  const descriptionId = `modal-description-${id}`
  const dialogRef = useRef<HTMLElement>(null)
  const lastFieldRef = useRef<HTMLElement | null>(null)
  // Capture the opener before a child's autoFocus runs during the commit.
  const openerRef = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  const closeRef = useRef(onClose)
  const dirtyRef = useRef(dirty)
  const busyRef = useRef(busy)
  closeRef.current = onClose
  dirtyRef.current = dirty
  busyRef.current = busy

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog || activeKeyboardScope() !== dialog) return
    // Disabling a focused field can silently move focus to body in Chromium.
    if (busy && (!dialog.contains(document.activeElement) || (document.activeElement instanceof HTMLElement && !isAvailable(document.activeElement)))) dialog.focus()
    else if (!busy && document.activeElement === dialog && lastFieldRef.current
      && dialog.contains(lastFieldRef.current) && isAvailable(lastFieldRef.current)) lastFieldRef.current.focus()
  }, [busy])

  useEffect(() => {
    const layer = ++modalSequence
    if (!openModalStack.length) initialBodyOverflow = document.body.style.overflow
    openModalStack.push(layer)
    const dialog = dialogRef.current
    const previousFocus = openerRef.current
    const previousModal = previousFocus?.closest<HTMLElement>('.app-modal')
    const previousInert = previousModal?.inert ?? false
    if (previousModal && previousModal !== dialogRef.current) previousModal.inert = true
    document.body.style.overflow = 'hidden'
    if (dialog) resetKeyboardMode(dialog)
    const focusFirst = () => {
      if (!dialog || openModalStack.at(-1) !== layer) return
      const target = focusableElements(dialog).find(element => element.hasAttribute('data-modal-autofocus'))
        ?? primaryFields(dialog)[0] ?? focusableElements(dialog)[0] ?? dialog
      target.focus()
    }
    const timer = window.setTimeout(focusFirst, 0)
    const requestClose = () => {
      if (busyRef.current) return
      confirmModalClose(dirtyRef.current, closeRef.current, dialogRef.current)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || openModalStack[openModalStack.length - 1] !== layer) return
      if (event.key === 'Escape') { event.preventDefault(); requestClose(); return }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = focusableElements(dialogRef.current)
      if (!focusable.length) { event.preventDefault(); dialogRef.current.focus(); return }
      const first = focusable[0], last = focusable[focusable.length - 1]
      if (!dialogRef.current.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus() }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('keydown', onKeyDown)
      const index = openModalStack.indexOf(layer)
      if (index >= 0) openModalStack.splice(index, 1)
      document.body.style.overflow = openModalStack.length ? 'hidden' : initialBodyOverflow
      if (previousModal) previousModal.inert = previousInert
      if (dialog) cancelCloseConfirmation(dialog)
      if (previousFocus?.isConnected && !previousFocus.matches(':disabled') && !previousFocus.closest('[inert]') && previousFocus.getClientRects().length > 0) previousFocus.focus()
    }
  }, [])

  const requestClose = () => {
    if (busy) return
    confirmModalClose(dirty, onClose, dialogRef.current)
  }

  return createPortal(<div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { event.stopPropagation(); requestClose() } }}>
    <section ref={dialogRef} onFocusCapture={event => { if (event.target !== event.currentTarget) lastFieldRef.current = event.target as HTMLElement }} className={`app-modal app-modal-${size}${className ? ` ${className}` : ''}`} role={role} aria-modal="true" aria-busy={busy || undefined} aria-labelledby={titleId} aria-describedby={[description ? descriptionId : '', describedBy].filter(Boolean).join(' ') || undefined} tabIndex={-1}>
      <header className="app-modal-header"><div>{headerIcon && <span className="app-modal-header-icon">{headerIcon}</span>}<h2 id={titleId}>{title}</h2>{description && <p id={descriptionId}>{description}</p>}</div><button type="button" className="icon-button" aria-label="Закрити вікно" disabled={busy} onClick={requestClose}><X size={19}/></button></header>
      <div className="app-modal-content">{children}</div>
    </section>
  </div>, document.body)
}
