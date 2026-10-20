import type { ReportPdfKind } from './api-contract.js'

const reportNames: Record<ReportPdfKind, string> = {
  month: 'МІСЯЦЬ',
  quarter: 'КВАРТАЛ',
  annual: 'РІК',
  cumulative: 'З ПОЧАТКУ РОКУ',
}

export function isReportPdfKind(value: unknown): value is ReportPdfKind {
  return typeof value === 'string' && Object.hasOwn(reportNames, value)
}

/** Local creation date, deliberately independent of the accounting year and report period. */
export function reportPdfFileName(kind: ReportPdfKind, date = new Date()): string {
  const day = [String(date.getFullYear()).padStart(4, '0'), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
  return `[${day}][0213242][ЗВІТ] – ${reportNames[kind]}.pdf`
}
