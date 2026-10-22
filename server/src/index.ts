import { createApp } from './app.js'
import { SqliteBackupService, startDailyBackupScheduler } from './backup.js'
import { BackupKeyStore, decodeRecoveryKey } from './backup-crypto.js'
import { BackupArchives } from './backup-archives.js'
import { readServerConfig } from './config.js'
import { openServerDatabase } from './database.js'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { acquireDatabaseOwnership } from './restore-safety.js'
import { BackupAdministration, assertNoPendingRestore } from './backup-admin.js'

async function start() {
  const config = readServerConfig()
  mkdirSync(dirname(config.databasePath), { recursive: true })
  assertNoPendingRestore(config.databasePath)
  const releaseOwnership = acquireDatabaseOwnership(config.databasePath)
  const database = openServerDatabase(config.databasePath)
  let key: Buffer | undefined
  try { const saved = new BackupKeyStore(config.backupDirectory).load(); if (saved) key = decodeRecoveryKey(saved.encryptionKey) } catch { /* Local SQLite backups remain independent. */ }
  const archives = new BackupArchives(config.backupDirectory, () => {
    if (!key) throw new Error('Налаштуйте серверний ключ резервування.')
    return key
  })
  let scheduler: ReturnType<typeof startDailyBackupScheduler> | undefined
  const logger = { error: (message: string) => app.log.error(message), warn: (message: string) => app.log.warn(message) }
  const service = new SqliteBackupService(database, config.backupDirectory, logger)
  const administration = new BackupAdministration(config.databasePath, archives, service, async () => { await scheduler?.stop() })
  const app = createApp(database, archives, administration)
  let stopping = false
  const stop = async (signal: string) => {
    if (stopping) return
    stopping = true
    app.log.info({ signal }, 'Завершуємо HromadaAID API')
    try { await app.close() } finally { await scheduler?.stop(); await archives.stop(); database.close(); releaseOwnership() }
  }
  process.once('SIGINT', () => { void stop('SIGINT') })
  process.once('SIGTERM', () => { void stop('SIGTERM') })
  try {
    await app.listen({ host: config.host, port: config.port })
    if (!key) logger.warn('Ключ розподіленого резервування не налаштовано. Виконайте server:backup-key-setup; локальні копії створюються незалежно.')
    scheduler = startDailyBackupScheduler(service, logger, { onBackupCreated: () => { if (key) void archives.list().catch(() => logger.error('Не вдалося підготувати зашифровані резервні архіви.')) } })
    app.log.info({ host: config.host, port: config.port }, 'HromadaAID API готовий')
  } catch {
    app.log.error('Не вдалося запустити HromadaAID API')
    await app.close().catch(() => undefined)
    await scheduler?.stop()
    await archives.stop()
    database.close()
    releaseOwnership()
    process.exitCode = 1
  }
}
void start().catch(() => { console.error('API не запущено: перевірте блокування бази або незавершене відновлення (server:backup-restore).'); process.exitCode = 1 })
