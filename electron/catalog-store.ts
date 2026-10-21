import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { CatalogEditInput, CatalogSaveResult } from './api-contract.js'
import { orderScope, touchOrderRevision } from './catalog-order.js'
import { nextRecordRevision } from '../shared/record-revision.js'

export function saveCatalog(database: DatabaseSync, value: unknown): CatalogSaveResult {
  if (!value || typeof value !== 'object') return invalid('Перевірте дані довідника.')
  const item = value as CatalogEditInput
  if ((item.kind !== 'program' && item.kind !== 'aidType') || (item.id !== undefined && typeof item.id !== 'string') || typeof item.shortName !== 'string' || !item.shortName.trim() || item.shortName.length > 250 || typeof item.officialName !== 'string' || !item.officialName.trim() || item.officialName.length > 1500) return invalid('Коротка та офіційна назви мають бути заповнені.')
  if (item.id && (!item.expectedUpdatedAt || typeof item.expectedUpdatedAt !== 'string')) return invalid('Оновіть довідник перед редагуванням.')
  const expectedUpdatedAt = typeof item.expectedUpdatedAt === 'string' ? item.expectedUpdatedAt : null
  let active = false
  try {
    database.exec('BEGIN IMMEDIATE'); active = true
    const table = item.kind === 'program' ? 'programs' : 'aid_types'
    const existing = item.id
      ? database.prepare(item.kind === 'program' ? 'SELECT id,updated_at FROM programs WHERE id=?' : 'SELECT id,updated_at,program_id FROM aid_types WHERE id=?').get(item.id) as { id: string; updated_at: string; program_id?: string } | undefined
      : undefined
    if (item.id && !existing) return rollback(database, 'not-found', item.kind === 'program' ? 'Програму не знайдено. Оновіть довідник.' : 'Вид допомоги не знайдено. Оновіть довідник.')
    if (existing && existing.updated_at !== expectedUpdatedAt) return rollback(database, 'conflict', 'Запис довідника вже змінив інший користувач. Оновіть список і повторіть зміни.')
    const duplicate = database.prepare(`SELECT id FROM ${table} WHERE (lower(trim(short_name))=lower(trim(?)) OR lower(trim(official_name))=lower(trim(?))) AND id!=? LIMIT 1`).get(item.shortName, item.officialName, item.id ?? '')
    if (duplicate) return rollback(database, 'validation', 'Довідник із такою короткою або офіційною назвою вже існує. Перевірте наявний запис.')
    const revision = nextRecordRevision(existing?.updated_at)
    const isActive = item.isActive !== false
    if (item.kind === 'program') {
      const approvalId = typeof item.approvalId === 'string' && item.approvalId ? item.approvalId : null
      const approvalNumber = typeof item.approvalNumber === 'string' && item.approvalNumber.trim() ? item.approvalNumber.trim() : null
      const approvalDate = typeof item.approvalDate === 'string' && item.approvalDate ? item.approvalDate : null
      if (approvalNumber && !/^[\w\-/№. ]{1,100}$/u.test(approvalNumber)) return rollback(database, 'validation', 'Перевірте номер рішення про затвердження.')
      if (approvalDate && !isIsoDate(approvalDate)) return rollback(database, 'validation', 'Перевірте дату рішення про затвердження.')
      if (approvalId && !database.prepare('SELECT 1 FROM program_approvals WHERE id=?').get(approvalId)) return rollback(database, 'validation', 'Обране рішення про затвердження не знайдено.')
      if (existing) {
        const result = database.prepare('UPDATE programs SET short_name=?,official_name=?,is_active=?,approval_id=?,approval_number=?,approval_date=?,approval_title=?,updated_at=? WHERE id=? AND updated_at=?').run(item.shortName.trim(), item.officialName.trim(), isActive ? 1 : 0, approvalId, approvalNumber, approvalDate, typeof item.approvalTitle === 'string' && item.approvalTitle.trim() ? item.approvalTitle.trim() : null, revision, item.id!, expectedUpdatedAt!)
        if (!Number(result.changes)) return rollback(database, 'conflict', 'Запис довідника вже змінив інший користувач. Оновіть список і повторіть зміни.')
      } else {
        const id = randomUUID(); database.prepare('INSERT INTO programs(id,code,short_name,official_name,is_active,approval_id,approval_number,approval_date,approval_title,sort_order,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id, `PROGRAM_${randomUUID()}`, item.shortName.trim(), item.officialName.trim(), isActive ? 1 : 0, approvalId, approvalNumber, approvalDate, typeof item.approvalTitle === 'string' && item.approvalTitle.trim() ? item.approvalTitle.trim() : null, Number((database.prepare('SELECT COALESCE(MAX(sort_order),-1)+1 AS value FROM programs').get() as { value: number }).value), revision); touchOrderRevision(database, orderScope('program')); touchOrderRevision(database, orderScope('aidType', id))
      }
    } else {
      if (existing && item.isActive === true && (database.prepare('SELECT code FROM aid_types WHERE id=?').get(item.id!) as { code?: string } | undefined)?.code === 'SOCIAL_WAR_EMERGENCY') return rollback(database, 'validation', 'Цей вид допомоги вимкнено через дублювання категорії та недоступний для нових призначень.')
      if (typeof item.programId !== 'string' || !item.programId || !database.prepare('SELECT 1 FROM programs WHERE id=? AND is_active=1').get(item.programId)) return rollback(database, 'validation', 'Обрана програма недоступна.')
      const oldProgramId = existing?.program_id
      if (existing) {
        const result = database.prepare('UPDATE aid_types SET sort_order=CASE WHEN program_id<>? THEN (SELECT COALESCE(MAX(sort_order),-1)+1 FROM aid_types WHERE program_id=?) ELSE sort_order END,program_id=?,short_name=?,official_name=?,direction=?,funding_source=?,is_active=?,updated_at=? WHERE id=? AND updated_at=?').run(item.programId, item.programId, item.programId, item.shortName.trim(), item.officialName.trim(), typeof item.direction === 'string' && item.direction.trim() ? item.direction.trim() : null, typeof item.fundingSource === 'string' && item.fundingSource.trim() ? item.fundingSource.trim() : null, isActive ? 1 : 0, revision, item.id!, expectedUpdatedAt!)
        if (!Number(result.changes)) return rollback(database, 'conflict', 'Запис довідника вже змінив інший користувач. Оновіть список і повторіть зміни.')
        if (oldProgramId !== item.programId) { touchOrderRevision(database, orderScope('aidType', oldProgramId)); touchOrderRevision(database, orderScope('aidType', item.programId)) }
      } else {
        database.prepare('INSERT INTO aid_types(id,code,program_id,short_name,official_name,direction,funding_source,is_active,sort_order,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), `AID_${randomUUID()}`, item.programId, item.shortName.trim(), item.officialName.trim(), typeof item.direction === 'string' && item.direction.trim() ? item.direction.trim() : null, typeof item.fundingSource === 'string' && item.fundingSource.trim() ? item.fundingSource.trim() : null, isActive ? 1 : 0, Number((database.prepare('SELECT COALESCE(MAX(sort_order),-1)+1 AS value FROM aid_types WHERE program_id=?').get(item.programId) as { value: number }).value), revision); touchOrderRevision(database, orderScope('aidType', item.programId))
      }
    }
    database.exec('COMMIT'); active = false; return { ok: true }
  } catch { if (active) try { database.exec('ROLLBACK') } catch {}; return { ok: false, reason: 'storage', message: 'Не вдалося зберегти зміни довідника.' } }
}
const invalid = (message: string): CatalogSaveResult => ({ ok: false, reason: 'validation', message })
function rollback(database: DatabaseSync, reason: Exclude<CatalogSaveResult, { ok: true }>['reason'], message: string): CatalogSaveResult { database.exec('ROLLBACK'); return { ok: false, reason, message } }
function isIsoDate(value: string) { const date = new Date(`${value}T00:00:00.000Z`); return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value }
