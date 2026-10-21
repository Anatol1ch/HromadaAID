import Alert from './Alert'
import { useRef, useState } from 'react'
import { Check, Plus, Trash2, X } from 'lucide-react'
import type { BankInput, BankRecord } from '../../electron/api-contract'
import { validateBankInput, type BankErrors } from '../../electron/bank-validation'
import { bankRepository } from '../services/bankRepository'
import Modal, { confirmModalClose } from './Modal'
import ConfirmDialog from './ConfirmDialog'

type DetailDraft = BankInput['details'][number] & { key: string }
const newDetail = (): DetailDraft => ({ key: crypto.randomUUID(), mfo: '', edrpou: '' })

export default function BankFormModal({ initial, onClose, onSaved }: { initial?: BankRecord; onClose: () => void; onSaved: (bank: BankRecord) => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [details, setDetails] = useState<DetailDraft[]>(() => initial ? initial.details.map(detail => ({ id: detail.id, key: detail.id, mfo: detail.mfo, edrpou: detail.edrpou })) : [newDetail()])
  const baseline = useRef(JSON.stringify({ name, details }))
  const formRef = useRef<HTMLFormElement>(null)
  const savingRef = useRef(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [errors, setErrors] = useState<BankErrors>({})
  const [removing, setRemoving] = useState<DetailDraft | null>(null)
  const dirty = JSON.stringify({ name, details }) !== baseline.current
  const close = () => { if (!savingRef.current) onClose() }
  const updateDetail = (key: string, field: 'mfo' | 'edrpou', value: string) => {
    setDetails(current => current.map(detail => detail.key === key ? { ...detail, [field]: value } : detail))
    setErrors({}); setError('')
  }
  const requestRemoval = (detail: DetailDraft) => {
    const used = initial?.details.find(item => item.id === detail.id)?.recipientCount ?? 0
    if (used) { setError(`Ці реквізити використовуються у ${used} картках отримувачів. Видалення заборонено.`); return }
    if (details.length === 1) { setError('Банк повинен мати щонайменше один набір реквізитів. Спочатку додайте інший.'); return }
    setRemoving(detail)
  }
  const save = async () => {
    if (savingRef.current) return
    const validation = validateBankInput({ name, details })
    setErrors(validation.errors); setError('')
    if (!validation.ok) {
      setError(validation.message)
      const first = Array.from(formRef.current?.querySelectorAll<HTMLElement>('[data-bank-field]') ?? []).find(field => validation.errors[field.dataset.bankField!])
      first?.querySelector('input')?.focus()
      return
    }
    savingRef.current = true; setSaving(true)
    try {
      const result = await bankRepository.save(validation.input, initial?.id, initial?.updatedAt)
      if (result.ok) onSaved(result.bank)
      else setError(result.message)
    } catch { setError('Не вдалося зберегти банк. Введені дані залишилися у формі.') }
    finally { savingRef.current = false; setSaving(false) }
  }
  const field = (key: string, label: string, value: string, maxLength: number, change: (value: string) => void) => <label className="recipient-field" data-bank-field={key}>
    <span>{label} <span className="recipient-required-mark" aria-hidden="true">*</span></span>
    <input required disabled={saving} maxLength={maxLength} value={value} aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `bank-error-${key}` : undefined} onChange={event => change(event.target.value)}/>
    {errors[key] && <span id={`bank-error-${key}`} className="recipient-field-error">{errors[key]}</span>}
  </label>
  return <>
    <Modal title={initial ? 'Редагування банку' : 'Новий банк'} description="Вкажіть найменування банку та пов’язані пари МФО і ЄДРПОУ." size="large" className="recipient-card-modal" busy={saving} dirty={dirty} onClose={close}>
      <form className="recipient-card-form bank-form" ref={formRef} noValidate onSubmit={event => { event.preventDefault(); void save() }}>
        <fieldset className="recipient-fieldset"><legend>Основні відомості</legend><div className="recipient-form-grid bank-name-grid">{field('name', 'Найменування банку', name, 200, value => { setName(value); setErrors({}); setError('') })}</div></fieldset>
        <fieldset className="recipient-fieldset"><legend>Банківські реквізити</legend>
          <div className="bank-detail-list">{details.map((detail, index) => <div className="bank-detail-row" key={detail.key}>
            <div className="recipient-form-grid">
              {field(`details.${index}.mfo`, 'Код МФО', detail.mfo, 32, value => updateDetail(detail.key, 'mfo', value))}
              {field(`details.${index}.edrpou`, 'Код банку за ЄДРПОУ', detail.edrpou, 32, value => updateDetail(detail.key, 'edrpou', value))}
            </div>
            <button type="button" className="table-action danger-action" disabled={saving} title="Видалити пару реквізитів" aria-label={`Видалити набір реквізитів ${index + 1}`} onClick={() => requestRemoval(detail)}><Trash2 size={18}/></button>
          </div>)}</div>
          <button type="button" className="secondary-button green-outline-button bank-add-details" disabled={saving} onClick={() => { setDetails(current => [...current, newDetail()]); setErrors({}); setError('') }}><Plus size={17}/>Додати реквізити</button>
          {initial && initial.recipientCount > 0 && <p className="bank-form-note">Зміни найменування та реквізитів відобразяться у {initial.recipientCount} пов’язаних картках отримувачів. Номери рахунків залишаться незмінними.</p>}
        </fieldset>
        {error && <Alert variant="error">{error}</Alert>}
        <div className="recipient-form-actions recipient-card-actions"><span className="recipient-required-note"><span className="recipient-required-mark">*</span> Обов’язкові поля.</span><button type="button" className="secondary-button assignment-cancel-button" disabled={saving} onClick={() => confirmModalClose(dirty, close)}><X size={17}/>Скасувати</button><button type="submit" className="primary-button" disabled={saving}><Check size={17}/>{saving ? 'Збереження…' : initial ? 'Зберегти зміни' : 'Створити банк'}</button></div>
      </form>
    </Modal>
    {removing && <ConfirmDialog title="Видалити реквізити?" message={`МФО ${removing.mfo || '—'} · ЄДРПОУ ${removing.edrpou || '—'}. Пару буде остаточно видалено після збереження банку.`} confirmLabel="Видалити" confirmIcon={<Trash2 size={17}/>} onCancel={() => setRemoving(null)} onConfirm={() => { setDetails(current => current.filter(detail => detail.key !== removing.key)); setRemoving(null); setErrors({}); setError('') }}/>}
  </>
}
