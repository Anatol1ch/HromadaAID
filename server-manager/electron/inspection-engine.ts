import { win32 } from 'node:path'
import { isIP } from 'node:net'
import type { CheckStatus, InspectionCheck, InspectionSnapshot, InstallationStatus, InspectedConfiguration, ServiceStatus } from './inspection-types.js'

export const HROMADAAID_SERVICE_NAME = 'HromadaAIDApi'
export const INSPECTION_TIMEOUT_MS = 4_000
export type ServiceMetadata = { installed: boolean; state?: string; startMode?: string; startName?: string; binaryPath?: string; error?: 'access_denied' | 'query_failed' }
export type InstallationLocator =
  | { status: 'missing' | 'invalid' | 'access_denied' | 'query_failed' }
  | { status: 'available'; programDirectory: string; dataDirectory: string; backupDirectory: string; writableByUnprivileged: boolean }
export type InspectionAdapters = {
  platform: string
  programFiles: string | null
  programData: string | null
  queryService(name: string): Promise<ServiceMetadata>
  readInstallationLocator(): Promise<InstallationLocator>
  exists(path: string): Promise<boolean>
  readText(path: string): Promise<string>
  probeApi(url: string, timeoutMs: number): Promise<{ kind: 'response'; status: number; redirected: boolean; body: unknown } | { kind: 'timeout' } | { kind: 'network_error' } | { kind: 'invalid_response' }>
  now(): Date
}

type SafeConfig = { configVersion: 1 | 2; mode: 'local' | 'network'; programDirectory: string; host: string; port: number; databasePath: string; backupDirectory: string; tls?: { certificatePath: string; privateKeyPath: string; certificateChainPath?: string } }

function absoluteWindowsPath(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value) && /^[A-Za-z]:[\\/]/.test(value) && win32.isAbsolute(value)
}
function parseConfig(text: string): SafeConfig {
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new Error('config_invalid_json') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('config_invalid_shape')
  const record = value as Record<string, unknown>
  const allowed = record.configVersion === 1
    ? ['configVersion', 'programDirectory', 'host', 'port', 'databasePath', 'backupDirectory']
    : record.configVersion === 2
      ? ['configVersion', 'programDirectory', 'mode', 'host', 'port', 'databasePath', 'backupDirectory', 'tls']
      : null
  if (!allowed || Object.keys(record).some(key => !allowed.includes(key))) throw new Error('config_unsupported')
  const mode = record.configVersion === 1 ? 'local' : record.mode
  if ((mode !== 'local' && mode !== 'network') || !absoluteWindowsPath(record.programDirectory) || !absoluteWindowsPath(record.databasePath) || !absoluteWindowsPath(record.backupDirectory) || typeof record.host !== 'string' || !record.host || /[\s\u0000-\u001f]/.test(record.host) || !Number.isInteger(record.port) || (record.port as number) < 1024 || (record.port as number) > 65535) throw new Error('config_invalid_fields')
  if (record.configVersion === 2 && record.tls !== undefined && (!record.tls || typeof record.tls !== 'object' || Array.isArray(record.tls) || Object.keys(record.tls as object).some(key => !['certificatePath', 'privateKeyPath', 'certificateChainPath'].includes(key)))) throw new Error('config_unsupported')
  let tls: SafeConfig['tls']
  if (mode === 'local' && record.tls !== undefined) throw new Error('config_invalid_fields')
  if (mode === 'network') {
    if (record.configVersion !== 2 || !record.tls || typeof record.tls !== 'object' || Array.isArray(record.tls)) throw new Error('config_invalid_tls')
    const tlsRecord = record.tls as Record<string, unknown>
    if (!absoluteWindowsPath(tlsRecord.certificatePath) || !absoluteWindowsPath(tlsRecord.privateKeyPath) || (tlsRecord.certificateChainPath !== undefined && !absoluteWindowsPath(tlsRecord.certificateChainPath))) throw new Error('config_invalid_tls')
    tls = { certificatePath: tlsRecord.certificatePath, privateKeyPath: tlsRecord.privateKeyPath, ...(typeof tlsRecord.certificateChainPath === 'string' ? { certificateChainPath: tlsRecord.certificateChainPath } : {}) }
  }
  return { configVersion: record.configVersion as 1 | 2, mode, programDirectory: record.programDirectory, host: record.host, port: record.port as number, databasePath: record.databasePath, backupDirectory: record.backupDirectory, ...(tls ? { tls } : {}) }
}
function decodeXml(value: string): string { return value.replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&').trim() }
function xmlValue(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i').exec(xml)
  return match ? decodeXml(match[1]) : null
}
function extractConfigPath(xml: string): string | null {
  const args = xmlValue(xml, 'arguments')
  if (!args) return null
  const match = /(?:^|\s)--config\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i.exec(args)
  const path = match?.[1] ?? match?.[2] ?? match?.[3]
  return absoluteWindowsPath(path) ? path : null
}
function extractWrapperPath(command: string | undefined): string | null {
  if (!command) return null
  const match = /^\s*(?:"([^"]+\.exe)"|(.+?\.exe))(?:\s|$)/i.exec(command)
  const path = match?.[1] ?? match?.[2]
  return absoluteWindowsPath(path) && win32.basename(path).toLowerCase() === 'hromadaaidservice.exe' ? path : null
}
function normalize(value: string): string { return win32.resolve(value).replace(/[\\/]+$/, '').toLocaleLowerCase('en-US') }
function pathsOverlap(left: string, right: string): boolean {
  const a = normalize(left), b = normalize(right)
  return a === b || a.startsWith(`${b}\\`) || b.startsWith(`${a}\\`)
}
function isLoopback(host: string): boolean {
  const value = host.toLowerCase()
  return value === '::1' || value === '::ffff:127.0.0.1' || (isIP(value) === 4 && value.startsWith('127.'))
}
function isNetworkIp(host: string): boolean {
  return isIP(host) !== 0
}
function validApiHost(config: SafeConfig): boolean {
  if (config.mode === 'local') return isLoopback(config.host)
  return !isLoopback(config.host) && !config.host.toLowerCase().startsWith('::ffff:') && config.host !== '0.0.0.0' && config.host !== '::' && isNetworkIp(config.host)
}
function healthUrl(config: SafeConfig): string {
  const host = config.host.includes(':') && !config.host.startsWith('[') ? `[${config.host}]` : config.host
  return `${config.mode === 'network' ? 'https' : 'http'}://${host}:${config.port}/health`
}
function componentError(error: unknown): 'missing' | 'access' | 'invalid' | 'unknown' {
  const code = (error as NodeJS.ErrnoException)?.code
  if (code === 'ENOENT' || code === 'ENOTDIR') return 'missing'
  if (code === 'EACCES' || code === 'EPERM') return 'access'
  if (error instanceof SyntaxError || (error instanceof Error && error.message.startsWith('config_'))) return 'invalid'
  return 'unknown'
}
function check(id: InspectionCheck['id'], title: string, status: CheckStatus, time: string, message: string, details?: string): InspectionCheck {
  return { id, title, status, checkedAt: time, message, ...(details ? { details } : {}) }
}

/** Read-only inspection. All operating-system and file access is supplied by narrow adapters. */
export async function inspectEnvironment(adapters: InspectionAdapters): Promise<InspectionSnapshot> {
  const time = adapters.now().toISOString()
  const configuration: InspectedConfiguration = { programDirectory: null, dataDirectory: null, backupDirectory: null, databasePath: null, apiAddress: null, host: null, port: null, transport: null, serverVersion: null, serviceName: HROMADAAID_SERVICE_NAME, serviceAccount: null, startMode: null, logDirectory: null }
  const checks: InspectionCheck[] = []
  let service: ServiceMetadata
  try { service = await adapters.queryService(HROMADAAID_SERVICE_NAME) }
  catch { service = { installed: false, error: 'query_failed' } }

  let serviceStatus: ServiceStatus = 'unknown'
  let serviceMessage = 'Не вдалося перевірити Windows Service.'
  let installationStatus: InstallationStatus = 'unknown'
  let installationMessage = 'Не вдалося встановити стан серверної інсталяції.'
  let configPath: string | null = null
  let packageRoot: string | null = null
  let config: SafeConfig | null = null
  let configState: 'ok' | 'missing' | 'access' | 'invalid' | 'unknown' = 'missing'
  let packageState: 'ok' | 'missing' | 'access' | 'invalid' | 'unknown' = 'missing'
  let defaultDiscoveryFailed = false
  let defaultEvidence = false
  let locatorStatus: InstallationLocator['status'] = 'missing'
  let locatorEvidence = false
  let locatorStale = false
  let locatorUntrusted = false
  let locatorError = false
  let discovery: InspectionSnapshot['discovery'] = { source: 'unknown', confidence: 'unavailable', message: 'Джерело інсталяції ще не визначено.' }

  if (service.error) {
    const message = service.error === 'access_denied' ? 'Немає прав прочитати стан диспетчера служб.' : 'Не вдалося опитати диспетчер служб Windows.'
    checks.push(check('service', 'Windows Service', 'unknown', time, message, service.error))
    serviceMessage = message
  } else if (!service.installed) {
    serviceStatus = 'missing'
    serviceMessage = 'Службу HromadaAIDApi не зареєстровано.'
    checks.push(check('service', 'Windows Service', 'warning', time, serviceMessage, 'service_not_found'))
  } else {
    discovery = { source: 'windows_service', confidence: 'corroborated', message: 'Шлях отримано з конфігурації Windows Service.' }
    serviceStatus = service.state?.toLowerCase() === 'running' ? 'running' : service.state?.toLowerCase() === 'stopped' ? 'stopped' : 'other'
    serviceMessage = serviceStatus === 'running' ? 'Служба працює.' : serviceStatus === 'stopped' ? 'Службу зупинено.' : `Проміжний стан служби: ${service.state ?? 'невідомий'}.`
    configuration.serviceAccount = service.startName ?? null
    configuration.startMode = service.startMode ?? null
    checks.push(check('service', 'Windows Service', serviceStatus === 'running' ? 'passed' : 'warning', time, serviceMessage, `name=${HROMADAAID_SERVICE_NAME}; state=${service.state ?? 'unknown'}`))
    const wrapper = extractWrapperPath(service.binaryPath)
    if (wrapper) {
      const serviceDirectory = win32.dirname(wrapper)
      packageRoot = win32.dirname(serviceDirectory)
      configuration.programDirectory = win32.dirname(packageRoot)
      try {
        const xml = await adapters.readText(win32.join(serviceDirectory, 'HromadaAIDService.xml'))
        if (xmlValue(xml, 'id') !== HROMADAAID_SERVICE_NAME) throw new Error('config_service_xml_mismatch')
        const executable = xmlValue(xml, 'executable')
        const workingDirectory = xmlValue(xml, 'workingdirectory')
        const argumentsValue = xmlValue(xml, 'arguments') ?? ''
        const entryMatch = /"([^"]*installed\.js)"|'([^']*installed\.js)'|(\S*installed\.js)/i.exec(argumentsValue)
        const entryPath = entryMatch?.[1] ?? entryMatch?.[2] ?? entryMatch?.[3]
        if (!executable || normalize(executable) !== normalize(win32.join(packageRoot, 'runtime', 'node.exe')) || !workingDirectory || normalize(workingDirectory) !== normalize(win32.join(packageRoot, 'app')) || !entryPath || normalize(entryPath) !== normalize(win32.join(packageRoot, 'app', 'dist', 'server', 'src', 'installed.js'))) throw new Error('config_service_xml_mismatch')
        configPath = extractConfigPath(xml)
        const logPath = xmlValue(xml, 'logpath')
        if (logPath && absoluteWindowsPath(logPath)) configuration.logDirectory = logPath
        if (!configPath) throw new Error('config_argument_missing')
      } catch (error) { configState = componentError(error) }
    } else configState = 'invalid'
  }

  // NSIS already writes non-secret install paths to HKLM. Treat them as a
  // locator, never as proof: validate the shape, assess key write ACLs, then
  // corroborate paths with expected package/config files.
  if (!service.error && !service.installed) {
    let locator: InstallationLocator
    try { locator = await adapters.readInstallationLocator() }
    catch { locator = { status: 'query_failed' } }
    locatorStatus = locator.status
    if (locator.status === 'available') {
      const fields = [locator.programDirectory, locator.dataDirectory, locator.backupDirectory]
      const validPaths = fields.every(absoluteWindowsPath) &&
        !fields.some(path => path.startsWith('\\\\')) &&
        !pathsOverlap(locator.programDirectory, locator.dataDirectory) &&
        !pathsOverlap(locator.programDirectory, locator.backupDirectory) &&
        !pathsOverlap(locator.dataDirectory, locator.backupDirectory)
      if (!validPaths) {
        locatorStatus = 'invalid'
        discovery = { source: 'installer_registry', confidence: 'untrusted', message: 'Реєстрові метадані інсталятора містять некоректні або вкладені шляхи.' }
      }
      else if (locator.writableByUnprivileged) {
        locatorUntrusted = true
        discovery = { source: 'installer_registry', confidence: 'untrusted', message: 'Реєстрові метадані інсталятора доступні для зміни непривілейованим користувачам; шляхи не використовувалися.' }
      } else {
        const candidateRoot = win32.join(locator.programDirectory, 'Server')
        const candidateConfig = win32.join(locator.dataDirectory, 'server.json')
        const packageMarkers = [
          win32.join(candidateRoot, 'runtime', 'node.exe'),
          win32.join(candidateRoot, 'service', 'HromadaAIDService.exe'),
          win32.join(candidateRoot, 'app', 'dist', 'server', 'src', 'installed.js'),
        ]
        try {
          const [packagePresent, configPresent] = await Promise.all([
            Promise.all(packageMarkers.map(path => adapters.exists(path))),
            adapters.exists(candidateConfig),
          ])
          locatorEvidence = packagePresent.some(Boolean) || configPresent
          if (locatorEvidence) {
            packageRoot = candidateRoot
            configuration.programDirectory = locator.programDirectory
            configPath = configPresent ? candidateConfig : null
            if (!configPresent) configState = 'missing'
            serviceStatus = 'missing'
            serviceMessage = 'Метадані інсталятора вказують на серверні компоненти, але службу не зареєстровано.'
            discovery = { source: 'installer_registry', confidence: 'corroborated', message: 'Шляхи з HKLM підтверджено файлами серверного пакета або конфігурацією.' }
          } else {
            locatorStale = true
            discovery = { source: 'installer_registry', confidence: 'stale', message: 'Реєстрові шляхи знайдено, але очікувані компоненти за ними відсутні.' }
          }
        } catch (error) {
          locatorError = true
          const kind = componentError(error)
          discovery = { source: 'installer_registry', confidence: 'unavailable', message: kind === 'access' ? 'Немає прав перевірити шляхи з реєстрових метаданих.' : 'Не вдалося перевірити шляхи з реєстрових метаданих.' }
        }
      }
    } else if (locator.status === 'invalid') {
      discovery = { source: 'installer_registry', confidence: 'untrusted', message: 'Реєстрові метадані інсталятора пошкоджені або містять некоректні шляхи.' }
    } else if (locator.status === 'access_denied' || locator.status === 'query_failed') {
      locatorError = true
      discovery = { source: 'unknown', confidence: 'unavailable', message: locator.status === 'access_denied' ? 'Немає прав прочитати метадані інсталятора.' : 'Не вдалося прочитати метадані інсталятора.' }
    }
  }

  // Older installs without the existing HKLM locator can only be discovered
  // in these documented default locations; no drive scan is performed.
  if (!service.error && !service.installed && adapters.programFiles && adapters.programData) {
    const defaultProgram = win32.join(adapters.programFiles, 'HromadaAID')
    const defaultServer = win32.join(defaultProgram, 'Server')
    const defaultData = win32.join(adapters.programData, 'HromadaAID', 'Data')
    const markers = [
      win32.join(defaultServer, 'app', 'dist', 'server', 'src', 'installed.js'),
      win32.join(defaultServer, 'runtime', 'node.exe'),
      win32.join(defaultServer, 'service', 'HromadaAIDService.exe'),
      win32.join(defaultProgram, 'Server.next', 'app', 'dist', 'server', 'src', 'installed.js'),
      win32.join(defaultData, 'server.json'),
    ]
    let present: boolean[]
    try { present = await Promise.all(markers.map(path => adapters.exists(path))) }
    catch { present = markers.map(() => false); defaultDiscoveryFailed = true }
    if (present.some(Boolean) && !locatorEvidence && !locatorUntrusted) {
      defaultEvidence = true
      packageRoot = present.slice(0, 3).some(Boolean) ? defaultServer : null
      configPath = present[4] ? win32.join(defaultData, 'server.json') : null
      configuration.programDirectory = present.slice(0, 4).some(Boolean) ? defaultProgram : null
      configState = configPath ? 'ok' : 'missing'
      serviceStatus = 'missing'
      serviceMessage = 'Компоненти сервера виявлено, але Windows Service не зареєстровано.'
      discovery = { source: 'standard_locations', confidence: 'corroborated', message: 'Компоненти знайдено у стандартних каталогах Windows.' }
    }
  }

  if (service.error) discovery = { source: 'unknown', confidence: 'unavailable', message: 'Installation Discovery обмежено помилкою опитування диспетчера служб.' }
  else if (service.installed && packageRoot) discovery = { source: 'windows_service', confidence: configPath && configState === 'ok' ? 'confirmed' : 'corroborated', message: configPath && configState === 'ok' ? 'Шляхи підтверджено SCM, WinSW XML і server.json.' : 'Шлях отримано з SCM; частину компонентів ще не підтверджено.' }
  else if (service.installed && discovery.source !== 'windows_service') discovery = { source: 'windows_service', confidence: 'corroborated', message: 'Windows SCM підтверджує зареєстровану службу.' }

  if (configPath) {
    try {
      const candidate = parseConfig(await adapters.readText(configPath))
      configState = 'ok'
      configuration.dataDirectory = win32.dirname(configPath)
      configuration.backupDirectory = candidate.backupDirectory
      configuration.databasePath = candidate.databasePath
      configuration.host = candidate.host
      configuration.port = candidate.port
      configuration.transport = candidate.mode === 'network' ? 'HTTPS' : 'HTTP'
      if (configuration.programDirectory && normalize(candidate.programDirectory) !== normalize(configuration.programDirectory)) throw new Error('config_program_path_mismatch')
      const hostOkay = validApiHost(candidate)
      if (!hostOkay) throw new Error('config_invalid_network_host')
      if (candidate.tls) {
        const tlsFiles = [candidate.tls.certificatePath, candidate.tls.privateKeyPath, ...(candidate.tls.certificateChainPath ? [candidate.tls.certificateChainPath] : [])]
        const tlsPresent = await Promise.all(tlsFiles.map(path => adapters.exists(path)))
        if (tlsPresent.some(present => !present)) throw new Error('config_tls_file_missing')
      }
      configuration.programDirectory ??= candidate.programDirectory
      configuration.apiAddress = healthUrl(candidate).replace(/\/health$/, '')
      config = candidate
    } catch (error) { configState = componentError(error) }
  }

  if (packageRoot) {
    try {
      const required = [
        win32.join(packageRoot, 'runtime', 'node.exe'),
        win32.join(packageRoot, 'service', 'HromadaAIDService.exe'),
        win32.join(packageRoot, 'app', 'dist', 'server', 'src', 'installed.js'),
        win32.join(packageRoot, 'app', 'node_modules', 'fastify', 'package.json'),
        win32.join(packageRoot, 'app', 'node_modules', 'argon2', 'package.json'),
        win32.join(packageRoot, 'app', 'node_modules', '@phc', 'format', 'package.json'),
      ]
      const present = await Promise.all(required.map(path => adapters.exists(path)))
      if (present.every(Boolean)) {
        const packageJson = JSON.parse(await adapters.readText(win32.join(packageRoot, 'app', 'package.json'))) as { version?: unknown }
        if (typeof packageJson.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(packageJson.version)) throw new Error('package_version_invalid')
        configuration.serverVersion = packageJson.version
        packageState = 'ok'
      } else packageState = 'missing'
    } catch (error) { packageState = componentError(error) }
  }

  const configured = configState === 'ok' && !!config
  const packagePresent = packageState === 'ok'
  if (service.error) {
    installationStatus = 'unknown'
    installationMessage = 'Стан інсталяції невідомий через помилку опитування Windows Service.'
  } else if (!service.installed && !packageRoot && !configPath && (defaultDiscoveryFailed || locatorError)) {
    installationStatus = 'unknown'
    installationMessage = 'Не вдалося перевірити стандартні каталоги інсталяції через обмеження доступу.'
  } else if (!service.installed && !packageRoot && !configPath && (!adapters.programFiles || !adapters.programData)) {
    installationStatus = 'unknown'
    installationMessage = 'Не вдалося визначити стандартні каталоги Windows для перевірки інсталяції.'
  } else if (!service.installed && !packageRoot && !configPath && (defaultEvidence || locatorEvidence)) {
    installationStatus = 'partial_installation'
    installationMessage = 'Залишилися компоненти сервера без повної інсталяції або зареєстрованої служби.'
  } else if (!service.installed && !packageRoot && !configPath) {
    if (locatorUntrusted || locatorStatus === 'invalid') {
      installationStatus = 'unknown'
      installationMessage = 'Не вдалося безпечно підтвердити реєстрові метадані серверної інсталяції.'
    } else {
      installationStatus = 'not_installed'
      installationMessage = locatorStale ? 'Застарілі метадані інсталятора знайдено, але активних компонентів сервера немає.' : 'Ознак серверної інсталяції у перевірених каталогах не виявлено.'
      if (discovery.source === 'unknown') discovery = { source: 'none', confidence: 'corroborated', message: locatorStale ? 'Реєстровий locator застарілий; активні компоненти не знайдено.' : 'Перевірено відомі стандартні каталоги; повного сканування дисків не виконувалося.' }
    }
  } else if (service.installed && configured && packagePresent) {
    installationStatus = 'installed'
    installationMessage = 'Службу, конфігурацію та серверний пакет узгоджено.'
  } else {
    installationStatus = 'partial_installation'
    installationMessage = 'Виявлено неповний або неузгоджений комплект серверних компонентів.'
  }

  if (service.installed) {
    const confirmed = installationStatus === 'installed'
    discovery = {
      source: 'windows_service',
      confidence: confirmed ? 'confirmed' : 'corroborated',
      message: confirmed ? 'Шляхи підтверджено SCM, WinSW XML, server.json і файлами пакета.' : 'Шлях служби отримано з SCM; виявлені компоненти перевіряються окремо.',
    }
  }

  const configurationStatus: CheckStatus = configured ? 'passed' : configState === 'missing' ? 'warning' : 'failed'
  const configurationMessage = configured ? 'Дозволені параметри server.json прочитано.' : configState === 'missing' ? 'Конфігурацію server.json не знайдено.' : configState === 'access' ? 'Немає прав прочитати server.json.' : configState === 'invalid' ? 'Конфігурація server.json некоректна або несумісна.' : 'Не вдалося перевірити конфігурацію.'
  checks.push(check('configuration', 'Конфігурація', configurationStatus, time, configurationMessage, configState === 'ok' ? `configVersion=${config?.configVersion}` : `config_${configState}`))
  const packageStatus: CheckStatus = packagePresent ? 'passed' : packageState === 'missing' ? 'warning' : 'failed'
  const packageMessage = packagePresent ? 'Основні файли серверного пакета наявні.' : packageState === 'missing' ? 'Серверний пакет відсутній або неповний.' : packageState === 'access' ? 'Немає прав перевірити файли серверного пакета.' : 'Не вдалося перевірити серверний пакет.'
  checks.push(check('package', 'Серверний пакет', packageStatus, time, packageMessage, packagePresent ? `version=${configuration.serverVersion}` : `package_${packageState}`))
  checks.push(check('installation', 'Інсталяція', installationStatus === 'installed' ? 'passed' : installationStatus === 'not_installed' ? 'warning' : installationStatus === 'unknown' ? 'unknown' : 'failed', time, installationMessage))

  let api: InspectionSnapshot['api'] = { status: 'not_configured', message: 'API не перевірено: сумісну конфігурацію не визначено.', contractVersion: null }
  // Only probe the configured API when SCM confirms the service installation.
  // A registry locator is advisory and may point at a user-controlled config.
  if (config && service.installed) {
    try {
      const response = await adapters.probeApi(healthUrl(config), INSPECTION_TIMEOUT_MS)
      if (response.kind === 'timeout') api = { status: 'unavailable', message: 'API не відповів у межах тайм-ауту.', contractVersion: null }
      else if (response.kind === 'network_error') api = { status: 'unavailable', message: 'Не вдалося встановити з’єднання з налаштованим API.', contractVersion: null }
      else if (response.kind === 'invalid_response' || response.redirected) api = { status: 'invalid_response', message: 'API повернув перенаправлення або некоректну відповідь health endpoint.', contractVersion: null }
      else {
        const body = response.body as Record<string, unknown> | null
        const valid = response.status === 200 && !!body && typeof body === 'object' && body.status === 'ok' && body.service === 'hromada-aid-api' && body.apiContractVersion === 1
        api = valid
          ? { status: 'available', message: 'Health endpoint HromadaAID відповів коректно.', contractVersion: 1 }
          : { status: 'invalid_response', message: 'Відповідь не відповідає контракту health endpoint HromadaAID.', contractVersion: typeof body?.apiContractVersion === 'number' ? body.apiContractVersion : null }
      }
    } catch { api = { status: 'unavailable', message: 'Перевірка API завершилася технічною помилкою.', contractVersion: null } }
  }
  checks.push(check('api', 'Health endpoint API', api.status === 'available' ? 'passed' : api.status === 'not_configured' ? 'not_checked' : api.status === 'unavailable' ? 'warning' : 'failed', time, api.message, api.contractVersion === null ? undefined : `apiContractVersion=${api.contractVersion}`))
  return { checkedAt: time, installation: { status: installationStatus, message: installationMessage }, service: { status: serviceStatus, message: serviceMessage }, api, configuration, discovery, checks }
}
