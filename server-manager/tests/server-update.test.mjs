import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const { verifyUpdatePackage, prepareServerUpdate, applyServerUpdate } = await import('../../dist-server-manager/main/server-update.js')
const { buildSafeZipExtractionCommand } = await import('../../dist-server-manager/main/windows-server-update.js')

const payloadFiles = [
  'runtime/node.exe', 'service/HromadaAIDService.exe', 'service/HromadaAIDService.xml.template', 'app/package.json',
  'app/dist/server/src/create-admin.js', 'app/dist/electron/database.js', 'app/dist/shared/api-compatibility.js', 'installer/verify-server-package.mjs',
  'installer/server-runtime-check.mjs', 'installer/server-package-transaction.mjs', 'installer/prepare-server-install.mjs',
  'installer/install-server-service.ps1', 'installer/write-installation-locator.ps1',
]

async function fixturePackage(directory, { version = '0.1.0', apiVersion = 1, schema = { minimum: 1, maximum: 28 } } = {}) {
  for (const path of payloadFiles) {
    const absolute = join(directory, ...path.split('/'))
    await mkdir(join(absolute, '..'), { recursive: true })
    await writeFile(absolute, path === 'app/package.json' ? JSON.stringify({ version })
      : path === 'app/dist/shared/api-compatibility.js' ? `export const HROMADAAID_API_CONTRACT_VERSION = ${apiVersion};`
        : path === 'app/dist/electron/database.js' ? 'const migrations = [{ version: 1 }, { version: 28 }];'
          : `fixture:${path}`)
  }
  const files = async root => {
    const values = []
    async function walk(folder) {
      for (const item of await (await import('node:fs/promises')).readdir(folder, { withFileTypes: true })) {
        const absolute = join(folder, item.name)
        if (item.isDirectory()) await walk(absolute)
        else {
          const bytes = await readFile(absolute)
          values.push({ path: absolute.slice(root.length + 1).replaceAll('\\', '/'), sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
        }
      }
    }
    await walk(root)
    return values.sort((a, b) => a.path.localeCompare(b.path, 'en'))
  }
  const integrityFiles = await files(directory)
  await writeFile(join(directory, 'package-integrity.json'), JSON.stringify({ formatVersion: 1, files: integrityFiles }))
  const manifestFiles = await files(directory)
  await writeFile(join(directory, 'package-manifest.json'), JSON.stringify({
    formatVersion: 1, packageSchemaVersion: 1, component: 'server', name: 'HromadaAID Server', version,
    platform: 'win32', architecture: 'x64', authenticity: { method: 'sha256-manifest', detachedSignature: null },
    compatibility: { serverApi: { contract: 'hromadaaid-rest', version: apiVersion }, sqliteSchema: schema }, files: manifestFiles,
  }))
}

function snapshot({ service = 'running', installation = 'installed', confidence = 'confirmed', api = 'available', version = '0.1.0' } = {}) {
  return {
    installation: { status: installation }, service: { status: service }, api: { status: api, contractVersion: api === 'available' ? 1 : null },
    configuration: { programDirectory: 'C:\\Program Files\\HromadaAID', dataDirectory: 'D:\\HromadaAID Data', backupDirectory: 'E:\\HromadaAID Backups', databasePath: 'D:\\HromadaAID Data\\Database\\hromada-aid.sqlite', serverVersion: version },
    discovery: { confidence },
  }
}

function adapters({ current = snapshot(), conflict = false, final = snapshot(), events = [] } = {}) {
  let installerCompleted = false
  return {
    inspect: async () => installerCompleted ? final : current,
    extract: async (_zip, destination) => { await mkdir(destination, { recursive: true }); await fixturePackage(destination) },
    readCurrentSchema: async () => 4,
    readInstalledApiContract: async () => 1,
    prepare: async () => events.push('adapter:prepare'),
    runInstaller: async (_env, report) => { events.push('adapter:installer'); report('stop', 'Штатна зупинка'); report('switch', 'Перемикання'); report('health', 'Перевірка API'); installerCompleted = true },
    cleanup: async path => rm(path, { recursive: true, force: true }),
    pathExists: async path => conflict && path.endsWith('Server.previous'),
    nowId: (() => { let id = 0; return () => `id-${++id}` })(),
  }
}

test('server ZIP payload manifests and file hashes are verified; same SemVer remains eligible', async t => {
  const root = await mkdtemp(join(tmpdir(), 'hromada-update-package-')); t.after(() => rm(root, { recursive: true, force: true }))
  await fixturePackage(root)
  const result = await verifyUpdatePackage(root)
  assert.deepEqual(result, { version: '0.1.0', apiContract: 1, schema: { minimum: 1, maximum: 28 }, authenticity: 'unsigned' })
  await writeFile(join(root, 'service', 'HromadaAIDService.exe'), 'tampered')
  await assert.rejects(verifyUpdatePackage(root), { code: 'PACKAGE_HASH_MISMATCH' })
})

test('manifest rejects traversal paths and compatibility metadata outside supported ranges', async t => {
  const root = await mkdtemp(join(tmpdir(), 'hromada-update-manifest-')); t.after(() => rm(root, { recursive: true, force: true }))
  await fixturePackage(root)
  const manifest = JSON.parse(await readFile(join(root, 'package-manifest.json'), 'utf8'))
  manifest.files[0].path = '../escape'
  await writeFile(join(root, 'package-manifest.json'), JSON.stringify(manifest))
  await assert.rejects(verifyUpdatePackage(root), { code: 'PACKAGE_PATH_INVALID' })
})

test('package API contract and SQLite manifest values must match the packaged implementation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'hromada-update-compat-mismatch-')); t.after(() => rm(root, { recursive: true, force: true }))
  await fixturePackage(root)
  const manifest = JSON.parse(await readFile(join(root, 'package-manifest.json'), 'utf8'))
  manifest.compatibility.serverApi.version = 2
  await writeFile(join(root, 'package-manifest.json'), JSON.stringify(manifest))
  await assert.rejects(verifyUpdatePackage(root), { code: 'API_CONTRACT_MANIFEST_MISMATCH' })
})

test('stopped service and same version are supported after read-only schema and contract checks', async t => {
  const root = await mkdtemp(join(tmpdir(), 'hromada-update-engine-')); t.after(() => rm(root, { recursive: true, force: true }))
  const calls = []
  const io = adapters({ current: snapshot({ service: 'stopped', api: 'unavailable' }), events: calls })
  const prepared = await prepareServerUpdate(join(root, 'HromadaAID Server.zip'), io)
  assert.equal(prepared.preview.sameVersion, true)
  assert.equal(prepared.preview.currentSchema, 4)
  assert.equal(prepared.preview.apiContract, 'hromadaaid-rest v1')
  const result = await applyServerUpdate(prepared, io, 'update-1', event => calls.push(event.stage))
  assert.equal(result.success, true)
  assert.deepEqual(calls.filter(value => value.startsWith('adapter:')), ['adapter:prepare', 'adapter:installer'])
  assert.ok(calls.includes('stop'))
})

test('incompatible contract and outstanding transaction stop before package preparation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'hromada-update-negative-')); t.after(() => rm(root, { recursive: true, force: true }))
  const incompatible = adapters()
  incompatible.extract = async (_zip, destination) => { await mkdir(destination, { recursive: true }); await fixturePackage(destination, { apiVersion: 2 }) }
  await assert.rejects(prepareServerUpdate(join(root, 'package.zip'), incompatible), { code: 'API_CONTRACT_INCOMPATIBLE' })
  let extracted = false
  const conflict = adapters({ conflict: true })
  conflict.extract = async () => { extracted = true }
  await assert.rejects(prepareServerUpdate(join(root, 'package.zip'), conflict), { code: 'UPDATE_RECOVERY_REQUIRED' })
  assert.equal(extracted, false)
})

test('partial or uncertain installation is never treated as an update target', async t => {
  const root = await mkdtemp(join(tmpdir(), 'hromada-update-install-state-')); t.after(() => rm(root, { recursive: true, force: true }))
  await assert.rejects(prepareServerUpdate(join(root, 'package.zip'), adapters({ current: snapshot({ installation: 'partial_installation' }) })), { code: 'INSTALLATION_NOT_CONFIRMED' })
})

test('failed API confirmation reports failure and never reports update success', async t => {
  const root = await mkdtemp(join(tmpdir(), 'hromada-update-health-fail-')); t.after(() => rm(root, { recursive: true, force: true }))
  const io = adapters({ final: snapshot({ service: 'running', api: 'unavailable', version: '0.1.0' }) })
  const prepared = await prepareServerUpdate(join(root, 'package.zip'), io)
  const result = await applyServerUpdate(prepared, io, 'update-health-fail', () => undefined)
  assert.equal(result.success, false)
  assert.equal(result.manualRecoveryRequired, false)
  assert.match(result.message, /не завершено/)
})

test('installer rollback outcome remains distinct from success and manual recovery', async t => {
  const root = await mkdtemp(join(tmpdir(), 'hromada-update-rollback-')); t.after(() => rm(root, { recursive: true, force: true }))
  const io = adapters()
  io.runInstaller = async () => { throw new Error('Нове оновлення не пройшло перевірку. Попередній серверний пакет відновлено: service failed') }
  const prepared = await prepareServerUpdate(join(root, 'package.zip'), io)
  const result = await applyServerUpdate(prepared, io, 'update-rollback', () => undefined)
  assert.equal(result.success, false)
  assert.equal(result.rolledBack, true)
  assert.equal(result.manualRecoveryRequired, false)
})

test('Windows PowerShell safe extractor accepts Unicode paths and rejects ZIP traversal', { skip: process.platform !== 'win32' }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'HromadaAID ZIP перевірка ')); t.after(() => rm(root, { recursive: true, force: true }))
  const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const archive = join(root, 'сервер package.zip'), destination = join(root, 'unpacked'), badArchive = join(root, 'bad.zip')
  const createScript = String.raw`Add-Type -AssemblyName System.IO.Compression; $zipPath=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__ZIP__'));$archive=[IO.Compression.ZipArchive]::new([IO.File]::Open($zipPath,[IO.FileMode]::CreateNew),[IO.Compression.ZipArchiveMode]::Create);try{$entry=$archive.CreateEntry('пакет/дані.txt');$writer=[IO.StreamWriter]::new($entry.Open(),[Text.Encoding]::UTF8);try{$writer.Write('тест')}finally{$writer.Dispose()}}finally{$archive.Dispose()}`
  const create = (path, script) => spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script.replace('__ZIP__', Buffer.from(path, 'utf8').toString('base64')), 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true })
  assert.equal(create(archive, createScript).status, 0)
  const extracted = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(buildSafeZipExtractionCommand(archive, destination), 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true })
  assert.equal(extracted.status, 0, extracted.stderr || extracted.stdout)
  assert.equal(await readFile(join(destination, 'пакет', 'дані.txt'), 'utf8').then(value => value.replace(/^\uFEFF/, '')), 'тест')
  const badScript = String.raw`Add-Type -AssemblyName System.IO.Compression;$zipPath=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__ZIP__'));$archive=[IO.Compression.ZipArchive]::new([IO.File]::Open($zipPath,[IO.FileMode]::CreateNew),[IO.Compression.ZipArchiveMode]::Create);try{$entry=$archive.CreateEntry('../escape.txt');$writer=[IO.StreamWriter]::new($entry.Open());$writer.Write('bad');$writer.Dispose()}finally{$archive.Dispose()}`
  assert.equal(create(badArchive, badScript).status, 0)
  const rejected = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(buildSafeZipExtractionCommand(badArchive, join(root, 'bad-out')), 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true })
  assert.notEqual(rejected.status, 0)
})

test('existing service installer stops only after validations and keeps failures before transaction from stopping service', async () => {
  const source = await readFile(join(process.cwd(), 'packaging/install-server-service.ps1'), 'utf8')
  assert.ok(source.indexOf("Set-InstallStage 'inspect-database-and-create-admin'") < source.indexOf("Set-InstallStage 'stop-service'"))
  assert.ok(source.indexOf("Set-InstallStage 'stop-service'") < source.indexOf("Set-InstallStage 'prepare-package-journal'"))
  assert.match(source, /\$transactionStarted = .*\$previousServer.*\$failedServer.*\$newServiceRegistered/)
  assert.match(source, /if \(\$transactionStarted -and \$null -ne \$service/)
  const aclSetup = source.indexOf("Set-AclChecked $DataDirectory")
  const aclGuard = source.lastIndexOf('if (-not $hadOldPackage)', aclSetup)
  assert.ok(aclGuard > source.indexOf("Set-InstallStage 'configure-acl'"))
  assert.ok(aclSetup < source.indexOf("Set-InstallStage 'stop-service'"))
  assert.match(source, /if \(-not \$hadOldPackage\) \{\s*# Initial install needs the baseline ACLs before creating data/)
  assert.match(source, /\[switch\]\$UpdateOnly/)
  assert.match(source, /if \(\$UpdateOnly -and \(-not \$hadOldPackage -or \$null -eq \$service\)\)/)
  assert.match(source, /if \(\$UpdateOnly -and \(\$databaseStatus\.users -eq 0 -or \$pendingExists\)\)/)
  assert.ok(source.indexOf('if ($UpdateOnly -and ($databaseStatus.users -eq 0 -or $pendingExists))') < source.indexOf('if ($databaseStatus.users -eq 0)'))
  const adapter = await readFile(join(process.cwd(), 'server-manager/electron/windows-server-update.ts'), 'utf8')
  assert.match(adapter, /'-FromServerManager',\s*'-UpdateOnly'/)
})

test('existing configuration remains authoritative during package preparation, including network host and port', async () => {
  const source = await readFile(join(process.cwd(), 'server-manager/electron/windows-server-update.ts'), 'utf8')
  assert.match(source, /Existing server\.json is authoritative/)
  assert.doesNotMatch(source, /'--host'\s*,\s*config\.host| '--port'\s*,\s*String\(config\.port\)/)
})

test('preload exposes fixed update methods and no arbitrary command execution channel', async () => {
  const source = await readFile(join(process.cwd(), 'server-manager/electron/preload.cjs'), 'utf8')
  assert.match(source, /selectServerUpdatePackage/)
  assert.match(source, /applyServerUpdate: previewId => ipcRenderer\.invoke\('manager:apply-server-update', previewId\)/)
  assert.doesNotMatch(source, /exec\(|spawn\(|powershell|run-command|execute-command/i)
})
