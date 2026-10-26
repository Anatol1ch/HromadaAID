import test from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { activateServerPackage, preparePackageUpdate } from '../../packaging/server-package-transaction.mjs'
import { renderWinSWConfig } from '../../packaging/windows-installer-config.mjs'

const installer = fileURLToPath(new URL('../../packaging/install-server-service.ps1', import.meta.url))
const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const source = readFileSync(installer, 'utf8').replace(/\r\n/g, '\n')

test('Windows PowerShell 5.1 parses the recovery branch and preserves its administrator boundary', { skip: process.platform !== 'win32' }, () => {
  const script = `$tokens=$null;$errors=$null;[void][Management.Automation.Language.Parser]::ParseFile('${installer.replaceAll("'", "''")}',[ref]$tokens,[ref]$errors);if($errors.Count){$errors|ForEach-Object{[Console]::Error.WriteLine($_.Message)};exit 1}`
  execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true })
  const recovery = source.slice(source.indexOf('if ($RecoverUpdate) {'), source.indexOf("\ntry {\n  Set-InstallStage 'validate-inputs'"))
  assert.ok(recovery.indexOf('WindowsBuiltInRole]::Administrator') < recovery.indexOf('recover-rollback'))
  assert.doesNotMatch(recovery, /^\s*(Configure-ServiceAccess|Set-AclChecked|initialize|createAdministrator)\b/m)
})

test('recovery restarts the verified active wrapper before accepting health from that package', { skip: process.platform !== 'win32' }, () => {
  const helper = source.slice(source.indexOf('function Start-RecoveredPackage {'), source.indexOf('function Assert-RecoveryServiceIdentity {'))
  const script = `
$ErrorActionPreference='Stop';$activeServer='C:\\synthetic-only\\Server';$serviceName='HromadaAIDApi';$settings=@{};$database='C:\\synthetic-only\\no-database';$script:present=$true;$script:trace=@()
function Get-RecoveryService { if($script:present){return [pscustomobject]@{Status='Running'}};return $null }
function Get-ItemProperty { return [pscustomobject]@{ImagePath=(Join-Path $activeServer 'service\\HromadaAIDService.exe')} }
function Unregister-ServiceIfPresent { $script:trace+='unregister';$script:present=$false }
function Register-Service { $script:trace+='register';$script:present=$true }
function Get-ServiceSid { return 'S-1-5-80-synthetic' }
function Assert-ServiceAccess { $script:trace+='acl-check' }
function Get-Service { return [pscustomobject]@{Status='Stopped'} }
function Invoke-Checked { $script:trace+='start' }
function Get-HealthUrl { return 'http://127.0.0.1:1/health' }
function Wait-ServiceHealthy([string]$Url,[int]$Seconds,[bool]$AllowMaintenance){$script:trace+="health:$AllowMaintenance"}
${helper}
Start-RecoveredPackage
[Console]::Out.WriteLine(($script:trace|ConvertTo-Json -Compress))
`
  const output = execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, encoding: 'utf8' })
  assert.deepEqual(JSON.parse(output.trim()), ['unregister', 'register', 'acl-check', 'start', 'health:False'])
})

for (const scenario of ['finalize', 'rollback', 'rollback-health-fails', 'ambiguous', 'scm-unavailable']) {
  test(`real PowerShell recovery orchestration and Node renames: ${scenario} (mock SCM/health, synthetic database)`, { skip: process.platform !== 'win32' }, () => {
    const root = mkdtempSync(join(tmpdir(), 'Hromada recovery перевірка '))
    try {
      const programDirectory = join(root, 'program'), dataDirectory = join(root, 'data'), backupDirectory = join(root, 'backups')
      for (const path of [programDirectory, dataDirectory, backupDirectory]) mkdirSync(path)
      mkdirSync(join(dataDirectory, 'Database'))
      const databasePath = join(dataDirectory, 'Database', 'hromada-aid.sqlite')
      writeFileSync(databasePath, 'database sentinel'); writeFileSync(join(backupDirectory, 'existing.hraid'), 'archive sentinel'); writeFileSync(join(backupDirectory, '.hromadaaid-backup-key.dpapi'), 'key sentinel')
      const options = { mode: 'server', programDirectory, dataDirectory, backupDirectory }
      writeFileSync(join(dataDirectory, 'server.json'), JSON.stringify({ ...options, databasePath, host: '127.0.0.1', port: 4310 }))
      for (const [name, content] of [['Server', 'old'], ['Server.next', 'new']]) {
        const folder = join(programDirectory, name)
        mkdirSync(join(folder, 'runtime'), { recursive: true }); mkdirSync(join(folder, 'service')); mkdirSync(join(folder, 'app', 'dist', 'electron'), { recursive: true })
        linkSync(process.execPath, join(folder, 'runtime', 'node.exe'))
        writeFileSync(join(folder, 'app.txt'), content)
        writeFileSync(join(folder, 'app', 'dist', 'electron', 'database.js'), 'version: 28')
        const template = '__PROGRAM_DIRECTORY__ __DATA_DIRECTORY__ __BACKUP_DIRECTORY__'
        writeFileSync(join(folder, 'service', 'HromadaAIDService.xml.template'), template)
        writeFileSync(join(folder, 'service', 'HromadaAIDService.xml'), renderWinSWConfig(template, options))
        writeFileSync(join(folder, 'package-integrity.json'), JSON.stringify({ formatVersion: 1, files: [{ path: 'app.txt', sizeBytes: content.length, sha256: createHash('sha256').update(content).digest('hex') }] }))
      }
      preparePackageUpdate({ programDirectory, dataDirectory, hadPreviousPackage: true, oldSchemaMaximum: 28, schemaBeforeActivation: 28, serviceWasRunning: true })
      activateServerPackage({ programDirectory, dataDirectory })
      if (scenario === 'ambiguous') { mkdirSync(join(programDirectory, 'Server.failed')); writeFileSync(join(programDirectory, 'Server.failed', 'package-integrity.json'), 'unrecognized') }
      for (const file of ['server-package-transaction.mjs', 'windows-installer-config.mjs']) copyFileSync(join(dirname(installer), file), join(root, file))
      const verifier = pathToFileURL(join(dirname(installer), 'verify-server-package.mjs')).href
      writeFileSync(join(root, 'verifier.mjs'), `import {verifyServerPackage} from ${JSON.stringify(verifier)};await verifyServerPackage(process.argv[2]);`)
      const mocks = `
# Only the native service/account boundary is mocked. No service is installed,
# stopped or modified; the real transaction module performs the file operations.
function Assert-RecoveryPackage([string]$Root) { Invoke-Checked (Join-Path $Root 'runtime\\node.exe') @((Join-Path $PSScriptRoot 'verifier.mjs'), $Root) 'Fixture integrity failure' }
function Assert-RecoveryServiceIdentity { if ('${scenario}' -eq 'scm-unavailable') { [void](Get-RecoveryService) } }
$script:MockServiceExists = $true
function Get-Service { throw 'Native SCM must never be queried by this test' }
function Get-RecoveryService { if ('${scenario}' -eq 'scm-unavailable') { throw 'Synthetic SCM access failure' }; if ($script:MockServiceExists) { return [pscustomobject]@{Status='Stopped'} }; return $null }
function Unregister-ServiceIfPresent { $script:MockServiceExists=$false; [IO.File]::AppendAllText((Join-Path $PSScriptRoot 'trace'), "unregister\n") }
function Get-DatabaseStatus { return [pscustomobject]@{schemaVersion=28;users='present'} }
function Start-RecoveredPackage {
  $kind=[IO.File]::ReadAllText((Join-Path $activeServer 'app.txt'))
  [IO.File]::AppendAllText((Join-Path $PSScriptRoot 'trace'), "health-$kind\n")
  if ($kind -eq 'new' -and '${scenario}' -ne 'finalize') { throw 'Synthetic candidate health failure' }
  if ($kind -eq 'old' -and '${scenario}' -eq 'rollback-health-fails') { throw 'Synthetic previous health failure' }
}
`
      const branch = source.indexOf('\nif ($RecoverUpdate) {')
      const normal = source.indexOf("\ntry {\n  Set-InstallStage 'validate-inputs'")
      // Tests do not require elevation. Production's role check remains intact
      // and is asserted by the preceding parser/boundary test.
      const code = (source.slice(0, branch) + mocks + source.slice(branch, normal)).replace(/if \(-not \$principal\.IsInRole\(\[Security\.Principal\.WindowsBuiltInRole\]::Administrator\)\) \{ throw '[^']*' \}/g, '# Test process: no native operations; elevation boundary separately checked.')
      writeFileSync(join(root, 'recovery.ps1'), code)
      const result = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'recovery.ps1'), '-ProgramDirectory', programDirectory, '-DataDirectory', dataDirectory, '-BackupDirectory', backupDirectory, '-RecoverUpdate'], { windowsHide: true, encoding: 'utf8', timeout: 30_000 })
      if (['finalize', 'rollback'].includes(scenario)) {
        assert.equal(result.status, 0, result.stderr + result.stdout)
        assert.equal(readFileSync(join(programDirectory, 'Server', 'app.txt'), 'utf8'), scenario === 'finalize' ? 'new' : 'old')
        assert.equal(existsSync(join(dataDirectory, '.hromadaaid-update-state.json')), false)
        assert.match(result.stdout, scenario === 'finalize' ? /RECOVERY_OUTCOME\|finalized/ : /RECOVERY_OUTCOME\|rolled-back/)
      } else {
        assert.equal(result.status, 1)
        assert.ok(existsSync(join(dataDirectory, '.hromadaaid-update-state.json')))
        assert.ok(existsSync(join(programDirectory, ['ambiguous', 'scm-unavailable'].includes(scenario) ? 'Server.previous' : 'Server.failed')))
      }
      if (scenario === 'rollback') assert.match(readFileSync(join(root, 'trace'), 'utf8'), /health-new\nunregister\nhealth-old/)
      assert.equal(readFileSync(databasePath, 'utf8'), 'database sentinel')
      assert.equal(readFileSync(join(backupDirectory, 'existing.hraid'), 'utf8'), 'archive sentinel')
      assert.equal(readFileSync(join(backupDirectory, '.hromadaaid-backup-key.dpapi'), 'utf8'), 'key sentinel')
    } finally { assert.ok(root.startsWith(join(tmpdir(), 'Hromada recovery перевірка '))); rmSync(root, { recursive: true, force: true }) }
  })
}
