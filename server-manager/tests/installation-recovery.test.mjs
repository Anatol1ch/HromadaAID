import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, stat, lstat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'
import { verifyServerPackage } from '../../packaging/verify-server-package.mjs'

const { inspectEnvironment } = await import('../../dist-server-manager/main/inspection-engine.js')
const { verifyInitialInstallCandidate, markInitialSetupReadiness } = await import('../../dist-server-manager/main/initial-setup.js')
const { runServerInstallation } = await import('../../dist-server-manager/main/installation-engine.js')
const { classifyLocatorFailure, locatorQueryScript } = await import('../../dist-server-manager/main/windows-inspection.js')
const presentation = ts.transpileModule(await readFile(new URL('../src/inspection-presentation.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
const { initialSetupAction } = await import(`data:text/javascript;base64,${Buffer.from(presentation).toString('base64')}`)

const { canResumeInitialInstallLayout, isInitialInstallRetryJournal } = await import('../../dist-server-manager/main/installation-recovery.js')
const program = 'D:\\Застосунки HromadaAID'
const valid = { formatVersion: 1, phase: 'initial-install-needs-review', programDirectory: program, hadPreviousPackage: false }

test('only a matching failed first-install journal authorizes retry over package files', () => {
  assert.equal(isInitialInstallRetryJournal(valid, program), true)
  assert.equal(isInitialInstallRetryJournal({ ...valid, programDirectory: 'E:\\Other' }, program), false)
  assert.equal(isInitialInstallRetryJournal({ ...valid, phase: 'new-package-active' }, program), false)
  assert.equal(isInitialInstallRetryJournal({ ...valid, hadPreviousPackage: true }, program), false)
  assert.equal(isInitialInstallRetryJournal(null, program), false)
})

test('partial first install can be retried from an active package only with its matching review journal', () => {
  const base = { retryJournal: true, stagedPackageExists: false, activePackageExists: true, previousPackageExists: false, failedPackageExists: false }
  assert.equal(canResumeInitialInstallLayout(base), true)
  assert.equal(canResumeInitialInstallLayout({ ...base, retryJournal: false }), false)
  assert.equal(canResumeInitialInstallLayout({ ...base, previousPackageExists: true }), false)
  assert.equal(canResumeInitialInstallLayout({ ...base, activePackageExists: false }), false)
  assert.equal(canResumeInitialInstallLayout({ ...base, stagedPackageExists: true }), true)
  assert.equal(canResumeInitialInstallLayout({ ...base, retryJournal: false, stagedPackageExists: true, activePackageExists: false }), true)
})

test('fresh staged installation accepts different existing empty data and backup directories', async t => {
  const f = await stagedFixture(t)
  const dataDirectory = join(dirname(f.dataDirectory), 'Selected Data')
  const backupDirectory = join(dirname(f.backupDirectory), 'Selected Backups')
  await mkdir(dataDirectory, { recursive: true }); await mkdir(backupDirectory, { recursive: true })
  const request = { ...f.request, dataDirectory, backupDirectory }
  assert.equal(await f.verify(request), true, 'the NSIS locator defaults must not override the Manager wizard choices')

  let preflightRequest
  await runServerInstallation(request, {
    inspect: f.inspect, canResume: f.verify,
    preflight: async value => { preflightRequest = value }, stagePackage: async () => {}, prepareConfiguration: async () => {}, recordLocator: async () => {},
    initialize: async () => {}, databaseStatus: async () => ({ users: 'present' }), hasPendingAdminMarker: async () => false,
    createAdministrator: async () => assert.fail('Existing administrator must not be replaced'), installService: async () => {},
  }, 'custom-paths', () => {}, async () => true)
  assert.equal(preflightRequest.dataDirectory, dataDirectory)
  assert.equal(preflightRequest.backupDirectory, backupDirectory)
})

test('custom first-install paths remain blocked when selected or locator data directories contain files', async t => {
  const f = await stagedFixture(t)
  const selectedData = join(dirname(f.dataDirectory), 'Selected Data')
  const selectedBackups = join(dirname(f.backupDirectory), 'Selected Backups')
  await mkdir(selectedData, { recursive: true }); await mkdir(selectedBackups, { recursive: true })
  const selectedDatabase = join(selectedData, 'Database', 'hromada-aid.sqlite')
  await mkdir(dirname(selectedDatabase), { recursive: true }); await writeFile(selectedDatabase, 'synthetic database sentinel')
  await assert.rejects(f.verify({ ...f.request, dataDirectory: selectedData, backupDirectory: selectedBackups }), { code: 'INSTALL_DIRECTORY_NOT_EMPTY' })
  assert.equal(await readFile(selectedDatabase, 'utf8'), 'synthetic database sentinel')

  const h = await stagedFixture(t)
  const protectedBackups = join(dirname(h.backupDirectory), 'Selected Backups')
  await mkdir(protectedBackups, { recursive: true })
  const archive = join(protectedBackups, 'existing.hraid')
  await writeFile(archive, 'synthetic archive sentinel')
  await assert.rejects(h.verify({ ...h.request, dataDirectory: join(dirname(h.dataDirectory), 'Selected Data'), backupDirectory: protectedBackups }), { code: 'INSTALL_DIRECTORY_NOT_EMPTY' })
  assert.equal(await readFile(archive, 'utf8'), 'synthetic archive sentinel')

  const g = await stagedFixture(t)
  const locatorConfig = join(g.dataDirectory, 'server.json')
  await mkdir(g.dataDirectory, { recursive: true }); await writeFile(locatorConfig, 'synthetic existing configuration')
  await assert.rejects(g.verify({ ...g.request, dataDirectory: join(dirname(g.dataDirectory), 'Selected Data'), backupDirectory: join(dirname(g.backupDirectory), 'Selected Backups') }), { code: 'INSTALL_DIRECTORY_NOT_EMPTY' })
  assert.equal(await readFile(locatorConfig, 'utf8'), 'synthetic existing configuration')
})

async function stagedFixture(t, source = 'standard_locations') {
  const root = await mkdtemp(join(tmpdir(), 'hromada-initial-setup-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const programFiles = join(root, 'Program Files')
  const programData = join(root, 'ProgramData')
  const programDirectory = join(programFiles, 'HromadaAID')
  const dataDirectory = join(programData, 'HromadaAID', 'Data')
  const backupDirectory = join(programData, 'HromadaAID', 'Backups')
  const stage = join(programDirectory, 'Server.next')
  const files = {
    'runtime/node.exe': 'fixture runtime, never executed',
    'service/HromadaAIDService.exe': 'fixture wrapper, never executed',
    'service/HromadaAIDService.xml.template': '<service/>',
    'installer/verify-server-package.mjs': 'fixture verifier, never executed',
    'app/dist/server/src/installed.js': 'fixture entrypoint, never executed',
    'app/node_modules/fastify/package.json': '{}',
    'app/node_modules/argon2/package.json': '{}',
    'app/node_modules/@phc/format/package.json': '{}',
    'app/package.json': JSON.stringify({ version: '0.1.0' }),
  }
  const records = []
  for (const [path, bytes] of Object.entries(files)) {
    const target = join(stage, ...path.split('/'))
    await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes)
    records.push({ path, sizeBytes: Buffer.byteLength(bytes), sha256: createHash('sha256').update(bytes).digest('hex') })
  }
  await writeFile(join(stage, 'package-integrity.json'), JSON.stringify({ formatVersion: 1, files: records }))
  const adapter = {
    platform: 'win32', programFiles, programData,
    queryService: async () => ({ installed: false }),
    readInstallationLocator: async () => source === 'installer_registry' ? { status: 'available', programDirectory, dataDirectory, backupDirectory, writableByUnprivileged: false } : { status: 'missing' },
    exists: async path => { try { await stat(path); return true } catch (error) { if (['ENOENT', 'ENOTDIR'].includes(error.code)) return false; throw error } },
    readText: path => readFile(path, 'utf8'),
    probeApi: async () => { throw Error('No API probe before service registration') },
    now: () => new Date('2026-10-25T12:00:00Z'),
  }
  let verifications = 0
  const inspect = () => inspectEnvironment(adapter)
  const verify = request => verifyInitialInstallCandidate(request, {
    inspect, payloadRoot: () => stage,
    verifyPackageCopy: async (sourceRoot, candidate) => {
      verifications++
      assert.deepEqual(await readFile(join(sourceRoot, 'package-integrity.json')), await readFile(join(candidate, 'package-integrity.json')))
      // Real hash/path verifier; only Windows SCM and runtime execution are mocked.
      await verifyServerPackage(candidate)
    },
  })
  const ready = async () => { const result = await inspect(); await markInitialSetupReadiness(result, verify); return result }
  const request = { programDirectory, dataDirectory, backupDirectory, host: '127.0.0.1', port: 4310, administrator: { displayName: 'Synthetic', username: 'synthetic', password: 'synthetic', confirmation: 'synthetic' } }
  return { stage, programDirectory, dataDirectory, backupDirectory, adapter, inspect, ready, verify, request, verifications: () => verifications }
}

for (const source of ['standard_locations', 'installer_registry']) test(`clean Windows stage-only package opens the existing wizard via ${source}`, { skip: process.platform !== 'win32' }, async t => {
  const f = await stagedFixture(t, source)
  const result = await f.ready()
  assert.equal(result.discovery.source, source)
  assert.equal(result.service.status, 'missing')
  assert.equal(result.checks.find(item => item.id === 'configuration').details, 'config_missing')
  assert.equal(result.checks.find(item => item.id === 'package').status, 'passed')
  assert.equal(result.configuration.dataDirectory, f.dataDirectory)
  assert.equal(result.installation.status, 'ready_to_configure')
  assert.equal(initialSetupAction(result), 'Налаштувати сервер')
  assert.equal(f.verifications(), 1)
  await assert.rejects(lstat(f.dataDirectory), { code: 'ENOENT' }, 'Discovery must not create data directories')
  let installed = false
  let initialized = 0
  await runServerInstallation(f.request, {
    inspect: () => installed ? Promise.resolve({ installation: { status: 'installed' }, service: { status: 'running' }, api: { status: 'available' }, configuration: { serverVersion: '0.1.0', apiAddress: 'http://127.0.0.1:4310' } }) : f.inspect(),
    canResume: f.verify,
    preflight: async () => {}, stagePackage: async () => {}, prepareConfiguration: async () => {}, recordLocator: async () => {},
    initialize: async () => { initialized++ }, databaseStatus: async () => ({ users: 'present' }),
    hasPendingAdminMarker: async () => false, createAdministrator: async () => { throw Error('Existing administrator must not be replaced') },
    installService: async () => { installed = true },
  }, 'synthetic', () => {}, async () => true)
  assert.equal(initialized, 1)
  assert.equal(f.verifications(), 2, 'Critical checks must run again at execution, independent of button state')
})

test('incomplete, corrupt manifest and tampered staged packages cannot open the wizard', { skip: process.platform !== 'win32' }, async t => {
  for (const mode of ['empty', 'incomplete', 'manifest', 'hash']) {
    const f = await stagedFixture(t)
    if (mode === 'empty') { await rm(f.stage, { recursive: true }); await mkdir(f.stage) }
    if (mode === 'incomplete') await rm(join(f.stage, 'runtime/node.exe'))
    if (mode === 'manifest') await writeFile(join(f.stage, 'package-integrity.json'), '{broken')
    if (mode === 'hash') await writeFile(join(f.stage, 'app/dist/server/src/installed.js'), 'changed')
    const result = await f.ready()
    assert.equal(initialSetupAction(result), null)
    assert.equal(result.installation.status, 'partial_installation')
    if (mode === 'manifest' || mode === 'hash') assert.equal(result.checks.find(item => item.id === 'installation').diagnostics[0].operation, 'package.verify')
  }
})

test('pending update transaction, active Server and recovery artifacts block first setup', { skip: process.platform !== 'win32' }, async t => {
  for (const conflict of ['journal', 'Server', 'Server.previous', 'Server.failed']) {
    const f = await stagedFixture(t)
    if (conflict === 'journal') {
      await mkdir(f.dataDirectory, { recursive: true })
      await writeFile(join(f.dataDirectory, '.hromadaaid-update-state.json'), JSON.stringify({ phase: 'new-package-active' }))
    } else await mkdir(join(f.programDirectory, conflict))
    assert.equal(initialSetupAction(await f.ready()), null, conflict)
    assert.equal(f.verifications(), 0)
  }
})

test('SCM and locator errors block setup even when the staged package exists', { skip: process.platform !== 'win32' }, async t => {
  for (const code of ['access_denied', 'query_failed']) {
    const f = await stagedFixture(t)
    f.adapter.queryService = async () => ({ installed: false, error: code })
    assert.equal((await f.ready()).installation.status, 'unknown')
    assert.equal(initialSetupAction(await f.ready()), null)
    assert.equal(f.verifications(), 0)
  }
  const f = await stagedFixture(t)
  f.adapter.readInstallationLocator = async () => classifyLocatorFailure({ code: 'ETIMEDOUT' })
  const result = await f.ready()
  assert.equal(result.installation.status, 'unknown')
  assert.match(result.installation.message, /реєстрі/)
  assert.doesNotMatch(result.installation.message, /відмовила в доступі/)
  assert.equal(initialSetupAction(result), null)
})

test('filesystem failures retain operation/path/code and never leak raw exception content', { skip: process.platform !== 'win32' }, async t => {
  for (const code of ['EACCES', 'EPERM', 'EIO']) {
    const f = await stagedFixture(t)
    const target = join(f.stage, 'runtime/node.exe')
    const exists = f.adapter.exists
    f.adapter.exists = async path => { if (path === target) throw Object.assign(new Error('SECRET_PASSWORD=do-not-log'), { code }); return exists(path) }
    const result = await f.ready()
    assert.equal(result.installation.status, 'unknown')
    const diagnostic = result.checks.find(item => item.id === 'installation').diagnostics.find(item => item.target === target)
    assert.equal(diagnostic.operation, 'filesystem.stat'); assert.equal(diagnostic.code, code)
    assert.equal(initialSetupAction(result), null)
    assert.equal(/відмовила в доступі/.test(result.installation.message), code !== 'EIO')
    assert.doesNotMatch(JSON.stringify(result), /SECRET_PASSWORD|do-not-log/)
  }
})

test('a package changed after wizard availability is rejected again before any install mutation', { skip: process.platform !== 'win32' }, async t => {
  const f = await stagedFixture(t)
  assert.equal(initialSetupAction(await f.ready()), 'Налаштувати сервер')
  await writeFile(join(f.stage, 'app/dist/server/src/installed.js'), 'tampered after inspection')
  await assert.rejects(runServerInstallation(f.request, { inspect: f.inspect, canResume: f.verify, preflight: async () => assert.fail('Must not start filesystem mutations') }, 'synthetic', () => {}, async () => true), /цілісності/)
  assert.equal(f.verifications(), 2)
})

test('an installed service or arbitrary request directory never starts first setup', { skip: process.platform !== 'win32' }, async t => {
  const f = await stagedFixture(t)
  assert.equal(await f.verify({ ...f.request, programDirectory: join(f.programDirectory, 'Other') }), false)
  f.adapter.queryService = async () => ({ installed: true, state: 'Running', binaryPath: `"${join(f.programDirectory, 'Server/service/HromadaAIDService.exe')}"` })
  assert.equal(initialSetupAction(await f.ready()), null)
  assert.equal(await f.verify(f.request), false)
})

test('locator errors use structured HRESULT, not exception wording', () => {
  const denied = classifyLocatorFailure({ code: 13, stdout: JSON.stringify({ code: '0x80070005', operation: 'registry.acl' }) })
  assert.equal(denied.status, 'access_denied'); assert.equal(denied.diagnostic.code, '0x80070005')
  assert.equal(denied.diagnostic.operation, 'registry.acl')
  const other = classifyLocatorFailure({ code: 2, message: 'access denied SECRET', stdout: JSON.stringify({ code: '0x80004005', operation: 'registry.identity' }) })
  assert.equal(other.status, 'query_failed')
  assert.doesNotMatch(JSON.stringify(other), /SECRET/)
})

test('Windows registry read permissions are not mistaken for mutation permissions', { skip: process.platform !== 'win32' }, async () => {
  const source = await readFile(new URL('../electron/windows-inspection.ts', import.meta.url), 'utf8')
  const assignment = source.split(/\r?\n/).find(line => line.trim().startsWith('$writeMask ='))
  const script = `${assignment}; $rights = [System.Security.AccessControl.RegistryRights]; if (([System.Security.AccessControl.RegistryRights]::ReadKey -band $writeMask) -ne 0) { throw 'Read-only ACE treated as writable' }; foreach ($name in @('SetValue','CreateSubKey','Delete','ChangePermissions','TakeOwnership','FullControl')) { if (([Enum]::Parse($rights,$name) -band $writeMask) -eq 0) { throw $name } }; 'mask-ok'`
  assert.match(execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true }), /mask-ok/)
})

test('PowerShell 5.1 locator reads RegistryKey ACLs by SID, including unresolved accounts, without changing the registry', { skip: process.platform !== 'win32' }, () => {
  for (const writable of [false, true]) {
    const script = String.raw`
$security = New-Object System.Security.AccessControl.RegistrySecurity
$reader = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-545')
$unresolved = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-21-111111111-222222222-333333333-9999')
foreach ($sid in @($reader, $unresolved)) {
  $security.AddAccessRule((New-Object System.Security.AccessControl.RegistryAccessRule($sid, [System.Security.AccessControl.RegistryRights]::ReadKey, [System.Security.AccessControl.AccessControlType]::Allow)))
}
${writable ? "$security.AddAccessRule((New-Object System.Security.AccessControl.RegistryAccessRule($reader, [System.Security.AccessControl.RegistryRights]::SetValue, [System.Security.AccessControl.AccessControlType]::Allow)))" : ''}
$testKey = New-Object PSObject
$testKey | Add-Member -MemberType ScriptMethod -Name GetAccessControl -Value { return $security }
function Test-Path { return $true }
function Get-Item { return $testKey }
function Get-ItemProperty { return @{ ProgramDirectory='C:\Program Files\HromadaAID'; DataDirectory='C:\ProgramData\HromadaAID\Data'; BackupDirectory='C:\ProgramData\HromadaAID\Backups' } }
` + locatorQueryScript
    const result = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true }))
    assert.equal(result.status, 'available')
    assert.equal(result.writableByUnprivileged, writable)
  }
  // Read only a Windows built-in key. No test/project keys or permissions are created.
  const probe = String.raw`$ErrorActionPreference='Stop'; $key=Get-Item -LiteralPath 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE'; $acl=$key.GetAccessControl(); $null=$acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]); 'registry-acl-read-ok'`
  assert.match(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(probe, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true }), /registry-acl-read-ok/)
})
