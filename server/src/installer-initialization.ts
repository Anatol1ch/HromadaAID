import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BackupKeyStore, createRecoveryKey } from './backup-crypto.js'
import { initializeInstalledServerDatabase } from './database.js'
import { readInstalledServerConfig, initializationConfigArgument } from './config.js'
import { validateInstalledPaths } from './installed-paths.js'

export type InstallDataState = 'fresh' | 'existing' | 'inconsistent'
export function classifyInstallDataState(databaseExists: boolean, keyExists: boolean, hasArchives: boolean): InstallDataState {
  if (databaseExists && keyExists) return 'existing'
  if (databaseExists || keyExists || hasArchives) return 'inconsistent'
  return 'fresh'
}

type InstallInitializationOptions = {
  databasePath: string
  keyExists: () => boolean
  hasArchives: () => boolean
  loadExistingKey: () => unknown
  createKey: (encodedKey: string) => void
  removeNewKey: () => void
  initializeDatabase: () => void
  confirmRecoveryKey: (encodedKey: string) => boolean
}

/** First-install state machine with injectable filesystem/DPAPI seams for isolated tests. */
export function runInstallInitialization(options: InstallInitializationOptions): 'initialized' | 'existing' {
  const databaseExists = existsSync(options.databasePath)
  const keyExists = options.keyExists()
  const state = classifyInstallDataState(databaseExists, keyExists, options.hasArchives())
  if (state === 'inconsistent') {
    throw new Error('Наявні база, DPAPI-ключ або архіви не утворюють повний комплект. Ініціалізацію зупинено; наявні дані не змінено.')
  }
  if (state === 'existing') {
    options.loadExistingKey()
    return 'existing'
  }

  const recovery = createRecoveryKey()
  try {
    if (!options.confirmRecoveryKey(recovery.encoded)) throw new Error('Первинне встановлення скасовано: аварійний ключ не було підтверджено.')
    // Recheck immediately before publishing persistent material to close the
    // ordinary race with another installer process. DPAPI store also uses an
    // atomic create-if-absent operation for the final key path.
    if (existsSync(options.databasePath) || options.keyExists() || options.hasArchives()) {
      throw new Error('Під час встановлення з’явилися наявні дані. Ініціалізацію зупинено без перезапису.')
    }
    options.createKey(recovery.encoded)
    try {
      options.initializeDatabase()
    } catch (error) {
      // Remove only the just-created key when no database was published. If a
      // database appeared, preserve both files for explicit administrator review.
      if (!existsSync(options.databasePath)) options.removeNewKey()
      throw error
    }
    return 'initialized'
  } finally {
    recovery.bytes.fill(0)
  }
}

function showAndConfirmRecoveryKey(encodedKey: string): boolean {
  if (process.platform !== 'win32') throw new Error('Вікно збереження аварійного ключа доступне лише під час інсталяції у Windows.')
  const script = [
    "$ErrorActionPreference='Stop'",
    'Add-Type -AssemblyName System.Windows.Forms',
    '$key=[Console]::In.ReadToEnd().Trim()',
    "if (-not $key) { exit 2 }",
    "$message='Збережіть цей аварійний ключ окремо від сервера та резервних копій. Він потрібний для відновлення даних після втрати сервера.' + [Environment]::NewLine + [Environment]::NewLine + $key + [Environment]::NewLine + [Environment]::NewLine + 'Натисніть «Так» лише після того, як збережете ключ у надійному місці.'",
    "$result=[System.Windows.Forms.MessageBox]::Show($message,'HromadaAID — аварійний ключ',[System.Windows.Forms.MessageBoxButtons]::YesNo,[System.Windows.Forms.MessageBoxIcon]::Warning)",
    'if ($result -eq [System.Windows.Forms.DialogResult]::Yes) { exit 0 } else { exit 1 }',
  ].join('; ')
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-STA', '-WindowStyle', 'Hidden', '-Command', script], {
    input: encodedKey,
    encoding: 'utf8',
    windowsHide: false,
    timeout: 0,
    stdio: ['pipe', 'ignore', 'ignore'],
  })
  return result.status === 0
}

function main(): void {
try {
  const configPath = resolve(initializationConfigArgument(process.argv.slice(2)))
  const config = readInstalledServerConfig(configPath)
  const keyStore = new BackupKeyStore(config.backupDirectory)
  const databasePath = config.databasePath
  const result = runInstallInitialization({
    databasePath,
    keyExists: () => keyStore.exists(),
    hasArchives: () => readdirSync(config.backupDirectory).some(name => name.toLocaleLowerCase('en-US').endsWith('.hraid')),
    loadExistingKey: () => {
      if (!keyStore.load()) throw new Error('DPAPI-ключ резервування відсутній або недоступний службі; серверний компонент не запускається.')
    },
    createKey: encryptionKey => keyStore.create({ version: 1, encryptionKey }),
    removeNewKey: () => { if (keyStore.exists()) unlinkSync(keyStore.path) },
    initializeDatabase: () => {
      validateInstalledPaths(config, { initialize: true })
      initializeInstalledServerDatabase(databasePath)
    },
    confirmRecoveryKey: showAndConfirmRecoveryKey,
  })
  console.log(result === 'initialized' ? 'Первинну базу та DPAPI-ключ створено; цілісність SQLite перевірено.' : 'Наявні база й DPAPI-ключ перевірено; дані не змінювалися.')
} catch (error) {
  console.error(`Підготовку серверних даних не виконано: ${error instanceof Error ? error.message : 'перевірте конфігурацію та права доступу.'}`)
  process.exitCode = 1
}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
