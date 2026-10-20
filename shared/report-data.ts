import type { ReportPdfKind, ReportSummary, ReportSummaryRow } from './api-contract.js'

export const reportInstitution = 'Виконавчий комітет Вишнівської селищної ради'
export const reportBudgetCode = 'За КПКВ 0213242 «Інші заходи та заклади у сфері соціального захисту і соціального забезпечення»'

export const reportTitle = (kind: ReportPdfKind) => kind === 'cumulative' ? 'Звіт про виконання річного плану' : 'Звіт про фактично виплачені матеріальні допомоги'

export function reportNumbers(row: ReportSummaryRow) {
  const planCount = row.plannedRecipientCount ?? 0, planAmount = row.plannedAmountMinor ?? 0
  return [planCount, planAmount, row.paidCount, row.paidAmountMinor, planCount - row.paidCount, planAmount - row.paidAmountMinor]
}
export const reportTotals = (rows: ReportSummaryRow[]) => rows.reduce((sum, row) => reportNumbers(row).map((value, index) => value + sum[index]), [0, 0, 0, 0, 0, 0])
/** Preserve the catalog sort_order supplied by the data source; never sort by totals or names. */
export function reportGroups(summary: ReportSummary) {
  const groups = new Map<string, { id: string; name: string; rows: ReportSummaryRow[] }>()
  for (const program of summary.programs ?? []) groups.set(program.id, { id: program.id, name: program.officialName, rows: [] })
  for (const row of summary.rows) {
    const id = row.programId ?? row.programOfficialName
    const group = groups.get(id) ?? { id, name: row.programOfficialName, rows: [] }
    group.rows.push(row); groups.set(id, group)
  }
  return [...groups.values()]
}
