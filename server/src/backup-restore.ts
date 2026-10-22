import { backup, DatabaseSync } from 'node:sqlite'
import { existsSync, readFileSync, renameSync, unlinkSync, openSync, fsyncSync, closeSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { hashFile } from './backup-crypto.js'
import { clearMaintenance, maintenancePath, restoreCandidatePath, restorePlanPath, type RestorePlan } from './backup-admin.js'
import { acquireDatabaseOwnership, assertServerDatabasePath, durableJson, validateRestoreDatabase } from './restore-safety.js'
import { secureBackupDirectory } from './backup.js'
import { restoreError } from './restore-diagnostics.js'

type RestoreJournal = { version: 1; id: string; safety: string; original: string; stage: string; phase: 'prepared' | 'moved' | 'installed' }
const flush = (path: string) => { const fd = openSync(path, 'r+'); try { fsyncSync(fd) } finally { closeSync(fd) } }
function checkpoint(path: string): void {
  const db = new DatabaseSync(path)
  try {
    const result = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as { busy: number }
    if (result.busy) throw new Error('SQLite зайнята іншим процесом.')
    db.exec('PRAGMA journal_mode=DELETE')
  } finally { db.close() }
  // Only after successful checkpoint, journal-mode transition and close.
  for (const suffix of ['-wal', '-shm']) if (existsSync(`${path}${suffix}`)) unlinkSync(`${path}${suffix}`)
  flush(path)
}

/** Offline only. Durable renames and a journal make every crash point resumable. */
export async function restoreOffline(databasePath: string, backupDirectory: string, fault?: (phase: string) => void): Promise<string> {
  assertServerDatabasePath(databasePath)
  let stage = 'ownership'
  let release: (() => void) | undefined
  const journalPath = `${databasePath}.restore-journal.json`
  try {
    release = acquireDatabaseOwnership(databasePath)
    let journal: RestoreJournal
    if (existsSync(journalPath)) {
      stage = 'load-journal'
      journal = JSON.parse(readFileSync(journalPath, 'utf8')) as RestoreJournal
      if (journal.version !== 1 || !/^[a-f0-9-]{36}$/.test(journal.id) || journal.original !== `${databasePath}.before-restore-${journal.id}` || journal.stage !== `${databasePath}.restore-stage-${journal.id}` || journal.safety !== join(backupDirectory, `hromada-aid-safety-${journal.id}.sqlite`)) throw new Error('Невідомий журнал відновлення. Автоматичну заміну зупинено.')
    } else {
      stage = 'load-marker'
      const marker = JSON.parse(readFileSync(maintenancePath(databasePath), 'utf8')) as { version: number; id: string }
      if (marker.version !== 1 || !/^[a-f0-9-]{36}$/.test(marker.id)) throw new Error('Невідоме підтвердження відновлення.')
      stage = 'load-plan'
      const plan = JSON.parse(readFileSync(restorePlanPath(backupDirectory, marker.id), 'utf8')) as RestorePlan
      if (!plan.confirmed || plan.id !== marker.id) throw new Error('Відновлення не підтверджено адміністратором.')
      const candidate = restoreCandidatePath(backupDirectory, marker.id)
      stage = 'validate-candidate'
      if ((await hashFile(candidate)).sha256 !== plan.hash) throw new Error('Підготовлена база змінилася.')
      validateRestoreDatabase(candidate)
      stage = 'backup-directory-access'
      secureBackupDirectory(backupDirectory)
      const id = marker.id
      journal = { version: 1, id, safety: join(backupDirectory, `hromada-aid-safety-${id}.sqlite`), original: `${databasePath}.before-restore-${id}`, stage: `${databasePath}.restore-stage-${id}`, phase: 'prepared' }
      const safetyPartial = `${journal.safety}.${randomUUID()}.partial`
      stage = 'insurance-backup'
      // No active Fastify can acquire ownership while this command owns the lock.
      const current = new DatabaseSync(databasePath)
      try {
        if (!existsSync(journal.safety)) await backup(current, safetyPartial)
      } finally { current.close() }
      if (!existsSync(journal.safety)) {
        checkpoint(safetyPartial)
        validateRestoreDatabase(safetyPartial)
        renameSync(safetyPartial, journal.safety)
      } else validateRestoreDatabase(journal.safety)
      fault?.('safety')
      stage = 'stage-database'
      // Use SQLite backup rather than filesystem copy, including for the staged candidate.
      // Before publishing the journal, this stage is disposable and has no open
      // handles. A crash during its creation must not prevent a fresh attempt.
      for (const suffix of ['', '-wal', '-shm']) rmSync(`${journal.stage}${suffix}`, { force: true })
      const source = new DatabaseSync(candidate, { readOnly: true })
      try { await backup(source, journal.stage) } finally { source.close() }
      const staged = new DatabaseSync(journal.stage)
      try {
        staged.exec('BEGIN IMMEDIATE; DELETE FROM user_sessions; COMMIT;')
      } finally { staged.close() }
      checkpoint(journal.stage)
      validateRestoreDatabase(journal.stage)
      checkpoint(databasePath)
      stage = 'publish-journal'
      durableJson(journalPath, journal)
      fault?.('prepared')
    }
    stage = 'verify-insurance'
    validateRestoreDatabase(journal.safety)
    if (!existsSync(journal.original)) {
      stage = 'move-original'
      if (!existsSync(databasePath) || !existsSync(journal.stage)) throw new Error('Неповний стан відновлення. Файли збережено для ручної перевірки.')
      renameSync(databasePath, journal.original)
      fault?.('original-renamed')
      journal.phase = 'moved'; durableJson(journalPath, journal)
    }
    if (existsSync(journal.stage)) {
      stage = 'install-database'
      if (existsSync(databasePath)) throw new Error('Неоднозначний стан заміни. Автоматичне відновлення зупинено.')
      renameSync(journal.stage, databasePath)
      fault?.('replacement-renamed')
    }
    stage = 'verify-restored-database'
    validateRestoreDatabase(databasePath)
    const restored = new DatabaseSync(databasePath)
    try { restored.exec('DELETE FROM user_sessions') } finally { restored.close() }
    checkpoint(databasePath)
    journal.phase = 'installed'; durableJson(journalPath, journal)
    fault?.('installed')
    stage = 'finish-maintenance'
    clearMaintenance(databasePath)
    unlinkSync(journalPath)
    // Original and insurance copy are intentionally retained, never pruned as daily backups.
    return journal.safety
  } catch (error) { throw restoreError(stage, error) }
  finally { release?.() }
}
