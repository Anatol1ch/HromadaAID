import { basename, dirname, resolve } from 'node:path'

export type ServerConfig = {
  host: '127.0.0.1'
  port: number
  databasePath: string
  backupDirectory: string
}

const defaultDatabasePath = resolve(process.cwd(), 'server', '.data', 'hromada-aid-api-test.sqlite')

export function readServerConfig(environment = process.env): ServerConfig {
  const configuredHost = environment.HROMADA_AID_API_HOST?.trim() || '127.0.0.1'
  if (configuredHost !== '127.0.0.1') throw new Error('На цьому етапі API дозволено запускати лише на 127.0.0.1.')

  const configuredPort = environment.HROMADA_AID_API_PORT?.trim()
  const port = configuredPort ? Number(configuredPort) : 4310
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Порт API має бути цілим числом від 1024 до 65535.')

  const databasePath = resolve(environment.HROMADA_AID_API_DATABASE?.trim() || defaultDatabasePath)
  if (!basename(databasePath).toLocaleLowerCase('uk').includes('test')) {
    throw new Error('Для цього етапу вкажіть окрему тестову SQLite-базу з назвою, що містить "test".')
  }

  const backupDirectory = resolve(environment.HROMADA_AID_API_BACKUP_DIR?.trim() || resolve(dirname(databasePath), 'backups'))

  return { host: '127.0.0.1', port, databasePath, backupDirectory }
}
