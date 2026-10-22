import { createApp } from './app.js'
import { SqliteBackupService, startDailyBackupScheduler } from './backup.js'
import { DriveSecretsStore, type DriveSecrets } from './backup-crypto.js'
import { readServerConfig } from './config.js'
import { openServerDatabase } from './database.js'
import { createDriveClient, DriveSyncStateStore, GoogleDriveBackupSync } from './google-drive.js'

async function start() {
  const config = readServerConfig()
  const database = openServerDatabase(config.databasePath)
  const app = createApp(database)
  let backupScheduler: ReturnType<typeof startDailyBackupScheduler> | undefined
  let driveSync: GoogleDriveBackupSync | undefined
  let stopping = false

  const stop = async (signal: string) => {
    if (stopping) return
    stopping = true
    app.log.info({ signal }, 'Завершуємо HromadaAID API')
    try { await app.close() } finally { await driveSync?.stop(); await backupScheduler?.stop(); database.close() }
  }

  process.once('SIGINT', () => { void stop('SIGINT') })
  process.once('SIGTERM', () => { void stop('SIGTERM') })

  try {
    await app.listen({ host: config.host, port: config.port })
    const logger = {
      error: (message: string) => app.log.error(message),
      warn: (message: string) => app.log.warn(message),
    }
    const secretsStore = new DriveSecretsStore(config.backupDirectory)
    let secrets: DriveSecrets | null = null
    try { secrets = secretsStore.load() }
    catch { app.log.error('Не вдалося відкрити захищені параметри Google Drive; локальне резервування продовжується.') }
    let syncState: DriveSyncStateStore | undefined
    let driveClient: ReturnType<typeof createDriveClient> = null
    if (secrets) {
      driveClient = createDriveClient(secrets)
      if (!driveClient) app.log.warn('Резервні копії очікують синхронізації: не задано OAuth client ID Google Drive.')
      else {
        syncState = new DriveSyncStateStore(config.backupDirectory)
        try { syncState.load() }
        catch { app.log.warn('Стан синхронізації пошкоджений; повторні завантаження будуть звірені з Google Drive.') }
        driveSync = new GoogleDriveBackupSync(config.backupDirectory, secrets, driveClient, syncState, logger)
        driveSync.start()
      }
    }
    const backupService = new SqliteBackupService(database, config.backupDirectory, {
      ...logger,
    }, (fileName) => Boolean(secretsStore.exists() && (!syncState || !syncState.isUploaded(fileName))))
    backupScheduler = startDailyBackupScheduler(backupService, logger, { onBackupCreated: () => driveSync?.wake() })
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
