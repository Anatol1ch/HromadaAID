import type { DatabaseSync } from 'node:sqlite'
import { resolveAccountingYear } from './accounting-year.js'
import type { AnnualPlanEntry, ProgramApproval, ReportSheet, ReportSourceRow } from '../shared/api-contract.js'

type Row = Record<string, string | number | null>

const reportSheets: readonly ReportSheet[] = ['ПЛАН', 'ФАКТ (МІСЯЦЬ)', 'ФАКТ (КВАРТАЛ)', 'ПЛАН-ФАКТ (РІК)']

export function listReportSourceRows(database: DatabaseSync, sheetValue: unknown): ReportSourceRow[] {
  if (typeof sheetValue !== 'string' || !reportSheets.includes(sheetValue as ReportSheet)) return []
  const rows = database.prepare('SELECT source_row_number,item_label,data_json,formulas_json,report_as_of FROM reporting_source_rows WHERE worksheet=? ORDER BY source_row_number')
    .all(sheetValue) as Row[]
  return rows.map((row) => {
    try {
      return { rowNumber: Number(row.source_row_number), label: String(row.item_label),
        values: JSON.parse(String(row.data_json)), formulas: JSON.parse(String(row.formulas_json)),
        asOf: typeof row.report_as_of === 'string' ? row.report_as_of : null } as ReportSourceRow
    } catch { return null }
  }).filter((row): row is ReportSourceRow => row !== null)
}

export function listAnnualPlanEntries(database: DatabaseSync, yearValue: unknown): AnnualPlanEntry[] {
  const year = resolveAccountingYear(yearValue)
  return database.prepare(`SELECT e.id,e.year,e.aid_type_id AS aidTypeId,t.short_name AS aidTypeName,t.official_name AS aidTypeOfficialName,
    p.short_name AS programName,p.official_name AS programOfficialName,
    e.reference_label AS referenceLabel,e.planned_recipient_count AS plannedRecipientCount,e.planned_amount_minor AS plannedAmountMinor
    FROM annual_plan_entries e JOIN aid_types t ON t.id=e.aid_type_id JOIN programs p ON p.id=t.program_id
    WHERE e.year=? ORDER BY p.short_name,t.short_name,e.reference_label`).all(year) as AnnualPlanEntry[]
}

export function listProgramApprovals(database: DatabaseSync): ProgramApproval[] {
  return database.prepare(`SELECT pa.id,pa.document_number AS documentNumber,pa.document_date AS documentDate,pa.title,COUNT(p.id) AS programCount
    FROM program_approvals pa LEFT JOIN programs p ON p.approval_id=pa.id GROUP BY pa.id ORDER BY pa.document_date DESC,pa.document_number`).all() as ProgramApproval[]
}
