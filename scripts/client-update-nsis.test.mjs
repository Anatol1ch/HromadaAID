import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const installer = await readFile(new URL('../packaging/windows-installer.nsi', import.meta.url), 'utf8')
const launcher = await readFile(new URL('../packaging/client-update-launcher.ps1', import.meta.url), 'utf8')
const copyAssets = await readFile(new URL('../electron/copy-assets.mjs', import.meta.url), 'utf8')

test('Client-only NSIS update bypasses component selection and never invokes server removal/update paths', () => {
  assert.match(installer, /Page custom ModePageCreate ModePageLeave ModePagePre/)
  assert.match(installer, /Function ModePagePre[\s\S]*?ClientUpdateMode == "1"[\s\S]*?Abort[\s\S]*?FunctionEnd/)
  assert.match(installer, /Function DirectoryPagePre[\s\S]*?ClientUpdateMode == "1"[\s\S]*?Abort[\s\S]*?FunctionEnd/)
  assert.match(installer, /\$\{GetOptions\}\s+"\$CMDLINE"\s+"\/CLIENTUPDATE="\s+\$ClientUpdateMode/)
  assert.match(installer, /SectionSetFlags \$\{SEC_CLIENT\} \$\{SF_SELECTED\}[\s\S]*?SectionSetFlags \$\{SEC_SERVER\} 0[\s\S]*?Goto initDone/)
  assert.match(installer, /Section -RemoveDeselected[\s\S]*?ClientUpdateMode == "1"[\s\S]*?Goto removeDeselectedDone[\s\S]*?Call RemoveServerComponent/)
  assert.match(installer, /ClientUpdateMode == "1"[\s\S]*?InstalledComponents[\s\S]*?updateMetadataDone/)
  assert.match(installer, /FileOpen \$2 "\$INSTDIR\\Client\\client-update-success\.txt" "w"/)
})

test('external launcher waits for Client, uses the standard UAC verb, waits for NSIS, and restarts Client', () => {
  assert.match(launcher, /Wait-Process -Id \$ProcessId -Timeout 600/)
  assert.match(launcher, /Start-Process -FilePath \$InstallerPath -ArgumentList @\(\$mode\) -Verb RunAs -Wait -PassThru/)
  assert.match(launcher, /ValidateSet\('Client','ServerManager'\)/)
  assert.match(launcher, /\$Component -eq 'Client'[\s\S]*?\/CLIENTUPDATE=1/)
  assert.match(launcher, /else \{ 'manager-update-success\.txt' \}/)
  assert.match(launcher, /client-update-success\.txt[\s\S]*\$process\.ExitCode -eq 0/)
  assert.match(launcher, /Start-Process -FilePath \$ApplicationExecutable/)
})

test('Manager-only NSIS mode replaces only Manager, preserves installation metadata and bypasses server/service work', () => {
  assert.match(installer, /\$\{GetOptions\} "\$CMDLINE" "\/MANAGERUPDATE=" \$ManagerUpdateMode/)
  assert.match(installer, /Section -ManagerOnlyUpdate[\s\S]*?SetOutPath "\$INSTDIR\\ServerManager\.next"[\s\S]*?File \/r "\$\{MANAGER_PAYLOAD\}\\\*"[\s\S]*?Rename "\$INSTDIR\\ServerManager\.next" "\$INSTDIR\\ServerManager"[\s\S]*?SectionEnd/)
  assert.match(installer, /managerRestoreInterrupted:[\s\S]*?Rename "\$INSTDIR\\ServerManager\.previous" "\$INSTDIR\\ServerManager"/)
  assert.match(installer, /ManagerUpdateMode == "1"[\s\S]*?InstalledComponents[\s\S]*?manager-update-success\.txt/)
  assert.match(installer, /Section -RemoveDeselected[\s\S]*?ClientUpdateMode == "1"[\s\S]*?ManagerUpdateMode == "1"[\s\S]*?Goto removeDeselectedDone/)
  const section = installer.slice(installer.indexOf('Section -ManagerOnlyUpdate'), installer.indexOf('Section -ProductBranding'))
  assert.doesNotMatch(section, /Server\.next|HromadaAIDApi|service-control|install-server-service|DataDirectory|BackupDirectory/)
  assert.match(installer, /-Mode "manager"[\s\S]*?-ManagerBytes \$\{MANAGER_PAYLOAD_BYTES\}/)
})

test('the common release updater module is copied into Electron runtime output', () => {
  assert.match(copyAssets, /const outputShared = join\(root, 'dist-electron', 'shared'\)/)
  assert.match(copyAssets, /copyFileSync\(join\(root, 'shared', 'release-updates\.mjs'\), join\(outputShared, 'release-updates\.mjs'\)\)/)
})

test('the client update PowerShell launcher parses without executing it', { skip: process.platform !== 'win32' }, () => {
  const command = "$tokens=$null; $errors=$null; [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $pwd 'packaging/client-update-launcher.ps1'),[ref]$tokens,[ref]$errors)|Out-Null; if($errors.Count -gt 0){$errors|ForEach-Object{$_.ToString()};exit 1}"
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, result.stderr || result.stdout)
})
