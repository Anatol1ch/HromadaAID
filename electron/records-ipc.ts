import { listAnnualPlans, saveAnnualPlan, syncLegacyPlan } from './annual-plans.js'
import { listCatalogs } from './catalog-data.js'
import { reorderCatalog } from './catalog-order.js'
import { saveCatalog } from './catalog-store.js'
import { saveProgramApproval } from './program-approval-store.js'
import { addDecisionAssignments, saveDecision } from './decision-store.js'
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { trustedIpcMain as ipcMain } from './ipc-security.js'
import { changeAssignmentStatuses } from './assignment-status.js'
import { ASSIGNMENT_STATUSES } from './assignment-model.js'
import { dashboardSummary, reportSummary } from './financial-summary.js'
import { paymentYearError, resolveAccountingYear } from './accounting-year.js'
import { assignmentFromRow, assignmentFrom, assignmentSelect, getDecision, listAssignments, listDecisions, listRecipientAssignmentHistory, type AssignmentRow } from './assignment-data.js'
import { listAnnualPlanEntries, listProgramApprovals, listReportSourceRows } from './report-read-data.js'
import type {
  AssignmentChangeResult, AssignmentInput, AssignmentListResult, AssignmentRecord, AssignmentStatus,
  DecisionRecord, DecisionSummary, AnnualPlanInput,
} from './api-contract.js'

type Row = AssignmentRow

const assignmentStatusValues: readonly AssignmentStatus[] = ASSIGNMENT_STATUSES

function readAssignmentInput(value: unknown): AssignmentInput | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  if (typeof source.recipientId !== 'string' || !source.recipientId || typeof source.aidTypeId !== 'string' || !source.aidTypeId) return null
  const decisionId = typeof source.decisionId === 'string' && source.decisionId ? source.decisionId : undefined
  const decisionNumber = typeof source.decisionNumber === 'string' ? source.decisionNumber.trim() : ''
  const decisionDate = typeof source.decisionDate === 'string' ? source.decisionDate.trim() : ''
  if (!decisionId && (!decisionNumber || decisionNumber.length > 100 || !isIsoDate(decisionDate))) return null
  if (typeof source.amountMinor !== 'number' || !Number.isSafeInteger(source.amountMinor) || source.amountMinor <= 0) return null
  if (!assignmentStatusValues.includes(source.status as AssignmentStatus)) return null
  if (source.paidOn !== undefined && (typeof source.paidOn !== 'string' || (source.paidOn !== '' && !isIsoDate(source.paidOn)))) return null
  return { recipientId: source.recipientId, decisionId, decisionNumber, decisionDate, aidTypeId: source.aidTypeId, amountMinor: source.amountMinor, status: source.status as AssignmentStatus, paidOn: source.paidOn as string | undefined }
}

export function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function registerRecordsIpc(database: DatabaseSync) {
  ipcMain.handle('assignments:change-statuses', (_event, value: unknown) => changeAssignmentStatuses(database, value))
  ipcMain.handle('assignments:list', (_event, yearValue: unknown): AssignmentListResult => listAssignments(database, yearValue))

  ipcMain.handle('assignments:save', (_event, value: unknown, idValue?: unknown): AssignmentChangeResult => {
    const input = readAssignmentInput(value)
    if (!input) return { ok: false, reason: 'validation', message: 'Перевірте отримувача, рішення, вид допомоги, суму та статус.' }
    if (input.status === 'Виплачено' && (!input.paidOn || !isIsoDate(input.paidOn))) {
      return { ok: false, reason: 'validation', message: 'Для статусу «Виплачено» вкажіть коректну дату фактичної виплати.' }
    }
    const id = typeof idValue === 'string' && idValue ? idValue : null
    const now = new Date().toISOString()
    try {
      database.exec('BEGIN IMMEDIATE')
      const recipient = database.prepare('SELECT 1 AS found FROM recipients WHERE id = ?').get(input.recipientId)
      let decisionId = input.decisionId
      if (!decisionId) {
        const now = new Date().toISOString()
        database.prepare('INSERT OR IGNORE INTO decisions(id, decision_number, decision_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
          .run(randomUUID(), input.decisionNumber, input.decisionDate, now, now)
        const row = database.prepare('SELECT id FROM decisions WHERE decision_number = ? AND decision_date = ?').get(input.decisionNumber, input.decisionDate) as Row | undefined
        decisionId = row ? String(row.id) : undefined
      }
      const decision = decisionId ? database.prepare('SELECT decision_date FROM decisions WHERE id = ?').get(decisionId) as Row | undefined : null
      const aidType = database.prepare(`SELECT direction, funding_source FROM aid_types t WHERE id=? AND (is_active=1 OR (? IS NOT NULL AND EXISTS(SELECT 1 FROM assignments old WHERE old.id=? AND old.aid_type_id=t.id)))`)
        .get(input.aidTypeId, id, id) as Row | undefined
      if (!recipient || !decision || !aidType) {
        database.exec('ROLLBACK')
        return { ok: false, reason: 'validation', message: 'Отримувач, рішення або вид допомоги недоступний. Оновіть дані й спробуйте ще раз.' }
      }
      if (!decisionId) {
        database.exec('ROLLBACK')
        return { ok: false, reason: 'validation', message: 'Не вдалося зберегти реквізити рішення.' }
      }
      if (input.status === 'Виплачено') {
        const message = paymentYearError(input.paidOn, String(decision.decision_date))
        if (message) { database.exec('ROLLBACK'); return { ok: false, reason: 'validation', message } }
      }
      if (id && !database.prepare('SELECT 1 FROM assignments WHERE id = ?').get(id)) {
        database.exec('ROLLBACK')
        return { ok: false, reason: 'not-found', message: 'Призначення не знайдено.' }
      }

      let savedId = id
      if (id) {
        database.prepare(`UPDATE assignments SET recipient_id=?, decision_id=?, aid_type_id=?, amount_minor=?, status=?, direction=?, funding_source=?, updated_at=?, paid_on=CASE WHEN ?='Виплачено' THEN ? ELSE NULL END WHERE id=?`)
          .run(input.recipientId, decisionId, input.aidTypeId, input.amountMinor, input.status, aidType.direction, aidType.funding_source, now, input.status, input.paidOn || null, id)
      } else {
        savedId = randomUUID()
        database.prepare(`INSERT INTO assignments(id, recipient_id, decision_id, aid_type_id, amount_minor, status, direction, funding_source, created_at, updated_at, paid_on) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
          .run(savedId, input.recipientId, decisionId, input.aidTypeId, input.amountMinor, input.status, aidType.direction, aidType.funding_source, now, now, input.status === 'Виплачено' ? input.paidOn! : null)
      }

      const row = database.prepare(`SELECT ${assignmentSelect} ${assignmentFrom} WHERE a.id = ?`).get(savedId!) as Row | undefined
      if (!row) { database.exec('ROLLBACK'); return { ok: false, reason: 'storage', message: 'Запис не вдалося прочитати після збереження; транзакцію скасовано.' } }
      const saved = assignmentFromRow(row)
      database.exec('COMMIT')
      return { ok: true, assignment: saved }
    } catch {
      try { database.exec('ROLLBACK') } catch { /* Transaction may already be closed. */ }
      return { ok: false, reason: 'storage', message: 'Не вдалося зберегти призначення. Перевірте локальне сховище.' }
    }
  })

  ipcMain.handle('dashboard:get', (_event, yearValue: unknown) => dashboardSummary(database, yearValue))

  ipcMain.handle('reports:get', (_event, sheetValue: unknown) => {
    return listReportSourceRows(database, sheetValue)
  })

  ipcMain.handle('reports:summary', (_event, yearValue: unknown, periodValue: unknown) => reportSummary(database, yearValue, periodValue))

  ipcMain.handle('reports:annual-plan-list', (_event, year: unknown) => listAnnualPlans(database, resolveAccountingYear(year)))
  ipcMain.handle('reports:annual-plan-save', (_event, input: unknown) => saveAnnualPlan(database, input))

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
