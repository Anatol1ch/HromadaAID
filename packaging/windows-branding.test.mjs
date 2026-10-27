import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

test('unified NSIS keeps one product identity with a component-independent Client brand icon', () => {
  const source = readFileSync('packaging/windows-installer.nsi', 'utf8')
  assert.equal((source.match(/"DisplayName" "HromadaAID"/g) ?? []).length, 1)
  assert.equal((source.match(/"DisplayIcon"/g) ?? []).length, 1)
  assert.match(source, /"DisplayIcon"[^\r\n]*\$INSTDIR\\assets\\hromadaaid.ico/)
  assert.doesNotMatch(source, /"DisplayIcon"[^\r\n]*(Client|ServerManager)/)
  assert.match(source, /Section -ProductBranding[\s\S]*?File \/oname=hromadaaid.ico "\$\{PROJECT_DIR\}\\assets\\hromadaaid.ico"/)
  assert.match(source, /!define MUI_ICON "\$\{PROJECT_DIR\}\\assets\\hromadaaid.ico"/)
  assert.match(source, /!define MUI_UNICON "\$\{PROJECT_DIR\}\\assets\\hromadaaid.ico"/)
  assert.doesNotMatch(source, /RMDir \/r "\$INSTDIR\\assets"/)
  const builder = readFileSync('scripts/package-windows.mjs', 'utf8')
  assert.match(builder, /'windows-shortcuts.ps1'/)
  assert.match(builder, /installerSupportBytes.push\(\(await stat\(join\(root, 'assets', 'hromadaaid.ico'\)\)\).size\)/)
})

test('NSIS syncs target-checked links after Modify and removes owned links only after service removal succeeds', () => {
  const source = readFileSync('packaging/windows-installer.nsi', 'utf8')
  assert.doesNotMatch(source, /CreateShortcut|Delete[^\r\n]*\.lnk/i)
  assert.match(source, /Section -ApplicationShortcuts[\s\S]*?SectionGetFlags \$\{SEC_CLIENT\} \$0[\s\S]*?SectionGetFlags \$\{SEC_SERVER\} \$1[\s\S]*?!insertmacro SyncApplicationShortcuts \$0 \$1/)
  assert.ok(source.indexOf('Section -ApplicationShortcuts') > source.indexOf('Section -RemoveDeselected'))
  assert.match(source, /Call un.RemoveServerComponent\s+!insertmacro SyncApplicationShortcuts 0 0/)
  assert.match(source, /SetOutPath "\$PLUGINSDIR\\WindowsIntegration"/)
  assert.match(source, /!macro SyncApplicationShortcuts[^\r\n]*\r?\n\s+InitPluginsDir/)
  assert.match(source, /Pop \$2\s+Pop \$3\s+DetailPrint "\$3"/)
  assert.match(source, /SetShellVarContext all/)
  // Combined must remain selected on Reinstall; Client-first would skip the Server branch.
  const serverSelection = source.indexOf('HromadaAID Server Manager.exe" selectInstalledServer')
  assert.ok(serverSelection >= 0 && serverSelection < source.indexOf('HromadaAID.exe" selectInstalledClient'))
  assert.match(source, /ReadINIStr \$ManagerBranding[^\r\n]*"brandingId"/)
  assert.match(source, /\$\{AndIf\} \$ManagerBranding == "\$\{MANAGER_BRANDING_ID\}"/)
  const managerPackager = readFileSync('scripts/package-server-manager.mjs', 'utf8')
  assert.match(managerPackager, /brandingId=\$\{createHash\('sha256'\).update\(icon\).digest\('hex'\)\}/)
  const installerBuild = readFileSync('scripts/build-windows-installer.mjs', 'utf8')
  assert.match(installerBuild, /nsisDefine\('MANAGER_BRANDING_ID', managerBrandingId\)/)
})

test('selective NSIS updates keep the other component selected for shortcut synchronization', () => {
  const source = readFileSync('packaging/windows-installer.nsi', 'utf8')
  const shortcuts = source.slice(source.indexOf('Section -ApplicationShortcuts'), source.indexOf('Section -UninstallMetadata'))
  const client = shortcuts.slice(shortcuts.indexOf('${If} $ClientUpdateMode'), shortcuts.indexOf('${If} $ManagerUpdateMode'))
  const manager = shortcuts.slice(shortcuts.indexOf('${If} $ManagerUpdateMode'), shortcuts.indexOf('shortcutsDone:'))
  assert.match(client, /ReadRegStr \$1 HKLM "Software\\HromadaAID\\Installer" "InstalledComponents"/)
  assert.match(client, /\$1 == "Server,ServerManager"[\s\S]*?\$1 == "Client,Server,ServerManager"[\s\S]*?StrCpy \$1 1[\s\S]*?StrCpy \$1 0/)
  assert.match(client, /!insertmacro SyncApplicationShortcuts 1 \$1/)
  assert.match(manager, /ReadRegStr \$0 HKLM "Software\\HromadaAID\\Installer" "InstalledComponents"/)
  assert.match(manager, /\$0 == "Client"[\s\S]*?\$0 == "Client,Server,ServerManager"[\s\S]*?StrCpy \$0 1[\s\S]*?StrCpy \$0 0/)
  assert.match(manager, /!insertmacro SyncApplicationShortcuts \$0 1/)
  for (const path of ['server-manager/electron/windows-server-update.ts', 'packaging/install-server-service.ps1', 'packaging/server-package-transaction.mjs']) {
    assert.doesNotMatch(readFileSync(path, 'utf8'), /windows-shortcuts|SyncApplicationShortcuts|Sync-HromadaAidShortcuts|\.lnk\b/, `${path} must not manipulate application shortcuts`)
  }
})

for (const systemDirectory of ['System32', 'SysWOW64']) {
  const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', systemDirectory, 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  test(`shortcut lifecycle, icons and AppUserModelIDs with PowerShell 5.1 (${systemDirectory}), isolated temp folders`, { skip: process.platform !== 'win32' || !existsSync(powershell) }, () => {
    const root = mkdtempSync(join(tmpdir(), 'HromadaAID shortcuts '))
    const script = fileURLToPath(new URL('./windows-shortcuts.ps1', import.meta.url))
    assert.equal(readFileSync(script).subarray(0, 3).toString('hex'), 'efbbbf')
    const harness = join(root, 'check.ps1')
    const ps = String.raw`
$ErrorActionPreference = 'Stop'
. '${script.replaceAll("'", "''")}' -LibraryOnly
function Assert($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
$program = Join-Path $PSScriptRoot 'Програма з пробілами'
$menu = Join-Path $PSScriptRoot 'Меню Пуск'
$desktop = Join-Path $PSScriptRoot 'Робочий стіл'
foreach ($directory in @($menu, $desktop, (Join-Path $program 'Client'), (Join-Path $program 'ServerManager'))) { [IO.Directory]::CreateDirectory($directory) | Out-Null }
$client = Join-Path $program 'Client\HromadaAID.exe'
$manager = Join-Path $program 'ServerManager\HromadaAID Server Manager.exe'
[IO.File]::WriteAllText($client, 'synthetic non-executable fixture')
[IO.File]::WriteAllText($manager, 'synthetic non-executable fixture')
$unrelated = Join-Path $desktop 'HromadaAID користувацький.lnk'
[IO.File]::WriteAllText($unrelated, 'leave this file intact')
[Console]::Out.WriteLine('phase: Client-only / Reinstall')
Sync-HromadaAidShortcuts $program $menu $desktop 1 0
Sync-HromadaAidShortcuts $program $menu $desktop 1 0
Assert (@(Get-ChildItem -LiteralPath $menu -Filter '*.lnk').Count -eq 1) 'Client-only Reinstall duplicated links'
foreach ($dir in @($menu, $desktop)) {
  $path = Join-Path $dir 'HromadaAID.lnk'
  Assert ([HromadaAid.ShortcutIdentity]::Read($path) -eq 'local.hromadaaid') 'Wrong Client AppUserModelID'
  $link = [HromadaAid.ShortcutIdentity]::Info($path)
  Assert ($link.Target -eq $client) 'Wrong Client target'
  Assert ($link.Icon -eq $client -and $link.IconIndex -eq 0) 'Wrong Client icon'
  Assert (-not (Test-Path -LiteralPath (Join-Path $dir 'HromadaAID Server Manager.lnk'))) 'Client-only created Manager link'
}
[Console]::Out.WriteLine('phase: Server-only')
Sync-HromadaAidShortcuts $program $menu $desktop 0 1
foreach ($dir in @($menu, $desktop)) {
  Assert (-not (Test-Path -LiteralPath (Join-Path $dir 'HromadaAID.lnk'))) 'Server-only retained Client link'
  $path = Join-Path $dir 'HromadaAID Server Manager.lnk'
  Assert ([HromadaAid.ShortcutIdentity]::Read($path) -eq 'local.hromadaaid.server-manager') 'Wrong Manager AppUserModelID'
  $link = [HromadaAid.ShortcutIdentity]::Info($path)
  Assert ($link.Target -eq $manager) 'Wrong Manager target'
  Assert ($link.Icon -eq $manager -and $link.IconIndex -eq 0) 'Wrong Manager icon'
}
[Console]::Out.WriteLine('phase: Combined / Modify')
Sync-HromadaAidShortcuts $program $menu $desktop 1 1
Assert (@(Get-ChildItem -LiteralPath $menu -Filter '*.lnk').Count -eq 2) 'Combined did not create both links'
[Console]::Out.WriteLine('phase: Combined selective update isolation')
# The NSIS caller contract above resolves both selective modes to 1,1 for Combined.
foreach ($mode in @('Manager-only', 'Client-only')) {
  Sync-HromadaAidShortcuts $program $menu $desktop 1 1
  foreach ($dir in @($menu, $desktop)) {
    $clientLink = Join-Path $dir 'HromadaAID.lnk'
    $managerLink = Join-Path $dir 'HromadaAID Server Manager.lnk'
    Assert (Test-Path -LiteralPath $clientLink) "$mode removed Client shortcut"
    Assert (Test-Path -LiteralPath $managerLink) "$mode removed Manager shortcut"
    Assert ([HromadaAid.ShortcutIdentity]::Info($clientLink).Target -eq $client) "$mode changed Client target"
    Assert ([HromadaAid.ShortcutIdentity]::Info($managerLink).Target -eq $manager) "$mode changed Manager target"
  }
}
Sync-HromadaAidShortcuts $program $menu $desktop 1 0
Assert (-not (Test-Path -LiteralPath (Join-Path $desktop 'HromadaAID Server Manager.lnk'))) 'Modify did not remove Manager desktop link'
[Console]::Out.WriteLine('phase: legacy identity')
# Repair a legacy NSIS shortcut with no AppUserModelID.
$legacy = Join-Path $menu 'HromadaAID.lnk'
[HromadaAid.ShortcutIdentity]::Write($legacy, '')
Sync-HromadaAidShortcuts $program $menu $desktop 1 0
Assert ([HromadaAid.ShortcutIdentity]::Read($legacy) -eq 'local.hromadaaid') 'Legacy shortcut identity was not repaired'
[Console]::Out.WriteLine('phase: foreign and custom links')
# An exact-name foreign link and a user link with custom arguments remain byte-identical.
$foreign = Join-Path $desktop 'HromadaAID Server Manager.lnk'
[HromadaAid.ShortcutIdentity]::SaveLink($foreign, $client, '')
$foreignBytes = [Convert]::ToBase64String([IO.File]::ReadAllBytes($foreign))
$custom = Join-Path $menu 'HromadaAID.lnk'
[HromadaAid.ShortcutIdentity]::SaveLink($custom, $client, '--user-option')
$customBytes = [Convert]::ToBase64String([IO.File]::ReadAllBytes($custom))
Sync-HromadaAidShortcuts $program $menu $desktop 1 1
Sync-HromadaAidShortcuts $program $menu $desktop 0 0
Assert ([Convert]::ToBase64String([IO.File]::ReadAllBytes($foreign)) -eq $foreignBytes) 'Foreign link was modified'
Assert ([Convert]::ToBase64String([IO.File]::ReadAllBytes($custom)) -eq $customBytes) 'Custom link was modified'
Assert ([IO.File]::ReadAllText($unrelated) -eq 'leave this file intact') 'Similar user link was modified'
Assert (-not (Test-Path -LiteralPath (Join-Path $menu 'HromadaAID Server Manager.lnk'))) 'Uninstall retained owned Manager link'
[Console]::Out.WriteLine('phase: missing executable')
# Never create a dangling link, and remove a formerly owned dangling link.
Remove-Item -LiteralPath $foreign
Sync-HromadaAidShortcuts $program $menu $desktop 0 1
Remove-Item -LiteralPath $manager
Sync-HromadaAidShortcuts $program $menu $desktop 0 1
Assert (-not (Test-Path -LiteralPath (Join-Path $desktop 'HromadaAID Server Manager.lnk'))) 'Dangling Manager link remained'
[Console]::Out.WriteLine('PASS: isolated shortcut lifecycle and identity checks')

`
    try {
      writeFileSync(harness, '\uFEFF' + ps, 'utf8')
      const result = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', harness], { cwd: root, windowsHide: true, encoding: 'utf8', timeout: 30_000 })
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
      assert.match(result.stdout, /PASS: isolated shortcut lifecycle and identity checks/)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
}
