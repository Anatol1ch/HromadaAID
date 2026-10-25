import Alert from './Alert'
import { useRef, useState, type FormEvent } from 'react'
import type { DecisionInput, DecisionSummary } from '../../electron/api-contract'
import { decisionRepository } from '../services/decisionRepository'
import Modal, { confirmModalClose } from './Modal'
import DecisionFields from './DecisionFields'
import { notifySystemToast } from './SystemToastHost'

export default function DecisionFormModal({ year, onClose, onSaved }: { year: number; onClose: () => void; onSaved: (decision: DecisionSummary) => void }) {
  const [draft, setDraft] = useState<DecisionInput>({ decisionNumber: '', decisionDate: '', title: '' })
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [error, setError] = useState('')
  const dirty = !!(draft.decisionNumber || draft.decisionDate || draft.title)
  const close = () => { if (!savingRef.current) onClose() }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (savingRef.current) return
    if (Number(draft.decisionDate.slice(0, 4)) !== year) { setError(`Дата рішення має належати обраному робочому року — ${year}.`); return }
    savingRef.current = true; setSaving(true); setError('')
    try {
      const result = await decisionRepository.save(draft)
      if (!result.ok) { setError(result.message); return }
      notifySystemToast('success', 'Рішення додано', 'Нове рішення успішно збережено.')
      onSaved(result.decision)
    } catch { setError('Не вдалося зберегти рішення. Введені дані залишилися у формі.') }
    finally { savingRef.current = false; setSaving(false) }
  }
  return <Modal title="Нове рішення виконкому" description={`Рішення для призначень за ${year} рік. Примітка необов’язкова.`} onClose={close} busy={saving} dirty={dirty}>
    <form onSubmit={(event) => void submit(event)}><DecisionFields disabled={saving} value={draft} onChange={setDraft} year={year}/>
      {error && <Alert variant="error">{error}</Alert>}
      <div className="recipient-form-actions decision-modal-actions"><div><button type="button" className="secondary-button" disabled={saving} onClick={() => confirmModalClose(dirty, close)}>Скасувати</button><button type="submit" className="primary-button" disabled={saving}>{saving ? 'Збереження…' : 'Зберегти рішення'}</button></div></div>
    </form>
  </Modal>
}
