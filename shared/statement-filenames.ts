import type { StatementKind, StatementParameters } from './api-contract.js'

export function documentNumberError(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return 'Вкажіть номер відомості.'
  if (/[<>:"/\\|?*\u0000-\u001f]/u.test(value)) return 'Номер не може містити символи < > : " / \\ | ? * або керівні символи.'
  const longestFixed = Math.max('vf02132421090041500000041059569.xls'.length, '(0000-00-00)() – ЗВЕДЕНИЙ СПИСОК ВИПЛАТИ.xlsx'.length)
  if (value.length + longestFixed > 255) return 'Номер надто довгий для назви файлу.'
  return undefined
}

export function statementFileName(kind: StatementKind, value: Pick<StatementParameters, 'documentNumber' | 'documentDate'>): string {
  if (documentNumberError(value.documentNumber)) throw new Error('Invalid statement number')
  if (kind === 'personal') return `vf021324210900415${value.documentDate.slice(2).replaceAll('-', '')}41059569${value.documentNumber}.xls`
  return `(${value.documentDate})(${value.documentNumber}) – ЗВЕДЕНИЙ СПИСОК ВИПЛАТИ.xlsx`
}

export function bankStatementFileName(date = new Date()): string {
  const localDate = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
  return `(${localDate}) – ВІДОМІСТЬ ДЛЯ ПРИВАТБАНКУ.xlsx`
}
