import type { ReportPeriod } from '../../electron/api-contract'
import { daysInMonth, formatDateInput } from './dates.ts'

export { reportInstitution, reportBudgetCode, reportTitle, reportNumbers, reportTotals, reportGroups } from '../../electron/report-data.js'

/** Presentation only: the financial query keeps its existing period boundaries. */
export function reportPeriodText(year: number, period: ReportPeriod) {
  let firstMonth = 1, lastMonth = 12, label = `${year} року`
  if (period.kind === 'month') {
    firstMonth = lastMonth = period.value
    label = `${new Intl.DateTimeFormat('uk-UA', {month: 'long', timeZone: 'UTC'}).format(new Date(Date.UTC(year,period.value - 1,1)))} ${year} року`
  } else if (period.kind === 'quarter') {
    firstMonth = (period.value - 1) * 3 + 1; lastMonth = firstMonth + 2
    label = `${['I', 'II', 'III', 'IV'][period.value - 1]} квартал ${year} року`
  } else if (period.kind === 'year-to-month') lastMonth = period.value
  const start = `${year}-${String(firstMonth).padStart(2, '0')}-01`
  const end = period.kind === 'year-to-date' ? period.endDate : `${year}-${String(lastMonth).padStart(2, '0')}-${daysInMonth(year,lastMonth)}`
  const range = `з ${formatDateInput(start)} по ${formatDateInput(end)}`
  return { label: period.kind === 'year-to-date' || period.kind === 'year-to-month' ? range : label, range }
}
export const reportMoney = (minor: number) => `${new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100)} грн`
export const reportCount = (count: number) => new Intl.NumberFormat('uk-UA').format(count)
export function parsePlanMoney(value: string): number | null {
  const text = value.trim().replace(/\s/g, '').replace(',', '.')
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null
  const [whole, fraction = ''] = text.split('.')
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(minor) && minor >= 0 ? minor : null
}
