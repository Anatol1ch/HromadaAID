import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const { prepareServerUpdate, applyServerUpdate, verifyUpdatePackage } = await import('../../dist-server-manager/main/server-update.js')
const { createWindowsServerUpdateAdapters } = await import('../../dist-server-manager/main/windows-server-update.js')
const version = JSON.parse(await readFile('package.json', 'utf8')).version
const productionZip = process.env.HROMADAAID_TEST_SERVER_ZIP ?? join(process.cwd(), 'release', `HromadaAID-Server-v${version}-win-x64.zip`)
// This is the actual legacy installer payload emitted by package-windows.mjs,
// not a reduced hand-written package or a new ZIP with metadata removed.
const legacySource = join(process.cwd(), 'release', 'installer-payload', 'Server')

async function setPackageVersion(root, nextVersion) {
  const appPackagePath = join(root, 'app', 'package.json')
  const appPackage = JSON.parse(await readFile(appPackagePath, 'utf8'))
  appPackage.version = nextVersion
  await writeFile(appPackagePath, JSON.stringify(appPackage))
  const integrityPath = join(root, 'package-integrity.json')
  const integrity = JSON.parse(await readFile(integrityPath, 'utf8'))
  for (const entry of integrity.files) {
    const bytes = await readFile(join(root, ...entry.path.split('/')))
    entry.sizeBytes = bytes.length
    entry.sha256 = createHash('sha256').update(bytes).digest('hex')
  }
  await writeFile(integrityPath, JSON.stringify(integrity))
  const componentPath = join(root, 'package-manifest.json')
  if (existsSync(componentPath)) {
    const component = JSON.parse(await readFile(componentPath, 'utf8'))
    component.version = nextVersion
    for (const entry of component.files) {
      const bytes = await readFile(join(root, ...entry.path.split('/')))
      entry.sizeBytes = bytes.length
      entry.sha256 = createHash('sha256').update(bytes).digest('hex')
    }
    await writeFile(componentPath, JSON.stringify(component))
  }
}

test('production legacy and component packages update and roll back using bundled Node and real file transactions, with mock SCM', {
  skip: process.platform !== 'win32' ? 'Requires Windows production runtime' : !existsSync(productionZip) || !existsSync(legacySource) ? 'Build the Windows payload and set HROMADAAID_TEST_SERVER_ZIP' : false,
}, async t => {
  assert.equal(existsSync(join(legacySource, 'package-manifest.json')), false, 'Fixture must be the real integrity-only installer payload')
  const root = await mkdtemp(join(tmpdir(), 'HromadaAID legacy update інтеграція '))
  t.after(() => rm(root, { recursive: true, force: true }))
  const windows = createWindowsServerUpdateAdapters()
  const modernSource = join(root, 'source', 'package')
  await windows.extract(productionZip, modernSource)
  await verifyUpdatePackage(modernSource)
  const candidateFile = join(modernSource, 'app', 'dist', 'server', 'src', 'installed.js')
  const candidateBytes = await readFile(candidateFile)
  await writeFile(candidateFile, 'damaged candidate')
  await assert.rejects(verifyUpdatePackage(modernSource), { code: 'PACKAGE_HASH_MISMATCH' })
  await writeFile(candidateFile, candidateBytes)
  const componentPath = join(modernSource, 'package-manifest.json'), componentBytes = await readFile(componentPath)
  await rm(componentPath)
  await assert.rejects(verifyUpdatePackage(modernSource), { code: 'PACKAGE_MANIFEST_MISSING' })
  await writeFile(componentPath, componentBytes)
  const serviceInstaller = await readFile('packaging/install-server-service.ps1', 'utf8')
  const transactionFunction = serviceInstaller.slice(serviceInstaller.indexOf('function Invoke-PackageTransaction('), serviceInstaller.indexOf('function Get-SupportedSchemaMaximum('))
  assert.match(serviceInstaller, /Invoke-PackageTransaction \$rollbackToolRoot 'finalize-rollback' @\(\) \(Join-Path \$activeServer 'runtime\\node.exe'\)/)
  const candidateVersion = `${Number(version.split('.')[0])}.${Number(version.split('.')[1])}.${Number(version.split('.')[2]) + 1}`
  await setPackageVersion(modernSource, candidateVersion)
  await verifyUpdatePackage(modernSource)

  function run(node, args, cwd, input) {
    const result = spawnSync(node, args, { cwd, input, encoding: 'utf8', windowsHide: true, timeout: 120_000 })
    assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message)
    return result.stdout
  }

  for (const format of ['legacy', 'component']) for (const outcome of ['preparation', 'rollback', 'success']) {
    await t.test(`${format}: ${outcome}`, async () => {
      const folder = join(root, `${format}-${outcome}`), programDirectory = join(folder, 'Program'), dataDirectory = join(folder, 'Data'), backupDirectory = join(folder, 'Backups')
      const active = join(programDirectory, 'Server'), stage = join(programDirectory, 'Server.next')
      await cp(format === 'legacy' ? legacySource : modernSource, active, { recursive: true })
      await mkdir(join(dataDirectory, 'Database'), { recursive: true }); await mkdir(backupDirectory, { recursive: true })
      const databasePath = join(dataDirectory, 'Database', 'hromada-aid.sqlite'), configPath = join(dataDirectory, 'server.json'), keyPath = join(backupDirectory, '.hromadaaid-backup-key.dpapi')
      const environment = { programDirectory, dataDirectory, backupDirectory, databasePath, serverVersion: version, apiContractVersion: 1, serviceStatus: 'running' }
      const node = join(active, 'runtime', 'node.exe'), app = join(active, 'app')
      const initialize = `import {join} from 'node:path';import {pathToFileURL} from 'node:url';const {initializeInstalledServerDatabase}=await import(pathToFileURL(join(process.argv[1],'app/dist/server/src/database.js')).href);initializeInstalledServerDatabase(process.argv[2]);`
      run(node, ['--input-type=module', '--eval', initialize, active, databasePath], app)
      const password = 'Synthetic update fixture password'
      run(node, [join(app, 'dist', 'server', 'src', 'create-admin.js'), '--database', databasePath, '--installer-stdin'], app, JSON.stringify({ displayName: 'Тестовий адміністратор', username: 'test-admin', password, confirmation: password }) + '\n')
      await writeFile(keyPath, 'synthetic protected-key sentinel, no real DPAPI key')
      await writeFile(configPath, JSON.stringify({ configVersion: 2, mode: 'local', programDirectory, databasePath, backupDirectory, host: '127.0.0.1', port: 4310 }))
      const { prepareServerInstall } = await import(pathToFileURL(join(active, 'installer', 'prepare-server-install.mjs')).href)
      prepareServerInstall({ mode: 'server', programDirectory, dataDirectory, backupDirectory, packageRoot: active }, active)
      const preserved = await Promise.all([databasePath, configPath, keyPath].map(path => readFile(path)))
      const originalIdentity = await windows.readActivePackageIdentity(environment)
      assert.equal(existsSync(join(active, 'package-manifest.json')), format === 'component')
      assert.equal(await windows.readCurrentSchema(environment), 28)
      if (outcome === 'success') {
        const file = join(active, 'app', 'dist', 'server', 'src', 'installed.js'), bytes = await readFile(file)
        await writeFile(file, 'damaged installed program')
        await assert.rejects(windows.readActivePackageIdentity(environment))
        await writeFile(file, bytes)
        const integrityPath = join(active, 'package-integrity.json'), integrityBytes = await readFile(integrityPath)
        const integrity = JSON.parse(integrityBytes.toString('utf8'))
        integrity.files = integrity.files.filter(entry => entry.path !== 'runtime/node.exe')
        await writeFile(integrityPath, JSON.stringify(integrity))
        await assert.rejects(windows.readActivePackageIdentity(environment), { code: 'INSTALLED_PACKAGE_INVALID' })
        await writeFile(integrityPath, integrityBytes)
        if (format === 'component') {
          const file = join(active, 'package-manifest.json'), bytes = await readFile(file)
          await writeFile(file, '{malformed component metadata')
          await assert.rejects(windows.readActivePackageIdentity(environment), { code: 'INSTALLED_PACKAGE_INVALID' })
          await writeFile(file, bytes)
        }
      }
      let service = 'running', installedVersion = version
      const sequence = []
      const io = {
        ...windows,
        extract: async (_zipPath, destination) => cp(modernSource, destination, { recursive: true }),
        inspect: async () => ({ installation: { status: 'installed' }, service: { status: service }, api: { status: service === 'running' ? 'available' : 'unavailable', contractVersion: 1 }, configuration: { ...environment, serverVersion: installedVersion }, discovery: { confidence: 'confirmed' } }),
        prepare: async (...args) => { await windows.prepare(...args); sequence.push('prepared'); if (outcome === 'preparation') throw new Error('Synthetic failure before service control') },
        runInstaller: async (_environment, report) => {
          // Real packaged transaction CLI, no SCM/ACL/DPAPI operations.
          const transaction = (packageRoot, action, extra = []) => run(join(packageRoot, 'runtime', 'node.exe'), [join(packageRoot, 'installer', 'server-package-transaction.mjs'), action, '--program-dir', programDirectory, '--data-dir', dataDirectory, ...extra], folder)
          sequence.push('stop'); service = 'stopped'; report('stop', 'Mock SCM: stopped')
          transaction(stage, 'prepare', ['--had-previous', 'true', '--old-schema', '28', '--schema-before', '28', '--service-was-running', 'true'])
          transaction(stage, 'activate'); installedVersion = candidateVersion; sequence.push('switch'); report('switch', 'Real file transaction')
          transaction(active, 'health-check'); sequence.push('start'); service = 'running'; report('health', 'Mock API health')
          if (outcome === 'rollback') {
            service = 'stopped'; transaction(active, 'rollback', ['--schema-version', '28'])
            service = 'running'; installedVersion = version
            // Execute the real PowerShell transaction wrapper only (no service/ACL
            // functions) and its actual finalize-rollback invocation in isolation.
            const encode = value => Buffer.from(value, 'utf8').toString('base64')
            const finalizer = `$ErrorActionPreference='Stop';$ProgramDirectory=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(programDirectory)}'));$DataDirectory=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(dataDirectory)}'));\n${transactionFunction}\n$activeServer=Join-Path $ProgramDirectory 'Server';$rollbackToolRoot=Join-Path $ProgramDirectory 'Server.failed';Invoke-PackageTransaction $rollbackToolRoot 'finalize-rollback' @() (Join-Path $activeServer 'runtime\\node.exe')`
            run(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(finalizer, 'utf16le').toString('base64')], folder)
            throw Object.assign(new Error('Synthetic health failure; previous package restored'), { rollbackConfirmed: true })
          }
          transaction(active, 'healthy'); transaction(active, 'finalize')
        },
      }
      const prepared = await prepareServerUpdate(productionZip, io)
      assert.equal(prepared.activePackageIdentity, originalIdentity)
      const result = await applyServerUpdate(prepared, io, `${format}-${outcome}`, () => undefined)
      assert.equal(result.manualRecoveryRequired, false, result.details || result.message)
      assert.equal(result.success, outcome === 'success', result.details || result.message)
      assert.equal(result.rolledBack, outcome === 'rollback')
      assert.deepEqual(sequence, outcome === 'preparation' ? ['prepared'] : ['prepared', 'stop', 'switch', 'start'])
      assert.equal(service, 'running')
      assert.deepEqual(await Promise.all([databasePath, configPath, keyPath].map(path => readFile(path))), preserved)
      assert.equal(existsSync(join(dataDirectory, '.hromadaaid-update-state.json')), false)
      assert.equal(existsSync(join(programDirectory, 'Server.previous')), false)
      assert.equal(existsSync(join(programDirectory, 'Server.failed')), false)
      if (outcome !== 'success') {
        assert.equal(await windows.readActivePackageIdentity(environment), originalIdentity)
        assert.equal(existsSync(join(active, 'package-manifest.json')), format === 'component', 'Legacy metadata must never be fabricated')
      } else assert.equal(existsSync(join(active, 'package-manifest.json')), true)
    })
  }
})
