import { existsSync, lstatSync, mkdirSync, openSync, closeSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type DatabaseSync as DatabaseHandle } from 'node:sqlite'
import { openInitializedDatabase } from '../../electron/database.js'

export function openServerDatabase(databasePath: string): DatabaseHandle {
  mkdirSync(dirname(databasePath), { recursive: true })
  return openInitializedDatabase(databasePath)
}

/** Installed service path: open an initialized file only; never create a database on startup. */
export function openInstalledServerDatabase(databasePath: string): DatabaseHandle {
  if (!existsSync(databasePath)) throw new Error(`Файл серверної бази не знайдено: ${databasePath}. Нова база автоматично не створюється.`)
  const metadata = lstatSync(databasePath)
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`Шлях серверної бази не є звичайним файлом: ${databasePath}`)
  const probe = new DatabaseSync(databasePath, { readOnly: true })
  try {
    const version = Number((probe.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
    const hasSchema = probe.prepare("SELECT 1 FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' LIMIT 1").get()
    if (!Number.isInteger(version) || version < 1 || !hasSchema) throw new Error('Файл SQLite порожній або не є ініціалізованою базою HromadaAID. Для першого запуску виконайте окрему команду server:initialize.')
  } finally { probe.close() }
  return openInitializedDatabase(databasePath)
}

/** Creates the initial database only when explicitly requested, and never overwrites an existing file. */
export function initializeInstalledServerDatabase(databasePath: string): void {
  if (existsSync(`${databasePath}-wal`) || existsSync(`${databasePath}-shm`)) throw new Error(`Поруч із новою базою вже є SQLite sidecar-файл; ініціалізацію зупинено без змін: ${databasePath}`)
  let descriptor: number
  try { descriptor = openSync(databasePath, 'wx', 0o600) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`Файл бази вже існує; його не перезаписано: ${databasePath}`)
    throw new Error(`Не вдалося створити файл бази ${databasePath}: перевірте каталог і права доступу.`)
  }
  closeSync(descriptor)
  let database: DatabaseHandle | undefined
  try {
    database = openInitializedDatabase(databasePath)
    const result = database.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[]
    if (result.length !== 1 || result[0].integrity_check !== 'ok') throw new Error('Створена база не пройшла перевірку цілісності.')
    database.close()
    database = undefined
  } catch (error) {
    database?.close()
    // Remove only the file reserved by this operation and its own SQLite sidecars.
    rmSync(databasePath, { force: true })
    rmSync(`${databasePath}-wal`, { force: true })
    rmSync(`${databasePath}-shm`, { force: true })
    throw error
  }
}
