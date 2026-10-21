import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { ProgramApproval, ProgramApprovalInput, ProgramApprovalSaveResult } from './api-contract.js'
import { nextRecordRevision } from '../shared/record-revision.js'

export function saveProgramApproval(database: DatabaseSync, value: unknown, idValue?: unknown, expectedUpdatedAtValue?: unknown): ProgramApprovalSaveResult {
  if (!value || typeof value !== 'object') return invalid('Перевірте реквізити рішення.')
  const source = value as ProgramApprovalInput
  const number = typeof source.documentNumber === 'string' ? source.documentNumber.trim() : '', date = typeof source.documentDate === 'string' ? source.documentDate.trim() : '', title = typeof source.title === 'string' ? source.title.trim() : ''
  if (!number || number.length > 100 || !isIsoDate(date) || title.length > 300) return invalid('Вкажіть номер і коректну дату рішення про затвердження.')
  const id = typeof idValue === 'string' && idValue ? idValue : null
  if (id && (typeof expectedUpdatedAtValue !== 'string' || !expectedUpdatedAtValue)) return invalid('Оновіть рішення перед редагуванням.')
  const expectedUpdatedAt = typeof expectedUpdatedAtValue === 'string' ? expectedUpdatedAtValue : null
  try {
    database.exec('BEGIN IMMEDIATE')
    const existing = id ? database.prepare('SELECT updated_at FROM program_approvals WHERE id=?').get(id) as { updated_at: string } | undefined : undefined
    if (id && !existing) { database.exec('ROLLBACK'); return fail('not-found', 'Рішення не знайдено. Оновіть довідник.') }
    if (existing && existing.updated_at !== expectedUpdatedAt) { database.exec('ROLLBACK'); return fail('conflict', 'Рішення про затвердження вже змінив інший користувач. Оновіть список і повторіть зміни.') }
    if (database.prepare('SELECT id FROM program_approvals WHERE document_number=? AND document_date=? AND id!=?').get(number, date, id ?? '')) { database.exec('ROLLBACK'); return invalid('Рішення з таким номером і датою вже є в довіднику.') }
    const savedId = id ?? randomUUID(), revision = nextRecordRevision(existing?.updated_at)
    if (id) {
      const result = database.prepare('UPDATE program_approvals SET document_number=?,document_date=?,title=?,updated_at=? WHERE id=? AND updated_at=?').run(number, date, title || null, revision, id, expectedUpdatedAt!)
      if (!Number(result.changes)) { database.exec('ROLLBACK'); return fail('conflict', 'Рішення про затвердження вже змінив інший користувач. Оновіть список і повторіть зміни.') }
    } else database.prepare('INSERT INTO program_approvals(id,document_number,document_date,title,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(savedId, number, date, title || null, revision, revision)
    const approval = database.prepare(`SELECT pa.id,pa.document_number AS documentNumber,pa.document_date AS documentDate,pa.title,pa.updated_at AS updatedAt,COUNT(p.id) AS programCount FROM program_approvals pa LEFT JOIN programs p ON p.approval_id=pa.id WHERE pa.id=? GROUP BY pa.id`).get(savedId) as ProgramApproval
    database.exec('COMMIT'); return { ok: true, approval }
  } catch { try { database.exec('ROLLBACK') } catch {}; return fail('storage', 'Не вдалося зберегти рішення про затвердження програми.') }
}
const invalid = (message: string): ProgramApprovalSaveResult => fail('validation', message)
const fail = (reason: Exclude<ProgramApprovalSaveResult, { ok: true }>['reason'], message: string): ProgramApprovalSaveResult => ({ ok: false, reason, message })
function isIsoDate(value: string) { const date = new Date(`${value}T00:00:00.000Z`); return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value }
