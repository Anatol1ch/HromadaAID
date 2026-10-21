import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { paymentYearError } from './accounting-year.js'
import { ASSIGNMENT_STATUSES } from './assignment-model.js'
import { getDecision, listDecisionAssignments } from './assignment-data.js'
import type { AssignmentDraft, AssignmentSaveResult, AssignmentStatus, DecisionInput, DecisionSaveResult } from './api-contract.js'
import { nextRecordRevision } from '../shared/record-revision.js'

type Row = Record<string, string | number | null>
const assignmentStatusValues: readonly AssignmentStatus[] = ASSIGNMENT_STATUSES

export function readDecisionInput(value: unknown): DecisionInput | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  if (typeof source.decisionNumber !== 'string' || typeof source.decisionDate !== 'string' || typeof source.title !== 'string') return null
  const decisionNumber = source.decisionNumber.trim(), decisionDate = source.decisionDate.trim(), title = source.title.trim()
  if (!decisionNumber || decisionNumber.length > 100 || title.length > 300 || !isIsoDate(decisionDate)) return null
  return { decisionNumber, decisionDate, title }
}

export function readAssignmentDrafts(value: unknown): AssignmentDraft[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 500) return null
  const drafts: AssignmentDraft[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') return null
    const draft = item as Record<string, unknown>
    if (typeof draft.recipientId !== 'string' || !draft.recipientId || typeof draft.aidTypeId !== 'string' || !draft.aidTypeId || typeof draft.amountMinor !== 'number' || !Number.isSafeInteger(draft.amountMinor) || draft.amountMinor <= 0 || !assignmentStatusValues.includes(draft.status as AssignmentStatus)) return null
    if (draft.paidOn !== undefined && (typeof draft.paidOn !== 'string' || (draft.paidOn !== '' && !isIsoDate(draft.paidOn)))) return null
    if (draft.status === 'Виплачено' && (typeof draft.paidOn !== 'string' || !isIsoDate(draft.paidOn))) return null
    drafts.push({ recipientId: draft.recipientId, aidTypeId: draft.aidTypeId, amountMinor: draft.amountMinor, status: draft.status as AssignmentStatus, paidOn: draft.status === 'Виплачено' ? draft.paidOn as string : undefined })
  }
  return drafts
}

export function saveDecision(database: DatabaseSync, value: unknown, idValue?: unknown, expectedUpdatedAtValue?: unknown): DecisionSaveResult {
  const input = readDecisionInput(value)
  if (!input) return failDecision('validation', 'Перевірте номер і дату рішення.')
  const id = typeof idValue === 'string' && idValue ? idValue : null
  if (id && (typeof expectedUpdatedAtValue !== 'string' || !expectedUpdatedAtValue)) return failDecision('validation', 'Оновіть рішення перед редагуванням.')
  const expectedUpdatedAt = typeof expectedUpdatedAtValue === 'string' ? expectedUpdatedAtValue : null
  let transaction = false
  try {
    database.exec('BEGIN IMMEDIATE'); transaction = true
    if (database.prepare('SELECT id FROM decisions WHERE decision_number=? AND decision_date=? AND id!=?').get(input.decisionNumber, input.decisionDate, id ?? '')) return rollbackDecision(database, 'conflict', 'Рішення з таким номером і датою вже зареєстроване.')
    let savedId = id
    if (id) {
      const current = database.prepare('SELECT updated_at FROM decisions WHERE id=?').get(id) as { updated_at: string } | undefined
      if (!current) return rollbackDecision(database, 'not-found', 'Рішення не знайдено. Оновіть список і спробуйте ще раз.')
      if (current.updated_at !== expectedUpdatedAt) return rollbackDecision(database, 'conflict', 'Рішення вже змінив інший користувач. Оновіть список і повторіть зміни.')
      if (database.prepare("SELECT 1 FROM assignments WHERE decision_id=? AND status='Виплачено' AND substr(paid_on,1,4)<>? LIMIT 1").get(id, input.decisionDate.slice(0, 4))) return rollbackDecision(database, 'validation', 'Рік рішення має збігатися з роком фактичної виплати пов’язаних призначень. Зміни не збережено.')
      const revision = nextRecordRevision(current.updated_at)
      const result = database.prepare('UPDATE decisions SET decision_number=?,decision_date=?,title=?,updated_at=? WHERE id=? AND updated_at=?').run(input.decisionNumber, input.decisionDate, input.title || null, revision, id, expectedUpdatedAt!)
      if (!Number(result.changes)) return rollbackDecision(database, 'conflict', 'Рішення вже змінив інший користувач. Оновіть список і повторіть зміни.')
    } else {
      savedId = randomUUID()
      const revision = nextRecordRevision(undefined)
      database.prepare('INSERT INTO decisions(id,decision_number,decision_date,title,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(savedId, input.decisionNumber, input.decisionDate, input.title || null, revision, revision)
    }
    const decision = getDecision(database, savedId!)
    if (!decision) return rollbackDecision(database, 'storage', 'Не вдалося прочитати рішення перед збереженням; зміни скасовано.')
    database.exec('COMMIT'); transaction = false
    return { ok: true, decision }
  } catch {
    if (transaction) try { database.exec('ROLLBACK') } catch { /* preserve original failure */ }
    return failDecision('storage', 'Не вдалося зберегти рішення. Перевірте сховище та спробуйте ще раз.')
  }
}

export function addDecisionAssignments(database: DatabaseSync, decisionIdValue: unknown, value: unknown, requestIdValue?: unknown): AssignmentSaveResult {
  if (typeof decisionIdValue !== 'string' || !decisionIdValue) return failAssignments('validation', 'Не вибрано рішення.')
  if (typeof requestIdValue !== 'string' || !isRequestId(requestIdValue)) return failAssignments('validation', 'Для збереження призначень потрібен ідентифікатор операції. Спробуйте ще раз.')
  const drafts = readAssignmentDrafts(value)
  if (!drafts) return failAssignments('validation', 'Перевірте отримувачів, вид допомоги й суми. Для статусу «Виплачено» потрібна коректна дата фактичної виплати.')
  const payloadHash = assignmentPayloadHash(drafts)
  let transaction = false
  try {
    database.exec('BEGIN IMMEDIATE'); transaction = true
    const previous = database.prepare('SELECT decision_id,payload_hash,result_json FROM decision_assignment_requests WHERE request_id=?').get(requestIdValue) as { decision_id: string; payload_hash: string; result_json: string } | undefined
    if (previous) {
      if (previous.decision_id !== decisionIdValue || previous.payload_hash !== payloadHash) return rollbackAssignments(database, 'conflict', 'Цей ідентифікатор уже використано для іншого набору призначень. Оновіть форму й почніть нову операцію.')
      const replay = parseStoredResult(previous.result_json)
      if (!replay) return rollbackAssignments(database, 'storage', 'Не вдалося прочитати попередній результат операції.')
      database.exec('COMMIT'); transaction = false
      return replay
    }
    const decision = database.prepare('SELECT decision_date FROM decisions WHERE id=?').get(decisionIdValue) as Row | undefined
    if (!decision) return rollbackAssignments(database, 'not-found', 'Рішення не знайдено. Оновіть список.')
    const recipientExists = database.prepare('SELECT 1 FROM recipients WHERE id=?')
    const aidType = database.prepare('SELECT direction,funding_source FROM aid_types WHERE id=? AND is_active=1')
    for (const draft of drafts) {
      if (draft.status === 'Виплачено') {
        const message = paymentYearError(draft.paidOn, String(decision.decision_date))
        if (message) return rollbackAssignments(database, 'validation', message)
      }
      if (!recipientExists.get(draft.recipientId)) return rollbackAssignments(database, 'validation', 'Один із вибраних отримувачів більше не доступний. Оновіть список.')
      if (!aidType.get(draft.aidTypeId)) return rollbackAssignments(database, 'validation', 'Один із вибраних видів допомоги більше не доступний. Оновіть список.')
    }
    const insert = database.prepare(`INSERT INTO assignments(id,recipient_id,decision_id,aid_type_id,amount_minor,status,direction,funding_source,created_at,updated_at,paid_on)
      SELECT ?,?,?,t.id,?,?,t.direction,t.funding_source,?,?,? FROM aid_types t WHERE t.id=?`)
    const now = nextRecordRevision(undefined)
    for (const draft of drafts) insert.run(randomUUID(), draft.recipientId, decisionIdValue, draft.amountMinor, draft.status, now, now, draft.status === 'Виплачено' ? draft.paidOn! : null, draft.aidTypeId)
    const result: AssignmentSaveResult = { ok: true, assignments: listDecisionAssignments(database, decisionIdValue) }
    database.prepare('INSERT INTO decision_assignment_requests(request_id,decision_id,payload_hash,result_json,created_at) VALUES(?,?,?,?,?)').run(requestIdValue, decisionIdValue, payloadHash, JSON.stringify(result), now)
    database.exec('COMMIT'); transaction = false
    return result
  } catch {
    if (transaction) try { database.exec('ROLLBACK') } catch { /* preserve original failure */ }
    return failAssignments('storage', 'Не вдалося зберегти призначення. Перевірте сховище та спробуйте ще раз.')
  }
}

function assignmentPayloadHash(drafts: AssignmentDraft[]): string {
  const normalized = drafts.map((draft) => JSON.stringify({ recipientId: draft.recipientId, aidTypeId: draft.aidTypeId, amountMinor: draft.amountMinor, status: draft.status, paidOn: draft.status === 'Виплачено' ? draft.paidOn ?? null : null })).sort()
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
}

function parseStoredResult(value: string): AssignmentSaveResult | null {
  try {
    const result = JSON.parse(value) as AssignmentSaveResult
    return result && result.ok === true && Array.isArray(result.assignments) ? result : null
  } catch { return null }
}

function isRequestId(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) }
function isIsoDate(value: string): boolean { const parsed = new Date(`${value}T00:00:00.000Z`); return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value }
function failDecision(reason: Exclude<DecisionSaveResult, { ok: true }>['reason'], message: string): DecisionSaveResult { return { ok: false, reason, message } }
function rollbackDecision(database: DatabaseSync, reason: Exclude<DecisionSaveResult, { ok: true }>['reason'], message: string): DecisionSaveResult { database.exec('ROLLBACK'); return failDecision(reason, message) }
function failAssignments(reason: Exclude<AssignmentSaveResult, { ok: true }>['reason'], message: string): AssignmentSaveResult { return { ok: false, reason, message } }
function rollbackAssignments(database: DatabaseSync, reason: Exclude<AssignmentSaveResult, { ok: true }>['reason'], message: string): AssignmentSaveResult { database.exec('ROLLBACK'); return failAssignments(reason, message) }
