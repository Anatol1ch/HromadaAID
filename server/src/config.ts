import { basename, dirname, isAbsolute, resolve } from 'node:path'
import { readFileSync } from 'node:fs'

export type ServerConfig = {
  databasePath: string
  backupDirectory: string
}

export type InstalledServerConfig = ServerConfig & {
  configVersion: 3
  programDirectory: string
}

/** Development/test only. Keep its isolated test-path guard; transport is fixed. */
export function readServerConfig(environment = process.env): ServerConfig {
  const defaultDatabasePath = resolve(process.cwd(), 'server', '.data', 'hromada-aid-api-test.sqlite')
  const databasePath = resolve(environment.HROMADA_AID_API_DATABASE?.trim() || defaultDatabasePath)
  if (!basename(databasePath).toLocaleLowerCase('uk').includes('test')) {
    throw new Error('Для development/test-режиму вкажіть окрему SQLite-базу з назвою, що містить "test".')
  }

  const backupDirectory = resolve(environment.HROMADA_AID_API_BACKUP_DIR?.trim() || resolve(dirname(databasePath), 'backups'))
  return { databasePath, backupDirectory }
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: string[]): void {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key))
  if (unknown.length) throw new Error(`Несумісна конфігурація сервера: невідомий параметр ${unknown[0]}. Файл не змінено.`)
}

function absolutePath(value: unknown, key: string): string {
  if (typeof value !== 'string' || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value) || !/^[A-Za-z]:[\\/]/.test(value) || !isAbsolute(value)) {
    throw new Error(`Параметр ${key} має містити абсолютний шлях.`)
  }
  return resolve(value)
}

/** Installed mode is selected only by a separately packaged entry point and an explicit config path. */
export function readInstalledServerConfig(configPath: string): InstalledServerConfig {
  if (!/^[A-Za-z]:[\\/]/.test(configPath) || !isAbsolute(configPath)) throw new Error('Параметр --config має містити абсолютний локальний шлях Windows до конфігурації сервера.')
  let value: unknown
  try { value = JSON.parse(readFileSync(configPath, 'utf8')) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`Файл конфігурації сервера не знайдено: ${configPath}`)
    if (['EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw new Error(`Немає прав прочитати файл конфігурації сервера: ${configPath}`)
    if (error instanceof SyntaxError) throw new Error('Файл конфігурації сервера містить некоректний JSON.')
    throw new Error('Не вдалося прочитати файл конфігурації сервера.')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Конфігурація сервера має бути JSON-об’єктом.')
  const record = value as Record<string, unknown>
  if (record.configVersion !== 3) throw new Error('Несумісна версія конфігурації сервера. Потрібна configVersion: 3; файл не змінено.')
  assertOnlyKeys(record, ['configVersion', 'programDirectory', 'databasePath', 'backupDirectory'])
  return {
    configVersion: record.configVersion,
    programDirectory: absolutePath(record.programDirectory, 'programDirectory'),
    databasePath: absolutePath(record.databasePath, 'databasePath'),
    backupDirectory: absolutePath(record.backupDirectory, 'backupDirectory'),
  }
}

/** Locate an explicit configuration argument without consuming or interpreting unrelated service args. */
export function installedConfigArgument(args: string[]): string {
  if (args.length !== 2 || args[0] !== '--config' || !args[1]) throw new Error('Встановлений сервер запускається лише з явним параметром --config <абсолютний шлях до server.json>.')
  if (!/^[A-Za-z]:[\\/]/.test(args[1]) || !isAbsolute(args[1])) throw new Error('Параметр --config має містити абсолютний локальний шлях Windows.')
  return args[1]
}

export function initializationConfigArgument(args: string[]): string {
  if (args.length !== 3 || args[0] !== '--config' || !args[1] || args[2] !== '--confirm-initialization') {
    throw new Error('Первинну базу створює лише явна команда: --config <server.json> --confirm-initialization.')
  }
  if (!/^[A-Za-z]:[\\/]/.test(args[1]) || !isAbsolute(args[1])) throw new Error('Параметр --config має містити абсолютний локальний шлях Windows.')
  return args[1]
}
