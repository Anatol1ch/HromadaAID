import { randomUUID } from 'node:crypto'
import { closeSync, fsyncSync, openSync, renameSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'
import { openInitializedDatabase } from '../../electron/database.js'

export function durableJson(path: string, value: unknown): void {
  const temp = `${path}.${randomUUID()}.tmp`
  const fd = openSync(temp, 'wx', 0o600)
  try { writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd) } finally { closeSync(fd) }
  renameSync(temp, path)
}

/** Cooperative, fail-closed process ownership. Never removes a live owner's lock. */
export function acquireDatabaseOwnership(path: string): () => void {
  // A separate technical SQLite is used solely as an OS-backed process mutex.
  // SQLite releases its lock on crash, avoiding stale PID files and PID reuse.
  const lock = new DatabaseSync(`${path}.process-lock.sqlite`)
  try { lock.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE;') }
  catch { lock.close(); throw new Error('SQLite використовується іншим серверним процесом. Спочатку зупиніть Fastify.') }
  return () => { lock.exec('ROLLBACK'); lock.close() }
}

export function assertServerDatabasePath(path: string): void {
  const normalized = resolve(path).replaceAll('/', '\\').toLowerCase()
  if (normalized.endsWith('\\appdata\\roaming\\hromada-aid\\hromada-aid.sqlite')) throw new Error('Робочу локальну SQLite Electron використовувати заборонено.')
}

function schema(database: DatabaseSync): string {
  return JSON.stringify(database.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all())
}

/** Rejects unknown objects, triggers, future/old schemas; never executes archive migrations. */
export function validateRestoreDatabase(path: string, allowLegacy = false): void {
  const candidate = new DatabaseSync(path, { readOnly: true, enableDoubleQuotedStringLiterals: false })
  const reference = openInitializedDatabase(':memory:')
  try {
    candidate.exec('PRAGMA trusted_schema=OFF')
    const version = (db: DatabaseSync) => (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    // Google Drive format-1 backups used schema 27. Only this known predecessor
    // is accepted, and only after matching its exact known schema and history.
    if (allowLegacy && version(candidate) === 27 && version(reference) === 28) reference.exec('DROP TABLE backup_installations; DELETE FROM schema_migrations WHERE version=28; PRAGMA user_version=27;')
    if (schema(candidate) !== schema(reference)) throw new Error('Структура резервної бази несумісна з цією версією HromadaAID.')
    if (version(candidate) !== version(reference) || JSON.stringify(candidate.prepare('SELECT version FROM schema_migrations ORDER BY version').all()) !== JSON.stringify(reference.prepare('SELECT version FROM schema_migrations ORDER BY version').all())) throw new Error('Версія резервної бази несумісна.')
    const check = candidate.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[]
    if (check.length !== 1 || check[0].integrity_check !== 'ok' || candidate.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Резервна база не пройшла перевірку цілісності.')
    const admin = candidate.prepare("SELECT 1 FROM users u JOIN user_roles r ON r.user_id=u.id WHERE u.status='active' AND r.role='administrator' LIMIT 1").get()
    if (!admin) throw new Error('У копії немає активного адміністратора. Потрібне окреме аварійне відновлення.')
  } finally { candidate.close(); reference.close() }
}

export function upgradeRestoreCandidate(path: string): void {
  validateRestoreDatabase(path, true)
  const upgraded = openInitializedDatabase(path)
  upgraded.close()
  validateRestoreDatabase(path)
}
