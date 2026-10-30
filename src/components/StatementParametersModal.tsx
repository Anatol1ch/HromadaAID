import { type DocumentKind, type StatementSelection } from '../../shared/statement-groups'
import { assertUniqueStatementFileNames, statementFileName } from '../../shared/statement-filenames'
import Alert from './Alert'
import { useId, useRef, useState, type FormEvent } from 'react'
import { Check, ChevronDown, Copy, FileText, Minus, X } from 'lucide-react'
import type { StatementAssignment, StatementParameters } from '../../electron/api-contract'
import { statementKey, statementPlan, statementParameterErrors, type ParameterErrors, type StatementPlan } from '../../electron/statement-parameters'
import Modal, { confirmModalClose } from './Modal'
import DatePicker from './DatePicker'

const money = (minor: number) => new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100) + ' ₴'

export default function StatementParametersModal({ kind, rows, busy, error, onClose, onGenerate }: { kind: DocumentKind; rows: StatementAssignment[]; busy: boolean; error: string; onClose: () => void; onGenerate: (ids: string[], selection: StatementSelection[], values: StatementParameters[]) => void }) {
  const prefix = useId()
  const form = useRef<HTMLFormElement>(null)
  const banks = [...new Map(rows.filter(row => row.bankId).map(row => [row.bankId!, { id: row.bankId!, name: row.bankName ?? row.bankId! }])).values()].sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const [bankIds, setBankIds] = useState(() => new Set(banks.map(bank => bank.id)))
  const selected = rows.filter(row => row.bankId && bankIds.has(row.bankId))
  let plan: StatementPlan[] = []
  let planError = ''
  try {
    if (rows.some(row => !row.bankId || !row.bankName?.trim())) throw new Error('Є призначення без визначеного банку. Доповніть картки отримувачів і оновіть список.')
    plan = statementPlan(kind, selected)
  } catch (error) { planError = error instanceof Error ? error.message : 'Не вдалося підготувати план.' }
  const blank = (item: StatementPlan): StatementParameters => ({ aidTypeId: item.aidTypeId, bankId: item.bankId, partIndex: item.partIndex, documentNumber: '', documentDate: '', periodStart: '', periodEnd: '' })
  const [drafts, setDrafts] = useState<Record<string, StatementParameters>>({})
  const values = plan.map(item => drafts[statementKey(item)] ?? blank(item))
  const [formError, setFormError] = useState('')
  const [expandedKey, setExpandedKey] = useState<string | null>(() => plan[0] ? statementKey(plan[0]) : null)
  const [errors, setErrors] = useState<ParameterErrors[]>([])
  const [notice, setNotice] = useState('')
  const dirty = bankIds.size !== banks.length || Object.values(drafts).some(value => value.documentNumber || value.documentDate || value.periodStart || value.periodEnd)
  const update = (index: number, field: keyof ParameterErrors, value: string) => {
    setDrafts(current => ({ ...current, [statementKey(plan[index])]: { ...values[index], [field]: value } }))
    setFormError('')
    setErrors(current => current.map((item,i) => i === index ? { ...item, [field]: undefined, ...(field === 'periodStart' ? { periodEnd: undefined } : {}) } : item))
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (busy || planError || !plan.length) return
    if (kind === 'bank') { onGenerate(selected.map(row => row.id), selected.map(row => ({ id: row.id, aidTypeId: row.aidTypeId, bankId: row.bankId! })), []); return }
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
      setExpandedKey(statementKey(plan[first]))
      const field = Object.keys(next[first])[0]
      requestAnimationFrame(() => document.getElementById(`${prefix}-${first}-${field}`)?.focus())
      return
    }
    try { assertUniqueStatementFileNames(plan.map((item,index) => statementFileName(kind, values[index], item))) }
    catch (error) { setFormError(error instanceof Error ? error.message : 'Перевірте номери документів.'); return }
    onGenerate(selected.map(row => row.id), selected.map(row => ({ id: row.id, aidTypeId: row.aidTypeId, bankId: row.bankId! })), values)
  }
  const applyDates = (index: number) => {
    const { documentDate, periodStart, periodEnd } = values[index]
    setDrafts(current => ({ ...current, ...Object.fromEntries(values.map(item => [statementKey(item), { ...item, documentDate, periodStart, periodEnd }])) }))
    setErrors(current => current.map(item => ({ ...item, documentDate: undefined, periodStart: undefined, periodEnd: undefined })))
    setNotice('Дати та період застосовано до всіх документів. Номери залишено без змін.')
  }
  return <Modal title="Параметри формування" description={kind === 'bank' ? 'Виберіть банки для формування відомостей.' : kind === 'personal' ? 'Вкажіть реквізити кожної персональної відомості.' : 'Вкажіть реквізити кожної зведеної відомості.'} size="wide" className="statement-parameters-modal" headerIcon={<FileText size={21}/>} busy={busy} dirty={dirty} onClose={onClose}>
    <form ref={form} className="statement-parameters-form" noValidate onSubmit={submit}>
      <div className="statement-parameters-body">
      <fieldset className="statement-bank-selection" disabled={busy}>
        <legend>Банки</legend>
        <div className="statement-bank-options" role="group" aria-label="Вибір банків">
          <button type="button" role="checkbox" aria-checked={bankIds.size > 0 && bankIds.size < banks.length ? 'mixed' : banks.length > 0 && bankIds.size === banks.length} className="statement-bank-chip" disabled={busy || !banks.length} onClick={() => { setBankIds(bankIds.size === banks.length ? new Set() : new Set(banks.map(bank => bank.id))); setErrors([]); setFormError('') }}>
            {bankIds.size > 0 && bankIds.size < banks.length ? <Minus className="statement-bank-chip-icon" size={14} aria-hidden="true"/> : <Check className="statement-bank-chip-icon" size={14} aria-hidden="true"/>}<span>Всі банки</span>
          </button>
          {banks.map(bank => <button type="button" role="checkbox" aria-checked={bankIds.has(bank.id)} className="statement-bank-chip" disabled={busy} key={bank.id} title={bank.name} onClick={() => { setBankIds(current => { const next = new Set(current); if (next.has(bank.id)) next.delete(bank.id); else next.add(bank.id); return next }); setErrors([]); setFormError('') }}>
            <Check className="statement-bank-chip-icon" size={14} aria-hidden="true"/><span>{bank.name}{banks.some(other => other.id !== bank.id && other.name === bank.name) && <small> · {bank.id.slice(0,8)}</small>}</span>
          </button>)}
        </div>
      </fieldset>
      <div className="statement-plan-summary" role="status"><span>{plan.reduce((sum,item) => sum + item.recordCount, 0)} призначень · {plan.length} документів</span><strong>{money(plan.reduce((sum,item) => sum + item.totalMinor, 0))}</strong></div>
      {planError && <Alert variant="error">{planError}</Alert>}
      {!plan.length && !planError && <Alert variant="warning">Виберіть щонайменше один банк.</Alert>}
      <fieldset className="statement-parameter-list" disabled={busy}>{plan.map((item,index) => {
        const key = statementKey(item)
        const open = expandedKey === key
        const hasParts = kind === 'personal' && plan.some(other => other.aidTypeId === item.aidTypeId && other.bankId === item.bankId && other.partIndex > 0)
        const id = `${prefix}-${index}`
        const fieldError = (field: keyof ParameterErrors) => errors[index]?.[field] && <span className="recipient-field-error" id={`${id}-${field}-error`} role="alert">{errors[index][field]}</span>
        return <section className="statement-parameter-card" key={statementKey(item)}>
          {kind === 'bank' ? <div className="statement-parameter-heading statement-bank-document-heading">
            <span className="statement-document-titles"><strong>{item.bankName}</strong></span><span className="statement-document-meta"><strong>{money(item.totalMinor)}</strong><small>{item.recordCount} призначень</small></span>
          </div> : <button type="button" className="statement-parameter-heading" aria-expanded={open} aria-controls={`${id}-fields`} disabled={busy} onClick={() => setExpandedKey(current => current === key ? null : key)}>
            <span className="statement-document-titles"><strong>{item.aidTypeName}</strong><span>{item.bankName}</span></span>
            <span className="statement-document-meta"><strong>{money(item.totalMinor)}</strong><small>{item.recordCount} призначень{hasParts ? ` · Частина ${item.partIndex + 1}` : ''}</small></span>
            <ChevronDown size={16} aria-hidden="true"/>
          </button>}
          {kind !== 'bank' && <div id={`${id}-fields`} hidden={!open} className="statement-parameter-fields"><div className="decision-form-grid">
            <div className="recipient-field"><label htmlFor={`${id}-documentNumber`}>Номер відомості *</label><input id={`${id}-documentNumber`} required disabled={busy} value={values[index].documentNumber} aria-invalid={!!errors[index]?.documentNumber} aria-describedby={errors[index]?.documentNumber ? `${id}-documentNumber-error` : undefined} onChange={event => update(index,'documentNumber',event.target.value)}/>{fieldError('documentNumber')}</div>
            {(['documentDate','periodStart','periodEnd'] as const).map(field => <div className="recipient-field" key={field}><label htmlFor={`${id}-${field}`}>{field === 'documentDate' ? kind === 'personal' ? 'Дата виплати' : 'Дата проведення' : field === 'periodStart' ? 'Початок періоду' : 'Кінець періоду'} *</label><DatePicker disabled={busy} error={errors[index]?.[field]} id={`${id}-${field}`} required value={values[index][field]} onChange={value => update(index,field,value)}/></div>)}
          </div>{plan.length > 1 && <button type="button" className="secondary-button green-outline-button statement-copy-dates" disabled={busy} onClick={() => applyDates(index)}><Copy size={15}/>Застосувати дати та період до всіх</button>}</div>}
        </section>
      })}</fieldset>
      {notice && <Alert variant="success">{notice}</Alert>}
      {formError && <Alert variant="error">{formError}</Alert>}
      {error && <Alert variant="error">{error}</Alert>}
      </div>
      <div className="recipient-form-actions decision-modal-actions recipient-card-actions statement-parameters-actions"><div><button type="button" className="secondary-button assignment-cancel-button" disabled={busy} onClick={() => confirmModalClose(dirty,onClose)}><X size={17} aria-hidden="true"/>Скасувати</button><button type="submit" className="primary-button" disabled={busy || Boolean(planError) || !plan.length}>{busy ? 'Формуємо…' : 'Сформувати документи'}</button></div></div>
    </form>
  </Modal>
}
