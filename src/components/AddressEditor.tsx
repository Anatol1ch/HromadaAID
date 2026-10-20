import Alert from './Alert'
import { useId, useRef, useState } from 'react'
import { Check, MapPin, X } from 'lucide-react'
import { ADDRESS_TEMPLATES, SETTLEMENT_TYPES, STREET_TYPES, addressLabels, applyAddressTemplate, copyAddress, emptyAddress, formatAddress, validateAddress, type AddressErrors, type AddressParts } from '../../electron/address'
import Modal, { confirmModalClose } from './Modal'
import Select from './Select'

const typeLabel = (value: string) => value[0].toLocaleUpperCase('uk') + value.slice(1)

/** Draft-only editor. The recipient is changed exclusively by the onSave callback. */
export default function AddressEditor({ initial, legacyText, kind, onSave, onClose }: {
  initial: AddressParts | null; legacyText?: string; kind: 'registration' | 'residence'
  onSave: (address: AddressParts) => void; onClose: () => void
}) {
  const id = useId()
  const [draft, setDraft] = useState<AddressParts>(() => initial ? copyAddress(initial) : emptyAddress())
  const baseline = useRef(JSON.stringify(draft))
  const formRef = useRef<HTMLFormElement>(null)
  const [errors, setErrors] = useState<AddressErrors>({})
  const [error, setError] = useState('')
  const [templateId, setTemplateId] = useState(() => ADDRESS_TEMPLATES.find(template => initial?.postalCode === template.postalCode && initial.region === 'Дніпропетровська' && initial.district === "Кам'янський" && initial.settlementType === template.type && initial.settlementName === template.name)?.id ?? 'manual')
  const dirty = JSON.stringify(draft) !== baseline.current
  const preview = formatAddress(draft)
  const update = (key: keyof AddressParts, value: string) => {
    const next = { ...draft, [key]: value, ...(key === 'streetType' && value !== 'інше' ? { customStreetType: '' } : {}) }
    setDraft(next)
    if (['postalCode', 'region', 'district', 'settlementType', 'settlementName'].includes(key)) setTemplateId('manual')
    if (Object.keys(errors).length) setErrors(validateAddress(next).errors)
    setError('')
  }
  const chooseTemplate = (value: string) => {
    setTemplateId(value)
    const next = applyAddressTemplate(draft, value)
    if (ADDRESS_TEMPLATES.some(template => template.id === value)) {
      next.streetType = 'вулиця'
      next.customStreetType = ''
    }
    setDraft(next)
    if (Object.keys(errors).length) setErrors(validateAddress(next).errors)
    setError('')
  }
  const save = () => {
    const result = validateAddress(draft)
    setErrors(result.errors)
    if (!result.ok) {
      setError('Перевірте виділені складові адреси.')
      const fields = Array.from(formRef.current?.querySelectorAll<HTMLElement>('[data-address-field]') ?? [])
      fields.find(field => result.errors[field.dataset.addressField as keyof AddressParts])?.querySelector<HTMLElement>('input, button')?.focus()
      return
    }
    onSave(result.address)
  }
  const textField = (key: Exclude<keyof AddressParts, 'settlementType' | 'streetType'>) => <label className="recipient-field" data-address-field={key}>
    <span>{addressLabels[key]}{key !== 'apartment' && <> <span className="recipient-required-mark" aria-hidden="true">*</span></>}</span>
    <input name={key} required={key !== 'apartment'} maxLength={key === 'postalCode' ? 5 : 500} inputMode={key === 'postalCode' ? 'numeric' : 'text'} value={draft[key]} onChange={event => update(key, event.target.value)} aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `${id}-${key}-error` : undefined}/>
    {errors[key] && <span className="recipient-field-error" id={`${id}-${key}-error`}>{errors[key]}</span>}
  </label>
  const typeField = (key: 'settlementType' | 'streetType', values: readonly string[]) => <div className="recipient-field" data-address-field={key}>
    <span aria-hidden="true">{addressLabels[key]} <span className="recipient-required-mark">*</span></span>
    <Select label={addressLabels[key]} required searchable={key === 'streetType'} value={draft[key]} error={errors[key]} options={values.map(value => ({ value, label: typeLabel(value) }))} onChange={value => update(key, value)}/>
  </div>
  return <Modal title={kind === 'registration' ? 'Адреса реєстрації' : 'Адреса проживання'} description="Оберіть шаблон або введіть адресу будь-якого населеного пункту України." size="large" className="recipient-card-modal address-editor-modal" dirty={dirty} onClose={onClose} headerIcon={<MapPin size={21} aria-hidden="true"/>}>
    <form className="recipient-card-form address-editor-form" ref={formRef} noValidate onSubmit={event => { event.preventDefault(); save() }}>
      <section className="address-template-block" aria-labelledby={`${id}-templates`}><h3 id={`${id}-templates`}>Шаблони Вишнівської громади</h3>
        <Select label="Шаблони Вишнівської громади" searchable value={templateId} options={[{ value: 'manual', label: 'Інший населений пункт' }, ...ADDRESS_TEMPLATES.map(template => ({ value: template.id, label: `${template.type} ${template.name}`, description: template.postalCode, searchText: template.postalCode }))]} onChange={chooseTemplate}/>
        <p>Усі складові можна змінювати вручну. Вулицю, будинок і квартиру заповніть самостійно.</p>
      </section>
      {!initial && legacyText && <div className="address-legacy-note"><strong>Раніше зазначена адреса</strong><p>{legacyText}</p><span>Перенесіть її складові до відповідних полів. Автоматичний розбір не виконується.</span></div>}
      <fieldset className="recipient-fieldset"><legend>Складові адреси</legend><div className="recipient-form-grid">
        {textField('postalCode')}{textField('region')}
        {textField('district')}{typeField('settlementType', SETTLEMENT_TYPES)}
        {textField('settlementName')}{typeField('streetType', STREET_TYPES)}
        {draft.streetType === 'інше' && <div className="address-full-width">{textField('customStreetType')}</div>}
        {textField('streetName')}{textField('building')}
        {textField('apartment')}
      </div></fieldset>
      <section className="address-preview" aria-labelledby={`${id}-preview`}><h3 id={`${id}-preview`}>Попередній перегляд</h3><p aria-live="polite" aria-atomic="true">{preview || 'Адреса з’явиться після заповнення полів.'}</p></section>
      {error && <Alert variant="error">{error}</Alert>}
      <div className="recipient-form-actions recipient-card-actions"><button type="button" className="secondary-button assignment-cancel-button" onClick={() => confirmModalClose(dirty, onClose)}><X size={17} aria-hidden="true"/>Скасувати</button><button type="submit" className="primary-button"><Check size={17} aria-hidden="true"/>Зберегти адресу</button></div>
    </form>
  </Modal>
}
