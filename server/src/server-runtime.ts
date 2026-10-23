import { createApp } from './app.js'
import { SqliteBackupService, startDailyBackupScheduler } from './backup.js'
import { BackupKeyStore, decodeRecoveryKey } from './backup-crypto.js'
import { BackupArchives } from './backup-archives.js'
import { openInstalledServerDatabase, openServerDatabase } from './database.js'
import { acquireDatabaseOwnership } from './restore-safety.js'
import { BackupAdministration, assertNoPendingRestore } from './backup-admin.js'
import { readInstalledTlsOptions, type InstalledServerConfig, type ServerConfig } from './config.js'
import { lstatSync } from 'node:fs'

export async function startServer(config: ServerConfig | InstalledServerConfig, installed: boolean): Promise<void> {
  const https = installed ? readInstalledTlsOptions(config as InstalledServerConfig) : undefined
  assertNoPendingRestore(config.databasePath)
  const key = loadBackupKey(config.backupDirectory, installed)
  const releaseOwnership = acquireDatabaseOwnership(config.databasePath)
  let database: ReturnType<typeof openServerDatabase> | undefined
  let scheduler: ReturnType<typeof startDailyBackupScheduler> | undefined
  let archives: BackupArchives | undefined
  let app: ReturnType<typeof createApp> | undefined
  let stopping = false
  try {
    database = installed ? openInstalledServerDatabase(config.databasePath) : openServerDatabase(config.databasePath)
    archives = new BackupArchives(config.backupDirectory, () => {
      if (!key) throw new Error('Ключ зашифрованного резервування не налаштовано.')
      return key
    }, !installed)
    const logger = { error: (message: string) => app?.log.error(message), warn: (message: string) => app?.log.warn(message) }
    const service = new SqliteBackupService(database, config.backupDirectory, logger, !installed)
    const administration = new BackupAdministration(config.databasePath, archives, service, async () => { await scheduler?.stop() }, !installed)
    app = createApp(database, archives, administration, https)
    const stop = async (signal: string) => {
      if (stopping) return
      stopping = true
      app?.log.info({ signal }, 'Завершуємо HromadaAID API')
      try { await app?.close() }
      finally { await scheduler?.stop(); await archives?.stop(); database?.close(); releaseOwnership(); key?.fill(0) }
    }
    process.once('SIGINT', () => { void stop('SIGINT') })
    process.once('SIGTERM', () => { void stop('SIGTERM') })
    await app.listen({ host: config.host, port: config.port })
    if (!key) logger.warn('Ключ розподіленого резервування не налаштовано. Локальні SQLite-копії працюють незалежно.')
    scheduler = startDailyBackupScheduler(service, logger, { onBackupCreated: () => { if (key) void archives?.list().catch(() => logger.error('Не вдалося підготувати зашифровані резервні архіви.')) } })
    app.log.info({ host: config.host, port: config.port }, 'HromadaAID API готовий')
  } catch (error) {
    app?.log.error('Не вдалося запустити HromadaAID API')
    await app?.close().catch(() => undefined)
    await scheduler?.stop()
    await archives?.stop()
    database?.close()
    releaseOwnership()
    key?.fill(0)
    throw error
  }
}

function loadBackupKey(directory: string, required: boolean): Buffer | undefined {
  const store = new BackupKeyStore(directory)
  try {
    const metadata = lstatSync(store.path)
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('invalid-key-file')
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      if (required) throw new Error(`Ключ резервування не знайдено в каталозі ${store.path}. Створення нового ключа під час звичайного запуску заборонено.`)
      return undefined
    }
    if (!required) return undefined
    throw new Error(`Немає доступу до файла ключа резервування ${store.path}. Перевірте права службового облікового запису.`)
  }
  try {
    const saved = store.load()
    if (!saved) throw new Error('Файл ключа недоступний.')
    return decodeRecoveryKey(saved.encryptionKey)
  } catch {
    if (required) throw new Error(`Не вдалося прочитати захищений ключ резервування: ${store.path}. Перевірте права служби та цілісність файла.`)
    return undefined
  }
}
