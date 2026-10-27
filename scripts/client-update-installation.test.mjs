import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const launcher = fileURLToPath(new URL('../packaging/client-update-launcher.ps1', import.meta.url))
const literal = value => "'" + value.replaceAll("'", "''") + "'"
const cases = [
  { name: 'fresh marker and installed Client version confirm success', mode: 'success', success: true },
  { name: 'retained old marker never confirms the current attempt', mode: 'stale' },
  { name: 'exit zero without a marker is not success', mode: 'missing' },
  { name: 'wrong marker version is rejected', mode: 'wrong-marker' },
  { name: 'fresh marker with old installed EXE version is rejected', mode: 'wrong-exe' },
  { name: 'nonzero NSIS exit is rejected even with a fresh matching marker', mode: 'installer-error' },
  { name: 'UAC cancellation reports failure and restarts the original component once', mode: 'cancel' },
  { name: 'Setup launch failure is reported and restarts the original component once', mode: 'launch-error' },
  { name: 'restart failure preserves confirmed installation and reports a separate launcher failure', mode: 'restart-error', success: true, exitCode: 1, restarts: 0 },
  { name: 'unconfirmed parent termination starts neither Setup nor a duplicate Client', mode: 'parent-running' },
  { name: 'the shared launcher preserves Manager selective mode and version verification', mode: 'success', success: true, component: 'ServerManager' },
]

for (const scenario of cases) test(scenario.name, { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'hromada-install-result-'))
  try {
    const component = scenario.component ?? 'Client'
    const app = join(root, component), data = join(root, 'synthetic-data')
    await mkdir(app); await mkdir(data)
    const executable = join(app, 'component.exe'), setup = join(root, 'verified-setup.exe')
    const marker = join(app, component === 'Client' ? 'client-update-success.txt' : 'manager-update-success.txt')
    const log = join(root, 'installer-launcher.log'), waited = join(root, 'waited'), installs = join(root, 'installs'), restarts = join(root, 'restarts')
    await writeFile(executable, 'synthetic executable'); await writeFile(setup, 'synthetic setup')
    await writeFile(join(data, 'preserve.txt'), 'synthetic data must remain unchanged')
    const body = `
$executable = ${literal(executable)}
$setup = ${literal(setup)}
$marker = ${literal(marker)}
$waited = ${literal(waited)}
$testCase = ${literal(scenario.mode)}
if ($testCase -eq 'stale') { Set-Content -LiteralPath $marker -Value '0.1.1'; [IO.File]::SetLastWriteTimeUtc($marker, [DateTime]::UtcNow.AddHours(-1)) }
function Get-Process { if ($testCase -eq 'parent-running') { return [pscustomobject]@{ ProcessName = 'synthetic-parent' } }; return $null }
function Wait-Process { throw 'Synthetic unconfirmed parent termination' }
function Add-Type { throw 'GUI suppressed in this synthetic test' }
function Get-Item {
  param([string]$LiteralPath)
  if ($LiteralPath -eq $executable) { return [pscustomobject]@{ VersionInfo = [pscustomobject]@{ ProductVersion = $(if ($testCase -eq 'wrong-exe') { '0.1.0.0' } else { '0.1.1.0' }) } } }
  return Microsoft.PowerShell.Management\\Get-Item -LiteralPath $LiteralPath
}
function Remove-Item {
  [CmdletBinding()]param([string]$LiteralPath, [switch]$Force)
  if ($LiteralPath -eq $marker -and $testCase -eq 'stale') { throw 'Synthetic permission denial for an existing Program Files marker' }
  Microsoft.PowerShell.Management\\Remove-Item -LiteralPath $LiteralPath -Force:$Force -ErrorAction Stop
}
function Start-Process {
  param([string]$FilePath, [string[]]$ArgumentList, [string]$Verb, [switch]$PassThru, [string]$WorkingDirectory)
  if ($FilePath -eq $setup) {
    if ($Verb -ne 'RunAs' -or $ArgumentList.Count -ne 1 -or $ArgumentList[0] -ne '${component === 'Client' ? '/CLIENTUPDATE=1' : '/MANAGERUPDATE=1'}') { throw 'Incorrect selective UAC invocation' }
    Add-Content -LiteralPath ${literal(installs)} -Value 'attempt'
    if ($testCase -eq 'cancel') { throw [ComponentModel.Win32Exception]::new(1223) }
    if ($testCase -eq 'launch-error') { throw 'Synthetic Setup launch failure' }
    if ($testCase -notin @('stale', 'missing')) { Set-Content -LiteralPath $marker -Value $(if ($testCase -eq 'wrong-marker') { '0.1.0' } else { '0.1.1' }) }
    $process = [pscustomobject]@{ Id = 4321; Handle = 0; ExitCode = $(if ($testCase -eq 'installer-error') { 1603 } else { 0 }) }
    $process | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value { Set-Content -LiteralPath $waited -Value 'completed' }
    return $process
  }
  if ($FilePath -eq $executable) {
    if ($testCase -notin @('cancel','launch-error') -and !(Test-Path -LiteralPath $waited)) { throw 'Component restarted before Setup completion' }
    if ($testCase -eq 'restart-error') { throw 'Synthetic component launch failure' }
    Add-Content -LiteralPath ${literal(restarts)} -Value 'restart'
    return [pscustomobject]@{ Id = 9876 }
  }
  throw 'Unexpected process'
}
. ${literal(launcher)} -ProcessId 2147483647 -InstallerPath $setup -ApplicationExecutable $executable -ExpectedVersion '0.1.1' -LogPath ${literal(log)} -Component '${component}'
exit $LASTEXITCODE
`
    const harness = join(root, 'harness.ps1')
    await writeFile(harness, '\uFEFF' + body)
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', harness], { encoding: 'utf8', windowsHide: true, timeout: 15000 })
    assert.equal(result.status, scenario.exitCode ?? (scenario.success ? 0 : 1), result.stderr || result.stdout)
    const events = (await readFile(log, 'utf8')).replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
    assert.equal(events.some(event => event.stage === 'update-confirmed'), Boolean(scenario.success))
    const restartCount = scenario.restarts ?? (scenario.mode === 'parent-running' ? 0 : 1)
    assert.equal(events.filter(event => event.stage === 'application-restarted').length, restartCount)
    assert.equal((await readFile(restarts, 'utf8').catch(() => '')).trim().split(/\r?\n/).filter(Boolean).length, restartCount)
    if (scenario.mode === 'parent-running') await assert.rejects(readFile(installs))
    if (scenario.mode === 'stale') {
      assert.ok(events.some(event => event.stage === 'previous-marker-retained'))
      assert.ok(events.some(event => event.stage === 'installed-component-verified' && !event.details.freshMarker))
    }
    if (scenario.mode === 'wrong-exe') assert.ok(events.some(event => event.stage === 'installed-component-verified' && !event.details.versionMatches))
    if (scenario.mode === 'cancel') assert.ok(events.some(event => event.stage === 'launcher-error' && event.details.nativeErrorCode === 1223))
    if (scenario.mode === 'restart-error') assert.ok(events.some(event => event.stage === 'launcher-completed' && event.details.succeeded && event.details.restartFailed && event.details.exitCode === 1))
    assert.equal(await readFile(join(data, 'preserve.txt'), 'utf8'), 'synthetic data must remain unchanged')
  } finally { await rm(root, { recursive: true, force: true }) }
})
