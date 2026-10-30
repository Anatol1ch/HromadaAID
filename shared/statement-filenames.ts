import type { StatementKind, StatementParameters } from './api-contract.js'

export function documentNumberError(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return 'Вкажіть номер відомості.'
  if (/[<>:"/\\|?*\u0000-\u001f]/u.test(value)) return 'Номер не може містити символи < > : " / \\ | ? * або керівні символи.'
  const longestFixed = Math.max('vf02132421090041500000041059569.xls'.length, '(0000-00-00)() – ЗВЕДЕНИЙ СПИСОК ВИПЛАТИ.xlsx'.length)
  if (value.length + longestFixed > 255) return 'Номер надто довгий для назви файлу.'
  return undefined
}

export function bankFileLabel(bank: { bankId: string; bankName: string }): string {
  const name = bank.bankName.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '-').replace(/\s+/gu, ' ').trim().slice(0, 40) || 'Банк'
  const identity = [...new TextEncoder().encode(bank.bankId)].map(byte => byte.toString(16).padStart(2, '0')).join('')
  return `${name}_${identity}`
}
function checkedFileName(name: string) {
  if (name.length > 255) throw new Error('Назва файла надто довга. Скоротіть номер відомості.')
  return name
}
export function statementFileName(kind: StatementKind, value: Pick<StatementParameters, 'documentNumber' | 'documentDate'>, bank?: { bankId: string; bankName: string }): string {
  if (documentNumberError(value.documentNumber)) throw new Error('Invalid statement number')
  if (kind === 'personal') return `vf021324210900415${value.documentDate.slice(2).replaceAll('-', '')}41059569${value.documentNumber}.xls`
  return checkedFileName(`(${value.documentDate})(${value.documentNumber}) – ЗВЕДЕНИЙ СПИСОК ВИПЛАТИ${bank ? ` – ${bankFileLabel(bank)}` : ''}.xlsx`)
}

export function bankStatementFileName(date = new Date(), bank?: { bankId: string; bankName: string }): string {
  const localDate = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
  return checkedFileName(`(${localDate}) – ${bank ? `БАНКІВСЬКА ВІДОМІСТЬ – ${bankFileLabel(bank)}` : 'ВІДОМІСТЬ ДЛЯ ПРИВАТБАНКУ'}.xlsx`)
}

export function assertUniqueStatementFileNames(names: string[]) {
  const normalized = names.map(name => name.normalize('NFC').toLocaleLowerCase('uk'))
  if (new Set(normalized).size !== names.length) throw new Error('Назви файлів повторюються. Вкажіть різні номери відомостей для документів з однаковою датою.')
}
