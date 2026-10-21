import { listAnnualPlans, saveAnnualPlan, syncLegacyPlan } from './annual-plans.js'
import { listCatalogs } from './catalog-data.js'
import { reorderCatalog } from './catalog-order.js'
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { trustedIpcMain as ipcMain } from './ipc-security.js'
import { changeAssignmentStatuses } from './assignment-status.js'
import { ASSIGNMENT_STATUSES } from './assignment-model.js'
import { dashboardSummary, reportSummary } from './financial-summary.js'
import { paymentYearError, resolveAccountingYear } from './accounting-year.js'
import { assignmentFromRow, assignmentFrom, assignmentSelect, getDecision, listAssignments, listDecisionAssignments, listDecisions, listRecipientAssignmentHistory, type AssignmentRow } from './assignment-data.js'
import type {
  AssignmentChangeResult, AssignmentDraft, AssignmentInput, AssignmentListResult, AssignmentRecord, AssignmentSaveResult, AssignmentStatus, DecisionInput,
  DecisionRecord, DecisionSaveResult, DecisionSummary, AnnualPlanInput,
} from './api-contract.js'

type Row = AssignmentRow

const assignmentStatusValues: readonly AssignmentStatus[] = ASSIGNMENT_STATUSES

function readDecisionInput(value: unknown): DecisionInput | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  if (typeof source.decisionNumber !== 'string' || typeof source.decisionDate !== 'string' || typeof source.title !== 'string') return null
  const decisionNumber = source.decisionNumber.trim()
  const decisionDate = source.decisionDate.trim()
  const title = source.title.trim()
  if (!decisionNumber || decisionNumber.length > 100 || title.length > 300) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(decisionDate)) return null
  const parsedDate = new Date(`${decisionDate}T00:00:00.000Z`)
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== decisionDate) return null
  return { decisionNumber, decisionDate, title }
}

function readDrafts(value: unknown): AssignmentDraft[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 500) return null
  const drafts: AssignmentDraft[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') return null
    const draft = item as Record<string, unknown>
    if (typeof draft.recipientId !== 'string' || !draft.recipientId || typeof draft.aidTypeId !== 'string' || !draft.aidTypeId) return null
    if (typeof draft.amountMinor !== 'number' || !Number.isSafeInteger(draft.amountMinor) || draft.amountMinor <= 0) return null
    if (!assignmentStatusValues.includes(draft.status as AssignmentStatus)) return null
    if (draft.paidOn !== undefined && (typeof draft.paidOn !== 'string' || (draft.paidOn !== '' && !isIsoDate(draft.paidOn)))) return null
    if (draft.status === 'Виплачено' && (typeof draft.paidOn !== 'string' || !isIsoDate(draft.paidOn))) return null
    drafts.push({ recipientId: draft.recipientId, aidTypeId: draft.aidTypeId, amountMinor: draft.amountMinor, status: draft.status as AssignmentStatus, paidOn: draft.paidOn as string | undefined })
  }
  return drafts
}

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
    const allowed = ['ПЛАН', 'ФАКТ (МІСЯЦЬ)', 'ФАКТ (КВАРТАЛ)', 'ПЛАН-ФАКТ (РІК)']
    if (typeof sheetValue !== 'string' || !allowed.includes(sheetValue)) return []
    const rows = database.prepare('SELECT source_row_number,item_label,data_json,formulas_json,report_as_of FROM reporting_source_rows WHERE worksheet=? ORDER BY source_row_number')
      .all(sheetValue) as Row[]
    return rows.map((row) => {
      try {
        return { rowNumber: Number(row.source_row_number), label: String(row.item_label),
          values: JSON.parse(String(row.data_json)), formulas: JSON.parse(String(row.formulas_json)),
          asOf: typeof row.report_as_of === 'string' ? row.report_as_of : null }
      } catch { return null }
    }).filter(Boolean)
  })

  ipcMain.handle('reports:summary', (_event, yearValue: unknown, periodValue: unknown) => reportSummary(database, yearValue, periodValue))

  ipcMain.handle('reports:annual-plan-list', (_event, year: unknown) => listAnnualPlans(database, resolveAccountingYear(year)))
  ipcMain.handle('reports:annual-plan-save', (_event, input: unknown) => saveAnnualPlan(database, input))

  ipcMain.handle('reports:plan-list', (_event, yearValue: unknown) => {
    const year = resolveAccountingYear(yearValue)
    return database.prepare(`SELECT e.id,e.year,e.aid_type_id AS aidTypeId,t.short_name AS aidTypeName,t.official_name AS aidTypeOfficialName,
      p.short_name AS programName,p.official_name AS programOfficialName,
      e.reference_label AS referenceLabel,e.planned_recipient_count AS plannedRecipientCount,e.planned_amount_minor AS plannedAmountMinor
      FROM annual_plan_entries e JOIN aid_types t ON t.id=e.aid_type_id JOIN programs p ON p.id=t.program_id
      WHERE e.year=? ORDER BY p.short_name,t.short_name,e.reference_label`).all(year)
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

  ipcMain.handle('catalogs:save', (_event, value: unknown) => {
    if (!value || typeof value !== 'object') return { ok: false, message: 'Перевірте дані довідника.' }
    const item = value as Record<string, unknown>
    if ((item.kind !== 'program' && item.kind !== 'aidType') || (item.id !== undefined && typeof item.id !== 'string') ||
      typeof item.shortName !== 'string' || !item.shortName.trim() || item.shortName.length > 250 ||
      typeof item.officialName !== 'string' || !item.officialName.trim() || item.officialName.length > 1500) {
      return { ok: false, message: 'Коротка та офіційна назви мають бути заповнені.' }
    }
    try {
      const id = typeof item.id === 'string' && item.id ? item.id : null
      const isActive = item.isActive === undefined ? true : item.isActive === true
      const duplicate = (table: 'programs' | 'aid_types') => database.prepare(`SELECT id FROM ${table} WHERE (lower(trim(short_name))=lower(trim(?)) OR lower(trim(official_name))=lower(trim(?))) AND id!=? LIMIT 1`)
        .get(String(item.shortName), String(item.officialName), id ?? '')
      if (duplicate(item.kind === 'program' ? 'programs' : 'aid_types')) return { ok: false, message: 'Довідник із такою короткою або офіційною назвою вже існує. Перевірте наявний запис.' }
      if (item.kind === 'program') {
        const approvalId = typeof item.approvalId === 'string' && item.approvalId ? item.approvalId : null
        const approvalNumber = typeof item.approvalNumber === 'string' && item.approvalNumber.trim() ? item.approvalNumber.trim() : null
        const approvalDate = typeof item.approvalDate === 'string' && item.approvalDate ? item.approvalDate : null
        const approvalTitle = typeof item.approvalTitle === 'string' && item.approvalTitle.trim() ? item.approvalTitle.trim() : null
        if (approvalNumber && !/^[\w\-/№. ]{1,100}$/u.test(approvalNumber)) return { ok: false, message: 'Перевірте номер рішення про затвердження.' }
        if (approvalDate && !isIsoDate(approvalDate)) return { ok: false, message: 'Перевірте дату рішення про затвердження.' }
        if (approvalId && !database.prepare('SELECT 1 FROM program_approvals WHERE id=?').get(approvalId)) return { ok: false, message: 'Обране рішення про затвердження не знайдено.' }
        if (id) {
          const result = database.prepare('UPDATE programs SET short_name=?,official_name=?,is_active=?,approval_id=?,approval_number=?,approval_date=?,approval_title=? WHERE id=?').run(item.shortName.trim(), item.officialName.trim(), isActive ? 1 : 0, approvalId, approvalNumber, approvalDate, approvalTitle, id)
          if (!Number(result.changes)) return { ok: false, message: 'Програму не знайдено. Оновіть довідник.' }
        } else {
          database.prepare('INSERT INTO programs(id,code,short_name,official_name,is_active,approval_id,approval_number,approval_date,approval_title,sort_order) VALUES(?,?,?,?,?,?,?,?,?,(SELECT COALESCE(MAX(sort_order),-1)+1 FROM programs))')
            .run(randomUUID(), `PROGRAM_${randomUUID()}`, item.shortName.trim(), item.officialName.trim(), isActive ? 1 : 0, approvalId, approvalNumber, approvalDate, approvalTitle)
        }
      } else {
        if (id && item.isActive === true && (database.prepare('SELECT code FROM aid_types WHERE id=?').get(id) as Row | undefined)?.code === 'SOCIAL_WAR_EMERGENCY') {
          return { ok: false, message: 'Цей вид допомоги вимкнено через дублювання категорії та недоступний для нових призначень.' }
        }
        if (typeof item.programId !== 'string' || !item.programId) return { ok: false, message: 'Оберіть програму.' }
        const programExists = database.prepare('SELECT 1 FROM programs WHERE id = ? AND is_active = 1').get(item.programId)
        if (!programExists) return { ok: false, message: 'Обрана програма недоступна.' }
        if (id) {
          const result = database.prepare('UPDATE aid_types SET sort_order=CASE WHEN program_id<>? THEN (SELECT COALESCE(MAX(sort_order),-1)+1 FROM aid_types WHERE program_id=?) ELSE sort_order END,program_id=?,short_name=?,official_name=?,direction=?,funding_source=?,is_active=? WHERE id=?')
            .run(item.programId, item.programId, item.programId, item.shortName.trim(), item.officialName.trim(), typeof item.direction === 'string' && item.direction.trim() ? item.direction.trim() : null,
              typeof item.fundingSource === 'string' && item.fundingSource.trim() ? item.fundingSource.trim() : null, isActive ? 1 : 0, id)
          if (!Number(result.changes)) return { ok: false, message: 'Вид допомоги не знайдено. Оновіть довідник.' }
        } else {
          database.prepare('INSERT INTO aid_types(id,code,program_id,short_name,official_name,direction,funding_source,is_active,sort_order) VALUES(?,?,?,?,?,?,?,?,(SELECT COALESCE(MAX(sort_order),-1)+1 FROM aid_types WHERE program_id=?))')
            .run(randomUUID(), `AID_${randomUUID()}`, item.programId, item.shortName.trim(), item.officialName.trim(),
              typeof item.direction === 'string' && item.direction.trim() ? item.direction.trim() : null,
              typeof item.fundingSource === 'string' && item.fundingSource.trim() ? item.fundingSource.trim() : null, isActive ? 1 : 0, item.programId)
        }
      }
      return { ok: true }
    } catch { return { ok: false, message: 'Не вдалося зберегти зміни довідника.' } }
  })

  ipcMain.handle('program-approvals:list', () => database.prepare(`SELECT pa.id,pa.document_number AS documentNumber,pa.document_date AS documentDate,pa.title,COUNT(p.id) AS programCount
    FROM program_approvals pa LEFT JOIN programs p ON p.approval_id=pa.id GROUP BY pa.id ORDER BY pa.document_date DESC,pa.document_number`).all())

  ipcMain.handle('program-approvals:save', (_event, value: unknown, idValue?: unknown) => {
    if (!value || typeof value !== 'object') return { ok: false, message: 'Перевірте реквізити рішення.' }
    const source = value as Record<string, unknown>
    const documentNumber = typeof source.documentNumber === 'string' ? source.documentNumber.trim() : ''
    const documentDate = typeof source.documentDate === 'string' ? source.documentDate.trim() : ''
    const title = typeof source.title === 'string' ? source.title.trim() : ''
    if (!documentNumber || documentNumber.length > 100 || !isIsoDate(documentDate) || title.length > 300) return { ok: false, message: 'Вкажіть номер і коректну дату рішення про затвердження.' }
    const id = typeof idValue === 'string' && idValue ? idValue : null
    const savedId = id ?? randomUUID(), now = new Date().toISOString()
    try {
      const conflict = database.prepare('SELECT id FROM program_approvals WHERE document_number=? AND document_date=? AND id!=?').get(documentNumber, documentDate, id ?? '')
      if (conflict) return { ok: false, message: 'Рішення з таким номером і датою вже є в довіднику.' }
      if (id) {
        const result = database.prepare('UPDATE program_approvals SET document_number=?,document_date=?,title=?,updated_at=? WHERE id=?').run(documentNumber, documentDate, title || null, now, id)
        if (!Number(result.changes)) return { ok: false, message: 'Рішення не знайдено. Оновіть довідник.' }
      } else database.prepare('INSERT INTO program_approvals(id,document_number,document_date,title,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(savedId, documentNumber, documentDate, title || null, now, now)
      const approval = database.prepare(`SELECT pa.id,pa.document_number AS documentNumber,pa.document_date AS documentDate,pa.title,COUNT(p.id) AS programCount FROM program_approvals pa LEFT JOIN programs p ON p.approval_id=pa.id WHERE pa.id=? GROUP BY pa.id`).get(savedId)
      return { ok: true, approval }
    } catch { return { ok: false, message: 'Не вдалося зберегти рішення про затвердження програми.' } }
  })

  ipcMain.handle('decisions:list', (): DecisionSummary[] => {
    return listDecisions(database)
  })

  ipcMain.handle('decisions:get', (_event, id: unknown): DecisionRecord | null => {
    if (typeof id !== 'string' || !id) return null
    return getDecision(database, id)
  })

  ipcMain.handle('decisions:save', (_event, value: unknown, idValue?: unknown): DecisionSaveResult => {
    const input = readDecisionInput(value)
    if (!input) return { ok: false, reason: 'validation', message: 'Перевірте номер і дату рішення.' }
    const id = typeof idValue === 'string' && idValue ? idValue : null
    const now = new Date().toISOString()
    try {
      database.exec('BEGIN IMMEDIATE')
      const conflict = database.prepare('SELECT id FROM decisions WHERE decision_number = ? AND decision_date = ? AND id != ?').get(input.decisionNumber, input.decisionDate, id ?? '')
      if (conflict) {
        database.exec('ROLLBACK')
        return { ok: false, reason: 'conflict', message: 'Рішення з таким номером і датою вже зареєстроване.' }
      }
      let savedId = id
      if (id) {
        const conflictYear = database.prepare(`SELECT 1 FROM assignments WHERE decision_id=? AND status='Виплачено' AND substr(paid_on,1,4)<>? LIMIT 1`).get(id, input.decisionDate.slice(0, 4))
        if (conflictYear) {
          database.exec('ROLLBACK')
          return { ok: false, reason: 'validation', message: 'Рік рішення має збігатися з роком фактичної виплати пов’язаних призначень. Зміни не збережено.' }
        }
        const result = database.prepare('UPDATE decisions SET decision_number = ?, decision_date = ?, title = ?, updated_at = ? WHERE id = ?')
          .run(input.decisionNumber, input.decisionDate, input.title || null, now, id)
        if (Number(result.changes) === 0) {
          database.exec('ROLLBACK')
          return { ok: false, reason: 'not-found', message: 'Рішення не знайдено. Оновіть список і спробуйте ще раз.' }
        }
      } else {
        savedId = randomUUID()
        database.prepare('INSERT INTO decisions(id, decision_number, decision_date, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(savedId, input.decisionNumber, input.decisionDate, input.title || null, now, now)
      }
      const decision = getDecision(database, savedId!)
      if (!decision) {
        database.exec('ROLLBACK')
        return { ok: false, reason: 'storage', message: 'Не вдалося прочитати рішення перед збереженням; зміни скасовано.' }
      }
      const response: DecisionSaveResult = { ok: true, decision }
      database.exec('COMMIT')
      return response
    } catch {
      try { database.exec('ROLLBACK') } catch { /* Transaction may already be closed. */ }
      return { ok: false, reason: 'storage', message: 'Не вдалося зберегти рішення. Перевірте локальне сховище та спробуйте ще раз.' }
    }
  })

  ipcMain.handle('decisions:add-assignments', (_event, decisionIdValue: unknown, value: unknown): AssignmentSaveResult => {
    if (typeof decisionIdValue !== 'string' || !decisionIdValue) return { ok: false, reason: 'validation', message: 'Не вибрано рішення.' }
    const drafts = readDrafts(value)
    if (!drafts) return { ok: false, reason: 'validation', message: 'Перевірте отримувачів, вид допомоги й суми. Для статусу «Виплачено» потрібна коректна дата фактичної виплати.' }
    try {
      database.exec('BEGIN IMMEDIATE')
      const decision = database.prepare('SELECT decision_date FROM decisions WHERE id = ?').get(decisionIdValue) as Row | undefined
      if (!decision) {
        database.exec('ROLLBACK')
        return { ok: false, reason: 'not-found', message: 'Рішення не знайдено. Оновіть список.' }
      }
      const recipientExists = database.prepare('SELECT 1 AS found FROM recipients WHERE id = ?')
      const aidType = database.prepare('SELECT program_id, direction, funding_source FROM aid_types WHERE id = ? AND is_active = 1')
      for (const draft of drafts) {
        if (draft.status === 'Виплачено') {
          const message = paymentYearError(draft.paidOn, String(decision.decision_date))
          if (message) { database.exec('ROLLBACK'); return { ok: false, reason: 'validation', message } }
        }
        if (!recipientExists.get(draft.recipientId)) {
          database.exec('ROLLBACK')
          return { ok: false, reason: 'validation', message: 'Один із вибраних отримувачів більше не доступний. Оновіть список.' }
        }
        if (!aidType.get(draft.aidTypeId)) {
          database.exec('ROLLBACK')
          return { ok: false, reason: 'validation', message: 'Один із вибраних видів допомоги більше не доступний. Оновіть список.' }
        }
      }
      const insert = database.prepare(`INSERT INTO assignments (
        id, recipient_id, decision_id, aid_type_id, amount_minor, status, direction, funding_source, created_at, updated_at, paid_on
      ) SELECT ?, ?, ?, t.id, ?, ?, t.direction, t.funding_source, ?, ?, ? FROM aid_types t WHERE t.id = ?`)
      const now = new Date().toISOString()
      for (const draft of drafts) insert.run(randomUUID(), draft.recipientId, decisionIdValue, draft.amountMinor, draft.status, now, now, draft.status === 'Виплачено' ? draft.paidOn! : null, draft.aidTypeId)
      const response: AssignmentSaveResult = { ok: true, assignments: listDecisionAssignments(database, decisionIdValue) }
      database.exec('COMMIT')
      return response
    } catch {
      try { database.exec('ROLLBACK') } catch { /* Transaction may already be closed. */ }
      return { ok: false, reason: 'storage', message: 'Не вдалося зберегти призначення. Перевірте локальне сховище та спробуйте ще раз.' }
    }
  })
}

export { listAssignments } from './assignment-data.js'
