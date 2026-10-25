import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { relative, resolve, sep, join } from 'node:path'
import type { ServerUpdatePreview, ServerUpdateStage, ServerUpdateProgress, ServerUpdateResult } from './server-update-contract.js'

export type { ServerUpdatePreview, ServerUpdateStage, ServerUpdateProgress, ServerUpdateResult } from './server-update-contract.js'
export type ServerUpdateEnvironment = {
  programDirectory: string; dataDirectory: string; backupDirectory: string; databasePath: string
  serverVersion: string; apiContractVersion: number; serviceStatus: 'running' | 'stopped'
}
export type ServerUpdateAdapters = {
  inspect(): Promise<{ installation: { status: string }; service: { status: string }; api: { status: string; contractVersion: number | null }; configuration: { programDirectory: string | null; dataDirectory: string | null; backupDirectory: string | null; databasePath: string | null; serverVersion: string | null }; discovery: { confidence: string } }>
  extract(zipPath: string, destination: string): Promise<void>
  readCurrentSchema(environment: ServerUpdateEnvironment): Promise<number>
  readInstalledApiContract(programDirectory: string): Promise<number>
  readActivePackageIdentity(environment: ServerUpdateEnvironment): Promise<string>
  prepare(environment: ServerUpdateEnvironment, extractedPackage: string): Promise<void>
  runInstaller(environment: ServerUpdateEnvironment, report: (stage: ServerUpdateStage, message: string) => void): Promise<void>
  cleanup(path: string): Promise<void>
  pathExists(path: string): Promise<boolean>
  nowId(): string
}

const forbiddenStagingNames = ['Server.next', 'Server.previous', 'Server.failed'] as const
const updateJournalName = '.hromadaaid-update-state.json'
const expectedFiles = [
  'runtime/node.exe', 'service/HromadaAIDService.exe', 'service/HromadaAIDService.xml.template',
  'app/package.json', 'app/dist/server/src/create-admin.js', 'app/dist/electron/database.js', 'app/dist/shared/api-compatibility.js',
  'installer/verify-server-package.mjs', 'installer/server-runtime-check.mjs', 'installer/server-package-transaction.mjs',
  'installer/prepare-server-install.mjs', 'installer/windows-installer-config.mjs', 'installer/install-server-service.ps1', 'installer/write-installation-locator.ps1',
]

function fail(code: string, message: string): Error { return Object.assign(new Error(message), { code }) }
function safeRelativePath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.startsWith('/') || value.includes('\0')) throw fail('PACKAGE_PATH_INVALID', 'Архів містить некоректний шлях.')
  const parts = value.split('/')
  if (parts.some(part => !part || part === '.' || part === '..' || part.includes(':') || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw fail('PACKAGE_PATH_INVALID', 'Архів містить небезпечний або несумісний шлях.')
  return parts.join('/')
}

async function listFiles(root: string): Promise<Array<{ path: string; sizeBytes: number; sha256: string }>> {
  const result: Array<{ path: string; sizeBytes: number; sha256: string }> = []
  async function visit(directory: string) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, item.name)
      const info = await lstat(absolute)
      if (info.isSymbolicLink()) throw fail('PACKAGE_LINK_REJECTED', 'Пакет містить символічне посилання.')
      if (info.isDirectory()) { await visit(absolute); continue }
      if (!info.isFile()) throw fail('PACKAGE_ENTRY_REJECTED', 'Пакет містить непідтримуваний файловий об’єкт.')
      const path = relative(root, absolute).split(sep).join('/')
      const bytes = await readFile(absolute)
      result.push({ path, sizeBytes: info.size, sha256: createHash('sha256').update(bytes).digest('hex') })
    }
  }
  await visit(root)
  return result.sort((a, b) => a.path.localeCompare(b.path, 'en'))
}

/** Verifies both current server integrity manifest and Deployment 2.0 component manifest without executing package code. */
export async function verifyUpdatePackage(rootInput: string, prepared?: { serviceXmlSha256: string }): Promise<{ version: string; apiContract: number; schema: { minimum: number; maximum: number }; authenticity: 'unsigned' }> {
  const root = await realpath(resolve(rootInput))
  const files = await listFiles(root)
  const actual = new Map(files.map(file => [file.path, file]))
  let manifest: any, integrity: any
  try {
    manifest = JSON.parse(await readFile(join(root, 'package-manifest.json'), 'utf8'))
    integrity = JSON.parse(await readFile(join(root, 'package-integrity.json'), 'utf8'))
  } catch { throw fail('PACKAGE_MANIFEST_MISSING', 'ZIP не містить коректних маніфестів серверного пакета.') }
  const api = manifest?.compatibility?.serverApi
  const schema = manifest?.compatibility?.sqliteSchema
  if (manifest.formatVersion !== 1 || manifest.packageSchemaVersion !== 1 || manifest.component !== 'server' || manifest.platform !== 'win32' || manifest.architecture !== 'x64' || typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(manifest.version) || api?.contract !== 'hromadaaid-rest' || !Number.isInteger(api.version) || api.version < 1 || !Number.isInteger(schema?.minimum) || !Number.isInteger(schema?.maximum) || schema.minimum < 1 || schema.minimum > schema.maximum || manifest.authenticity?.method !== 'sha256-manifest' || manifest.authenticity.detachedSignature !== null) {
    throw fail('PACKAGE_MANIFEST_INVALID', 'Маніфест сервера має несумісний формат або некоректні метадані.')
  }
  if (integrity.formatVersion !== 1 || !Array.isArray(integrity.files) || !Array.isArray(manifest.files)) throw fail('PACKAGE_MANIFEST_INVALID', 'Маніфест цілісності пакета некоректний.')
  const generatedXml = 'service/HromadaAIDService.xml'
  if (prepared) {
    const xml = actual.get(generatedXml)
    if (!/^[a-f0-9]{64}$/.test(prepared.serviceXmlSha256) || !xml || xml.sizeBytes > 65536 || xml.sha256 !== prepared.serviceXmlSha256 || [...manifest.files, ...integrity.files].some(entry => entry?.path === generatedXml)) {
      throw fail('PREPARED_SERVICE_CONFIG_INVALID', 'Згенерована конфігурація WinSW не відповідає перевіреному шаблону та каталогам інсталяції.')
    }
  }
  const validateEntries = (entries: any[], excluded: Set<string>) => {
    const expected = new Map<string, any>()
    for (const entry of entries) {
      const path = safeRelativePath(entry?.path)
      if (expected.has(path) || !Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes < 0 || !/^[a-f0-9]{64}$/i.test(entry.sha256)) throw fail('PACKAGE_MANIFEST_INVALID', 'Маніфест містить повторні або некоректні записи.')
      expected.set(path, entry)
    }
    const found = [...actual.keys()].filter(path => !excluded.has(path) && !(prepared && path === generatedXml))
    if (found.length !== expected.size) throw fail('PACKAGE_CONTENT_MISMATCH', 'Фактичний склад ZIP не відповідає маніфесту.')
    for (const path of found) {
      const file = actual.get(path)!, entry = expected.get(path)
      if (!entry || entry.sizeBytes !== file.sizeBytes || entry.sha256 !== file.sha256) throw fail('PACKAGE_HASH_MISMATCH', `Перевірка цілісності не пройшла для ${path}.`)
    }
    return expected
  }
  const deploymentEntries = validateEntries(manifest.files, new Set(['package-manifest.json']))
  const integrityEntries = validateEntries(integrity.files, new Set(['package-manifest.json', 'package-integrity.json']))
  if (!deploymentEntries.has('package-integrity.json')) throw fail('PACKAGE_MANIFEST_INVALID', 'Deployment manifest не захищає маніфест цілісності.')
  for (const path of expectedFiles) if (!deploymentEntries.has(path)) throw fail('PACKAGE_REQUIRED_FILE_MISSING', `У серверному пакеті відсутній обов’язковий файл: ${path}.`)
  for (const path of integrityEntries.keys()) if (!deploymentEntries.has(path)) throw fail('PACKAGE_MANIFEST_INVALID', 'Маніфести пакета описують різний склад файлів.')
  const appManifest = JSON.parse(await readFile(join(root, 'app/package.json'), 'utf8'))
  if (appManifest.version !== manifest.version) throw fail('PACKAGE_VERSION_MISMATCH', 'Версія пакета не збігається з версією серверного застосунку.')
  const apiSource = await readFile(join(root, 'app/dist/shared/api-compatibility.js'), 'utf8')
  const apiSourceVersion = /HROMADAAID_API_CONTRACT_VERSION\s*=\s*(\d+)/.exec(apiSource)?.[1]
  if (!apiSourceVersion || Number(apiSourceVersion) !== api.version) throw fail('API_CONTRACT_MANIFEST_MISMATCH', 'Версія API-контракту в пакеті не збігається з маніфестом.')
  const databaseSource = await readFile(join(root, 'app/dist/electron/database.js'), 'utf8')
  const schemaVersions = [...databaseSource.matchAll(/version\s*:\s*(\d+)/g)].map(match => Number(match[1]))
  if (!schemaVersions.length || Math.max(...schemaVersions) !== schema.maximum) throw fail('SQLITE_MANIFEST_MISMATCH', 'Діапазон підтримуваної SQLite-схеми не збігається з реалізацією пакета.')
  return { version: manifest.version, apiContract: api.version, schema: { minimum: schema.minimum, maximum: schema.maximum }, authenticity: 'unsigned' }
}

async function environmentFrom(snapshot: Awaited<ReturnType<ServerUpdateAdapters['inspect']>>, adapters: ServerUpdateAdapters): Promise<ServerUpdateEnvironment> {
  const c = snapshot.configuration
  if (snapshot.installation.status !== 'installed' || !['running', 'stopped'].includes(snapshot.service.status) || !['confirmed', 'corroborated'].includes(snapshot.discovery.confidence) || !c.programDirectory || !c.dataDirectory || !c.backupDirectory || !c.databasePath || !c.serverVersion) {
    throw fail('INSTALLATION_NOT_CONFIRMED', 'Не вдалося достовірно визначити повну інсталяцію сервера. Оновлення не розпочато.')
  }
  const apiContractVersion = snapshot.api.contractVersion ?? await adapters.readInstalledApiContract(c.programDirectory)
  if (!Number.isInteger(apiContractVersion) || apiContractVersion < 1) throw fail('API_CONTRACT_UNKNOWN', 'Не вдалося визначити версію API-контракту встановленого сервера.')
  return { programDirectory: c.programDirectory, dataDirectory: c.dataDirectory, backupDirectory: c.backupDirectory, databasePath: c.databasePath, serverVersion: c.serverVersion, apiContractVersion, serviceStatus: snapshot.service.status as 'running' | 'stopped' }
}

export async function readPackageManifestIdentity(root: string): Promise<string> {
  const hash = createHash('sha256')
  for (const name of ['package-integrity.json', 'package-manifest.json']) { hash.update(await readFile(join(root, name))); hash.update('\0') }
  return hash.digest('hex')
}

export type PreparedServerUpdate = { preview: ServerUpdatePreview; extractedRoot: string; cleanupRoot: string; environment: ServerUpdateEnvironment; activePackageIdentity: string; candidatePackageIdentity: string }

export async function prepareServerUpdate(zipPath: string, adapters: ServerUpdateAdapters): Promise<PreparedServerUpdate> {
  if (!zipPath || !zipPath.toLocaleLowerCase('en-US').endsWith('.zip')) throw fail('UPDATE_ARCHIVE_INVALID', 'Виберіть ZIP-файл серверного пакета.')
  const environment = await environmentFrom(await adapters.inspect(), adapters)
  const program = resolve(environment.programDirectory), data = resolve(environment.dataDirectory)
  const conflicts = [...forbiddenStagingNames.map(name => join(program, name)), join(data, updateJournalName)]
  for (const path of conflicts) if (await adapters.pathExists(path)) throw fail('UPDATE_RECOVERY_REQUIRED', 'Виявлено залишки попереднього оновлення. Спершу перевірте стан сервера у розділі «Діагностика».')
  const cleanupRoot = resolve(join(process.env.TEMP || process.env.TMP || '.', `HromadaAID-Update-${adapters.nowId()}`))
  const extractedRoot = join(cleanupRoot, 'package')
  try {
    await adapters.extract(zipPath, extractedRoot)
    const metadata = await verifyUpdatePackage(extractedRoot)
    if (metadata.apiContract !== environment.apiContractVersion) throw fail('API_CONTRACT_INCOMPATIBLE', 'Пакет використовує несумісний API contract.')
    const currentSchema = await adapters.readCurrentSchema(environment)
    const activePackageIdentity = await adapters.readActivePackageIdentity(environment)
    const candidatePackageIdentity = await readPackageManifestIdentity(extractedRoot)
    if (currentSchema < metadata.schema.minimum || currentSchema > metadata.schema.maximum) throw fail('SQLITE_SCHEMA_INCOMPATIBLE', 'Поточна схема SQLite не підтримується вибраним серверним пакетом.')
    return { cleanupRoot, extractedRoot, environment, activePackageIdentity, candidatePackageIdentity, preview: { id: adapters.nowId(), sourceName: zipPath.split(/[\\/]/).pop() || 'server.zip', currentVersion: environment.serverVersion, newVersion: metadata.version, apiContract: `hromadaaid-rest v${metadata.apiContract}`, sqliteRange: metadata.schema, currentSchema, sameVersion: metadata.version === environment.serverVersion, authenticity: metadata.authenticity } }
  } catch (error) { await adapters.cleanup(cleanupRoot).catch(() => undefined); throw error }
}

export async function applyServerUpdate(prepared: PreparedServerUpdate, adapters: ServerUpdateAdapters, operationId: string, emit: (event: ServerUpdateProgress) => void): Promise<ServerUpdateResult> {
  const report = (stage: ServerUpdateStage, message: string) => emit({ operationId, stage, message })
  let installerInvoked = false
  try {
    report('compatibility', 'Повторно перевіряємо інсталяцію та стан транзакції.')
    const current = await environmentFrom(await adapters.inspect(), adapters)
    if (await adapters.readActivePackageIdentity(current) !== prepared.activePackageIdentity) throw fail('INSTALLATION_CHANGED', 'Вміст установленого пакета змінився після перевірки ZIP. Виберіть пакет повторно.')
    if (current.programDirectory !== prepared.environment.programDirectory || current.dataDirectory !== prepared.environment.dataDirectory || current.databasePath !== prepared.environment.databasePath || current.serverVersion !== prepared.environment.serverVersion) throw fail('INSTALLATION_CHANGED', 'Стан інсталяції змінився після перевірки пакета. Перевірте середовище й виберіть пакет повторно.')
    const program = resolve(current.programDirectory), data = resolve(current.dataDirectory)
    for (const path of [...forbiddenStagingNames.map(name => join(program, name)), join(data, updateJournalName)]) if (await adapters.pathExists(path)) throw fail('UPDATE_RECOVERY_REQUIRED', 'Знайдено залишки іншої транзакції; оновлення зупинено.')
    report('prepare', 'Копіюємо перевірений пакет у Server.next та повторно звіряємо файли.')
    await adapters.prepare(current, prepared.extractedRoot)
    installerInvoked = true
    await adapters.runInstaller(current, report)
    report('health', 'Перевіряємо фактичний стан служби й API.')
    const final = await adapters.inspect()
    if (final.installation.status !== 'installed' || final.service.status !== 'running' || final.api.status !== 'available' || final.configuration.serverVersion !== prepared.preview.newVersion) throw fail('UPDATE_HEALTH_FAILED', 'Новий пакет не пройшов перевірку служби та API. Перегляньте стан відкату й діагностику.')
    if (await adapters.readActivePackageIdentity(current) !== prepared.candidatePackageIdentity) throw fail('UPDATE_PACKAGE_NOT_ACTIVE', 'Фактично встановлений пакет не відповідає підтвердженому ZIP, навіть якщо версія та API збігаються.')
    for (const path of [...forbiddenStagingNames.map(name => join(program, name)), join(data, updateJournalName)]) if (await adapters.pathExists(path)) throw fail('UPDATE_NOT_FINALIZED', 'Служба працює, але транзакція оновлення не завершена. Службові файли збережено для перевірки.')
    report('complete', 'Сервер оновлено, служба працює, API доступний.')
    return { operationId, success: true, rolledBack: false, manualRecoveryRequired: false, message: `Сервер оновлено до версії ${prepared.preview.newVersion}. Windows Service працює, API доступний.` }
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Технічні подробиці недоступні.'
    const evidence = error as { rollbackConfirmed?: boolean; preservedBeforeSwitch?: boolean }
    let criticalArtifactsRemain = false, stagedPackageRemains = false, stateReadable = true
    const program = resolve(prepared.environment.programDirectory), data = resolve(prepared.environment.dataDirectory)
    for (const path of [join(program, 'Server.previous'), join(program, 'Server.failed'), join(data, updateJournalName)]) {
      try { if (await adapters.pathExists(path)) criticalArtifactsRemain = true } catch { stateReadable = false }
    }
    try { stagedPackageRemains = await adapters.pathExists(join(program, 'Server.next')) } catch { stateReadable = false }
    let originalConfirmed = false
    try {
      const snapshot = await adapters.inspect()
      const current = await environmentFrom(snapshot, adapters)
      originalConfirmed = current.programDirectory === prepared.environment.programDirectory && current.dataDirectory === prepared.environment.dataDirectory && current.backupDirectory === prepared.environment.backupDirectory && current.databasePath === prepared.environment.databasePath && current.serverVersion === prepared.environment.serverVersion && current.serviceStatus === prepared.environment.serviceStatus && (current.serviceStatus === 'stopped' || snapshot.api.status === 'available') && await adapters.readActivePackageIdentity(current) === prepared.activePackageIdentity
    } catch { stateReadable = false }
    const preparationFailed = (!installerInvoked || evidence.preservedBeforeSwitch === true) && stateReadable && !criticalArtifactsRemain && originalConfirmed
    const rolledBack = installerInvoked && evidence.rollbackConfirmed === true && stateReadable && !criticalArtifactsRemain && !stagedPackageRemains && originalConfirmed
    const manualRecoveryRequired = !preparationFailed && !rolledBack
    const message = preparationFailed
      ? `Помилка підготовки оновлення. Перемикання пакета не виконувалось; попередній сервер ${prepared.environment.serviceStatus === 'running' ? 'працює, API доступний' : 'залишається зупиненим'}.${stagedPackageRemains ? ' Server.next збережено для перевірки перед повторною спробою.' : ''}`
      : rolledBack ? 'Оновлення не завершено. Попередній пакет і стан служби підтверджено після відкату.' : 'Оновлення не завершено. Стан потребує ручного відновлення адміністратора.'
    return { operationId, success: false, rolledBack, manualRecoveryRequired, failureKind: preparationFailed ? 'preparation' : rolledBack ? 'rolled_back' : 'recovery_required', message, details: detail.slice(0, 4_000) }
  } finally { await adapters.cleanup(prepared.cleanupRoot).catch(() => undefined) }
}
