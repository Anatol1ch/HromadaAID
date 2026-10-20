import type { DatabaseSync } from 'node:sqlite'
import { ASSIGNMENT_STATUSES } from './assignment-model.js'
import { paymentYearError } from './accounting-year.js'
import type { AssignmentStatus, AssignmentStatusBatchInput, AssignmentStatusBatchResult } from './api-contract.js'

const statuses: readonly AssignmentStatus[] = ASSIGNMENT_STATUSES
const validDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function readInput(value: unknown): AssignmentStatusBatchInput | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Record<string, unknown>
  if (!Array.isArray(input.assignmentIds) || !input.assignmentIds.length || input.assignmentIds.length > 10000 ||
    input.assignmentIds.some((id) => typeof id !== 'string' || !id.trim() || id.length > 200) ||
    new Set(input.assignmentIds).size !== input.assignmentIds.length ||
    !Number.isInteger(input.year) || Number(input.year) < 2000 || Number(input.year) > 2200 ||
    !statuses.includes(input.status as AssignmentStatus)) return null
  if (input.status === 'Виплачено' && !validDate(input.paidOn)) return null
  if (input.paidOn !== undefined && input.paidOn !== '' && !validDate(input.paidOn)) return null
  return { assignmentIds: input.assignmentIds as string[], year: input.year as number, status: input.status as AssignmentStatus, paidOn: input.paidOn as string | undefined }
}

/** One write lock covers both eligibility checks and every status change. */
export function changeAssignmentStatuses(database: DatabaseSync, value: unknown): AssignmentStatusBatchResult {
  if (value && typeof value === 'object' && 'assignmentIds' in value && Array.isArray(value.assignmentIds) && value.assignmentIds.length > 10000) {
    return { ok: false, reason: 'validation', message: 'За одну операцію можна змінити не більше 10 000 призначень. Звузьте вибір за допомогою фільтрів.' }
  }
  const input = readInput(value)
  if (!input) return { ok: false, reason: 'validation', message: 'Перевірте вибір призначень, робочий рік, статус і дату виплати. Для статусу «Виплачено» дата обов’язкова.' }
  if (input.status === 'Виплачено') {
    const message = paymentYearError(input.paidOn, input.year)
    if (message) return { ok: false, reason: 'validation', message }
  }
  let transactionOpen = false
  try {
    database.exec('BEGIN IMMEDIATE')
    transactionOpen = true
    const reject = (reason: 'not-found' | 'conflict', message: string): AssignmentStatusBatchResult => {
      database.exec('ROLLBACK'); transactionOpen = false
      return { ok: false, reason, message }
    }
    const read = database.prepare(`SELECT a.status, d.decision_date, a.amount_minor, a.paid_on
      FROM assignments a JOIN decisions d ON d.id = a.decision_id
      JOIN recipients r ON r.id = a.recipient_id JOIN aid_types t ON t.id = a.aid_type_id
      JOIN programs p ON p.id = t.program_id WHERE a.id = ?`)
    const changes: string[] = []
    for (const id of input.assignmentIds) {
      const row = read.get(id)
      if (!row) return reject('not-found', 'Одне або кілька призначень більше не доступні. Оновіть реєстр. Жодних змін не внесено.')
      if (typeof row.decision_date !== 'string' || row.decision_date.slice(0, 4) !== String(input.year)) return reject('conflict', 'Вибрані призначення мають належати поточному робочому року. Жодних змін не внесено.')
      if (row.status === 'Виплачено') return reject('conflict', 'Виплачене призначення можна змінити лише індивідуально. Оновіть реєстр. Жодних змін не внесено.')
      if (!statuses.includes(row.status as AssignmentStatus) || typeof row.amount_minor !== 'number' || !Number.isSafeInteger(row.amount_minor) || row.amount_minor <= 0) return reject('conflict', 'Дані одного з призначень потребують індивідуальної перевірки. Жодних змін не внесено.')
      if (row.status !== input.status || (input.status !== 'Виплачено' && row.paid_on !== null)) changes.push(id)
    }
    const update = database.prepare(`UPDATE assignments SET status = ?, paid_on = CASE WHEN ? = 'Виплачено' THEN ? ELSE NULL END, updated_at = ? WHERE id = ?`)
    const now = new Date().toISOString()
    for (const id of changes) {
      const result = update.run(input.status, input.status, input.status === 'Виплачено' ? input.paidOn! : null, now, id)
      if (Number(result.changes) !== 1) throw new Error('Unexpected assignment update count')
    }
    const result: AssignmentStatusBatchResult = { ok: true, updatedCount: changes.length, unchangedCount: input.assignmentIds.length - changes.length }
    database.exec('COMMIT')
    transactionOpen = false
    return result
  } catch {
    if (transactionOpen) { try { database.exec('ROLLBACK') } catch { /* Preserve the original operation failure. */ } }
    return { ok: false, reason: 'storage', message: 'Не вдалося змінити статуси. Операцію скасовано повністю; жодних змін не внесено.' }
  }
}
