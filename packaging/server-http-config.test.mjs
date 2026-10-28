import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { renderInstalledServerConfig, validateInstallerOptions } from './windows-installer-config.mjs'
import { prepareServerInstall } from './prepare-server-install.mjs'
import { readInstalledServerConfig } from '../dist-server/server/src/config.js'

const windows = process.platform === 'win32'
const serviceScript = readFileSync(new URL('./install-server-service.ps1', import.meta.url), 'utf8')
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'hraid-http-config-'))
  const paths = { mode: 'server', programDirectory: join(root, 'program'), dataDirectory: join(root, 'data'), backupDirectory: join(root, 'backups') }
  for (const dir of [paths.programDirectory, paths.dataDirectory, paths.backupDirectory]) mkdirSync(dir)
  return { root, paths }
}
const obsolete = [{ configVersion: 1 }, { configVersion: 2 }, { configVersion: '3' }, { mode: 'local' }, { host: '0.0.0.0' }, { port: 4310 }, { tls: {} }, { unexpected: true }]

test('fresh server and combined installations generate the same current schema without SQLite or TLS', { skip: !windows }, () => {
  for (const mode of ['server', 'server-client']) {
    const { root, paths } = fixture()
    try {
      const options = { ...paths, mode }
      const rendered = JSON.parse(renderInstalledServerConfig(options))
      assert.deepEqual(rendered, { configVersion: 3, programDirectory: paths.programDirectory, databasePath: join(paths.dataDirectory, 'Database', 'hromada-aid.sqlite'), backupDirectory: paths.backupDirectory })
      const result = prepareServerInstall(options)
      assert.deepEqual(readInstalledServerConfig(result.configPath), rendered)
      assert.equal(existsSync(result.databasePath), false)
      assert.equal(existsSync(join(paths.backupDirectory, '.hromadaaid-backup-key.dpapi')), false)
      assert.throws(() => renderInstalledServerConfig({ ...options, host: '127.0.0.1' }), /не підтримуються/)
      assert.throws(() => renderInstalledServerConfig({ ...options, port: 4321 }), /не підтримуються/)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }
  const { root, paths } = fixture()
  try {
    assert.deepEqual(prepareServerInstall({ mode: 'client', programDirectory: paths.programDirectory }), { configured: false })
    assert.equal(existsSync(join(paths.dataDirectory, 'server.json')), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('incompatible schemas fail before preparation and preserve every persistent sentinel', { skip: !windows }, () => {
  const { root, paths } = fixture()
  try {
    const configPath = join(paths.dataDirectory, 'server.json')
    mkdirSync(join(paths.dataDirectory, 'Database')); mkdirSync(join(paths.dataDirectory, 'Logs'))
    const current = { configVersion: 3, programDirectory: paths.programDirectory, databasePath: join(paths.dataDirectory, 'Database', 'hromada-aid.sqlite'), backupDirectory: paths.backupDirectory }
    const sentinels = [current.databasePath, join(paths.dataDirectory, 'Logs', 'sentinel.log'), join(paths.backupDirectory, '.hromadaaid-backup-key.dpapi'), join(paths.backupDirectory, 'sentinel.hraid')]
    for (const path of sentinels) writeFileSync(path, 'synthetic persistent sentinel')
    for (const extra of obsolete) {
      const bytes = JSON.stringify({ ...current, ...extra })
      writeFileSync(configPath, bytes)
      assert.throws(() => validateInstallerOptions(paths), /Несумісна конфігурація/)
      assert.throws(() => prepareServerInstall(paths), /Несумісна конфігурація/)
      assert.throws(() => readInstalledServerConfig(configPath), /Несумісна/)
      assert.equal(readFileSync(configPath, 'utf8'), bytes)
      for (const path of sentinels) assert.equal(readFileSync(path, 'utf8'), 'synthetic persistent sentinel')
      assert.equal(existsSync(join(paths.programDirectory, 'Server')), false)
    }
    writeFileSync(configPath, JSON.stringify(current))
    assert.equal(validateInstallerOptions(paths).mode, 'server')
    prepareServerInstall(paths)
    for (const path of sentinels) assert.equal(readFileSync(path, 'utf8'), 'synthetic persistent sentinel')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('service install and recovery use only fixed loopback health and keep data and transaction guards', () => {
  assert.match(serviceScript, /\$apiHealthUrl = 'http:\/\/127\.0\.0\.1:4310\/health'/)
  assert.doesNotMatch(serviceScript, /Get-HealthUrl|\$settings\.(?:mode|host|port|tls)|TLS|tlsCertificate|tlsPrivateKey/)
  assert.match(serviceScript, /Assert-ServerConfiguration \$settings/)
  assert.match(serviceScript, /if \(-not \$configurationValidated\)[\s\S]*?exit 1/)
  assert.match(serviceScript, /-MaximumRedirection 0/)
  assert.match(serviceScript, /sidtype.*unrestricted/)
  assert.match(serviceScript, /oldSchemaMaximum|schemaVersion/)
  const nsis = readFileSync(new URL('./windows-installer.nsi', import.meta.url), 'utf8')
  assert.match(nsis, /Section "Клієнт HromadaAID"/)
  assert.match(nsis, /Section "API Server \+ Server Manager/)
  assert.match(nsis, /DataDirectory and BackupDirectory remain/)
})

test('Windows PowerShell service schema validation rejects obsolete formats without executing service commands', { skip: !windows }, () => {
  const path64 = Buffer.from(fileURLToPath(new URL('./install-server-service.ps1', import.meta.url)), 'utf8').toString('base64')
  const parseScript = `$path=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${path64}'));$tokens=$null;$errors=$null;[void][Management.Automation.Language.Parser]::ParseFile($path,[ref]$tokens,[ref]$errors);if($errors.Count){exit 12};exit 0`
  const parsed = spawnSync(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(parseScript, 'utf16le').toString('base64')], { windowsHide: true, timeout: 10_000, encoding: 'utf8' })
  assert.equal(parsed.error, undefined)
  assert.equal(parsed.status, 0, parsed.stderr)
  const extract = name => {
    const match = new RegExp(`^function ${name}[^]*?^}`, 'm').exec(serviceScript)
    assert.ok(match, name)
    return match[0]
  }
  const functions = ['Test-AbsoluteLocalPath', 'Assert-ServerConfiguration'].map(extract).join('\n')
  const current = { configVersion: 3, programDirectory: 'C:\\Program Files\\HromadaAID', databasePath: 'C:\\ProgramData\\HromadaAID\\Data\\Database\\hromada-aid.sqlite', backupDirectory: 'C:\\ProgramData\\HromadaAID\\Backups' }
  for (const extra of [{}, ...obsolete, { databasePath: 'relative.sqlite' }]) {
    const json = Buffer.from(JSON.stringify({ ...current, ...extra }), 'utf8').toString('base64')
    const script = `$ErrorActionPreference='Stop';${functions}\ntry { $settings = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${json}')) | ConvertFrom-Json; Assert-ServerConfiguration $settings; exit 0 } catch { exit 11 }`
    const result = spawnSync(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 10_000, encoding: 'utf8' })
    assert.equal(result.error, undefined)
    assert.equal(result.status, Object.keys(extra).length ? 11 : 0, result.stderr)
  }
})

test('actual NSIS preflight rejects incompatible config and preserves persistent files', { skip: !windows }, () => {
  const { root, paths } = fixture()
  try {
    const configPath = join(paths.dataDirectory, 'server.json')
    const databasePath = join(paths.dataDirectory, 'hromada-aid.sqlite')
    const keyPath = join(paths.backupDirectory, '.hromadaaid-backup-key.dpapi')
    const archivePath = join(paths.backupDirectory, 'sentinel.hraid')
    for (const path of [databasePath, keyPath, archivePath]) writeFileSync(path, 'synthetic sentinel')
    const current = { configVersion: 3, programDirectory: paths.programDirectory, databasePath, backupDirectory: paths.backupDirectory }
    const script = fileURLToPath(new URL('./windows-installer-paths.ps1', import.meta.url))
    for (const extra of [{}, { configVersion: 2 }, { mode: 'network' }, { tls: {} }]) {
      const config = JSON.stringify({ ...current, ...extra })
      writeFileSync(configPath, config)
      const result = spawnSync(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Mode', 'server', '-ProgramDirectory', paths.programDirectory, '-DataDirectory', paths.dataDirectory, '-BackupDirectory', paths.backupDirectory, '-ClientBytes', '0', '-ServerBytes', '0', '-SupportBytes', '0'], { windowsHide: true, timeout: 15_000, encoding: 'utf8' })
      assert.equal(result.error, undefined)
      assert.equal(result.status, Object.keys(extra).length ? 5 : 0, result.stdout + result.stderr)
      if (Object.keys(extra).length) assert.match(result.stdout, /reason=config-incompatible/)
      assert.equal(readFileSync(configPath, 'utf8'), config)
      for (const path of [databasePath, keyPath, archivePath]) assert.equal(readFileSync(path, 'utf8'), 'synthetic sentinel')
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})
