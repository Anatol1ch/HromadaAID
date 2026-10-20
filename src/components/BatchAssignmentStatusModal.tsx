import Alert from './Alert'
import { paymentYearError } from '../../electron/accounting-year'
import { ASSIGNMENT_STATUSES } from '../../electron/assignment-model'
import { useRef, useState, type FormEvent } from 'react'
import { Check } from 'lucide-react'
import type { AssignmentStatus, AssignmentStatusBatchResult } from '../../electron/api-contract'
import { assignmentRepository } from '../services/assignmentRepository'
import { isIsoCalendarDate } from '../lib/dates'
import Modal, { confirmModalClose } from './Modal'
import Select from './Select'
import DateField from './DateField'

export default function BatchAssignmentStatusModal({ assignmentIds, year, onClose, onSaved }: {
  assignmentIds: string[]; year: number; onClose: () => void
  onSaved: (result: Extract<AssignmentStatusBatchResult, { ok: true }>) => void
}) {
  const [status, setStatus] = useState<AssignmentStatus | ''>('')
  const [paidOn, setPaidOn] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)
  const dirty = !!(status || paidOn)
  const close = () => { if (!inFlight.current) onClose() }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (inFlight.current) return
    if (!assignmentIds.length || !status) { setError('Виберіть призначення та новий статус.'); return }
    if (status === 'Виплачено' && !isIsoCalendarDate(paidOn)) { setError('Вкажіть коректну дату фактичної виплати.'); return }
    if (status === 'Виплачено') { const message = paymentYearError(paidOn, year); if (message) { setError(message); return } }
    inFlight.current = true; setSaving(true); setError('')
    try {
      const result = await assignmentRepository.changeStatuses({ assignmentIds, year, status, ...(status === 'Виплачено' ? { paidOn } : {}) })
      if (!result.ok) { setError(result.message); return }
      onSaved(result)
    } catch { setError('Не вдалося отримати результат зміни статусів. Оновіть реєстр перед повторною спробою. Вибір збережено.') }
    finally { inFlight.current = false; setSaving(false) }
  }
  return <Modal title="Масова зміна статусу" description={`Вибрано призначень: ${assignmentIds.length}`} onClose={close} dirty={dirty && !saving} busy={saving}>
    <form className="batch-status-form" onSubmit={(event) => void submit(event)}>
      <label className="recipient-field"><span>Новий статус *</span><Select label="Новий статус" required disabled={saving} value={status} placeholder="Оберіть статус" options={ASSIGNMENT_STATUSES.map((value) => ({ value, label: value }))} onChange={(value) => { setStatus(value as AssignmentStatus); if (value !== 'Виплачено') setPaidOn('') }}/></label>
      {status === 'Виплачено' && <label className="recipient-field"><span>Дата фактичної виплати *</span><DateField disabled={saving} required min={`${year}-01-01`} max={`${year}-12-31`} value={paidOn} onChange={setPaidOn}/></label>}
      <p className="batch-status-caption">Зміни буде застосовано до {assignmentIds.length} вибраних призначень. Записи з таким самим статусом залишаться без змін.</p>
      {error && <Alert variant="error">{error}</Alert>}
      <div className="recipient-form-actions decision-modal-actions"><div><button type="button" className="secondary-button" disabled={saving} onClick={() => confirmModalClose(dirty, close)}>Скасувати</button><button type="submit" className="primary-button" disabled={saving}><Check size={17} aria-hidden="true"/>{saving ? 'Застосовуємо…' : 'Застосувати зміни'}</button></div></div>
    </form>
  </Modal>
}
