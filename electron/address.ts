export const SETTLEMENT_TYPES = ['місто', 'селище', 'село'] as const
export const STREET_TYPES = ['вулиця', 'провулок', 'проспект', 'площа', 'бульвар', 'проїзд', 'узвіз', 'набережна', 'шосе', 'інше'] as const
export type AddressParts = {
  postalCode: string
  region: string
  district: string
  settlementType: typeof SETTLEMENT_TYPES[number] | ''
  settlementName: string
  streetType: typeof STREET_TYPES[number] | ''
  customStreetType: string
  streetName: string
  building: string
  apartment: string
}
export const emptyAddress = (): AddressParts => ({ postalCode: '', region: '', district: '', settlementType: '', settlementName: '', streetType: '', customStreetType: '', streetName: '', building: '', apartment: '' })
export const ADDRESS_TEMPLATES = [
  { id: 'vyshneve', name: 'Вишневе', type: 'селище', postalCode: '52151' },
  { id: 'lozuvatka', name: 'Лозуватка', type: 'село', postalCode: '52150' },
  { id: 'komisarivka', name: 'Комісарівка', type: 'село', postalCode: '52142' },
  { id: 'terno-lozuvatka', name: 'Терно-Лозуватка', type: 'село', postalCode: '52178' },
  { id: 'ivanivka', name: 'Іванівка', type: 'село', postalCode: '52198' },
  { id: 'lykoshyne', name: 'Ликошине', type: 'село', postalCode: '52146' },
  { id: 'novoukrainka', name: 'Новоукраїнка', type: 'село', postalCode: '52121' },
  { id: 'kuliabkyne', name: 'Кулябкине', type: 'село', postalCode: '52150' },
  { id: 'chervonyi-yar', name: 'Червоний Яр', type: 'село', postalCode: '52178' },
  { id: 'baikivka', name: 'Байківка', type: 'село', postalCode: '52150' },
] as const

export function applyAddressTemplate(address: AddressParts, templateId: string): AddressParts {
  const template = ADDRESS_TEMPLATES.find(item => item.id === templateId)
  return template ? { ...address, postalCode: template.postalCode, region: 'Дніпропетровська', district: "Кам'янський", settlementType: template.type, settlementName: template.name } : { ...address }
}
export const copyAddress = (address: AddressParts): AddressParts => ({ ...address })

const settlementAbbreviation = { місто: 'м.', селище: 'с-ще', село: 'с.' }
const streetAbbreviation = { вулиця: 'вул.', провулок: 'пров.', проспект: 'просп.', площа: 'пл.', бульвар: 'бульв.', проїзд: 'пр-д', узвіз: 'узв.', набережна: 'наб.', шосе: 'шосе' }
const streetAliases: Partial<Record<keyof typeof streetAbbreviation, string[]>> = { провулок: ['провул.'], проспект: ['пр-т'], бульвар: ['б-р'], шосе: ['ш.'] }
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const text = (value: string) => value.trim().replace(/\s+/gu, ' ')

function stripRepeated(value: string, prefix: RegExp, suffix?: RegExp) {
  let current = text(value)
  let previous: string
  do { previous = current; current = current.replace(prefix, '').replace(suffix ?? /$^/u, '').trim() } while (current !== previous)
  return current
}
function stripType(value: string, full: string, short: string, aliases: string[] = []) {
  const alternatives = [...new Set([short, full, ...aliases])].map(token => escapeRegex(token) + (token.endsWith('.') || token !== full ? '\\s*' : '(?:\\s+|$)')).join('|')
  return stripRepeated(value, new RegExp(`^(?:${alternatives})`, 'iu'))
}

export function normalizeAddress(address: AddressParts): AddressParts {
  const result = Object.fromEntries(Object.entries(address).map(([key, value]) => [key, text(value)])) as AddressParts
  result.region = stripRepeated(result.region, /^(?:область\s+|обл\.\s*)/iu, /(?:^|\s+)(?:область|обл\.?)$/iu)
  result.district = stripRepeated(result.district, /^(?:район\s+|р-н\s+)/iu, /(?:^|\s+)(?:район|р-н)$/iu)
  if (result.settlementType && Object.hasOwn(settlementAbbreviation, result.settlementType)) result.settlementName = stripType(result.settlementName, result.settlementType, settlementAbbreviation[result.settlementType])
  if (result.streetType === 'інше') {
    if (result.customStreetType) result.streetName = stripType(result.streetName, result.customStreetType, result.customStreetType)
  } else {
    result.customStreetType = ''
    if (result.streetType && Object.hasOwn(streetAbbreviation, result.streetType)) result.streetName = stripType(result.streetName, result.streetType, streetAbbreviation[result.streetType], streetAliases[result.streetType])
  }
  result.building = stripRepeated(result.building, /^(?:буд\.\s*|будинок(?:\s+|$)|буд(?:\s+|$))/iu)
  result.apartment = stripRepeated(result.apartment, /^(?:кв\.\s*|квартира(?:\s+|$)|кв(?:\s+|$))/iu)
  return result
}

export function formatAddress(address: AddressParts | null): string {
  if (!address) return ''
  const a = normalizeAddress(address)
  const settlement = a.settlementType && Object.hasOwn(settlementAbbreviation, a.settlementType) ? settlementAbbreviation[a.settlementType] : ''
  const street = a.streetType === 'інше' ? a.customStreetType : a.streetType && Object.hasOwn(streetAbbreviation, a.streetType) ? streetAbbreviation[a.streetType] : ''
  return [a.postalCode, a.region && `${a.region} область`, a.district && `${a.district} район`,
    a.settlementName && [settlement, a.settlementName].filter(Boolean).join(' '),
    a.streetName && [street, a.streetName].filter(Boolean).join(' '), a.building && `буд. ${a.building}`, a.apartment && `кв. ${a.apartment}`].filter(Boolean).join(', ')
}

export const addressLabels = {
  postalCode: 'Поштовий індекс', region: 'Область', district: 'Район', settlementType: 'Тип населеного пункту',
  settlementName: 'Назва населеного пункту', streetType: 'Тип вулиці', customStreetType: 'Власний тип вулиці',
  streetName: 'Назва вулиці', building: 'Номер будинку', apartment: 'Номер квартири',
} as const
export type AddressErrors = Partial<Record<keyof AddressParts, string>>
export function validateAddress(value: unknown): { ok: true; address: AddressParts; errors: AddressErrors } | { ok: false; errors: AddressErrors; message: string } {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const errors: AddressErrors = {}
  const draft = emptyAddress()
  for (const key of Object.keys(draft) as (keyof AddressParts)[]) {
    if ((key === 'apartment' || key === 'customStreetType') && source[key] == null) continue
    if (typeof source[key] !== 'string') errors[key] = `Перевірте поле «${addressLabels[key]}».`
    else (draft[key] as string) = source[key]
  }
  const address = normalizeAddress(draft)
  for (const key of Object.keys(address) as (keyof AddressParts)[]) {
    if (key !== 'apartment' && key !== 'customStreetType' && !address[key]) errors[key] = `Заповніть поле «${addressLabels[key]}».`
  }
  if (!/^\d{5}$/.test(address.postalCode)) errors.postalCode = 'Поштовий індекс має містити рівно 5 цифр.'
  if (!(SETTLEMENT_TYPES as readonly string[]).includes(address.settlementType)) errors.settlementType = 'Оберіть тип населеного пункту.'
  if (!(STREET_TYPES as readonly string[]).includes(address.streetType)) errors.streetType = 'Оберіть тип вулиці.'
  if (address.streetType === 'інше' && !address.customStreetType) errors.customStreetType = 'Вкажіть власний тип вулиці.'
  if (formatAddress(address).length > 500) errors.streetName = 'Повна адреса має містити не більше 500 символів.'
  return Object.keys(errors).length ? { ok: false, errors, message: Object.values(errors)[0]! } : { ok: true, address, errors }
}

// Both address sets are value fields owned by the recipient, not an address catalog.
export const addressColumns = {
  postalCode: 'postal_code', region: 'region', district: 'district', settlementType: 'settlement_type', settlementName: 'settlement_name',
  streetType: 'street_type', customStreetType: 'custom_street_type', streetName: 'street_name', building: 'building', apartment: 'apartment',
} as const
export const addressKeys = Object.keys(addressColumns) as (keyof AddressParts)[]
export const addressValues = (address: AddressParts | null) => addressKeys.map(key => address?.[key] ?? null)
export function addressFromRow(row: Record<string, unknown>, prefix: 'registration' | 'residence'): AddressParts | null {
  if (!addressKeys.some(key => row[`${prefix}_${addressColumns[key]}`] != null)) return null
  return Object.fromEntries(addressKeys.map(key => [key, String(row[`${prefix}_${addressColumns[key]}`] ?? '')])) as AddressParts
}
export function storedAddressText(row: Record<string, unknown>, prefix: 'registration' | 'residence'): string | null {
  const parts = addressFromRow(row, prefix)
  const legacy = row[prefix === 'registration' ? 'registered_address' : 'address']
  return parts ? formatAddress(parts) || null : typeof legacy === 'string' ? legacy : null
}
