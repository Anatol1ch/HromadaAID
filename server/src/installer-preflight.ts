import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { installedConfigArgument, readInstalledServerConfig } from './config.js'
import { validateInstalledPaths } from './installed-paths.js'

export function validateServerInstallConfig(configPath: string): void {
  const config = readInstalledServerConfig(configPath)
  validateInstalledPaths(config, { initialize: !existsSync(config.databasePath) })
}

function main(): void {
  try {
    const configPath = installedConfigArgument(process.argv.slice(2))
    validateServerInstallConfig(configPath)
    console.log('Конфігурація та шляхи HTTP-сервера пройшли перевірку.')
  } catch (error) {
    console.error(`Перевірка сервера не пройшла: ${error instanceof Error ? error.message : 'перевірте конфігурацію та доступність каталогів.'}`)
    process.exitCode = 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
