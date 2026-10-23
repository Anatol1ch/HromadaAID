import { initializeInstalledServerDatabase } from './database.js'
import { initializationConfigArgument, readInstalledServerConfig } from './config.js'
import { validateInstalledPaths } from './installed-paths.js'
import { assertNoPendingRestore } from './backup-admin.js'

try {
  const configPath = initializationConfigArgument(process.argv.slice(2))
  const config = readInstalledServerConfig(configPath)
  assertNoPendingRestore(config.databasePath)
  validateInstalledPaths(config, { initialize: true })
  initializeInstalledServerDatabase(config.databasePath)
  console.log(`Початкову базу HromadaAID створено й перевірено: ${config.databasePath}`)
  console.log('Створіть адміністратора окремою адміністративною командою та налаштуйте ключ резервування перед запуском служби.')
} catch (error) {
  console.error(`Первинну ініціалізацію не виконано: ${error instanceof Error ? error.message : 'невідома помилка'}`)
  process.exitCode = 1
}
