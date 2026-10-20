import type { BankInput } from './api-contract.js'

export type BankErrors = Record<string, string>
export function validateBankInput(value: unknown): { ok: true; input: BankInput; errors: BankErrors } | { ok: false; errors: BankErrors; message: string } {
  const errors: BankErrors = {}
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const name = typeof source.name === 'string' ? source.name.trim() : ''
  if (!name) errors.name = 'Вкажіть найменування банку.'
  else if (name.length > 200) errors.name = 'Найменування банку має містити не більше 200 символів.'
  const details: BankInput['details'] = []
  const pairs = new Set<string>(), ids = new Set<string>()
  if (!Array.isArray(source.details) || !source.details.length) errors.details = 'Додайте щонайменше один повний набір реквізитів.'
  else source.details.forEach((row: unknown, index: number) => {
    const item = row && typeof row === 'object' ? row as Record<string, unknown> : {}
    const mfo = typeof item.mfo === 'string' ? item.mfo.trim() : ''
    const edrpou = typeof item.edrpou === 'string' ? item.edrpou.trim() : ''
    if (!mfo || mfo.length > 32) errors[`details.${index}.mfo`] = !mfo ? 'Вкажіть код МФО.' : 'Код МФО має містити не більше 32 символів.'
    if (!edrpou || edrpou.length > 32) errors[`details.${index}.edrpou`] = !edrpou ? 'Вкажіть код банку за ЄДРПОУ.' : 'Код ЄДРПОУ має містити не більше 32 символів.'
    const pair = JSON.stringify([mfo, edrpou])
    if (pairs.has(pair)) errors[`details.${index}.mfo`] = 'Така пара МФО та ЄДРПОУ вже є в цьому банку.'
    pairs.add(pair)
    if (item.id !== undefined && (typeof item.id !== 'string' || !item.id || item.id.length > 100 || ids.has(item.id))) {
      errors[`details.${index}.mfo`] = 'Некоректний ідентифікатор набору реквізитів. Оновіть картку банку.'
    }
    if (typeof item.id === 'string') ids.add(item.id)
    details.push({ ...(typeof item.id === 'string' ? { id: item.id } : {}), mfo, edrpou })
  })
  return Object.keys(errors).length ? { ok: false, errors, message: Object.values(errors)[0] } : { ok: true, input: { name, details }, errors }
}
