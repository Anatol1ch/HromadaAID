import { documentNumberError } from './statement-filenames.js'
import type { StatementKind, StatementParameters } from './api-contract.js'

export type StatementPlan = { aidTypeId: string; aidTypeName: string; partIndex: number; recordCount: number }
export function statementPlan(kind: StatementKind, rows: { aidTypeId: string; aidTypeName: string }[]): StatementPlan[] {
  const groups = new Map<string, { name: string; count: number }>()
  for (const row of rows) { const group = groups.get(row.aidTypeId) ?? { name: row.aidTypeName, count: 0 }; group.count++; groups.set(row.aidTypeId, group) }
  return [...groups].flatMap(([aidTypeId, group]) => Array.from({ length: kind === 'personal' ? Math.ceil(group.count / 12) : 1 }, (_, partIndex) => ({ aidTypeId, aidTypeName: group.name, partIndex, recordCount: kind === 'personal' ? Math.min(12, group.count - partIndex * 12) : group.count })))
}
export const statementKey = (value: Pick<StatementParameters, 'aidTypeId' | 'partIndex'>) => `${value.aidTypeId}:${value.partIndex}`
export type ParameterErrors = Partial<Record<'documentNumber' | 'documentDate' | 'periodStart' | 'periodEnd', string>>
function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y,m,d] = value.split('-').map(Number)
  const days = m === 2 ? (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28) : [4,6,9,11].includes(m) ? 30 : 31
  return y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= days
}
export function statementParameterErrors(value: StatementParameters): ParameterErrors {
  const errors: ParameterErrors = {}
  const numberError = documentNumberError(value.documentNumber)
  if (numberError) errors.documentNumber = numberError
  for (const key of ['documentDate', 'periodStart', 'periodEnd'] as const) if (!validDate(value[key])) errors[key] = 'Вкажіть коректну дату у форматі ДД.ММ.РРРР.'
  if (!errors.periodStart && !errors.periodEnd && value.periodStart > value.periodEnd) errors.periodEnd = 'Кінець періоду не може бути раніше його початку.'
  return errors
}
export function validateStatementParameters(value: unknown, plan: StatementPlan[]): StatementParameters[] | null {
  if (!Array.isArray(value) || value.length !== plan.length) return null
  const expected = new Set(plan.map(statementKey))
  const result: StatementParameters[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || typeof item.aidTypeId !== 'string' || !Number.isInteger(item.partIndex)) return null
    const key = statementKey(item)
    if (!expected.delete(key) || Object.keys(statementParameterErrors(item)).length) return null
    result.push({ aidTypeId: item.aidTypeId, partIndex: item.partIndex, documentNumber: item.documentNumber, documentDate: item.documentDate, periodStart: item.periodStart, periodEnd: item.periodEnd })
  }
  return expected.size ? null : result
}
export function statementPeriodText(value: StatementParameters) {
  const display = (date: string) => `${date.slice(8,10)}.${date.slice(5,7)}.${date.slice(0,4)}`
  return `За період з ${display(value.periodStart)} по ${display(value.periodEnd)}`
}
