import { createApp } from './app.js'
import { SqliteBackupService, startDailyBackupScheduler } from './backup.js'
import { BackupKeyStore, decodeRecoveryKey } from './backup-crypto.js'
import { BackupArchives } from './backup-archives.js'
import { openInstalledServerDatabase, openServerDatabase } from './database.js'
import { acquireDatabaseOwnership } from './restore-safety.js'
import { BackupAdministration, assertNoPendingRestore } from './backup-admin.js'
import type { ServerConfig } from './config.js'
import { lstatSync } from 'node:fs'
import { createGracefulShutdown } from './server-lifecycle.js'

export type RunningServer = { stop(signal: string): Promise<void> }
export const SERVER_HOST = '0.0.0.0'
export const SERVER_PORT = 4310

export async function startServer(config: ServerConfig, installed: boolean): Promise<RunningServer> {
  assertNoPendingRestore(config.databasePath)
  let key: Buffer | undefined
  let releaseOwnership: (() => void) | undefined
  let database: ReturnType<typeof openServerDatabase> | undefined
  let scheduler: ReturnType<typeof startDailyBackupScheduler> | undefined
  let archives: BackupArchives | undefined
  let app: ReturnType<typeof createApp> | undefined
  let databaseClosed = false
  let detachSignalHandlers: () => void = () => {}
  try {
    key = loadBackupKey(config.backupDirectory, installed)
    releaseOwnership = acquireDatabaseOwnership(config.databasePath)
    database = installed ? openInstalledServerDatabase(config.databasePath) : openServerDatabase(config.databasePath)
    archives = new BackupArchives(config.backupDirectory, () => {
      if (!key) throw new Error('Ключ зашифрованного резервування не налаштовано.')
      return key
    }, !installed)
    const logger = { error: (message: string) => app?.log.error(message), warn: (message: string) => app?.log.warn(message) }
    const service = new SqliteBackupService(database, config.backupDirectory, logger, !installed)
    const administration = new BackupAdministration(config.databasePath, archives, service, async () => { await scheduler?.stop() }, !installed)
    app = createApp(database, administration)
    const shutdown = createGracefulShutdown([
      { name: 'HTTP-запити Fastify', close: () => app?.close() },
      { name: 'планувальник резервування', close: () => scheduler?.stop() },
      { name: 'архіви резервування', close: () => archives?.stop() },
      { name: 'SQLite', close: () => { database?.close(); databaseClosed = true } },
      { name: 'блокування екземпляра', close: () => {
        if (!databaseClosed) throw new Error('SQLite remains open; ownership lock must be retained.')
        releaseOwnership?.()
      } },
      { name: 'очищення ключа з пам’яті', close: () => { key?.fill(0) } },
    ], {
      info: message => app?.log.info(message),
      warn: message => app?.log.warn(message),
      error: message => app?.log.error(message),
    }, { onCleanupFailure: () => { process.exitCode = 1 } })
    const stop = (signal: string) => {
      detachSignalHandlers()
      return shutdown(signal)
    }
    const onSigint = () => { void stop('SIGINT') }
    const onSigterm = () => { void stop('SIGTERM') }
    process.once('SIGINT', onSigint)
    process.once('SIGTERM', onSigterm)
    detachSignalHandlers = () => {
      process.off('SIGINT', onSigint)
      process.off('SIGTERM', onSigterm)
    }
    await app.listen({ host: SERVER_HOST, port: SERVER_PORT })
    if (!key) logger.warn('Ключ розподіленого резервування не налаштовано. Локальні SQLite-копії працюють незалежно.')
    scheduler = startDailyBackupScheduler(service, logger, { onBackupCreated: () => { if (key) void archives?.list().catch(() => logger.error('Не вдалося підготувати зашифровані резервні архіви.')) } })
    app.log.info({ host: SERVER_HOST, port: SERVER_PORT, protocol: 'HTTP' }, 'HromadaAID API готовий')
    return { stop }
  } catch (error) {
    detachSignalHandlers()
    app?.log.error('Не вдалося запустити HromadaAID API')
    await app?.close().catch(() => undefined)
    await scheduler?.stop().catch(() => undefined)
    await archives?.stop().catch(() => undefined)
    try { database?.close() } catch { /* startup is already failing */ }
    try { releaseOwnership?.() } catch { /* startup is already failing */ }
    key?.fill(0)
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      throw new Error(`Порт ${SERVER_PORT} зайнятий. HTTP API на ${SERVER_HOST}:${SERVER_PORT} не запущено; звільніть порт і повторіть запуск.`, { cause: error })
    }
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
