import { basename, dirname, isAbsolute, resolve } from 'node:path'
import { readFileSync, statSync } from 'node:fs'
import { isIP } from 'node:net'
import { createPrivateKey, X509Certificate } from 'node:crypto'
import { createSecureContext, type SecureContextOptions } from 'node:tls'

export type ServerConfig = {
  host: string
  port: number
  databasePath: string
  backupDirectory: string
}

export type InstalledServerConfig = ServerConfig & {
  configVersion: 1 | 2
  programDirectory: string
  mode: 'local' | 'network'
  tls?: { certificatePath: string; privateKeyPath: string; certificateChainPath?: string }
}

/** Development/test only. Keep its isolated test-path guard and legacy environment inputs. */
export function readServerConfig(environment = process.env): ServerConfig {
  const configuredHost = environment.HROMADA_AID_API_HOST?.trim() || '127.0.0.1'
  if (configuredHost !== '127.0.0.1') throw new Error('У development/test-режимі API дозволено запускати лише на 127.0.0.1.')

  const configuredPort = environment.HROMADA_AID_API_PORT?.trim()
  const port = configuredPort ? Number(configuredPort) : 4310
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Порт API має бути цілим числом від 1024 до 65535.')

  const defaultDatabasePath = resolve(process.cwd(), 'server', '.data', 'hromada-aid-api-test.sqlite')
  const databasePath = resolve(environment.HROMADA_AID_API_DATABASE?.trim() || defaultDatabasePath)
  if (!basename(databasePath).toLocaleLowerCase('uk').includes('test')) {
    throw new Error('Для development/test-режиму вкажіть окрему SQLite-базу з назвою, що містить "test".')
  }

  const backupDirectory = resolve(environment.HROMADA_AID_API_BACKUP_DIR?.trim() || resolve(dirname(databasePath), 'backups'))
  return { host: '127.0.0.1', port, databasePath, backupDirectory }
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: string[]): void {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key))
  if (unknown.length) throw new Error(`Конфігурація містить невідомий параметр: ${unknown[0]}.`)
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
  if (record.configVersion !== 1 && record.configVersion !== 2) throw new Error(`Несумісна версія конфігурації сервера (${String(record.configVersion ?? 'не вказана')}). Підтримуються configVersion: 1 та 2.`)
  assertOnlyKeys(record, record.configVersion === 1
    ? ['configVersion', 'programDirectory', 'host', 'port', 'databasePath', 'backupDirectory']
    : ['configVersion', 'programDirectory', 'mode', 'host', 'port', 'databasePath', 'backupDirectory', 'tls'])
  if (typeof record.host !== 'string' || !record.host) throw new Error('Параметр host має містити адресу прослуховування.')
  if (!Number.isInteger(record.port) || (record.port as number) < 1024 || (record.port as number) > 65535) throw new Error('Параметр port має бути цілим числом від 1024 до 65535.')
  const mode = record.configVersion === 1 ? 'local' : record.mode
  if (mode !== 'local' && mode !== 'network') throw new Error('Параметр mode має бути local або network.')
  const isLoopback = record.host === 'localhost' || record.host === '127.0.0.1' || record.host === '::1' || /^127\./.test(record.host) || record.host.toLowerCase().startsWith('::ffff:')
  if (mode === 'local' && (!isLoopback || record.tls !== undefined)) throw new Error('У режимі local дозволено лише HTTP на loopback (127.0.0.1, ::1 або localhost); параметри TLS не використовуються.')
  if (mode === 'network' && (isIP(record.host) === 0 || isLoopback || record.host === '0.0.0.0' || record.host === '::')) throw new Error('У режимі network вкажіть конкретну нелокальну IPv4 або IPv6 адресу; wildcard і loopback заборонені.')
  let tls: InstalledServerConfig['tls']
  if (mode === 'network') {
    if (!record.tls || typeof record.tls !== 'object' || Array.isArray(record.tls)) throw new Error('Для режиму network обов’язково задайте TLS-сертифікат і приватний ключ.')
    const tlsRecord = record.tls as Record<string, unknown>
    assertOnlyKeys(tlsRecord, ['certificatePath', 'privateKeyPath', 'certificateChainPath'])
    tls = {
      certificatePath: absolutePath(tlsRecord.certificatePath, 'tls.certificatePath'),
      privateKeyPath: absolutePath(tlsRecord.privateKeyPath, 'tls.privateKeyPath'),
      ...(tlsRecord.certificateChainPath === undefined ? {} : { certificateChainPath: absolutePath(tlsRecord.certificateChainPath, 'tls.certificateChainPath') }),
    }
  }
  return {
    configVersion: record.configVersion,
    mode,
    programDirectory: absolutePath(record.programDirectory, 'programDirectory'),
    host: record.host,
    port: record.port as number,
    databasePath: absolutePath(record.databasePath, 'databasePath'),
    backupDirectory: absolutePath(record.backupDirectory, 'backupDirectory'),
    ...(tls ? { tls } : {}),
  }
}

/** Read and validate TLS material before Fastify is created. Key contents never enter logs/config output. */
export function readInstalledTlsOptions(config: InstalledServerConfig): SecureContextOptions | undefined {
  if (config.mode === 'local') return undefined
  const tls = config.tls
  if (!tls) throw new Error('Для режиму network не задано TLS-параметри.')
  const readTlsFile = (path: string, parameter: string): Buffer => {
    try {
      const stat = statSync(path)
      if (!stat.isFile()) throw new Error('not-file')
      return readFileSync(path)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') throw new Error(`TLS-файл ${parameter} не знайдено: ${path}`)
      if (code === 'EACCES' || code === 'EPERM') throw new Error(`Немає прав прочитати TLS-файл ${parameter}: ${path}`)
      throw new Error(`TLS-параметр ${parameter} має вказувати на доступний звичайний файл: ${path}`)
    }
  }
  const certificate = readTlsFile(tls.certificatePath, 'certificatePath')
  const privateKey = readTlsFile(tls.privateKeyPath, 'privateKeyPath')
  const chain = tls.certificateChainPath ? readTlsFile(tls.certificateChainPath, 'certificateChainPath') : undefined
  try {
    const leaf = new X509Certificate(certificate)
    if (Date.parse(leaf.validFrom) > Date.now() || Date.parse(leaf.validTo) <= Date.now()) throw new Error('certificate-time')
    leaf.checkPrivateKey(createPrivateKey(privateKey))
    const cert = chain ? Buffer.concat([certificate, Buffer.from('\n'), chain]) : certificate
    createSecureContext({ cert, key: privateKey })
    return { cert, key: privateKey, minVersion: 'TLSv1.2' }
  } catch {
    throw new Error('TLS-сертифікат або приватний ключ некоректний, не відповідає парі чи сертифікат прострочений/ще не чинний.')
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
