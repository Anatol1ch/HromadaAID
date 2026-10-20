import { formatAddress, validateAddress } from './address.js'
import type { RecipientInput } from './api-contract.js'
import { fieldFormatError, isFormattedField, normalizeField } from './field-formats.js'

// Shared by the form and IPC. Reading old cards does not apply these save rules.
export const recipientTextFields = {
  lastName: { label: 'Прізвище', maxLength: 150, required: true },
  firstName: { label: 'Ім’я', maxLength: 150, required: true },
  patronymic: { label: 'По батькові', maxLength: 150, required: true },
  passport: { label: 'Серія та номер паспорта', maxLength: 64, required: true },
  rnokpp: { label: 'РНОКПП', maxLength: 32, required: true },
  phone: { label: 'Телефон', maxLength: 80, required: false },
  email: { label: 'Електронна пошта', maxLength: 254, required: false },
  bankAccount: { label: 'Номер поточного рахунка', maxLength: 64, required: true },
  bankDetailsId: { label: 'Банківські реквізити', maxLength: 100, required: true },
} as const

export type RecipientTextField = keyof typeof recipientTextFields
export type RecipientErrors = Partial<Record<keyof RecipientInput, string>>
type ValidationResult = { ok: true; input: RecipientInput; errors: RecipientErrors }
  | { ok: false; errors: RecipientErrors; message: string }

export function validateRecipientInput(value: unknown): ValidationResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, errors: {}, message: 'Перевірте відомості картки отримувача.' }
  }
  const source = value as Record<string, unknown>
  const errors: RecipientErrors = {}
  const strings = {} as Record<RecipientTextField, string>
  for (const key of Object.keys(recipientTextFields) as RecipientTextField[]) {
    const { label, maxLength, required } = recipientTextFields[key]
    if (typeof source[key] !== 'string') {
      errors[key] = `Перевірте поле «${label}».`
      continue
    }
    const text = isFormattedField(key) ? normalizeField(key, source[key]) : source[key].trim()
    strings[key] = text
    if (required && !text) errors[key] = `Заповніть поле «${label}».`
    else if (text.length > maxLength) errors[key] = `Поле «${label}» має містити не більше ${maxLength} символів.`
    else if (isFormattedField(key)) {
      const message = fieldFormatError(key, source[key])
      if (message) errors[key] = message
    }
  }
  const registration = validateAddress(source.registeredAddressParts)
  if (!registration.ok) errors.registeredAddress = 'Адреса реєстрації: ' + registration.message
  const residence = source.addressParts === null ? null : validateAddress(source.addressParts)
  if (residence && !residence.ok) errors.address = 'Адреса проживання: ' + residence.message
  if (!residence && typeof source.address === 'string' && source.address.trim()) errors.address = 'Заповніть складові адреси проживання в редакторі або очистіть її.'
  if (source.addressParts === undefined) errors.address = 'Перевірте відомості адреси проживання.'
  if (typeof source.registeredAddress !== 'string' && !errors.registeredAddress) errors.registeredAddress = 'Перевірте адресу реєстрації.'
  if (typeof source.address !== 'string' && !errors.address) errors.address = 'Перевірте адресу проживання.'
  const sex = typeof source.sex === 'string' ? source.sex.trim() : ''
  if (sex !== 'Жінка' && sex !== 'Чоловік') errors.sex = 'Оберіть стать отримувача.'
  if (typeof source.isVpo !== 'boolean') errors.isVpo = 'Оберіть ознаку ВПО: «Так» або «Ні».'
  if (Object.keys(errors).length) return { ok: false, errors, message: Object.values(errors)[0]! }
  if (!registration.ok || (residence && !residence.ok)) return { ok: false, errors, message: 'Перевірте адреси отримувача.' }
  const registeredAddressParts = registration.address
  const addressParts = residence?.ok ? residence.address : null
  return { ok: true, input: { ...strings, registeredAddressParts, addressParts, registeredAddress: formatAddress(registeredAddressParts), address: formatAddress(addressParts), sex: sex as RecipientInput['sex'], isVpo: source.isVpo as boolean }, errors }
}
