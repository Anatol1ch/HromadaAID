import type { DatabaseSync } from 'node:sqlite'
import type { CatalogOrderInput, CatalogOrderResult } from './api-contract.js'
import { nextRecordRevision } from '../shared/record-revision.js'

export const orderScope = (kind: 'program' | 'aidType', programId?: string) => kind === 'program' ? 'programs' : `aid-types:${programId}`
export function touchOrderRevision(database: DatabaseSync, scope: string): string {
  const row = database.prepare('SELECT revision FROM catalog_order_revisions WHERE scope=?').get(scope) as { revision?: string } | undefined
  const revision = nextRecordRevision(row?.revision)
  if (row) database.prepare('UPDATE catalog_order_revisions SET revision=? WHERE scope=?').run(revision, scope)
  else database.prepare('INSERT INTO catalog_order_revisions(scope,revision) VALUES(?,?)').run(scope, revision)
  return revision
}
export function reorderCatalog(database: DatabaseSync, value: unknown): CatalogOrderResult {
  if (!value || typeof value !== 'object') return { ok: false, reason: 'validation', message: 'Перевірте порядок довідника.' }
  const input = value as CatalogOrderInput
  if (!['program', 'aidType'].includes(input.kind) || !Array.isArray(input.ids) || !input.ids.every(id => typeof id === 'string' && id.length > 0) || new Set(input.ids).size !== input.ids.length || (input.kind === 'aidType' && (typeof input.programId !== 'string' || !input.programId)) || typeof input.expectedOrderRevision !== 'string' || !input.expectedOrderRevision) return { ok: false, reason: 'validation', message: 'Некоректний список або версія порядку.' }
  let transaction = false
  try {
    database.exec('BEGIN IMMEDIATE'); transaction = true
    const scope = orderScope(input.kind, input.programId)
    const revision = database.prepare('SELECT revision FROM catalog_order_revisions WHERE scope=?').get(scope) as { revision?: string } | undefined
    if (!revision || revision.revision !== input.expectedOrderRevision) { database.exec('ROLLBACK'); return { ok: false, reason: 'conflict', message: 'Порядок довідника вже змінив інший користувач. Оновіть список і повторіть дію.' } }
    const table = input.kind === 'program' ? 'programs' : 'aid_types'
    const rows = (input.kind === 'program' ? database.prepare('SELECT id FROM programs').all() : database.prepare('SELECT id FROM aid_types WHERE program_id=?').all(input.programId!)) as { id: string }[]
    const ids = new Set(rows.map(row => row.id))
    if (rows.length !== input.ids.length || input.ids.some(id => !ids.has(id))) { database.exec('ROLLBACK'); return { ok: false, reason: 'conflict', message: 'Склад довідника змінився. Оновіть список і повторіть перестановку.' } }
    const update = database.prepare(`UPDATE ${table} SET sort_order=?,updated_at=? WHERE id=?`)
    input.ids.forEach((id, index) => update.run(index, nextRecordRevision(undefined), id))
    touchOrderRevision(database, scope)
    database.exec('COMMIT'); transaction = false
    return { ok: true }
  } catch {
    if (transaction) try { database.exec('ROLLBACK') } catch { /* preserve original failure */ }
    return { ok: false, reason: 'storage', message: 'Не вдалося зберегти порядок. Попередню послідовність відновлено.' }
  }
}
