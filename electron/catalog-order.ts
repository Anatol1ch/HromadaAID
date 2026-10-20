import type { DatabaseSync } from 'node:sqlite'
import type { CatalogOrderInput } from './api-contract.js'

/** Exact membership validation prevents stale lists, duplicates and cross-program moves. */
export function reorderCatalog(database: DatabaseSync, value: unknown): { ok: boolean; message?: string } {
  if (!value || typeof value !== 'object') return { ok: false, message: 'Перевірте порядок довідника.' }
  const input = value as CatalogOrderInput
  if (!['program', 'aidType'].includes(input.kind) || !Array.isArray(input.ids) || !input.ids.every(id => typeof id === 'string' && id.length > 0) || new Set(input.ids).size !== input.ids.length || (input.kind === 'aidType' && (typeof input.programId !== 'string' || !input.programId))) {
    return { ok: false, message: 'Некоректний список для зміни порядку.' }
  }
  let transaction = false
  try {
    database.exec('BEGIN IMMEDIATE'); transaction = true
    const table = input.kind === 'program' ? 'programs' : 'aid_types'
    if (input.kind === 'aidType' && !database.prepare('SELECT 1 FROM programs WHERE id=?').get(input.programId!)) throw Error('membership')
    const rows = (input.kind === 'program' ? database.prepare('SELECT id FROM programs').all() : database.prepare('SELECT id FROM aid_types WHERE program_id=?').all(input.programId!)) as { id: string }[]
    const ids = new Set(rows.map(row => row.id))
    if (rows.length !== input.ids.length || input.ids.some(id => !ids.has(id))) {
      database.exec('ROLLBACK'); transaction = false
      return { ok: false, message: 'Склад довідника змінився. Оновіть список і повторіть перестановку.' }
    }
    const update = database.prepare(`UPDATE ${table} SET sort_order=? WHERE id=?`)
    input.ids.forEach((id, index) => update.run(index, id))
    database.exec('COMMIT'); transaction = false
    return { ok: true }
  } catch {
    if (transaction) { try { database.exec('ROLLBACK') } catch { /* preserve original failure */ } }
    return { ok: false, message: 'Не вдалося зберегти порядок. Попередню послідовність відновлено.' }
  }
}
