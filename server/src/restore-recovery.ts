import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'
import { acquireDatabaseOwnership, durableJson, validateRestoreDatabase } from './restore-safety.js'
import { maintenancePath, restoreCandidatePath, restoreDirectory, restorePlanPath } from './backup-admin.js'
import { hashFile } from './backup-crypto.js'
import { secureBackupDirectory } from './backup.js'
import { RestoreError } from './restore-diagnostics.js'

export const completionPath = (database: string) => `${database}.restore-completed.json`
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"'

/** Logical contents, including sessions and metadata. Any data change forbids return.
 * Journal mode, checkpoint and other physical SQLite layout changes are irrelevant. */
export function databaseFingerprint(path: string): string {
  if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile()) throw new RestoreError('RESTORE_RECOVERY_PATH', 'validate-recovery', 'Файл recovery не може бути посиланням або каталогом.')
  validateRestoreDatabase(path)
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    db.exec('BEGIN')
    const hash = createHash('sha256')
    const tables = db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    for (const table of tables) {
      const name = String(table.name)
      hash.update(JSON.stringify(table))
      const columns = db.prepare(`PRAGMA table_info(${quote(name)})`).all().map(column => quote(String(column.name)))
      const statement = db.prepare(`SELECT * FROM ${quote(name)} ORDER BY ${columns.join(',')}`)
      statement.setReadBigInts(true)
      for (const row of statement.iterate()) hash.update(JSON.stringify(row, (_key, value) => typeof value === 'bigint' ? { integer: String(value) } : value instanceof Uint8Array ? { bytes: Buffer.from(value).toString('base64') } : value) + '\n')
    }
    return hash.digest('hex')
  } finally { db.close() }
}

export function recordRestoreCompletion(database: string, backups: string, id: string, returnOf?: string): void {
  const previousFingerprint = databaseFingerprint(`${database}.before-restore-${id}`)
  if (databaseFingerprint(join(backups, `hromada-aid-safety-${id}.sqlite`)) !== previousFingerprint) throw new RestoreError('RESTORE_RECOVERY_UNSAFE', 'validate-recovery', 'Попередня база й страхова копія не збігаються; файли та журнал збережено.')
  durableJson(completionPath(database), { version: 1, id, fingerprint: databaseFingerprint(database), previousFingerprint, acknowledged: false, ...(returnOf ? { returnOf } : {}) })
}

function readCompletion(database: string) {
  if (lstatSync(completionPath(database)).isSymbolicLink()) throw new RestoreError('RESTORE_RECOVERY_PATH', 'validate-recovery', 'Запис завершення restore не може бути посиланням.')
  const record = JSON.parse(readFileSync(completionPath(database), 'utf8')) as { version: number; id: string; fingerprint: string; previousFingerprint: string; acknowledged: boolean; returnOf?: string }
  if (record.version !== 1 || !/^[a-f0-9-]{36}$/.test(record.id) || !/^[a-f0-9]{64}$/.test(record.fingerprint) || !/^[a-f0-9]{64}$/.test(record.previousFingerprint) || typeof record.acknowledged !== 'boolean') throw new RestoreError('RESTORE_RECOVERY_UNSAFE', 'validate-recovery', 'Запис завершення restore пошкоджено. Копії збережено для ручної перевірки.')
  if (record.returnOf !== undefined && !/^[a-f0-9-]{36}$/.test(record.returnOf)) throw new RestoreError('RESTORE_RECOVERY_UNSAFE', 'validate-recovery', 'Історію повернення бази не підтверджено.')
  return record
}

export function inspectRestoreRecovery(database: string, backups: string): { pending: boolean; canReturn: boolean; reason: string } {
  if (existsSync(`${database}.restore-journal.json`) || existsSync(maintenancePath(database))) return { pending: true, canReturn: false, reason: 'Є незавершене відновлення. Продовжіть наявну операцію.' }
  if (!existsSync(completionPath(database))) return { pending: false, canReturn: false, reason: '' }
  let release: (() => void) | undefined
  try {
    release = acquireDatabaseOwnership(database)
    const record = readCompletion(database)
    if (record.acknowledged) return { pending: false, canReturn: false, reason: '' }
    if (record.returnOf) return { pending: false, canReturn: false, reason: 'Попередню базу вже повернуто. Якщо API недоступний, потрібне ручне втручання. Обидві бази та страхові копії збережено.' }
    if (databaseFingerprint(`${database}.before-restore-${record.id}`) !== record.previousFingerprint || databaseFingerprint(join(backups, `hromada-aid-safety-${record.id}.sqlite`)) !== record.previousFingerprint) throw new RestoreError('RESTORE_RECOVERY_UNSAFE', 'validate-recovery', 'Копії попередньої бази змінилися. Автоматичне повернення заборонене.')
    if (databaseFingerprint(database) !== record.fingerprint) throw new RestoreError('RESTORE_RECOVERY_UNSAFE', 'validate-recovery', 'Після restore дані змінилися. Повернення попередньої бази може втратити нові записи й заборонене.')
    return { pending: false, canReturn: true, reason: 'Попередню базу перевірено. Нових змін у поточній базі не виявлено.' }
  } catch (error) { return { pending: false, canReturn: false, reason: error instanceof Error ? error.message : 'Безпечне повернення не підтверджено.' } }
  finally { release?.() }
}

export function acknowledgeRestore(database: string): void {
  if (!existsSync(completionPath(database))) return
  const record = readCompletion(database)
  durableJson(completionPath(database), { ...record, acknowledged: true })
}

/** Publishes an ordinary confirmed restore plan, then the caller runs restoreOffline.
 * The current failed replacement also receives its own insurance copy and original. */
export async function preparePreviousDatabaseReturn(database: string, backups: string): Promise<void> {
  const release = acquireDatabaseOwnership(database)
  try {
    if (existsSync(`${database}.restore-journal.json`) || existsSync(maintenancePath(database))) throw new RestoreError('RESTORE_RECOVERY_UNSAFE', 'validate-recovery', 'Спочатку завершіть незавершене відновлення.')
    const record = readCompletion(database)
    if (record.returnOf) throw new RestoreError('RESTORE_RECOVERY_UNSAFE', 'validate-recovery', 'Попередню базу вже повернуто. Повторне перемикання баз заборонене.')
    if (record.acknowledged || databaseFingerprint(database) !== record.fingerprint) throw new RestoreError('RESTORE_RECOVERY_UNSAFE', 'validate-recovery', 'Дані змінилися або API вже підтвердив роботу. Безпечне повернення заборонене.')
    const original = `${database}.before-restore-${record.id}`
    if (databaseFingerprint(original) !== record.previousFingerprint || databaseFingerprint(join(backups, `hromada-aid-safety-${record.id}.sqlite`)) !== record.previousFingerprint) throw new RestoreError('RESTORE_RECOVERY_UNSAFE', 'validate-recovery', 'Копії попередньої бази змінилися. Повернення заборонене.')
    const id = randomUUID(), target = restoreCandidatePath(backups, id)
    await mkdir(restoreDirectory(backups), { recursive: true })
    secureBackupDirectory(restoreDirectory(backups))
    const source = new DatabaseSync(original, { readOnly: true })
    try { await backup(source, target) } finally { source.close() }
    if (databaseFingerprint(target) !== record.previousFingerprint) throw new RestoreError('RESTORE_RECOVERY_UNSAFE', 'validate-recovery', 'Кандидат повернення не відповідає перевіреній попередній базі.')
    durableJson(restorePlanPath(backups, id), { version: 1, id, hash: (await hashFile(target)).sha256, tokenHash: '', createdAt: null, expiresAt: '', confirmed: true, expectedCurrentFingerprint: record.fingerprint, returnOf: record.id })
    durableJson(maintenancePath(database), { version: 1, id })
  } finally { release() }
}
