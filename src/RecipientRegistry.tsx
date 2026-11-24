import DataState from './components/DataState'
import Alert from './components/Alert'
import { copyAddress, formatAddress, validateAddress, type AddressParts } from '../electron/address'
import DictionaryTable, { DictionarySearch, DictionaryToolbar } from './components/DictionaryTable'
import AddressEditor from './components/AddressEditor'
import FormattedInput from './components/FormattedInput'
import { fieldFormatError, fieldFormatHints, isFormattedField, validUkrainianIban } from '../electron/field-formats'
import { assignmentStatusColor } from '../electron/assignment-model'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import { AlertTriangle, Check, CircleAlert, CircleCheck, CircleHelp, ContactRound, Copy, Eye, Landmark, MapPin, Pencil, Plus, ShieldCheck, Trash2, UserRound, X } from 'lucide-react'
import type { AssignmentRecord, BankRecord, DeletePreview, DuplicateMatch, RecipientInput, RecipientRecord, RecipientSaveResult, RecipientSummary } from '../electron/api-contract'
import { bankRepository } from './services/bankRepository'
import BankFormModal from './components/BankFormModal'
import { bankForDetail, bankSearchText, onlyBankDetail } from './lib/bankSelection'
import { recipientRepository } from './services/recipientRepository'
import Modal from './components/Modal'
import { confirmModalClose } from './components/Modal'
import DeleteConfirmation from './components/DeleteConfirmation'
import Select from './components/Select'
import { formatDate } from './lib/dates'
import { recipientTextFields, validateRecipientInput, type RecipientErrors, type RecipientTextField } from '../electron/recipient-validation'
import { notifySystemToast } from './components/SystemToastHost'

const emptyRecipient: RecipientInput = {
  lastName: '', firstName: '', patronymic: '', rnokpp: '', sex: '', address: '', registeredAddress: '', addressParts: null, registeredAddressParts: null, isVpo: null,
  phone: '', email: '', bankAccount: '', bankDetailsId: '', passport: '',
}

export function recipientInputFromRecord(recipient: RecipientRecord): RecipientInput {
  return {
    lastName: recipient.lastName,
    firstName: recipient.firstName,
    patronymic: recipient.patronymic ?? '',
    rnokpp: recipient.rnokpp ?? '',
    sex: recipient.sex ?? '',
    isVpo: recipient.isVpo,
    address: recipient.address ?? '',
    registeredAddress: recipient.registeredAddress ?? '',
    addressParts: recipient.addressParts,
    registeredAddressParts: recipient.registeredAddressParts,
    phone: recipient.phone ?? '',
    email: recipient.email ?? '',
    bankAccount: recipient.bankAccount ?? '',
    bankDetailsId: recipient.bankDetailsId ?? '',
    passport: recipient.passport ?? '',
  }
}

function RecipientRegistry({ embedded = false, readOnly = false }: { embedded?: boolean; readOnly?: boolean }) {
  const [recipients, setRecipients] = useState<RecipientSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [form, setForm] = useState<RecipientInput | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingUpdatedAt, setEditingUpdatedAt] = useState<string | null>(null)
  const [viewing, setViewing] = useState<RecipientRecord | null>(null)
  const [history, setHistory] = useState<AssignmentRecord[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [detailError, setDetailError] = useState('')
  const [deletePreview, setDeletePreview] = useState<DeletePreview | null>(null)

  const loadRecipients = async () => {
    setLoading(true); setLoadError('')
    setError('')
    try {
      setRecipients(await recipientRepository.list(true))
    } catch {
      setLoadError('Не вдалося завантажити список. Перевірте підключення до сервера й повторіть спробу.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadRecipients() }, [])

  const visibleRecipients = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('uk')
    return recipients.filter((recipient) => recipient.fullName.toLocaleLowerCase('uk').includes(query) || (recipient.rnokpp ?? '').includes(query))
  }, [recipients, search])

  const beginCreate = () => {
    const initial: RecipientInput = { ...emptyRecipient }
    setForm(initial)
    setEditingId(null)
    setEditingUpdatedAt(null)
    setError('')
  }

  const beginEdit = async (id: string) => {
    setError('')
    try {
      const recipient = await recipientRepository.get(id)
      if (!recipient) {
        setError('Картку не знайдено. Оновіть список.')
        return
      }
      setForm(recipientInputFromRecord(recipient))
      setEditingId(recipient.id)
      setEditingUpdatedAt(recipient.updatedAt)
    } catch {
      setError('Не вдалося відкрити картку. Спробуйте оновити список.')
    }
  }

  const openDetails = async (id: string) => {
    setDetailError('')
    setHistoryError('')
    setHistory([])
    setHistoryLoading(true)
    try {
      const recipient = await recipientRepository.get(id)
      if (recipient) {
        setViewing(recipient)
        try { setHistory(await recipientRepository.assignmentHistory(id)) }
        catch { setHistoryError('Не вдалося завантажити історію призначень. Спробуйте відкрити картку ще раз.') }
      } else setDetailError('Картку не знайдено. Оновіть список.')
    } catch {
      setDetailError('Не вдалося відкрити картку. Спробуйте ще раз.')
    } finally {
      setHistoryLoading(false)
    }
  }

  const requestRecipientDelete = async (recipient: RecipientSummary) => {
    try {
      const preview = await window.hromadaAid.deletion.preview('recipient', recipient.id)
      if (!preview) setError('Картку не знайдено. Оновіть список.')
      else setDeletePreview(preview)
    } catch { setError('Не вдалося перевірити пов’язані дані картки.') }
  }

  return <>
    {!embedded && <section className="page-heading registry-heading">
      <div><div className="eyebrow">ОТРИМУВАЧІ • СЕРВЕРНІ ДАНІ</div><h1>Реєстр отримувачів</h1><p className="subtitle">Картки людей зберігаються окремо від рішень і призначень допомоги</p></div>
      {!readOnly && <button className="primary-button" onClick={beginCreate}><Plus size={19}/>Додати отримувача</button>}
    </section>}

    {error && !form && <Alert variant="error" action={<button type="button" onClick={() => void loadRecipients()}>Оновити список</button>}>{error}</Alert>}

    {form && <RecipientFormModal key={editingId ?? "new"} initial={form} editingId={editingId ?? undefined} expectedUpdatedAt={editingUpdatedAt ?? undefined} onView={(id) => void openDetails(id)} onClose={() => { setForm(null); setEditingId(null); setEditingUpdatedAt(null) }} onSaved={() => { setForm(null); setEditingId(null); setEditingUpdatedAt(null); void loadRecipients() }}/>}

    <section className="dashboard-panel registry-panel dictionary-registry">
      <DictionaryToolbar unavailable={Boolean(loadError)} title="Отримувачі" count={`Карток: ${visibleRecipients.length}${search.trim() ? ` з ${recipients.length}` : ''}`} loading={loading}>
        <DictionarySearch value={search} onChange={setSearch} placeholder="ПІБ або РНОКПП" label="Пошук отримувачів за ПІБ або РНОКПП"/>
        {!readOnly && <button className="primary-button" onClick={beginCreate}><Plus size={17}/>Додати отримувача</button>}
      </DictionaryToolbar>
      <DictionaryTable error={loadError} onRetry={() => void loadRecipients()} label="Отримувачі" className="dictionary-recipients" loading={loading} filtered={Boolean(search.trim())} empty={!visibleRecipients.length ? search.trim() ? 'За заданими параметрами нічого не знайдено' : 'Отримувачів поки немає. Додайте першу картку.' : undefined} columns={[
        {label:'Отримувач',width:'23%'},{label:'РНОКПП',width:'106px'},{label:'Стать',width:'72px'},{label:'ВПО',width:'46px',className:'dictionary-center'},
        {label:'Контакт',width:'128px'},{label:'Адреса реєстрації'},{label:'Оновлено',width:'96px'},{label:'Дії',width:'114px',className:'dictionary-actions-cell'},
      ]}>
        {visibleRecipients.map(recipient => <tr key={recipient.id}>
          <td><span className="registry-name">{recipient.fullName}</span>{recipient.isDemo && <span className="demo-recipient-badge">Демо</span>}</td>
          <td className="dictionary-nowrap">{recipient.rnokpp || '—'}</td><td className="dictionary-nowrap">{recipient.sex || '—'}</td><td className="dictionary-center">{recipient.isVpo === null ? '—' : recipient.isVpo ? 'Так' : 'Ні'}</td>
          <td className="dictionary-nowrap">{recipient.phone || '—'}</td><td><span className="dictionary-address" title={recipient.registeredAddress || undefined} tabIndex={recipient.registeredAddress ? 0 : undefined}>{recipient.registeredAddress || '—'}</span></td><td className="dictionary-nowrap">{formatDate(recipient.updatedAt)}</td>
          <td className="dictionary-actions-cell"><div className="registry-row-actions"><button type="button" className="table-action" title="Переглянути картку" aria-label={`Відкрити картку: ${recipient.fullName}`} onClick={() => void openDetails(recipient.id)}><Eye size={17}/></button>{!readOnly && <><button type="button" className="table-action" title="Редагувати картку" aria-label={`Редагувати картку: ${recipient.fullName}`} onClick={() => void beginEdit(recipient.id)}><Pencil size={16}/></button><button type="button" className="table-action danger-action" title="Видалити картку" aria-label={`Видалити картку: ${recipient.fullName}`} onClick={() => void requestRecipientDelete(recipient)}><Trash2 size={16}/></button></>}</div></td>
        </tr>)}
      </DictionaryTable>
    </section>
    <p className="registry-storage-note"><UserRound size={16}/> Дані зберігаються в центральній базі на сервері HromadaAID.</p>
    {detailError && <Alert variant="error" action={<button type="button" onClick={() => setDetailError('')}>Закрити</button>}>{detailError}</Alert>}
    {viewing && <RecipientDetails recipient={viewing} history={history} historyLoading={historyLoading} historyError={historyError} onClose={() => setViewing(null)} onEdit={readOnly ? undefined : () => { setViewing(null); void beginEdit(viewing.id) }}/>}
    {deletePreview && <DeleteConfirmation preview={deletePreview} onClose={() => setDeletePreview(null)} onDeleted={async () => { setDeletePreview(null); await loadRecipients() }}/>}
  </>
}

export function RecipientFormModal({ initial = emptyRecipient, editingId, expectedUpdatedAt, onClose, onSaved, onView, onUseExisting }: {
  initial?: RecipientInput; editingId?: string; expectedUpdatedAt?: string; onClose: () => void; onSaved: (recipient: RecipientRecord) => void; onView?: (id: string) => void; onUseExisting?: (id: string) => void
}) {
  const [form, setForm] = useState<RecipientInput>(() => ({ ...initial }))
  const addressErrorId = useId()
  const formId = useId()
  const initialFormRef = useRef(JSON.stringify(initial))
  const formRef = useRef<HTMLFormElement>(null)
  const [fieldErrors, setFieldErrors] = useState<RecipientErrors>({})
  const [ibanCheck, setIbanCheck] = useState<'' | 'valid' | 'invalid'>('')
  const [banks, setBanks] = useState<BankRecord[]>([])
  const [banksLoading, setBanksLoading] = useState(true)
  const [bankError, setBankError] = useState('')
  const [bankRevision, setBankRevision] = useState(0)
  const [bankChoice, setBankChoice] = useState<string | null>(null)
  const [showBankForm, setShowBankForm] = useState(false)
  const [addressEditor, setAddressEditor] = useState<'registeredAddress' | 'address' | null>(null)
  const [fieldTooltip, setFieldTooltip] = useState<{ left: number; top: number; text: string } | null>(null)
  useEffect(() => {
    let active = true
    setBanksLoading(true)
    void bankRepository.list().then(rows => { if (active) { setBanks(rows); setBankError('') } }, () => { if (active) setBankError('Не вдалося завантажити банки. Оновіть список.') }).finally(() => { if (active) setBanksLoading(false) })
    return () => { active = false }
  }, [bankRevision])
  const selectedBankId = bankChoice ?? bankForDetail(banks, form.bankDetailsId)?.id ?? ''
  const selectedBank = banks.find(bank => bank.id === selectedBankId)
  const selectedDetail = selectedBank?.details.find(detail => detail.id === form.bankDetailsId)
  const initialBankId = bankForDetail(banks, initial.bankDetailsId)?.id ?? ''
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [error, setError] = useState('')
  const [duplicate, setDuplicate] = useState<Extract<RecipientSaveResult, { ok: false }> | null>(null)
  const [viewing, setViewing] = useState<RecipientRecord | null>(null)
  const [history, setHistory] = useState<AssignmentRecord[]>([])
  const [historyError, setHistoryError] = useState('')
  const closeForm = () => { if (!savingRef.current) onClose() }
  const dirty = JSON.stringify(form) !== initialFormRef.current || (bankChoice !== null && bankChoice !== initialBankId)
  const updateField = (key: keyof RecipientInput, value: string | boolean | null) => {
    const next = { ...form, [key]: value } as RecipientInput
    setForm(next)
    setDuplicate(null)
    setError('')
    if (key === 'bankAccount') setIbanCheck('')
    if (fieldErrors[key]) {
      const validation = validateRecipientInput(next)
      setFieldErrors((current) => ({ ...current, [key]: validation.errors[key] }))
    }
  }
  const openDetails = async (id: string) => {
    if (onView) { onView(id); return }
    try {
      const person = await recipientRepository.get(id)
      if (!person) { setError('Картку не знайдено.'); return }
      setHistory([]); setHistoryError('')
      try { setHistory(await recipientRepository.assignmentHistory(id)) }
      catch { setHistoryError('Не вдалося завантажити історію призначень.') }
      setViewing(person)
    } catch { setError('Не вдалося відкрити картку для перевірки збігу.') }
  }
  const save = async (confirmSameName = false) => {
    if (savingRef.current) return
    const validation = validateRecipientInput(form)
    if (banksLoading || bankError) { setError('Спочатку завантажте довідник банків.'); return }
    const errors: RecipientErrors = { ...validation.errors }
    if (validation.ok && !selectedDetail) errors.bankDetailsId = 'Оберіть наявний банк і конкретний набір реквізитів.'
    setFieldErrors(errors)
    if (!validation.ok || !selectedDetail) {
      setError('Перевірте виділені поля картки.')
      const fields = formRef.current?.querySelectorAll<HTMLElement>('[data-recipient-field]')
      const first = Array.from(fields ?? []).find((field) => errors[field.dataset.recipientField as keyof RecipientInput])
      first?.querySelector<HTMLElement>('input, button')?.focus()
      return
    }
    savingRef.current = true; setSaving(true); setError(''); setDuplicate(null)
    try {
      const result = await recipientRepository.save(validation.input, editingId, confirmSameName, expectedUpdatedAt)
      if (result.ok) { notifySystemToast('success', editingId ? 'Дані отримувача збережено' : 'Отримувача створено', editingId ? 'Картку отримувача оновлено.' : 'Картку отримувача створено.'); onSaved(result.recipient); return }
      if (result.reason === 'name-match' || result.reason === 'rnokpp-match') setDuplicate(result)
      else setError(result.message)
    } catch { setError('Не вдалося зберегти картку. Дані у формі залишилися — спробуйте ще раз.') }
    finally { savingRef.current = false; setSaving(false) }
  }
  const applyAddress = (key: 'registeredAddress' | 'address', parts: AddressParts | null) => {
    const partsKey = key === 'registeredAddress' ? 'registeredAddressParts' : 'addressParts'
    setForm(current => ({ ...current, [key]: formatAddress(parts), [partsKey]: parts ? copyAddress(parts) : null }))
    setFieldErrors(current => ({ ...current, [key]: undefined }))
    setDuplicate(null); setError('')
  }
  const showFieldTooltip = (target: HTMLElement, text: string) => {
    const rect = target.getBoundingClientRect()
    const width = Math.min(280, window.innerWidth - 24)
    const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))
    const top = rect.bottom + 88 <= window.innerHeight - 8 ? rect.bottom + 8 : Math.max(8, rect.top - 80)
    setFieldTooltip({ left, top, text })
  }
  const addressCard = (key: 'registeredAddress' | 'address') => {
    const registration = key === 'registeredAddress'
    const label = registration ? 'Адреса реєстрації' : 'Адреса проживання'
    const parts = registration ? form.registeredAddressParts : form.addressParts
    const value = formatAddress(parts) || form[key]
    const sourceParts = registration ? form.addressParts : form.registeredAddressParts
    const sourceValid = validateAddress(sourceParts).ok
    const tooltipId = `${addressErrorId}${key}-help`
    return <div className={'recipient-address-card' + (fieldErrors[key] ? ' recipient-address-invalid' : '')} data-recipient-field={key}>
      <strong className="recipient-address-heading"><span>{label} <RequiredMark/></span>{!registration && <FieldHelpButton id={tooltipId} label="Пояснення щодо адреси проживання" disabled={saving} text="Адреса проживання використовується під час формування персональних списків виплат для органів Казначейства." onShow={showFieldTooltip} onHide={() => setFieldTooltip(null)}/>}</strong>
      <div className="recipient-address-info"><MapPin size={15} aria-hidden="true"/><div><p>{value || 'Адресу ще не зазначено'}</p>{!value && <small>Додайте або скопіюйте адресу.</small>}</div></div>
      <div className="recipient-address-actions"><div className="recipient-address-primary-actions"><button type="button" className="secondary-button recipient-address-edit" data-address-edit disabled={saving} aria-label={(value ? 'Змінити: ' : 'Додати: ') + label} aria-invalid={!!fieldErrors[key]} aria-describedby={fieldErrors[key] ? addressErrorId + key : undefined} onClick={() => setAddressEditor(key)}>{value ? <Pencil size={14}/> : <Plus size={14}/>}<span>{value ? 'Змінити' : 'Додати'}</span></button>
        <button type="button" className="secondary-button danger-action recipient-address-clear" disabled={saving || !(value || parts)} onClick={() => applyAddress(key, null)}><Trash2 size={14}/><span>Очистити</span></button></div>
        <button type="button" className="secondary-button recipient-address-copy" disabled={saving || !sourceValid} onClick={() => { if (sourceParts && sourceValid) applyAddress(key, copyAddress(sourceParts)) }}><Copy size={14}/><span>Копіювати з адреси {registration ? 'проживання' : 'реєстрації'}</span></button>
      </div>{fieldErrors[key] && <span className="recipient-field-error" id={addressErrorId + key} role="alert">{fieldErrors[key]}</span>}
    </div>
  }
  const textField = (key: RecipientTextField, options: { type?: string; autoComplete?: string; inputMode?: 'text' | 'numeric' | 'tel'; placeholder?: string; hideHint?: boolean; help?: string; fixedPrefix?: string } = {}) => <TextField
    field={key} {...recipientTextFields[key]} value={form[key]} error={fieldErrors[key]} disabled={saving}
    onChange={(value) => updateField(key, value)} showTooltip={showFieldTooltip} hideTooltip={() => setFieldTooltip(null)} {...options}/>
  const checkIban = () => setIbanCheck(validUkrainianIban(form.bankAccount.replace(/\s/g, '')) ? 'valid' : 'invalid')
  return <>
    <Modal title={editingId ? 'Редагування картки' : 'Нова картка отримувача'} description="Заповніть відомості про отримувача матеріальної допомоги." onClose={closeForm} dirty={!saving && dirty} busy={saving} size="large" className="recipient-card-modal recipient-editor-modal" footer={<div className="recipient-form-actions recipient-card-actions"><span className="recipient-required-note"><RequiredMark/> {editingId ? 'Обов’язкові поля картки.' : 'Обов’язкові поля для створення картки.'}</span><button type="button" className="secondary-button assignment-cancel-button" onClick={() => confirmModalClose(dirty, closeForm)} disabled={saving}><X size={17} aria-hidden="true"/>Скасувати</button><button className="primary-button" type="submit" form={formId} disabled={saving}><Check size={17} aria-hidden="true"/>{saving ? 'Збереження…' : editingId ? 'Зберегти зміни' : 'Створити картку'}</button></div>}>
      <form id={formId} ref={formRef} className="recipient-card-form" noValidate onSubmit={(event) => { event.preventDefault(); void save() }}>
        <fieldset className="recipient-fieldset"><legend><UserRound size={16} aria-hidden="true"/>Особисті дані</legend><div className="recipient-form-grid recipient-personal-grid">
          {textField('lastName', { autoComplete: 'family-name', placeholder: 'Введіть прізвище' })}
          {textField('firstName', { autoComplete: 'given-name', placeholder: 'Введіть ім’я' })}
          {textField('patronymic', { autoComplete: 'additional-name', placeholder: 'Введіть по батькові' })}
          {textField('passport', { placeholder: 'Введіть номер паспорта', hideHint: true, help: 'Паспорт-книжечка: дві українські літери та шість цифр (АА123456). ID-картка: дев’ять цифр.' })}
          {textField('rnokpp', { inputMode: 'numeric', placeholder: 'Введіть РНОКПП', hideHint: true, help: 'Реєстраційний номер облікової картки платника податків складається з 10 цифр.' })}
          <div className="recipient-field" data-recipient-field="sex"><span aria-hidden="true">Стать <RequiredMark/></span><Select label="Стать" required disabled={saving} error={fieldErrors.sex} value={form.sex} onChange={(value) => updateField('sex', value)} placeholder="Оберіть значення" options={[{ value: 'Чоловік', label: 'Чоловік' }, { value: 'Жінка', label: 'Жінка' }]}/></div>
          <div className="recipient-field" data-recipient-field="isVpo"><span aria-hidden="true">Внутрішньо переміщена особа <RequiredMark/></span><Select label="Внутрішньо переміщена особа" required disabled={saving} error={fieldErrors.isVpo} value={form.isVpo === null ? '' : form.isVpo ? 'yes' : 'no'} onChange={(value) => updateField('isVpo', value === '' ? null : value === 'yes')} placeholder="Оберіть значення" options={[{ value: 'no', label: 'Ні' }, { value: 'yes', label: 'Так' }]}/></div>
        </div></fieldset>
        <fieldset className="recipient-fieldset"><legend><MapPin size={16} aria-hidden="true"/>Адреси</legend><div className="recipient-form-grid recipient-address-grid">
          {addressCard('registeredAddress')}
          {addressCard('address')}
        </div></fieldset>
        <fieldset className="recipient-fieldset"><legend><ContactRound size={16} aria-hidden="true"/>Контактні дані</legend><div className="recipient-form-grid recipient-contact-grid">
          {textField('phone', { type: 'tel', autoComplete: 'tel', placeholder: 'XX XXX XX XX', hideHint: true, fixedPrefix: '+380' })}
          {textField('email', { autoComplete: 'email', placeholder: 'Введіть електронну пошту', hideHint: true, help: 'Наприклад: name@example.com' })}
        </div></fieldset>
        <fieldset className="recipient-fieldset"><legend><Landmark size={16} aria-hidden="true"/>Банківські реквізити</legend><div className="recipient-form-grid recipient-bank-grid">
          <div className="recipient-iban-field" data-iban-check={ibanCheck || undefined}><TextField
            field="bankAccount" {...recipientTextFields.bankAccount} value={form.bankAccount} error={fieldErrors.bankAccount} disabled={saving}
            onChange={(value) => updateField('bankAccount', value)} showTooltip={showFieldTooltip} hideTooltip={() => setFieldTooltip(null)} placeholder="XX XXXXXX XXXXXXXXXXXXXXXXXXX" hideHint fixedPrefix="UA" help="Український IBAN складається з коду UA та 27 цифр." action={<button type="button" className="secondary-button recipient-iban-check" disabled={saving || !form.bankAccount.trim()} onClick={checkIban}><ShieldCheck size={17}/><span>Перевірити</span></button>}/>
            {ibanCheck && <span className={`recipient-iban-feedback ${ibanCheck === 'valid' ? 'recipient-iban-success' : 'recipient-iban-failure'}`} role="status">{ibanCheck === 'valid' ? <><CircleCheck size={15} aria-hidden="true"/>Формат і контрольна сума IBAN коректні.</> : <><CircleAlert size={15} aria-hidden="true"/>IBAN має некоректний формат або контрольну суму.</>}</span>}
          </div>
          <div className="recipient-field" data-recipient-field={!selectedBankId ? 'bankDetailsId' : undefined}><span aria-hidden="true">Найменування банку <RequiredMark/></span><div className="recipient-bank-picker"><Select label="Найменування банку" required searchable disabled={saving || banksLoading} value={selectedBankId} error={!selectedBankId ? fieldErrors.bankDetailsId : undefined} placeholder={banksLoading ? 'Завантаження…' : 'Оберіть банк'} options={banks.map(bank => ({ value: bank.id, label: bank.name, description: bank.details.length + ' наборів реквізитів', searchText: bankSearchText(bank) }))} onChange={id => { if (id === selectedBankId) return; const bank = banks.find(item => item.id === id); setBankChoice(id); updateField('bankDetailsId', onlyBankDetail(bank)) }}/><button type="button" className="secondary-button assignment-create-button" aria-label="Створити новий банк" title="Створити новий банк" disabled={saving || banksLoading} onClick={() => setShowBankForm(true)}><Plus size={18}/></button></div></div>
          <div className="recipient-field recipient-bank-detail-picker" data-recipient-field="bankDetailsId"><span aria-hidden="true">Банківські реквізити <RequiredMark/></span><Select label="Банківські реквізити" required searchable value={form.bankDetailsId} disabled={saving || !selectedBank || selectedBank.details.length <= 1} error={selectedBankId ? fieldErrors.bankDetailsId : undefined} placeholder={selectedBank ? selectedBank.details.length ? 'Оберіть пару МФО та ЄДРПОУ' : 'Набори реквізитів відсутні' : 'Спочатку оберіть банк'} options={(selectedBank?.details ?? []).map(detail => ({ value: detail.id, label: `МФО ${detail.mfo} · ЄДРПОУ ${detail.edrpou}` }))} renderValue={option => <BankPair label={option.label}/>} renderOption={option => <BankPair label={option.label}/>} onChange={id => updateField('bankDetailsId', id)}/></div>
          {bankError && <Alert variant="error" className="recipient-bank-error" action={<button type="button" onClick={() => setBankRevision(current => current + 1)}>Оновити банки</button>}>{bankError}</Alert>}
        </div></fieldset>
        {error && <Alert variant="error">{error}</Alert>}
        {duplicate && <DuplicateNotice result={duplicate} onView={openDetails} onCreateSeparate={() => void save(true)} saving={saving} onUseExisting={onUseExisting ? (id) => confirmModalClose(dirty, () => onUseExisting(id)) : undefined}/>}
      </form>
    </Modal>
    {viewing && <RecipientDetails recipient={viewing} history={history} historyLoading={false} historyError={historyError} onClose={() => setViewing(null)}/>}
    {addressEditor && <AddressEditor initial={addressEditor === 'registeredAddress' ? form.registeredAddressParts : form.addressParts} legacyText={form[addressEditor]} kind={addressEditor === 'registeredAddress' ? 'registration' : 'residence'} onClose={() => setAddressEditor(null)} onSave={parts => { applyAddress(addressEditor, parts); setAddressEditor(null) }}/>}
    {showBankForm && <BankFormModal onClose={() => setShowBankForm(false)} onSaved={bank => {
      setBanks(current => [...current.filter(item => item.id !== bank.id), bank].sort((a, b) => a.name.localeCompare(b.name, 'uk')))
      setBankChoice(bank.id); updateField('bankDetailsId', onlyBankDetail(bank)); setShowBankForm(false)
    }}/>}
    {fieldTooltip && createPortal(<span className="recipient-address-tooltip" role="tooltip" aria-hidden="true" style={{ left: fieldTooltip.left, top: fieldTooltip.top }}>{fieldTooltip.text}</span>, document.body)}
  </>
}

function RequiredMark() { return <span className="recipient-required-mark" aria-hidden="true">*</span> }

function TextField({ field, label, value, onChange, maxLength, required, error, disabled, type = 'text', autoComplete, inputMode, placeholder, hideHint = false, help, fixedPrefix, action, showTooltip, hideTooltip }: {
  field: RecipientTextField; label: string; value: string; onChange: (value: string) => void; maxLength: number; required: boolean; error?: string; disabled: boolean; type?: string; autoComplete?: string; inputMode?: 'text' | 'numeric' | 'tel'; placeholder?: string; hideHint?: boolean; help?: string; fixedPrefix?: string; action?: ReactNode; showTooltip: (target: HTMLElement, text: string) => void; hideTooltip: () => void
}) {
  const id = useId()
  const [touched, setTouched] = useState(false)
  const errorId = 'recipient-error-' + id
  const hintId = 'recipient-hint-' + id
  const labelId = 'recipient-label-' + id
  const controlId = 'recipient-input-' + id
  const formatted = isFormattedField(field)
  const message = error || (touched && formatted ? fieldFormatError(field, value) : '')
  const hint = formatted && !hideHint ? fieldFormatHints[field] : ''
  const props = { id: controlId, name: field, type, value, maxLength, required, disabled, placeholder, 'aria-labelledby': labelId, 'aria-invalid': Boolean(message), 'aria-describedby': [hint ? hintId : '', message ? errorId : ''].filter(Boolean).join(' ') || undefined, autoComplete, inputMode, onBlur: () => setTouched(true), onChange }
  const input = action ? <FormattedInput {...props} kind={field as 'bankAccount'} showPlaceholderOnEmpty={Boolean(placeholder)} separatePrefix={Boolean(fixedPrefix)}/> : formatted ? <FormattedInput {...props} kind={field} showPlaceholderOnEmpty={Boolean(placeholder)} separatePrefix={Boolean(fixedPrefix)}/> : <input {...props} onChange={event => onChange(event.target.value)}/>
  const labelContent = <div className="recipient-field-label"><label id={labelId} htmlFor={controlId}>{label}{required && <> <RequiredMark/></>}</label>{help && <FieldHelpButton id={hintId} label={`Пояснення: ${label}`} disabled={disabled} text={help} onShow={showTooltip} onHide={hideTooltip}/>}</div>
  const prefixKind = field === 'bankAccount' ? 'iban' : field
  const renderedInput = fixedPrefix ? <span className={`recipient-prefixed-input recipient-prefixed-${prefixKind}${message ? ' recipient-prefixed-invalid' : ''}`}><span className="recipient-input-prefix" aria-hidden="true" onClick={event => event.currentTarget.parentElement?.querySelector('input')?.focus()}>{fixedPrefix}</span>{input}</span> : input
  return action
    ? <div className="recipient-field" data-recipient-field={field}>{labelContent}<div className="recipient-iban-input-row">{renderedInput}{action}</div>{hint && <span className="recipient-field-hint" id={hintId}>{hint}</span>}{message && <span id={errorId} className="recipient-field-error" role="alert">{message}</span>}</div>
    : <div className="recipient-field" data-recipient-field={field}>{labelContent}{renderedInput}{hint && <span className="recipient-field-hint" id={hintId}>{hint}</span>}{message && <span id={errorId} className="recipient-field-error" role="alert">{message}</span>}</div>
}
function FieldHelpButton({ id, label, text, disabled, onShow, onHide }: { id: string; label: string; text: string; disabled: boolean; onShow: (target: HTMLElement, text: string) => void; onHide: () => void }) { return <span className="recipient-address-help-wrap"><button type="button" className="recipient-address-help" aria-label={label} aria-describedby={id} disabled={disabled} onPointerEnter={event => onShow(event.currentTarget, text)} onPointerLeave={event => { if (!event.currentTarget.matches(':focus-visible')) onHide() }} onFocus={event => onShow(event.currentTarget, text)} onBlur={onHide}><CircleHelp size={15} aria-hidden="true"/></button><span className="visually-hidden" id={id}>{text}</span></span> }
function BankPair({ label }: { label: string }) { const match = /^МФО (.*?) · ЄДРПОУ (.*)$/.exec(label); if (!match) return <span>{label}</span>; return <span className="recipient-bank-pair"><span><strong>МФО</strong> <b>{match[1]}</b></span><span><strong>ЄДРПОУ</strong> <b>{match[2]}</b></span></span> }
function DuplicateNotice({ result, onView, onCreateSeparate, saving, onUseExisting }: {
  result: Extract<RecipientSaveResult, { ok: false }>; onView: (id: string) => void; onCreateSeparate: () => void; saving: boolean; onUseExisting?: (id: string) => void
}) {
  const sameName = result.reason === 'name-match'
  return <Alert variant="warning" icon={null} className={`duplicate-notice ${sameName ? 'name-match' : 'identifier-match'}`}>
    <div className="duplicate-notice-heading"><AlertTriangle size={20}/><strong>{sameName ? 'Знайдено збіг ПІБ — перевірте картку' : 'Цей РНОКПП уже зареєстрований'}</strong></div><p>{result.message}</p>
    <ul>{result.matches.map((match: DuplicateMatch) => <li key={match.id}><span>{match.fullName}{match.rnokpp ? ` • РНОКПП ${match.rnokpp}` : ''}</span><button type="button" onClick={() => void onView(match.id)}>Переглянути</button>{onUseExisting && <button type="button" onClick={() => onUseExisting(match.id)}>Використати картку</button>}</li>)}</ul>
    {sameName && <div className="duplicate-actions"><button type="button" className="secondary-button" onClick={onCreateSeparate} disabled={saving}>Створити окрему картку</button><span>Система не об’єднуватиме записи автоматично.</span></div>}
  </Alert>
}
function RecipientDetails({ recipient, history, historyLoading, historyError, onClose, onEdit }: { recipient: RecipientRecord; history: AssignmentRecord[]; historyLoading: boolean; historyError: string; onClose: () => void; onEdit?: () => void }) {
  const details: [string, [string, string | null][]][] = [
    ['Особисті дані', [['ПІБ', recipient.fullName], ['РНОКПП', recipient.rnokpp], ['Серія та номер паспорта', recipient.passport], ['Стать', recipient.sex]]],
    ['Адреси та контактні дані', [['Адреса проживання', recipient.address], ['Адреса реєстрації', recipient.registeredAddress], ['Телефон', recipient.phone], ['Електронна пошта', recipient.email], ['Ознака ВПО', recipient.isVpo === null ? null : recipient.isVpo ? 'Так' : 'Ні']]],
    ['Банківські реквізити', [['Поточний рахунок', recipient.bankAccount], ['Банк', recipient.bankName], ['МФО банку', recipient.bankMfo], ['ЄДРПОУ банку', recipient.bankEdrpou]]],
  ]
  return <Modal title="Картка отримувача" description={recipient.isDemo ? 'Синтетичний демонстраційний запис' : 'Запис у базі даних сервера'} onClose={onClose} size="large"><div className="recipient-details"><div className="detail-avatar"><UserRound size={22}/></div>
    {details.map(([section, fields]) => <section className="recipient-detail-section" key={section}><h3>{section}</h3><div className="recipient-detail-grid">{fields.map(([label, value]) => <div className="recipient-detail-item" key={label}><span>{label}</span><strong>{value || 'Не вказано'}</strong></div>)}</div></section>)}
    <section className="recipient-history" aria-labelledby="recipient-history-title"><div className="recipient-history-heading"><h3 id="recipient-history-title">Історія призначень</h3><span>{historyLoading ? 'Завантаження…' : historyError ? 'Дані недоступні' : `${history.length} записів`}</span></div>
      {historyError ? <Alert variant="error">{historyError}</Alert> : historyLoading ? <DataState kind="loading" compact message="Завантажуємо історію…"/> : history.length ? <div className="recipient-history-table-wrap"><table className="recipient-history-table"><thead><tr><th>Рішення</th><th>Дата</th><th>Вид допомоги</th><th>Сума</th><th>Статус</th></tr></thead><tbody>{history.map((item) => <tr key={item.id}><td>№ {item.decisionNumber}</td><td>{formatDate(item.decisionDate)}</td><td>{item.aidTypeName}<small>{item.programName}</small></td><td className="history-amount">{formatMoneyMinor(item.amountMinor)}</td><td><span className={`status-badge status-${assignmentStatusColor[item.status]}`}>{item.status}</span></td></tr>)}</tbody></table></div> : <DataState kind="empty" compact message="Для цього отримувача ще немає призначень."/>}
    </section><div className="detail-history-note"><MapPin size={17}/><span>Редагування персональних даних не змінює суми та історію призначень.</span></div><footer><button type="button" className="secondary-button" onClick={onClose}>Закрити</button>{onEdit && <button type="button" className="primary-button" onClick={onEdit}><Pencil size={17}/>Редагувати дані</button>}</footer>
  </div></Modal>
}
function formatMoneyMinor(value: number) { return `${new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value / 100)} ₴` }
export default RecipientRegistry
