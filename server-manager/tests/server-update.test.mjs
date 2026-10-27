import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile, readdir, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'

const { verifyUpdatePackage, prepareServerUpdate, applyServerUpdate, readPackageManifestIdentity, compareSemVer } = await import('../../dist-server-manager/main/server-update.js')
const { createWindowsServerUpdateAdapters, buildZipCompressionRatioProbeCommand, normalizePowerShellDiagnostic, buildInstallerInvocation } = await import('../../dist-server-manager/main/windows-server-update.js')
const { parseInstallerDiagnostic } = await import('../../dist-server-manager/main/server-install-diagnostic.js')

const payloadFiles = [
  'runtime/node.exe', 'service/HromadaAIDService.exe', 'service/HromadaAIDService.xml.template', 'app/package.json',
  'app/dist/server/src/create-admin.js', 'app/dist/electron/database.js', 'app/dist/shared/api-compatibility.js', 'installer/verify-server-package.mjs',
  'installer/server-runtime-check.mjs', 'installer/server-package-transaction.mjs', 'installer/prepare-server-install.mjs',
  'installer/windows-installer-config.mjs', 'installer/install-server-service.ps1', 'installer/write-installation-locator.ps1',
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

function adapters({ current = snapshot(), conflict = false, final, events = [], packageVersion = '0.1.1' } = {}) {
  let installerCompleted = false
  let candidateIdentity = ''
  const finalSnapshot = final ?? snapshot({ version: packageVersion })
  return {
    inspect: async () => installerCompleted ? finalSnapshot : current,
    extract: async (_zip, destination) => { await mkdir(destination, { recursive: true }); await fixturePackage(destination, { version: packageVersion }) },
    readCurrentSchema: async () => 4,
    readInstalledApiContract: async () => 1,
    readActivePackageIdentity: async () => installerCompleted ? candidateIdentity : 'original-package-identity',
    prepare: async (_environment, extracted) => { candidateIdentity = await readPackageManifestIdentity(extracted); events.push('adapter:prepare') },
    runInstaller: async (_env, report) => { events.push('adapter:installer'); report('stop', 'Штатна зупинка'); report('switch', 'Перемикання'); report('health', 'Перевірка API'); installerCompleted = true },
    cleanup: async path => rm(path, { recursive: true, force: true }),
    pathExists: async path => conflict && path.endsWith('Server.previous'),
    nowId: (() => { let id = 0; return () => `id-${++id}` })(),
  }
}

test('server ZIP payload manifests and file hashes are verified before update policy is applied', async t => {
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

test('newer stable version can update a stopped service after read-only schema and contract checks', async t => {
  const root = await mkdtemp(join(tmpdir(), 'hromada-update-engine-')); t.after(() => rm(root, { recursive: true, force: true }))
  const calls = []
  const io = adapters({ current: snapshot({ service: 'stopped', api: 'unavailable', version: '0.1.2' }), events: calls, packageVersion: '0.1.3' })
  const prepared = await prepareServerUpdate(join(root, 'HromadaAID Server.zip'), io)
  assert.equal(prepared.preview.sameVersion, false)
  assert.equal(prepared.preview.currentSchema, 4)
  assert.equal(prepared.preview.apiContract, 'hromadaaid-rest v1')
  const result = await applyServerUpdate(prepared, io, 'update-1', event => calls.push(event.stage))
  assert.equal(result.success, true)
  assert.deepEqual(calls.filter(value => value.startsWith('adapter:')), ['adapter:prepare', 'adapter:installer'])
  assert.ok(calls.includes('stop'))
})

test('same and older versions are rejected after ZIP verification and before package preparation or installer invocation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'hromada-update-version-policy-')); t.after(() => rm(root, { recursive: true, force: true }))
  for (const [version, currentVersion, code] of [['0.1.0', '0.1.0', 'UPDATE_VERSION_ALREADY_INSTALLED'], ['0.1.2', '0.1.3', 'UPDATE_DOWNGRADE_BLOCKED'], ['0.0.9', '0.1.0', 'UPDATE_DOWNGRADE_BLOCKED']]) {
    const calls = [], io = adapters({ current: snapshot({ version: currentVersion }), packageVersion: version, events: calls })
    await assert.rejects(prepareServerUpdate(join(root, `${version}.zip`), io), { code })
    assert.deepEqual(calls, [], `${version}: neither Server.next preparation nor installer may run`)
  }
  const prerelease = adapters({ packageVersion: '0.1.1-rc.1' })
  await assert.rejects(prepareServerUpdate(join(root, 'prerelease.zip'), prerelease), { code: 'UPDATE_PRERELEASE_UNSUPPORTED' })
})

test('SemVer precedence handles numeric components, prereleases, numeric identifiers and build metadata', () => {
  for (const [left, right, expected] of [
    ['0.1.2', '0.1.3', -1], ['0.1.3', '0.1.2', 1],
    ['0.10.0', '0.9.99', 1], ['1.0.0-alpha', '1.0.0', -1], ['1.0.0-alpha.2', '1.0.0-alpha.10', -1],
    ['1.0.0-rc.1', '1.0.0-rc.1', 0], ['1.0.0+build.2', '1.0.0+build.1', 0], ['1.0.0-beta', '1.0.0-alpha', 1],
  ]) assert.equal(compareSemVer(left, right), expected, `${left} vs ${right}`)
  assert.throws(() => compareSemVer('1.0.0-01', '1.0.0'), { code: 'PACKAGE_VERSION_INVALID' })
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
  assert.equal(result.manualRecoveryRequired, true)
  assert.match(result.message, /не завершено/)
})

test('installer rollback outcome remains distinct from success and manual recovery', async t => {
  const root = await mkdtemp(join(tmpdir(), 'hromada-update-rollback-')); t.after(() => rm(root, { recursive: true, force: true }))
  const io = adapters()
  io.runInstaller = async () => { throw Object.assign(new Error('Нове оновлення не пройшло перевірку. Попередній серверний пакет відновлено: service failed'), { rollbackConfirmed: true }) }
  const prepared = await prepareServerUpdate(join(root, 'package.zip'), io)
  const result = await applyServerUpdate(prepared, io, 'update-rollback', () => undefined)
  assert.equal(result.success, false)
  assert.equal(result.rolledBack, true)
  assert.equal(result.manualRecoveryRequired, false)
})

test('preparation failure with only Server.next leaves verified original installation intact', async t => {
  const root = await mkdtemp(join(tmpdir(), 'hromada-preparation-failure-')); t.after(() => rm(root, { recursive: true, force: true }))
  const io = adapters()
  const prepared = await prepareServerUpdate(join(root, 'package.zip'), io)
  let installerCalled = false
  io.prepare = async () => { throw new Error('Фактичний склад ZIP не відповідає маніфесту.') }
  io.pathExists = async path => path.endsWith('Server.next')
  io.runInstaller = async () => { installerCalled = true }
  const result = await applyServerUpdate(prepared, io, 'preparation-failure', () => undefined)
  assert.equal(installerCalled, false)
  assert.equal(result.failureKind, 'preparation')
  assert.equal(result.manualRecoveryRequired, false)
  assert.equal(result.rolledBack, false)
  assert.match(result.message, /Перемикання пакета не виконувалось/)
  assert.match(result.message, /Server.next збережено/)
})

test('healthy API alone never proves rollback or unchanged package after a failure', async t => {
  const root = await mkdtemp(join(tmpdir(), 'hromada-rollback-evidence-')); t.after(() => rm(root, { recursive: true, force: true }))
  for (const condition of ['journal', 'previous', 'changed-identity', 'access-error', 'text-only']) {
    const io = adapters()
    const prepared = await prepareServerUpdate(join(root, 'package.zip'), io)
    io.runInstaller = async () => {
      if (condition === 'changed-identity') io.readActivePackageIdentity = async () => 'different-content-same-version'
      if (condition === 'journal') io.pathExists = async path => path.endsWith('.hromadaaid-update-state.json')
      if (condition === 'previous') io.pathExists = async path => path.endsWith('Server.previous')
      if (condition === 'access-error') io.pathExists = async () => { throw new Error('Access denied') }
      throw Object.assign(new Error('Попередній серверний пакет відновлено'), { rollbackConfirmed: condition !== 'text-only' })
    }
    const result = await applyServerUpdate(prepared, io, condition, () => undefined)
    assert.equal(result.rolledBack, false, condition)
    assert.equal(result.manualRecoveryRequired, true, condition)
  }
})

test('healthy API cannot report success for an unchanged package or unfinished transaction', async t => {
  const root = await mkdtemp(join(tmpdir(), 'hromada-update-success-evidence-')); t.after(() => rm(root, { recursive: true, force: true }))
  for (const condition of ['unchanged', 'unfinished']) {
    const io = adapters()
    const prepared = await prepareServerUpdate(join(root, 'package.zip'), io)
    const runInstaller = io.runInstaller
    io.runInstaller = async (...args) => {
      await runInstaller(...args)
      if (condition === 'unchanged') io.readActivePackageIdentity = async () => prepared.activePackageIdentity
      else io.pathExists = async path => path.endsWith('.hromadaaid-update-state.json')
    }
    const result = await applyServerUpdate(prepared, io, condition, () => undefined)
    assert.equal(result.success, false)
    assert.equal(result.manualRecoveryRequired, true)
  }
})

const productionZip = process.env.HROMADAAID_TEST_SERVER_ZIP ?? join(process.cwd(), 'release', `HromadaAID-Server-v${JSON.parse(await readFile('package.json', 'utf8')).version}-win-x64.zip`)
test('production ZIP survives repeat verification and real Server.next preparation with only generated WinSW XML added', { skip: process.platform !== 'win32' ? 'Requires Windows runtime' : !existsSync(productionZip) ? 'Set HROMADAAID_TEST_SERVER_ZIP to a complete production ZIP' : false }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'HromadaAID production update тест ')); t.after(() => rm(root, { recursive: true, force: true }))
  const io = createWindowsServerUpdateAdapters()
  const extracted = join(root, 'extracted', 'package')
  await io.extract(productionZip, extracted)
  assert.deepEqual(await verifyUpdatePackage(extracted), await verifyUpdatePackage(extracted))
  const programDirectory = join(root, 'Program'), dataDirectory = join(root, 'Data'), backupDirectory = join(root, 'Backups')
  await mkdir(join(dataDirectory, 'Database'), { recursive: true }); await mkdir(backupDirectory, { recursive: true })
  const databasePath = join(dataDirectory, 'Database', 'hromada-aid.sqlite'), configPath = join(dataDirectory, 'server.json'), keyPath = join(backupDirectory, '.hromadaaid-backup-key.dpapi')
  await writeFile(databasePath, 'isolated synthetic database sentinel'); await writeFile(keyPath, 'isolated key sentinel')
  await writeFile(configPath, JSON.stringify({ configVersion: 2, mode: 'local', host: '127.0.0.1', port: 4310, programDirectory, databasePath, backupDirectory }))
  const before = await Promise.all([databasePath, configPath, keyPath].map(path => readFile(path)))
  const environment = { programDirectory, dataDirectory, backupDirectory, databasePath, serverVersion: '0.1.0', apiContractVersion: 1, serviceStatus: 'running' }
  const archiveCount = (await readdir(extracted, { recursive: true, withFileTypes: true })).filter(item => item.isFile()).length
  t.diagnostic(`Production ZIP: ${archiveCount} files; integrity manifest: ${JSON.parse(await readFile(join(extracted, 'package-integrity.json'), 'utf8')).files.length} entries; generated WinSW XML adds exactly one file.`)
  await io.prepare(environment, extracted)
  const staged = join(programDirectory, 'Server.next')
  const generated = await readFile(join(staged, 'service', 'HromadaAIDService.xml'))
  const { renderWinSWConfig } = await import(pathToFileURL(join(extracted, 'installer', 'windows-installer-config.mjs')).href)
  const expected = renderWinSWConfig(await readFile(join(extracted, 'service', 'HromadaAIDService.xml.template'), 'utf8'), { mode: 'server', programDirectory, dataDirectory, backupDirectory })
  assert.equal(generated.toString('utf8'), expected)
  const options = { serviceXmlSha256: createHash('sha256').update(expected, 'utf8').digest('hex') }
  await verifyUpdatePackage(staged, options)
  assert.equal((await readdir(staged, { recursive: true, withFileTypes: true })).filter(item => item.isFile()).length, archiveCount + 1)
  await assert.rejects(verifyUpdatePackage(staged), { code: 'PACKAGE_CONTENT_MISMATCH' })
  const stock = spawnSync(join(staged, 'runtime', 'node.exe'), [join(staged, 'installer', 'verify-server-package.mjs'), staged], { cwd: join(staged, 'app'), encoding: 'utf8', windowsHide: true, timeout: 120_000 })
  assert.equal(stock.status, 0, stock.stderr || stock.stdout)
  assert.match(stock.stdout, /create-admin.js --status/)
  await assert.rejects(io.prepare(environment, extracted), { code: 'UPDATE_STAGE_EXISTS' })
  await writeFile(join(staged, 'unknown.exe'), 'unexpected executable')
  await assert.rejects(verifyUpdatePackage(staged, options), { code: 'PACKAGE_CONTENT_MISMATCH' })
  await rm(join(staged, 'unknown.exe'))
  await writeFile(join(staged, 'service', 'HromadaAIDService.xml'), 'modified XML')
  await assert.rejects(verifyUpdatePackage(staged, options), { code: 'PREPARED_SERVICE_CONFIG_INVALID' })
  assert.deepEqual(await Promise.all([databasePath, configPath, keyPath].map(path => readFile(path))), before)
  await writeFile(join(staged, 'service', 'HromadaAIDService.xml'), generated)
  await rename(staged, join(programDirectory, 'Server'))
  const identity = await io.readActivePackageIdentity(environment)
  assert.match(identity, /^[a-f0-9]{64}$/)
  assert.equal(await io.readActivePackageIdentity(environment), identity)
  await writeFile(join(programDirectory, 'Server', 'app', 'package.json'), '{"version":"0.1.0","tampered":true}')
  await assert.rejects(io.readActivePackageIdentity(environment))
  const currentPayload = await readFile(join(process.cwd(), 'packaging', 'install-server-service.ps1'), 'utf8')
  assert.match(currentPayload, /\[switch\]\$UpdateOnly/)
})

test('Manager uses its bundled update orchestration and explicit outcome signals after verified recovery', async () => {
  const source = await readFile(join(process.cwd(), 'server-manager/electron/windows-server-update.ts'), 'utf8')
  assert.match(source, /const script = options\.installerScriptPath/)
  assert.match(source, /HROMADAAID_UPDATE_OUTCOME/)
  const main = await readFile(join(process.cwd(), 'server-manager/electron/main.ts'), 'utf8')
  assert.match(main, /installerScriptPath: app\.isPackaged \? join\(process\.resourcesPath, 'server-payload', 'installer', 'install-server-service.ps1'\)/)
  const installer = await readFile(join(process.cwd(), 'packaging/install-server-service.ps1'), 'utf8')
  assert.ok(installer.indexOf("Invoke-PackageTransaction $rollbackToolRoot 'finalize-rollback'") < installer.indexOf('HROMADAAID_UPDATE_OUTCOME|rolled-back'))
})

test('Windows PowerShell safe extractor accepts Unicode paths and rejects ZIP traversal', { skip: process.platform !== 'win32' }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'HromadaAID ZIP перевірка ')); t.after(() => rm(root, { recursive: true, force: true }))
  const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const archive = join(root, 'сервер package.zip'), destination = join(root, 'new temp parent', 'unpacked'), badArchive = join(root, 'bad.zip')
  const createScript = String.raw`Add-Type -AssemblyName System.IO.Compression; $zipPath=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__ZIP__'));$archive=[IO.Compression.ZipArchive]::new([IO.File]::Open($zipPath,[IO.FileMode]::CreateNew),[IO.Compression.ZipArchiveMode]::Create);try{$entry=$archive.CreateEntry('пакет/дані.txt');$writer=[IO.StreamWriter]::new($entry.Open(),[Text.Encoding]::UTF8);try{$writer.Write('тест')}finally{$writer.Dispose()}}finally{$archive.Dispose()}`
  const create = (path, script) => spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script.replace('__ZIP__', Buffer.from(path, 'utf8').toString('base64')), 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true })
  assert.equal(create(archive, createScript).status, 0)
  await createWindowsServerUpdateAdapters().extract(archive, destination)
  assert.equal(await readFile(join(destination, 'пакет', 'дані.txt'), 'utf8').then(value => value.replace(/^\uFEFF/, '')), 'тест')
  const badScript = String.raw`Add-Type -AssemblyName System.IO.Compression;$zipPath=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__ZIP__'));$archive=[IO.Compression.ZipArchive]::new([IO.File]::Open($zipPath,[IO.FileMode]::CreateNew),[IO.Compression.ZipArchiveMode]::Create);try{$entry=$archive.CreateEntry('../escape.txt');$writer=[IO.StreamWriter]::new($entry.Open());$writer.Write('bad');$writer.Dispose()}finally{$archive.Dispose()}`
  assert.equal(create(badArchive, badScript).status, 0)
  await assert.rejects(createWindowsServerUpdateAdapters().extract(badArchive, join(root, 'bad temp parent', 'bad-out')), { code: 'ZIP_EXTRACTION_FAILED' })
})

test('Windows PowerShell ZIP ratio arithmetic handles Int64 products and rejects zip bombs', { skip: process.platform !== 'win32' }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'HromadaAID ZIP limits ')); t.after(() => rm(root, { recursive: true, force: true }))
  const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const runProbe = (length, compressedLength) => spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(buildZipCompressionRatioProbeCommand(length, compressedLength), 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true })
  assert.equal(runProbe('361645040', '36164504').status, 0, 'Former Int32-overflow value must be accepted by safe Int64 arithmetic')
  assert.equal(runProbe('20000000', '1000').status, 1, 'Compression ratio over 1000:1 must be rejected')
  assert.equal(runProbe('9223372036854775807', '9223372036854776').status, 0, 'Int64 upper bound must not overflow during division')

  const archive = join(root, 'bomb.zip')
  const script = String.raw`Add-Type -AssemblyName System.IO.Compression; $archive=[IO.Compression.ZipArchive]::new([IO.File]::Open('__ZIP__',[IO.FileMode]::CreateNew),[IO.Compression.ZipArchiveMode]::Create);try{$entry=$archive.CreateEntry('bomb.bin',[IO.Compression.CompressionLevel]::Optimal);$stream=$entry.Open();try{$buffer=New-Object byte[] 65536;for($i=0;$i -lt 32;$i++){$stream.Write($buffer,0,$buffer.Length)}}finally{$stream.Dispose()}}finally{$archive.Dispose()}`.replace('__ZIP__', archive.replaceAll("'", "''"))
  const created = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true })
  assert.equal(created.status, 0, created.stderr)
  await assert.rejects(createWindowsServerUpdateAdapters().extract(archive, join(root, 'bomb-out')), error => {
    assert.equal(error.code, 'ZIP_EXTRACTION_FAILED')
    assert.match(error.details, /коефіцієнт стиснення/)
    return true
  })
})

test('PowerShell diagnostics omit CLIXML progress while retaining actual errors', () => {
  const clixml = '#< CLIXML\n<Objs><Obj S="progress"><AV>Preparing modules for first use</AV></Obj><S S="Error">ZIP invalid: &lt;bad&gt; &amp; unreadable</S></Objs>'
  assert.equal(normalizePowerShellDiagnostic(clixml), 'ZIP invalid: <bad> & unreadable')
  assert.doesNotMatch(normalizePowerShellDiagnostic(clixml), /Preparing modules/)
  assert.equal(normalizePowerShellDiagnostic('#< CLIXML\n<Objs><S S="Error">token=private-value</S></Objs>'), 'token=[redacted]')
  assert.equal(normalizePowerShellDiagnostic('Actual PowerShell failure'), 'Actual PowerShell failure')
  assert.equal(normalizePowerShellDiagnostic('#< CLIXML\n<Objs><Obj S="progress"><AV>Preparing modules for first use</AV></Obj></Objs>'), '')
})

test('service installer invocation preserves paths with spaces as separate -File arguments', () => {
  const script = 'C:\\Program Files\\HromadaAID\\Server Manager\\resources\\server-payload\\installer\\install-server-service.ps1'
  const environment = { programDirectory: 'C:\\Program Files\\HromadaAID', dataDirectory: 'C:\\ProgramData\\HromadaAID Data', backupDirectory: 'D:\\HromadaAID Backups' }
  const invocation = buildInstallerInvocation(script, environment, 'C:\\Windows')
  assert.equal(invocation.executable, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
  assert.equal(invocation.cwd, 'C:\\Windows\\System32')
  assert.deepEqual(invocation.args.slice(invocation.args.indexOf('-File'), invocation.args.indexOf('-File') + 2), ['-File', script])
  for (const [flag, path] of [['-ProgramDirectory', environment.programDirectory], ['-DataDirectory', environment.dataDirectory], ['-BackupDirectory', environment.backupDirectory]]) {
    assert.deepEqual(invocation.args.slice(invocation.args.indexOf(flag), invocation.args.indexOf(flag) + 2), [flag, path])
  }
})

test('installer failure diagnostics preserve Ukrainian text through an ASCII-safe UTF-8 marker', async () => {
  const message = 'Перевірка конфігурації сервера не пройшла: каталог недоступний.'
  const payload = { stage: 'validate-server-preflight', type: 'System.Exception', line: 361, hresult: -2146233088, childExitCode: null, detailFile: 'HromadaAID-service-install-test.json', detailWritten: true, message }
  const marker = `HROMADAAID_INSTALL_ERROR_B64|${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')}`
  assert.deepEqual(parseInstallerDiagnostic(marker), payload)
  assert.equal(parseInstallerDiagnostic('HROMADAAID_INSTALL_ERROR_B64|not valid!'), null)
  const script = await readFile(join(process.cwd(), 'packaging/install-server-service.ps1'), 'utf8')
  assert.match(script, /\[Console\]::OutputEncoding = \$utf8Output/)
  assert.match(script, /HROMADAAID_INSTALL_ERROR_B64\|\$encodedDiagnostic/)
})

test('Windows PowerShell 5.1 emits parseable Ukrainian structured install diagnostics', { skip: process.platform !== 'win32' }, () => {
  const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const script = String.raw`$utf8Output=[Text.UTF8Encoding]::new($false);[Console]::OutputEncoding=$utf8Output;$diagnostic=[ordered]@{stage='validate-server-preflight';type='System.Exception';line=361;hresult=-2146233088;childExitCode=$null;detailFile='HromadaAID-test.json';detailWritten=$true;message='Перевірка конфігурації сервера не пройшла: каталог недоступний.'}|ConvertTo-Json -Compress;$encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($diagnostic));[Console]::Out.WriteLine("HROMADAAID_INSTALL_ERROR_B64|$encoded")`
  const result = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  const parsed = parseInstallerDiagnostic(result.stdout)
  assert.equal(parsed?.message, 'Перевірка конфігурації сервера не пройшла: каталог недоступний.')
})

test('existing service installer stops only after validations and keeps failures before transaction from stopping service', async () => {
  const source = (await readFile(join(process.cwd(), 'packaging/install-server-service.ps1'), 'utf8')).replace(/\r\n/g, '\n')
  const normal = source.slice(source.indexOf("\ntry {\n  Set-InstallStage 'validate-inputs'"))
  assert.ok(normal.indexOf("Set-InstallStage 'inspect-database-and-create-admin'") < normal.indexOf("Set-InstallStage 'stop-service'"))
  assert.ok(normal.indexOf("Set-InstallStage 'stop-service'") < normal.indexOf("Set-InstallStage 'prepare-package-journal'"))
  assert.match(source, /\$transactionStarted = .*\$previousServer.*\$failedServer.*\$newServiceRegistered/)
  assert.match(source, /if \(\$transactionStarted -and \$null -ne \$service/)
  const aclSetup = normal.indexOf("Set-AclChecked $DataDirectory")
  const aclGuard = normal.lastIndexOf('if (-not $hadOldPackage)', aclSetup)
  assert.ok(aclGuard > normal.indexOf("Set-InstallStage 'configure-acl'"))
  assert.ok(aclSetup < normal.indexOf("Set-InstallStage 'stop-service'"))
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
