import Alert from './Alert'
import { useId, useRef, useState, type FormEvent } from 'react'
import { ChevronDown, Copy, FileText, X } from 'lucide-react'
import type { StatementKind, StatementParameters } from '../../electron/api-contract'
import { statementKey, statementParameterErrors, type ParameterErrors, type StatementPlan } from '../../electron/statement-parameters'
import Modal, { confirmModalClose } from './Modal'
import DatePicker from './DatePicker'

export default function StatementParametersModal({ kind, plan, busy, error, onClose, onGenerate }: { kind: StatementKind; plan: StatementPlan[]; busy: boolean; error: string; onClose: () => void; onGenerate: (values: StatementParameters[]) => void }) {
  const prefix = useId()
  const form = useRef<HTMLFormElement>(null)
  const [values, setValues] = useState<StatementParameters[]>(() => plan.map(item => ({ aidTypeId: item.aidTypeId, partIndex: item.partIndex, documentNumber: '', documentDate: '', periodStart: '', periodEnd: '' })))
  const [expanded, setExpanded] = useState(() => new Set([0]))
  const [errors, setErrors] = useState<ParameterErrors[]>([])
  const [notice, setNotice] = useState('')
  const dirty = values.some(value => value.documentNumber || value.documentDate || value.periodStart || value.periodEnd)
  const update = (index: number, field: keyof ParameterErrors, value: string) => {
    setValues(current => current.map((item,i) => i === index ? { ...item, [field]: value } : item))
    setErrors(current => current.map((item,i) => i === index ? { ...item, [field]: undefined, ...(field === 'periodStart' ? { periodEnd: undefined } : {}) } : item))
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    const next = values.map((value,index) => {
      const result = statementParameterErrors(value)
      for (const field of ['documentDate','periodStart','periodEnd'] as ('documentDate' | 'periodStart' | 'periodEnd')[]) {
        const input = document.getElementById(`${prefix}-${index}-${field}`) as HTMLInputElement | null
        if (input && !input.validity.valid) result[field] = input.validationMessage || 'Вкажіть коректну дату.'
      }
      return result
    })
    setErrors(next)
    const first = next.findIndex(item => Object.keys(item).length > 0)
    if (first >= 0) {
      setExpanded(current => new Set([...current, ...next.flatMap((item,i) => Object.keys(item).length ? [i] : [])]))
      const field = Object.keys(next[first])[0]
      requestAnimationFrame(() => document.getElementById(`${prefix}-${first}-${field}`)?.focus())
      return
    }
    onGenerate(values)
  }
  const applyDates = (index: number) => {
    const { documentDate, periodStart, periodEnd } = values[index]
    setValues(current => current.map(item => ({ ...item, documentDate, periodStart, periodEnd })))
    setErrors(current => current.map(item => ({ ...item, documentDate: undefined, periodStart: undefined, periodEnd: undefined })))
    setNotice('Дати та період застосовано до всіх документів. Номери залишено без змін.')
  }
  return <Modal title="Параметри формування" description={kind === 'personal' ? 'Вкажіть реквізити кожної персональної відомості.' : 'Вкажіть реквізити кожної зведеної відомості.'} size="wide" className="statement-parameters-modal" headerIcon={<FileText size={21}/>} busy={busy} dirty={dirty} onClose={onClose}>
    <form ref={form} noValidate onSubmit={submit}>
      <fieldset className="statement-parameter-list" disabled={busy}>{plan.map((item,index) => {
        const open = expanded.has(index)
        const id = `${prefix}-${index}`
        const fieldError = (field: keyof ParameterErrors) => errors[index]?.[field] && <span className="recipient-field-error" id={`${id}-${field}-error`} role="alert">{errors[index][field]}</span>
        return <section className="statement-parameter-card" key={statementKey(item)}>
          <button type="button" className="statement-parameter-heading" aria-expanded={open} aria-controls={`${id}-fields`} disabled={busy} onClick={() => setExpanded(current => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next })}><span><strong>{item.aidTypeName}</strong><small>{item.recordCount} призначень{kind === 'personal' ? ` · Частина ${item.partIndex + 1}` : ''}</small></span><ChevronDown size={18} aria-hidden="true"/></button>
          <div id={`${id}-fields`} hidden={!open} className="statement-parameter-fields"><div className="decision-form-grid">
            <div className="recipient-field"><label htmlFor={`${id}-documentNumber`}>Номер відомості *</label><input id={`${id}-documentNumber`} required disabled={busy} value={values[index].documentNumber} aria-invalid={!!errors[index]?.documentNumber} aria-describedby={errors[index]?.documentNumber ? `${id}-documentNumber-error` : undefined} onChange={event => update(index,'documentNumber',event.target.value)}/>{fieldError('documentNumber')}</div>
            {(['documentDate','periodStart','periodEnd'] as const).map(field => <div className="recipient-field" key={field}><label htmlFor={`${id}-${field}`}>{field === 'documentDate' ? kind === 'personal' ? 'Дата виплати' : 'Дата проведення' : field === 'periodStart' ? 'Початок періоду' : 'Кінець періоду'} *</label><DatePicker disabled={busy} error={errors[index]?.[field]} id={`${id}-${field}`} required value={values[index][field]} onChange={value => update(index,field,value)}/></div>)}
          </div>{plan.length > 1 && <button type="button" className="secondary-button green-outline-button statement-copy-dates" disabled={busy} onClick={() => applyDates(index)}><Copy size={15}/>Застосувати дати та період до всіх</button>}</div>
        </section>
      })}</fieldset>
      {notice && <Alert variant="success">{notice}</Alert>}
      {error && <Alert variant="error">{error}</Alert>}
      <div className="recipient-form-actions decision-modal-actions recipient-card-actions"><div><button type="button" className="secondary-button assignment-cancel-button" disabled={busy} onClick={() => confirmModalClose(dirty,onClose)}><X size={17} aria-hidden="true"/>Скасувати</button><button type="submit" className="primary-button" disabled={busy}>{busy ? 'Формуємо…' : 'Сформувати документи'}</button></div></div>
    </form>
  </Modal>
}
