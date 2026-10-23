import { installedConfigArgument, readInstalledServerConfig } from './config.js'
import { validateInstalledPaths } from './installed-paths.js'
import { startServer } from './server-runtime.js'

async function main(): Promise<void> {
  const configPath = installedConfigArgument(process.argv.slice(2))
  const config = readInstalledServerConfig(configPath)
  validateInstalledPaths(config)
  await startServer(config, true)
}

void main().catch(error => {
  console.error(`Встановлений сервер не запущено: ${error instanceof Error ? error.message : 'невідома помилка запуску'}`)
  process.exitCode = 1
})
