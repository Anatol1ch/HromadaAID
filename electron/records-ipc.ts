import { listAnnualPlans, saveAnnualPlan, syncLegacyPlan } from './annual-plans.js'
import { listCatalogs } from './catalog-data.js'
import { reorderCatalog } from './catalog-order.js'
import { saveCatalog } from './catalog-store.js'
import { saveProgramApproval } from './program-approval-store.js'
import { saveAssignment } from './assignment-store.js'
import { addDecisionAssignments, saveDecision } from './decision-store.js'
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { trustedIpcMain as ipcMain } from './ipc-security.js'
import { changeAssignmentStatuses } from './assignment-status.js'
import { dashboardSummary, reportSummary } from './financial-summary.js'
import { resolveAccountingYear } from './accounting-year.js'
import { getDecision, listAssignments, listDecisions, listRecipientAssignmentHistory, type AssignmentRow } from './assignment-data.js'
import { listAnnualPlanEntries, listProgramApprovals, listReportSourceRows } from './report-read-data.js'
import type {
  AssignmentChangeResult, AssignmentInput, AssignmentListResult, AssignmentRecord, AssignmentStatus,
  DecisionRecord, DecisionSummary, AnnualPlanInput,
} from './api-contract.js'

type Row = AssignmentRow

export function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function registerRecordsIpc(database: DatabaseSync) {
  ipcMain.handle('assignments:change-statuses', (_event, value: unknown, requestId?: unknown) => changeAssignmentStatuses(database, value, requestId))
  ipcMain.handle('assignments:list', (_event, yearValue: unknown): AssignmentListResult => listAssignments(database, yearValue))

  ipcMain.handle('assignments:save', (_event, value: unknown, idValue?: unknown, expectedUpdatedAt?: unknown, requestId?: unknown) => saveAssignment(database, value, idValue, expectedUpdatedAt, requestId))

  ipcMain.handle('dashboard:get', (_event, yearValue: unknown) => dashboardSummary(database, yearValue))

  ipcMain.handle('reports:get', (_event, sheetValue: unknown) => {
    return listReportSourceRows(database, sheetValue)
  })

  ipcMain.handle('reports:summary', (_event, yearValue: unknown, periodValue: unknown) => reportSummary(database, yearValue, periodValue))

  ipcMain.handle('reports:annual-plan-list', (_event, year: unknown) => listAnnualPlans(database, resolveAccountingYear(year)))
  ipcMain.handle('reports:annual-plan-save', (_event, input: unknown, expectedUpdatedAt?: unknown) => saveAnnualPlan(database, input, expectedUpdatedAt))

  ipcMain.handle('reports:plan-list', (_event, yearValue: unknown) => {
    return listAnnualPlanEntries(database, yearValue)
  })

  ipcMain.handle('reports:plan-save', (_event, value: unknown, idValue?: unknown) => {
    if (!value || typeof value !== 'object') return { ok: false, message: 'Перевірте дані плану.' }
    const input = value as AnnualPlanInput
    if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2200 || typeof input.aidTypeId !== 'string' ||
      typeof input.referenceLabel !== 'string' || !input.referenceLabel.trim() || input.referenceLabel.trim().length > 200 ||
      !Number.isInteger(input.plannedAmountMinor) || input.plannedAmountMinor < 0 ||
      (input.plannedRecipientCount !== null && (!Number.isInteger(input.plannedRecipientCount) || input.plannedRecipientCount < 0))) {
      return { ok: false, message: 'Заповніть підставу, вид допомоги та коректні планові показники.' }
    }
    try {
      if (!database.prepare('SELECT 1 FROM aid_types WHERE id=? AND is_active=1').get(input.aidTypeId)) {
        return { ok: false, message: 'Цей вид допомоги неактивний і недоступний для нового плану.' }
      }
      database.exec('BEGIN IMMEDIATE')
      const previous = typeof idValue === 'string' ? database.prepare('SELECT year,aid_type_id FROM annual_plan_entries WHERE id=?').get(idValue) as Row | undefined : undefined
      const now = new Date().toISOString()
      if (typeof idValue === 'string' && idValue) {
        if (!database.prepare('SELECT 1 FROM annual_plan_entries WHERE id=? AND year=?').get(idValue, input.year)) {
          database.exec('ROLLBACK')
          return { ok: false, message: 'Плановий рядок не належить вибраному обліковому року. Оновіть план.' }
        }
        const result = database.prepare(`UPDATE annual_plan_entries SET year=?,aid_type_id=?,reference_label=?,planned_recipient_count=?,planned_amount_minor=?,updated_at=? WHERE id=?`)
          .run(input.year, input.aidTypeId, input.referenceLabel.trim(), input.plannedRecipientCount, input.plannedAmountMinor, now, idValue)
        if (!Number(result.changes)) { database.exec('ROLLBACK'); return { ok: false, message: 'Плановий рядок не знайдено. Оновіть звіт.' } }
      } else {
        database.prepare(`INSERT INTO annual_plan_entries(id,year,aid_type_id,reference_label,planned_recipient_count,planned_amount_minor,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(year,aid_type_id,reference_label) DO UPDATE SET
          planned_recipient_count=excluded.planned_recipient_count,planned_amount_minor=excluded.planned_amount_minor,updated_at=excluded.updated_at`)
          .run(randomUUID(), input.year, input.aidTypeId, input.referenceLabel.trim(), input.plannedRecipientCount, input.plannedAmountMinor, now, now)
      }
      if (previous && previous.aid_type_id !== input.aidTypeId) syncLegacyPlan(database, Number(previous.year), String(previous.aid_type_id))
      syncLegacyPlan(database, input.year, input.aidTypeId)
      database.exec('COMMIT')
      return { ok: true }
    } catch { try { database.exec('ROLLBACK') } catch {} ; return { ok: false, message: 'Не вдалося зберегти плановий показник.' } }
  })

  ipcMain.handle('reports:plan-remove', (_event, idValue: unknown) => {
    if (typeof idValue !== 'string' || !idValue) return { ok: false, message: 'Плановий рядок не знайдено.' }
    try {
      database.exec('BEGIN IMMEDIATE')
      const previous = database.prepare('SELECT year,aid_type_id FROM annual_plan_entries WHERE id=?').get(idValue) as Row | undefined
      const result = database.prepare('DELETE FROM annual_plan_entries WHERE id=?').run(idValue)
      if (previous) syncLegacyPlan(database, Number(previous.year), String(previous.aid_type_id))
      database.exec('COMMIT')
      return Number(result.changes) ? { ok: true } : { ok: false, message: 'Плановий рядок не знайдено.' }
    } catch { try { database.exec('ROLLBACK') } catch {} ; return { ok: false, message: 'Не вдалося видалити плановий рядок.' } }
  })

  ipcMain.handle('recipients:assignment-history', (_event, id: unknown): AssignmentRecord[] => {
    if (typeof id !== 'string' || !id) return []
    return listRecipientAssignmentHistory(database, id)
  })

  ipcMain.handle('catalogs:list', (_event, includeInactiveValue: unknown) => {
    return listCatalogs(database, includeInactiveValue === true)
  })

  ipcMain.handle('catalogs:reorder', (_event, input: unknown) => reorderCatalog(database, input))

  ipcMain.handle('catalogs:save', (_event, value: unknown) => saveCatalog(database, value))

  ipcMain.handle('program-approvals:list', () => listProgramApprovals(database))

  ipcMain.handle('program-approvals:save', (_event, value: unknown, idValue?: unknown, expectedUpdatedAt?: unknown) =>
    saveProgramApproval(database, value, idValue, expectedUpdatedAt))

  ipcMain.handle('decisions:list', (): DecisionSummary[] => {
    return listDecisions(database)
  })

  ipcMain.handle('decisions:get', (_event, id: unknown): DecisionRecord | null => {
    if (typeof id !== 'string' || !id) return null
    return getDecision(database, id)
  })


  ipcMain.handle('decisions:save', (_event, value: unknown, idValue?: unknown, expectedUpdatedAt?: unknown) =>
    saveDecision(database, value, idValue, expectedUpdatedAt))

  ipcMain.handle('decisions:add-assignments', (_event, decisionIdValue: unknown, value: unknown, requestId?: unknown) =>
    addDecisionAssignments(database, decisionIdValue, value, requestId))
}

export { listAssignments } from './assignment-data.js'
