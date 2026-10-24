import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../electron/inspection-engine.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
const { inspectEnvironment, HROMADAAID_SERVICE_NAME } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
const ipcSource = readFileSync(new URL('../electron/inspection-ipc.ts', import.meta.url), 'utf8')
const ipcJs = ts.transpileModule(ipcSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
const { createInspectionRequestHandler } = await import(`data:text/javascript;base64,${Buffer.from(ipcJs).toString('base64')}`)

const program = 'C:\\Program Files\\HromadaAID'
const server = `${program}\\Server`
const data = 'D:\\Дані HromadaAID'
const backups = 'E:\\Копії HromadaAID'
const configPath = `${data}\\server.json`
const wrapper = `${server}\\service\\HromadaAIDService.exe`
const config = { configVersion: 2, mode: 'local', programDirectory: program, host: '127.0.0.1', port: 4310, databasePath: `${data}\\Database\\hromada-aid.sqlite`, backupDirectory: backups }
const serviceXml = `<service><id>HromadaAIDApi</id><executable>${server}\\runtime\\node.exe</executable><arguments>"${server}\\app\\dist\\server\\src\\installed.js" --config "${configPath}"</arguments><workingdirectory>${server}\\app</workingdirectory><logpath>${data}\\Logs</logpath></service>`

function fixture({ service = { installed: true, state: 'Running', startMode: 'Auto', startName: 'NT AUTHORITY\\LocalService', binaryPath: `"${wrapper}"` }, locator = { status: 'missing' }, configText = JSON.stringify(config), api = { kind: 'response', status: 200, redirected: false, body: { status: 'ok', service: 'hromada-aid-api', apiContractVersion: 1 } }, files = null, now = new Date('2026-10-24T10:30:00.000Z') } = {}) {
  const trace = {}
  const knownFiles = files ?? new Set([
    `${server}\\runtime\\node.exe`, `${server}\\service\\HromadaAIDService.exe`, `${server}\\app\\dist\\server\\src\\installed.js`, `${server}\\app\\node_modules\\fastify\\package.json`, `${server}\\app\\node_modules\\argon2\\package.json`, `${server}\\app\\node_modules\\@phc\\format\\package.json`, 'C:\\TLS\\cert.pem', 'C:\\TLS\\private.pem',
  ].map(value => value.toLowerCase()))
  const textFiles = new Map([
    [`${server}\\service\\HromadaAIDService.xml`.toLowerCase(), serviceXml],
    [configPath.toLowerCase(), configText],
    [`${server}\\app\\package.json`.toLowerCase(), JSON.stringify({ version: '0.1.0' })],
  ])
  return {
    adapter: {
      platform: 'win32', programFiles: 'C:\\Program Files', programData: 'C:\\ProgramData',
      queryService: async name => { assert.equal(name, HROMADAAID_SERVICE_NAME); return service },
      readInstallationLocator: async () => locator,
      exists: async path => knownFiles.has(path.toLowerCase()),
      readText: async path => { const value = textFiles.get(path.toLowerCase()); if (value === undefined) { const error = new Error('not found'); error.code = 'ENOENT'; throw error } return value },
      probeApi: async (url, timeoutMs) => { trace.lastUrl = url; trace.timeout = timeoutMs; return api },
      now: () => now,
    },
    trace,
  }
}

test('detects a complete installed service, reads only metadata and validates actual HromadaAID health contract', async () => {
  const f = fixture()
  const result = await inspectEnvironment(f.adapter)
  assert.equal(result.installation.status, 'installed')
  assert.equal(result.service.status, 'running')
  assert.equal(result.api.status, 'available')
  assert.equal(result.configuration.programDirectory, program)
  assert.equal(result.configuration.dataDirectory, data)
  assert.equal(result.configuration.backupDirectory, backups)
  assert.equal(result.configuration.serverVersion, '0.1.0')
  assert.equal(result.configuration.serviceAccount, 'NT AUTHORITY\\LocalService')
  assert.equal(result.configuration.logDirectory, `${data}\\Logs`)
  assert.equal(result.configuration.apiAddress, 'http://127.0.0.1:4310')
  assert.equal(result.discovery.source, 'windows_service')
  assert.equal(result.discovery.confidence, 'confirmed')
  assert.equal(f.trace.lastUrl, 'http://127.0.0.1:4310/health')
  assert.equal(f.trace.timeout, 4000)
  assert.equal(result.checkedAt, '2026-10-24T10:30:00.000Z')
})

test('distinguishes a genuinely missing service from a service query failure', async () => {
  const absent = fixture({ service: { installed: false }, files: new Set() })
  const absentResult = await inspectEnvironment(absent.adapter)
  assert.equal(absentResult.service.status, 'missing')
  assert.equal(absentResult.installation.status, 'not_installed')
  assert.equal(absent.trace.lastUrl, undefined)
  const denied = fixture({ service: { installed: false, error: 'access_denied' } }).adapter
  assert.equal((await inspectEnvironment(denied)).service.status, 'unknown')
  assert.equal((await inspectEnvironment(denied)).installation.status, 'unknown')
  const failed = fixture({ service: { installed: false, error: 'query_failed' } }).adapter
  assert.equal((await inspectEnvironment(failed)).installation.status, 'unknown')
})

test('discovers non-standard program, data and backup paths from the existing protected installer locator', async () => {
  const customProgram = 'D:\\Застосунки HromadaAID'
  const customData = 'E:\\Дані HromadaAID'
  const customBackups = 'F:\\Резервні копії HromadaAID'
  const customRoot = `${customProgram}\\Server`
  const customConfig = `${customData}\\server.json`
  const customFiles = new Set([
    `${customRoot}\\runtime\\node.exe`, `${customRoot}\\service\\HromadaAIDService.exe`, `${customRoot}\\app\\dist\\server\\src\\installed.js`,
    `${customRoot}\\app\\node_modules\\fastify\\package.json`, `${customRoot}\\app\\node_modules\\argon2\\package.json`, `${customRoot}\\app\\node_modules\\@phc\\format\\package.json`, customConfig,
  ].map(value => value.toLowerCase()))
  const custom = fixture({
    service: { installed: false },
    locator: { status: 'available', programDirectory: customProgram, dataDirectory: customData, backupDirectory: customBackups, writableByUnprivileged: false },
    files: customFiles,
  })
  const readText = custom.adapter.readText
  custom.adapter.readText = async path => {
    if (path.toLowerCase() === customConfig.toLowerCase()) return JSON.stringify({ ...config, programDirectory: customProgram, databasePath: `${customData}\\Database\\hromada-aid.sqlite`, backupDirectory: customBackups })
    if (path.toLowerCase() === `${customRoot}\\app\\package.json`.toLowerCase()) return JSON.stringify({ version: '0.1.0' })
    return readText(path)
  }
  const result = await inspectEnvironment(custom.adapter)
  assert.equal(result.installation.status, 'partial_installation')
  assert.equal(result.service.status, 'missing')
  assert.equal(result.configuration.programDirectory, customProgram)
  assert.equal(result.configuration.dataDirectory, customData)
  assert.equal(result.configuration.backupDirectory, customBackups)
  assert.equal(result.discovery.source, 'installer_registry')
  assert.equal(result.discovery.confidence, 'corroborated')
  assert.equal(custom.trace.lastUrl, undefined, 'an advisory locator never triggers an API request without SCM confirmation')
})

test('discovers a corroborated staged Server.next after an interrupted first installation', async () => {
  const customProgram = 'D:\\Застосунки HromadaAID'
  const customData = 'E:\\Дані HromadaAID'
  const customBackups = 'F:\\Резервні копії HromadaAID'
  const stagedRoot = `${customProgram}\\Server.next`
  const stagedFiles = new Set([
    `${stagedRoot}\\runtime\\node.exe`, `${stagedRoot}\\service\\HromadaAIDService.exe`, `${stagedRoot}\\app\\dist\\server\\src\\installed.js`,
    `${stagedRoot}\\app\\node_modules\\fastify\\package.json`, `${stagedRoot}\\app\\node_modules\\argon2\\package.json`, `${stagedRoot}\\app\\node_modules\\@phc\\format\\package.json`,
  ].map(value => value.toLowerCase()))
  const partial = fixture({
    service: { installed: false },
    locator: { status: 'available', programDirectory: customProgram, dataDirectory: customData, backupDirectory: customBackups, writableByUnprivileged: false },
    files: stagedFiles,
  })
  partial.adapter.readText = async path => {
    if (path.toLowerCase() === `${stagedRoot}\\app\\package.json`.toLowerCase()) return JSON.stringify({ version: '0.1.0' })
    const error = new Error('missing'); error.code = 'ENOENT'; throw error
  }
  const result = await inspectEnvironment(partial.adapter)
  assert.equal(result.installation.status, 'partial_installation')
  assert.equal(result.configuration.programDirectory, customProgram)
  assert.equal(result.configuration.dataDirectory, customData)
  assert.equal(result.configuration.backupDirectory, customBackups)
  assert.equal(result.configuration.serverVersion, '0.1.0')
  assert.match(result.discovery.message, /Server.next/)
})

test('fails closed for writable and malformed locators, and labels a locator with no surviving components as stale', async () => {
  const paths = { programDirectory: 'D:\\HromadaAID', dataDirectory: 'D:\\HromadaAID-Data', backupDirectory: 'E:\\HromadaAID-Backups' }
  const writable = fixture({ service: { installed: false }, locator: { status: 'available', ...paths, writableByUnprivileged: true }, files: new Set() })
  const writableResult = await inspectEnvironment(writable.adapter)
  assert.equal(writableResult.installation.status, 'unknown')
  assert.equal(writableResult.discovery.confidence, 'untrusted')
  assert.equal(writableResult.configuration.programDirectory, null)

  const malformed = fixture({ service: { installed: false }, locator: { status: 'available', ...paths, programDirectory: 'relative\\HromadaAID', writableByUnprivileged: false }, files: new Set() })
  const malformedResult = await inspectEnvironment(malformed.adapter)
  assert.equal(malformedResult.installation.status, 'unknown')
  assert.equal(malformedResult.discovery.confidence, 'untrusted')

  const overlapping = fixture({ service: { installed: false }, locator: { status: 'available', programDirectory: 'D:\\HromadaAID', dataDirectory: 'D:\\HromadaAID\\Data', backupDirectory: 'E:\\HromadaAID-Backups', writableByUnprivileged: false }, files: new Set() })
  assert.equal((await inspectEnvironment(overlapping.adapter)).discovery.confidence, 'untrusted')

  const stale = fixture({ service: { installed: false }, locator: { status: 'available', ...paths, writableByUnprivileged: false }, files: new Set() })
  const staleResult = await inspectEnvironment(stale.adapter)
  assert.equal(staleResult.installation.status, 'not_installed')
  assert.equal(staleResult.discovery.confidence, 'stale')
  assert.match(staleResult.discovery.message, /Реєстрові шляхи знайдено/)

  const inaccessible = fixture({ service: { installed: false }, locator: { status: 'access_denied' }, files: new Set() })
  assert.equal((await inspectEnvironment(inaccessible.adapter)).installation.status, 'unknown')
})

test('detects stopped and transitional service states independently of API status', async () => {
  const stopped = fixture({ service: { installed: true, state: 'Stopped', binaryPath: `"${wrapper}"` }, api: { kind: 'network_error' } }).adapter
  const result = await inspectEnvironment(stopped)
  assert.equal(result.service.status, 'stopped')
  assert.equal(result.api.status, 'unavailable')
  const pending = fixture({ service: { installed: true, state: 'Start Pending', binaryPath: `"${wrapper}"` } }).adapter
  assert.equal((await inspectEnvironment(pending)).service.status, 'other')
})

test('detects partial installation when the service is missing but default package artifacts remain', async () => {
  const f = fixture({ service: { installed: false } })
  f.adapter.exists = async path => path.toLowerCase() === 'c:\\program files\\hromadaaid\\server\\runtime\\node.exe'
  const result = await inspectEnvironment(f.adapter)
  assert.equal(result.installation.status, 'partial_installation')
  assert.equal(result.service.status, 'missing')
  assert.equal(result.api.status, 'not_configured')
})

test('fails closed for missing, malformed and unsupported configuration without exposing extra fields', async () => {
  const missing = fixture({ configText: undefined })
  missing.adapter.readText = async path => { if (path.toLowerCase() === `${server}\\service\\hromadaaidservice.xml`.toLowerCase()) return serviceXml; const error = new Error('missing'); error.code = 'ENOENT'; throw error }
  const missingResult = await inspectEnvironment(missing.adapter)
  assert.equal(missingResult.installation.status, 'partial_installation')
  assert.equal(missingResult.configuration.apiAddress, null)

  const corrupt = fixture({ configText: '{not-json' }).adapter
  assert.equal((await inspectEnvironment(corrupt)).checks.find(item => item.id === 'configuration').status, 'failed')

  const secret = 'SYNTHETIC_PRIVATE_MARKER'
  const withSecret = fixture({ configText: JSON.stringify({ ...config, recoveryKey: secret }) }).adapter
  const output = JSON.stringify(await inspectEnvironment(withSecret))
  assert.doesNotMatch(output, new RegExp(secret))
  assert.equal((await inspectEnvironment(withSecret)).configuration.apiAddress, null)
})

test('rejects unsafe HTTP network configuration and malformed health responses', async () => {
  const networkConfig = { ...config, mode: 'network', host: '192.0.2.10', tls: { certificatePath: 'C:\\TLS\\cert.pem', privateKeyPath: 'C:\\TLS\\private.pem' } }
  const configNetwork = fixture({ configText: JSON.stringify(networkConfig) })
  const networkResult = await inspectEnvironment(configNetwork.adapter)
  assert.equal(networkResult.configuration.transport, 'HTTPS')
  assert.equal(configNetwork.trace.lastUrl, 'https://192.0.2.10:4310/health')
  const noTls = fixture({ configText: JSON.stringify({ ...config, mode: 'network', host: '192.0.2.10' }) }).adapter
  const noTlsResult = await inspectEnvironment(noTls)
  assert.equal(noTlsResult.checks.find(item => item.id === 'configuration').status, 'failed')
  assert.equal(noTlsResult.api.status, 'not_configured')
  const insecureLocal = fixture({ configText: JSON.stringify({ ...config, host: '192.0.2.10' }) })
  const insecureResult = await inspectEnvironment(insecureLocal.adapter)
  assert.equal(insecureResult.checks.find(item => item.id === 'configuration').status, 'failed')
  assert.equal(insecureResult.api.status, 'not_configured')
  const hostnameLocal = fixture({ configText: JSON.stringify({ ...config, host: 'localhost' }) })
  assert.equal((await inspectEnvironment(hostnameLocal.adapter)).api.status, 'not_configured')

  const malformed = fixture({ api: { kind: 'response', status: 200, redirected: false, body: { status: 'ok' } } }).adapter
  assert.equal((await inspectEnvironment(malformed)).api.status, 'invalid_response')
  const redirect = fixture({ api: { kind: 'response', status: 302, redirected: true, body: null } }).adapter
  assert.equal((await inspectEnvironment(redirect)).api.status, 'invalid_response')
  const timeout = fixture({ api: { kind: 'timeout' } }).adapter
  assert.equal((await inspectEnvironment(timeout)).api.status, 'unavailable')
})

test('configuration and package access errors remain visible as checks, and no database contents are read', async () => {
  const f = fixture()
  const reads = []
  const stats = []
  const original = f.adapter.readText
  f.adapter.readText = async path => { reads.push(path); return original(path) }
  const originalExists = f.adapter.exists
  f.adapter.exists = async path => { stats.push(path); return originalExists(path) }
  const result = await inspectEnvironment(f.adapter)
  assert.equal(reads.some(path => path.toLowerCase().endsWith('.sqlite')), false)
  assert.equal(reads.some(path => path.toLowerCase().endsWith('.hraid')), false)
  assert.equal(reads.some(path => path.toLowerCase().includes('private-key')), false)
  assert.equal(stats.some(path => /\.(?:sqlite|hraid|dpapi)$/i.test(path)), false)
  assert.equal(result.checks.length, 5)
})

test('reports inaccessible metadata and incomplete package without treating either as uninstalled', async () => {
  const inaccessibleConfig = fixture()
  inaccessibleConfig.adapter.readText = async path => {
    if (path.toLowerCase() === `${server}\\service\\hromadaaidservice.xml`.toLowerCase()) return serviceXml
    const error = new Error('access denied'); error.code = 'EACCES'; throw error
  }
  const inaccessible = await inspectEnvironment(inaccessibleConfig.adapter)
  assert.equal(inaccessible.installation.status, 'partial_installation')
  assert.equal(inaccessible.checks.find(item => item.id === 'configuration').details, 'config_access')

  const incomplete = fixture()
  incomplete.adapter.exists = async path => !path.toLowerCase().endsWith('@phc\\format\\package.json') && [
    `${server}\\runtime\\node.exe`, `${server}\\service\\HromadaAIDService.exe`, `${server}\\app\\dist\\server\\src\\installed.js`, `${server}\\app\\node_modules\\fastify\\package.json`, `${server}\\app\\node_modules\\argon2\\package.json`,
  ].some(item => item.toLowerCase() === path.toLowerCase())
  const partial = await inspectEnvironment(incomplete.adapter)
  assert.equal(partial.installation.status, 'partial_installation')
  assert.equal(partial.checks.find(item => item.id === 'package').status, 'warning')
})

test('access failure while checking default roots is unknown, never a false not-installed result', async () => {
  const f = fixture({ service: { installed: false }, files: new Set() })
  f.adapter.exists = async () => { const error = new Error('denied'); error.code = 'EACCES'; throw error }
  const result = await inspectEnvironment(f.adapter)
  assert.equal(result.service.status, 'missing')
  assert.equal(result.installation.status, 'unknown')
})

test('PowerShell provider is constrained to a read-only named-service query and bounded child process', () => {
  const source = readFileSync(new URL('../electron/windows-inspection.ts', import.meta.url), 'utf8')
  assert.match(source, /Get-CimInstance -ClassName Win32_Service -Filter/)
  assert.match(source, /System\.Text\.UTF8Encoding/)
  assert.match(source, /SERVICE_ACCESS_DENIED/)
  assert.match(source, /timeout:\s*5_000/)
  assert.match(source, /windowsHide:\s*true/)
  assert.match(source, /HKEY_LOCAL_MACHINE\\Software\\HromadaAID\\Installer/)
  assert.match(source, /writableByUnprivileged/)
  assert.match(source, /Security\.AccessControl\.RegistryRights\]::SetValue/)
  assert.match(source, /Get-Acl -LiteralPath/)
  assert.doesNotMatch(source, /Start-Service|Stop-Service|New-Service|Remove-Service|sc\.exe\s+(?:start|stop|create|delete)|Set-Acl|Set-NetFirewall/)
  assert.doesNotMatch(source, /Set-ItemProperty|New-ItemProperty|Remove-ItemProperty|New-Item\s+-Path\s+Registry|Remove-Item\s+-Path\s+Registry/)
  assert.match(source, /redirect:\s*'manual'/)
  assert.match(source, /AbortController/)
})

test('IPC handler accepts only the trusted renderer, coalesces refreshes and returns a safe failure state', async () => {
  let calls = 0
  const snapshot = { ...await inspectEnvironment(fixture().adapter), checkedAt: 'fixed-test-time' }
  const safeFailure = { ...snapshot, installation: { status: 'unknown', message: 'safe failure' } }
  const trusted = event => event.sender === 'manager-window' && event.senderFrame?.url === 'file:///manager/index.html'
  const handler = createInspectionRequestHandler(async () => { calls++; await new Promise(resolve => setTimeout(resolve, 10)); return snapshot }, trusted, () => safeFailure)
  const event = { sender: 'manager-window', senderFrame: { url: 'file:///manager/index.html' } }
  const [first, second] = await Promise.all([handler(event), handler(event)])
  assert.equal(first, snapshot)
  assert.equal(second, snapshot)
  assert.equal(calls, 1)
  await assert.rejects(handler({ sender: 'other-window', senderFrame: event.senderFrame }), /UNTRUSTED_RENDERER/)
  const failed = createInspectionRequestHandler(async () => { throw new Error('secret marker must not cross IPC') }, trusted, () => safeFailure)
  assert.equal((await failed(event)).installation.message, 'safe failure')
  assert.doesNotMatch(JSON.stringify(await failed(event)), /secret marker/)
})
