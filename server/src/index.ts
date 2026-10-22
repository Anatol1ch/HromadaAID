import { createApp } from './app.js'
import { SqliteBackupService, startDailyBackupScheduler } from './backup.js'
import { readServerConfig } from './config.js'
import { openServerDatabase } from './database.js'

async function start() {
  const config = readServerConfig()
  const database = openServerDatabase(config.databasePath)
  const app = createApp(database)
  let backupScheduler: ReturnType<typeof startDailyBackupScheduler> | undefined
  let stopping = false

  const stop = async (signal: string) => {
    if (stopping) return
    stopping = true
    app.log.info({ signal }, 'Завершуємо HromadaAID API')
    try { await app.close() } finally { await backupScheduler?.stop(); database.close() }
  }

  process.once('SIGINT', () => { void stop('SIGINT') })
  process.once('SIGTERM', () => { void stop('SIGTERM') })

  try {
    await app.listen({ host: config.host, port: config.port })
    const backupService = new SqliteBackupService(database, config.backupDirectory, {
      error: (message) => app.log.error(message),
      warn: (message) => app.log.warn(message),
    })
    backupScheduler = startDailyBackupScheduler(backupService, {
      error: (message) => app.log.error(message),
      warn: (message) => app.log.warn(message),
    })
    app.log.info({ host: config.host, port: config.port, database: config.databasePath }, 'HromadaAID API готовий')
  } catch (error) {
    app.log.error(error, 'Не вдалося запустити HromadaAID API')
    await app.close().catch(() => undefined)
    await backupScheduler?.stop()
    database.close()
    process.exitCode = 1
  }
}

void start()
