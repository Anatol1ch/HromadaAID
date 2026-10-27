import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const installer = await readFile(new URL('../packaging/windows-installer.nsi', import.meta.url), 'utf8')
const launcher = await readFile(new URL('../packaging/client-update-launcher.ps1', import.meta.url), 'utf8')
const copyAssets = await readFile(new URL('../electron/copy-assets.mjs', import.meta.url), 'utf8')
const clientPackager = await readFile(new URL('../scripts/package-client-portable.mjs', import.meta.url), 'utf8')
const builderConfig = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

test('Client-only NSIS update bypasses component selection and never invokes server removal/update paths', () => {
  assert.match(installer, /Page custom ModePageCreate ModePageLeave "Вибір компонентів"/)
  assert.match(installer, /Function ModePageCreate[\s\S]*?ClientUpdateMode == "1"[\s\S]*?ManagerUpdateMode == "1"[\s\S]*?Abort[\s\S]*?nsDialogs::Create/)
  assert.match(installer, /Function DirectoryPagePre[\s\S]*?ClientUpdateMode == "1"[\s\S]*?Abort[\s\S]*?FunctionEnd/)
  assert.match(installer, /\$\{GetOptions\}\s+"\$CMDLINE"\s+"\/CLIENTUPDATE="\s+\$ClientUpdateMode/)
  assert.match(installer, /SectionSetFlags \$\{SEC_CLIENT\} \$\{SF_SELECTED\}[\s\S]*?SectionSetFlags \$\{SEC_SERVER\} 0[\s\S]*?Goto initDone/)
  assert.match(installer, /Section -RemoveDeselected[\s\S]*?ClientUpdateMode == "1"[\s\S]*?Goto removeDeselectedDone[\s\S]*?Call RemoveServerComponent/)
  assert.match(installer, /ClientUpdateMode == "1"[\s\S]*?InstalledComponents[\s\S]*?updateMetadataDone/)
  assert.match(installer, /FileOpen \$2 "\$INSTDIR\\Client\\client-update-success\.txt" "w"/)
  assert.doesNotMatch(installer, /^\s*Exec(?:Shell|Wait)?\s+[^\r\n]*HromadaAID\.exe/m, 'only the external launcher restarts Client')
})

test('external launcher logs installer lifecycle, uses UAC with the selective mode, checks exit status, and restarts safely', () => {
  assert.match(launcher, /Wait-Process -Id \$ProcessId -Timeout 600/)
  assert.match(launcher, /Start-Process -FilePath \$InstallerPath -ArgumentList @\(\$mode\) -Verb RunAs -PassThru/)
  assert.match(launcher, /installer-process-created/)
  assert.match(launcher, /\$process\.WaitForExit\(\)/)
  assert.match(launcher, /installer-process-exited/)
  assert.match(launcher, /launcher-error/)
  assert.match(launcher, /Write-UpdateLog 'update-confirmed'/)
  assert.match(launcher, /UAC скасовано/)
  assert.match(launcher, /Діагностика: \$LogPath/)
  assert.doesNotMatch(launcher, /Remove-Item[^\r\n]*InstallerPath/)
  assert.match(launcher, /ValidateSet\('Client','ServerManager'\)/)
  assert.match(launcher, /\$Component -eq 'Client'[\s\S]*?\/CLIENTUPDATE=1/)
  assert.match(launcher, /else \{ 'manager-update-success\.txt' \}/)
  assert.match(launcher, /client-update-success\.txt[\s\S]*\$exitCode -eq 0/)
  assert.match(launcher, /Start-Process -FilePath \$ApplicationExecutable/)
})

test('Manager-only NSIS mode replaces only Manager, preserves installation metadata and bypasses server/service work', () => {
  assert.match(installer, /\$\{GetOptions\} "\$CMDLINE" "\/MANAGERUPDATE=" \$ManagerUpdateMode/)
  assert.match(installer, /Section -ManagerOnlyUpdate[\s\S]*?SetOutPath "\$INSTDIR\\ServerManager\.next"[\s\S]*?File \/r "\$\{MANAGER_PAYLOAD\}\\\*"[\s\S]*?Rename "\$INSTDIR\\ServerManager\.next" "\$INSTDIR\\ServerManager"[\s\S]*?SectionEnd/)
  assert.match(installer, /managerPreviousPresent:[\s\S]*?ReadINIStr \$ManagerVersion[\s\S]*?Rename "\$INSTDIR\\ServerManager\.previous" "\$INSTDIR\\ServerManager"/)
  assert.match(installer, /ManagerUpdateMode == "1"[\s\S]*?InstalledComponents[\s\S]*?manager-update-success\.txt/)
  assert.match(installer, /Section -RemoveDeselected[\s\S]*?ClientUpdateMode == "1"[\s\S]*?ManagerUpdateMode == "1"[\s\S]*?Goto removeDeselectedDone/)
  const section = installer.slice(installer.indexOf('Section -ManagerOnlyUpdate'), installer.indexOf('Section -ProductBranding'))
  assert.doesNotMatch(section, /Server\.next|HromadaAIDApi|service-control|install-server-service|DataDirectory|BackupDirectory/)
  assert.match(installer, /-Mode "manager"[\s\S]*?-ManagerBytes \$\{MANAGER_PAYLOAD_BYTES\}/)
})

test('the common release updater module is copied into Electron runtime output', () => {
  assert.match(copyAssets, /const outputShared = join\(root, 'dist-electron', 'shared'\)/)
  assert.match(copyAssets, /copyFileSync\(join\(root, 'shared', 'release-updates\.mjs'\), join\(outputShared, 'release-updates\.mjs'\)\)/)
  assert.match(copyAssets, /copyFileSync\(join\(root, 'shared', 'windows-update-launcher\.mjs'\), join\(outputShared, 'windows-update-launcher\.mjs'\)\)/)
})

test('main journal write failures remain visible in stdout and stderr without launching any installer', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'hromada-log-failure-'))
  try {
    const launcherPath = fileURLToPath(new URL('../packaging/client-update-launcher.ps1', import.meta.url))
    const harnessPath = join(root, 'probe.ps1')
    const literal = value => "'" + value.replaceAll("'", "''") + "'"
    await writeFile(harnessPath, `function Add-Type { throw 'GUI disabled for synthetic test' }\n& ${literal(launcherPath)} -ProcessId 2147483647 -InstallerPath ${literal(join(root, 'missing.exe'))} -ApplicationExecutable ${literal(join(root, 'missing-app.exe'))} -ExpectedVersion '0.1.1' -LogPath ${literal(root)} -Component Client\nexit $LASTEXITCODE\n`)
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', harnessPath], { encoding: 'utf8', windowsHide: true, timeout: 15000 })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /main-log-write-failed/)
    assert.match(result.stdout, /launcher-started/)
    assert.doesNotMatch(result.stdout, /elevation-requested|installer-process-created/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Client packaging copies only the three allowlisted document templates and excludes the import register', () => {
  const copiedReferenceNames = [...copyAssets.matchAll(/copyFileSync\(join\(root, 'reference', '([^']+)'\)/g)].map(match => match[1])
  assert.deepEqual(copiedReferenceNames.sort(), ['ПриватБанк.xlsx', 'Зведений список.xlsx', 'Список.xlsx'].sort())
  assert.doesNotMatch(copyAssets, /Реєстр\.xlsx/)
  assert.ok(builderConfig.build.files.includes('dist-electron/**/*'), 'electron-builder must include the Client runtime payload')
  assert.match(clientPackager, /for \(const name of \['Список\.xlsx', 'Зведений список\.xlsx', 'ПриватБанк\.xlsx'\]\)/)
  assert.doesNotMatch(clientPackager, /Реєстр\.xlsx/)
})

test('the client update PowerShell launcher parses without executing it', { skip: process.platform !== 'win32' }, () => {
  const command = "$tokens=$null; $errors=$null; [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $pwd 'packaging/client-update-launcher.ps1'),[ref]$tokens,[ref]$errors)|Out-Null; if($errors.Count -gt 0){$errors|ForEach-Object{$_.ToString()};exit 1}"
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

test('the external launcher records child process creation, exit status, UAC cancellation, and restart in persistent diagnostics', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'hromada-update-launcher-'))
  const resources = join(root, 'resources'), appDir = join(root, 'Client'), installer = join(resources, 'verified-setup.exe'), executable = join(appDir, 'HromadaAID.exe')
  await mkdir(resources); await mkdir(appDir); await writeFile(installer, 'fixture'); await writeFile(executable, 'fixture')
  const encode = value => Buffer.from(value, 'utf8').toString('base64')
  const launcherB64 = encode(fileURLToPath(new URL('../packaging/client-update-launcher.ps1', import.meta.url)))
  const installerB64 = encode(installer), executableB64 = encode(executable), successLogB64 = encode(join(root, 'success', 'installer-launcher.log'))
  const cancelLogB64 = encode(join(root, 'cancel', 'installer-launcher.log'))
  const harness = (logB64, cancel) => `
$launcher = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${launcherB64}'))
$installer = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${installerB64}'))
$executable = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${executableB64}'))
$log = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${logB64}'))
function Get-Process { return $null }
function Get-Item {
  param([string]$LiteralPath)
  if ($LiteralPath -eq $executable) { return [pscustomobject]@{ VersionInfo = [pscustomobject]@{ ProductVersion = '1.2.0.0' } } }
  return Microsoft.PowerShell.Management\\Get-Item -LiteralPath $LiteralPath
}
function Add-Type { throw 'Message box suppressed in isolated test.' }
function New-FakeProcess([int]$id, [int]$exitCode) {
  $p = [pscustomobject]@{ Id = $id; ExitCode = $exitCode }
  $p | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value ([scriptblock]::Create(''))
  return $p
}
function Start-Process {
  param([string]$FilePath, [string[]]$ArgumentList, [string]$Verb, [switch]$PassThru)
  if ($FilePath -eq $installer) {
    if ($Verb -ne 'RunAs' -or $ArgumentList -notcontains '/CLIENTUPDATE=1') { throw 'Incorrect elevated installer invocation.' }
    ${cancel ? "throw [System.ComponentModel.Win32Exception]::new(1223)" : "Set-Content -LiteralPath (Join-Path (Split-Path -Parent $executable) 'client-update-success.txt') -Value '1.2.0'\n    return New-FakeProcess 4321 0"}
  }
  if ($FilePath -eq $executable) { return New-FakeProcess 9876 0 }
  throw 'Unexpected process path.'
}
. $launcher -ProcessId 2147483647 -InstallerPath $installer -ApplicationExecutable $executable -ExpectedVersion '1.2.0' -LogPath $log -Component Client
exit $LASTEXITCODE
`
  const run = async (body, logPath) => {
    const harnessPath = join(root, `${logPath.includes('success') ? 'success' : 'cancel'}.ps1`)
    await writeFile(harnessPath, body, 'utf8')
    const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', harnessPath], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', windowsHide: true, timeout: 15_000 })
    assert.equal(result.status, logPath.includes('cancel') ? 1 : 0, result.stderr || result.stdout)
    return (await readFile(logPath, 'utf8')).replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
  }
  try {
    const successful = await run(harness(successLogB64, false), join(root, 'success', 'installer-launcher.log'))
    assert.ok(successful.some(event => event.stage === 'elevation-requested' && event.details.arguments.includes('/CLIENTUPDATE=1')))
    assert.ok(successful.some(event => event.stage === 'installer-process-created'))
    assert.ok(successful.some(event => event.stage === 'installer-process-exited' && event.details.exitCode === 0))
    assert.ok(successful.some(event => event.stage === 'update-confirmed'))
    assert.ok(successful.some(event => event.stage === 'application-restarted' && event.details.succeeded))

    const cancelled = await run(harness(cancelLogB64, true), join(root, 'cancel', 'installer-launcher.log'))
    assert.ok(cancelled.some(event => event.stage === 'launcher-error' && event.details.nativeErrorCode === 1223))
    assert.ok(cancelled.some(event => event.stage === 'update-not-confirmed' && event.details.message.includes('UAC')))
    assert.ok(cancelled.some(event => event.stage === 'application-restarted' && !event.details.succeeded))
  } finally { await rm(root, { recursive: true, force: true }) }
})
