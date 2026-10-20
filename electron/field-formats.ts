/** Shared renderer/main rules. Normalization never discards unexpected characters. */
export const fieldFormatHints = {
  passport: '2 літери та 6 цифр або 9 цифр для ID-картки',
  rnokpp: '10 цифр',
  phone: '+380 XX XXX XX XX',
  email: 'example@gmail.com',
  bankAccount: 'UA XX XXXXXX XXXXXXXXXXXXXXXXXXX',
} as const
export type FormattedField = keyof typeof fieldFormatHints
export const isFormattedField = (key: string): key is FormattedField => Object.hasOwn(fieldFormatHints, key)

export function normalizeField(field: FormattedField, value: string): string {
  const text = value.trim()
  if (field === 'passport') return text.toLocaleUpperCase('uk')
  if (field === 'bankAccount') return text.replace(/\s/g, '').toUpperCase()
  if (field === 'phone') {
    const number = text.replace(/[\s()-]/g, '')
    if (!number || number === '+380' || number === '380') return ''
    if (/^0\d{9}$/.test(number)) return '+38' + number
    if (/^380\d{9}$/.test(number)) return '+' + number
    if (/^\d{9}$/.test(number)) return '+380' + number
    return number
  }
  return text
}

export function validUkrainianIban(value: string): boolean {
  if (!/^UA\d{27}$/.test(value)) return false
  let remainder = 0
  for (const char of value.slice(4) + value.slice(0, 4)) {
    const digits = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55)
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97
  }
  return remainder === 1
}

function validEmail(value: string): boolean {
  const parts = value.split('@')
  if (parts.length !== 2 || /\s/u.test(value)) return false
  const [local, domain] = parts
  if (!local || !/^[\p{L}\p{N}!#$%&'*+/=?^_`{|}~.-]+$/u.test(local)
    || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false
  const labels = domain.split('.')
  return labels.length > 1 && labels.every(label => /^(?!-)[\p{L}\p{N}-]{1,63}(?<!-)$/u.test(label))
    && /\p{L}/u.test(labels.at(-1)!)
}

export function fieldFormatError(field: FormattedField, value: string): string {
  const text = normalizeField(field, value)
  switch (field) {
    case 'passport': return /^(?:[А-ЩЬЮЯЄІЇҐ]{2}\d{6}|\d{9})$/u.test(text) ? '' : 'Вкажіть 2 українські літери та 6 цифр або 9 цифр для ID-картки.'
    case 'rnokpp': return /^\d{10}$/.test(text) ? '' : 'РНОКПП має містити рівно 10 цифр.'
    case 'phone': return !text || /^\+380\d{9}$/.test(text) ? '' : 'Введіть 9 цифр номера після +380.'
    case 'email': return !text || (!/\s/u.test(value) && validEmail(text)) ? '' : 'Введіть коректну електронну адресу, наприклад example@gmail.com.'
    // Temporarily format-only in both renderer and IPC. Keep validUkrainianIban
    // above for re-enabling checksum validation without changing the input mask.
    case 'bankAccount': return /^UA\d{27}$/.test(text) ? '' : 'Після UA введіть рівно 27 цифр рахунка.'
  }
}
