import Alert from './Alert'
import { useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { AlertTriangle, Check, CircleCheck, X } from 'lucide-react'
import Modal from './Modal'
import { finishCloseConfirmation, getCloseConfirmation, subscribeCloseConfirmation } from './closeConfirmation'

type ConfirmDialogProps = {
  title: string
  description?: string
  message: ReactNode
  children?: ReactNode
  variant?: 'danger' | 'warning' | 'primary'
  confirmLabel: string
  cancelLabel?: string
  confirmIcon?: ReactNode
  busyLabel?: string
  confirmDisabled?: boolean
  error?: string
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

export default function ConfirmDialog({ title, description, message, children, variant = 'danger', confirmLabel, cancelLabel = 'Скасувати', confirmIcon, busyLabel = 'Виконуємо…', confirmDisabled = false, error, onConfirm, onCancel }: ConfirmDialogProps) {
  const messageId = useId()
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const [operationError, setOperationError] = useState('')
  const cancel = () => { if (!inFlight.current) onCancel() }
  const confirmAction = async () => {
    if (inFlight.current || confirmDisabled) return
    inFlight.current = true; setBusy(true); setOperationError('')
    try { await onConfirm() }
    catch { setOperationError('Не вдалося виконати дію. Повторіть спробу або скасуйте її.') }
    finally { inFlight.current = false; setBusy(false) }
  }
  const HeaderIcon = variant === 'primary' ? CircleCheck : AlertTriangle
  return <Modal title={title} description={description} onClose={cancel} busy={busy}
    role={variant === 'primary' ? 'dialog' : 'alertdialog'} className={`confirm-dialog confirm-dialog-${variant}`} describedBy={messageId} headerIcon={<HeaderIcon size={23} aria-hidden="true"/>}>
    <div className="confirm-dialog-message" id={messageId}>{message}</div>
    {children}
    {(error || operationError) && <Alert variant="error">{error || operationError}</Alert>}
    <div className="confirm-dialog-actions">
      <button type="button" className="secondary-button" data-modal-autofocus disabled={busy} onClick={cancel}>{cancelLabel}</button>
      <button type="button" className="confirm-dialog-confirm" disabled={busy || confirmDisabled} onClick={() => void confirmAction()}>{confirmIcon ?? <Check size={17} aria-hidden="true"/>}{busy ? busyLabel : confirmLabel}</button>
    </div>
  </Modal>
}

/** Existing unsaved-change callbacks share the same dialog as other actions. */
export function UnsavedChangesConfirmation() {
  const request = useSyncExternalStore(subscribeCloseConfirmation, getCloseConfirmation)
  if (!request) return null
  return <ConfirmDialog title="Закрити без збереження?" description="У формі є незбережені зміни" variant="danger"
    message="Усі внесені зміни буде втрачено. Ви впевнені, що хочете закрити форму?"
    cancelLabel="Продовжити редагування" confirmLabel="Закрити без збереження" confirmIcon={<X size={17} aria-hidden="true"/>}
    onCancel={() => finishCloseConfirmation(request, false)} onConfirm={() => finishCloseConfirmation(request, true)}/>
}
