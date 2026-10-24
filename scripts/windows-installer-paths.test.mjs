import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderInstalledServerConfig, renderWinSWConfig, validateInstallerOptions } from '../packaging/windows-installer-config.mjs'
import { prepareServerInstall } from '../packaging/prepare-server-install.mjs'
import { readFile } from 'node:fs/promises'

const volume = () => ({ driveType: 3, fileSystem: 'NTFS', freeBytes: 2_000_000_000 })
const base = (root, mode = 'server-client') => ({
  mode,
  programDirectory: join(root, 'HromadaAID Програма'),
  dataDirectory: join(root, 'Дані HromadaAID'),
  backupDirectory: join(root, 'Резервні копії HromadaAID'),
})

test('installer accepts the three choices and only validates server paths when needed', () => {
  const root = mkdtempSync(join(tmpdir(), 'hromada-installer-'))
  try {
    const paths = base(root)
    assert.equal(validateInstallerOptions(paths, { inspectVolume: volume }).mode, 'server-client')
    assert.equal(validateInstallerOptions({ ...paths, mode: 'server' }, { inspectVolume: volume }).mode, 'server')
    assert.deepEqual(validateInstallerOptions({ mode: 'client', programDirectory: paths.programDirectory }, { inspectVolume: volume }), {
      mode: 'client', programDirectory: paths.programDirectory,
    })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('NSIS exposes the three install modes as independent client and server components', async () => {
  const script = (await readFile(new URL('../packaging/windows-installer.nsi', import.meta.url), 'utf8')).replace(/^\uFEFF/, '')
  assert.match(script, /Section "Клієнт HromadaAID" SEC_CLIENT/)
  assert.match(script, /Section "Сервер HromadaAID" SEC_SERVER/)
  assert.match(script, /SectionSetFlags \$\{SEC_CLIENT\} \$\{SF_SELECTED\}/)
  assert.match(script, /SectionSetFlags \$\{SEC_SERVER\} 0/)
  assert.match(script, /StrCpy \$ValidationMode "client"/)
  assert.match(script, /StrCpy \$ValidationMode "server-client"/)
  assert.match(script, /-Mode "\$ValidationMode"/)
  assert.match(script, /Call TrimPathTrailingSeparator[\s\S]*?Pop \$PreflightProgramDirectory[\s\S]*?Pop \$PreflightDataDirectory[\s\S]*?Pop \$PreflightBackupDirectory/)
  assert.match(script, /nsExec::ExecToStack[\s\S]*?windows-installer-paths\.ps1[\s\S]*?-ProgramDirectory "\$PreflightProgramDirectory"[\s\S]*?-DataDirectory "\$PreflightDataDirectory"[\s\S]*?-BackupDirectory "\$PreflightBackupDirectory"/)
  assert.match(script, /Pop \$2\s+Pop \$3\s+DetailPrint "Попередня перевірка каталогів: код \$2"/)
  assert.match(script, /DetailPrint "Діагностика підготовки служби: \$3"[\s\S]*?MessageBox[^\r\n]*Діагностика: \$3/)
  assert.match(script, /--package-root "\$INSTDIR\\Server\.next"/)
  assert.match(script, /CLIENT_PAYLOAD_BYTES/)
  assert.match(script, /SERVER_PAYLOAD_BYTES/)
  assert.match(script, /INSTALLER_SUPPORT_BYTES/)
  assert.match(script, /Function DataPage[\s\S]*Call IsServerSelected[\s\S]*FunctionEnd/)
  assert.match(script, /Function BackupPage[\s\S]*Call IsServerSelected[\s\S]*FunctionEnd/)
  assert.match(script, /Page custom AdminSetupPage AdminSetupLeave ": Створення адміністратора"/)
  assert.match(script, /SetOutPath "\$INSTDIR\\Server\.next"/)
  assert.ok(script.replace(/^\uFEFF/, '').startsWith('# -*- coding: utf-8 -*-\r\nUnicode true') || script.replace(/^\uFEFF/, '').startsWith('# -*- coding: utf-8 -*-\nUnicode true'))
  assert.match(script, /nsExec::ExecToStack/)
  assert.doesNotMatch(script, /ExecWait/)
  assert.match(script, /Pop \$2[\s\S]*?\$2 == 3[\s\S]*?\$2 == 4[\s\S]*?\$2 == 5[\s\S]*?\$2 == 6/)
  assert.match(script, /Page custom DataPage DataLeave ": Серверні дані"/)
  assert.match(script, /Page custom BackupPage BackupLeave ": Резервні копії"/)
  assert.match(script, /Page custom AdminSetupPage AdminSetupLeave ": Створення адміністратора"/)
  assert.match(script, /Page custom SummaryPage SummaryLeave ": Перевірка параметрів"/)
  assert.match(script, /Preflight launch: powershell=\[\$SYSDIR\\WindowsPowerShell\\v1\.0\\powershell\.exe\] script=\[\$PLUGINSDIR\\Preflight\\windows-installer-paths\.ps1\] cwd=\[\$PLUGINSDIR\\Preflight\]/)
  assert.match(script, /Діагностика preflight: \$3/)
  assert.match(script, /Не вдалося перевірити вибрані параметри\. Код: \$2.*\$3/)
  assert.doesNotMatch(script, /ExecWait\s+'[^\r\n]*powershell\.exe/i)
})

test('installer text sources are explicitly UTF-8 and Unicode NSIS is enabled', async () => {
  const scriptBytes = readFileSync(new URL('../packaging/windows-installer.nsi', import.meta.url))
  assert.deepEqual([...scriptBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf])
  const script = scriptBytes.subarray(3).toString('utf8')
  assert.match(script, /^Unicode true/m)
  assert.match(script, /Клієнт HromadaAID/)
  assert.match(script, /Каталог серверних даних/)
  assert.doesNotMatch(script, /\uFFFD|Рџ|СЂС/)
  const build = readFileSync(new URL('./build-windows-installer.mjs', import.meta.url), 'utf8')
  assert.match(build, /'\/INPUTCHARSET',[\s\S]*?'UTF8'/)
  for (const name of ['admin-setup.ps1', 'install-server-service.ps1', 'windows-service-control.ps1', 'windows-installer-paths.ps1']) {
    const bytes = readFileSync(new URL(`../packaging/${name}`, import.meta.url))
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], `${name} must include a UTF-8 BOM for Windows PowerShell 5.1`)
    const text = bytes.subarray(3).toString('utf8')
    assert.doesNotMatch(text, /\uFFFD|Рџ|СЂС/, `${name} contains likely mojibake`)
  }
})

test('NSIS registers and verifies the LocalService WinSW wrapper, preserves user data on uninstall', async () => {
  const script = await readFile(new URL('../packaging/windows-installer.nsi', import.meta.url), 'utf8')
  const installer = await readFile(new URL('../packaging/install-server-service.ps1', import.meta.url), 'utf8')
  const serviceControl = await readFile(new URL('../packaging/windows-service-control.ps1', import.meta.url), 'utf8')
  assert.match(script, /install-server-service\.ps1/)
  assert.match(script, /windows-service-control\.ps1/)
  assert.match(installer, /\$Wrapper @\('install'\)/)
  assert.match(installer, /& \$oldWrapper uninstall/)
  assert.doesNotMatch(installer, /\('refresh'\)/)
  assert.match(installer, /\('sidtype', \$serviceName, 'unrestricted'\)/)
  assert.match(installer, /\('start'\)/)
  assert.match(installer, /Status -eq 'Running'/)
  assert.match(installer, /Test-HromadaServiceHealth/)
  assert.match(installer, /Set-InstallStage 'register-service-and-sid'/)
  assert.match(installer, /Set-AclChecked \$DataDirectory @\('\*S-1-5-18:[\s\S]*?Register-Service \$wrapper[\s\S]*?Configure-ServiceAccess/)
  assert.match(installer, /\$script:serviceSid = Get-ServiceSid \$serviceName/)
  assert.match(installer, /Register-Service \$wrapper\s+Set-InstallStage 'grant-service-acl'\s+Configure-ServiceAccess[\s\S]*?Set-InstallStage 'start-service'/)
  assert.doesNotMatch(installer, /SYSTEM:|BUILTIN\\Administrators:|NT SERVICE\\HromadaAIDApi:/)
  assert.match(installer, /\*S-1-5-18/)
  assert.match(installer, /\*S-1-5-32-544/)
  assert.match(installer, /\*\$script:serviceSid/)
  assert.match(installer, /SERVICE_INSTALL_ERROR\|stage=\$script:InstallStage\|type=\$type\|line=\$line\|hresult=\$hresult\|childExitCode=\$script:LastChildExitCode\|detailFile=\$fileName/)
  assert.match(installer, /HromadaAID-service-install-/)
  assert.match(installer, /message = \(Protect-InstallDiagnosticText \$exception\.Message\)/)
  assert.match(installer, /function Protect-InstallDiagnosticText/)
  assert.doesNotMatch(installer, /Write-InstallFailureDiagnostic[\s\S]*?Password\s*=/i)
  assert.match(installer, /installer-preflight\.js/)
  assert.match(installer, /installer-initialization\.js/)
  assert.match(installer, /create-admin\.js/)
  assert.match(installer, /\$adminArguments[\s\S]*Start-Process[\s\S]*-WindowStyle Hidden -Wait -PassThru/)
  assert.match(installer, /Invoke-PackageTransaction \$stagedServer 'prepare'/)
  assert.match(installer, /Invoke-PackageTransaction \$stagedServer 'activate'/)
  assert.match(installer, /verify-server-package\.mjs/)
  assert.match(installer, /Wait-ServiceHealthy/)
  assert.match(installer, /schemaVersion.*oldSchemaMaximum/)
  assert.match(installer, /Server\.previous/)
  assert.match(installer, /& \$scPath showsid \$Name/)
  assert.match(installer, /function Configure-ServiceAccess[\s\S]*?Protect-ServiceFile \$config/)
  assert.match(installer, /Restore-Acls[\s\S]*?Register-Service \$oldWrapper/)
  assert.doesNotMatch(installer, /LocalSystem|Everyone:|S-1-1-0/)
  assert.match(script, /-Action uninstall/)
  assert.match(serviceControl, /\$Action -eq 'uninstall'/)
  assert.doesNotMatch(script, /RMDir\s+\/r\s+"\$DataDirectory|RMDir\s+\/r\s+"\$BackupDirectory/)
})

test('installer ACL rules use SIDs and actual icacls on isolated Unicode paths', { skip: process.platform !== 'win32' }, async () => {
  const installer = await readFile(new URL('../packaging/install-server-service.ps1', import.meta.url), 'utf8')
  const invokeChecked = installer.match(/function Invoke-Checked\([\s\S]*?(?=\r?\nfunction Test-AbsoluteLocalPath)/)?.[0]
  const getServiceSid = installer.match(/function Get-ServiceSid\([\s\S]*?(?=\r?\nfunction Save-Acl)/)?.[0]
  const aclFunctions = installer.match(/function Set-AclChecked\([\s\S]*?(?=\r?\nfunction Invoke-PackageTransaction)/)?.[0]
  assert.ok(invokeChecked && getServiceSid && aclFunctions, 'extract the actual installer ACL functions')

  const root = mkdtempSync(join(tmpdir(), 'HromadaAID ACL test '))
  const harness = join(root, 'test-acls.ps1')
  const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const script = [
    "$ErrorActionPreference = 'Stop'",
    'try {',
    "$unregisteredServiceSid = Get-ServiceSid 'HromadaAIDApi'; if ($unregisteredServiceSid -notmatch '^S-1-5-80-(?:\\d+-){4}\\d+$') { throw 'Could not compute the HromadaAID service SID before registration.' }",
    "$script:serviceSid = Get-ServiceSid 'Schedule'",
    "if ($script:serviceSid -notmatch '^S-1-5-80-(?:\\d+-){4}\\d+$') { throw 'Invalid service SID returned by sc.exe.' }",
    "$data = Join-Path $Root 'Дані HromadaAID'",
    "$database = Join-Path $data 'База даних'",
    "$logs = Join-Path $data 'Журнали'",
    "$backups = Join-Path $Root 'Резервні копії'",
    "$program = Join-Path $Root 'Program Files\\Server'",
    'foreach ($path in @($data, $database, $logs, $backups, $program)) { New-Item -ItemType Directory -Path $path -Force | Out-Null }',
    "$config = Join-Path $data 'server.json'; [IO.File]::WriteAllText($config, '{}')",
    "foreach ($path in @($data, $database, $logs, $backups, $program)) { Set-AclChecked $path @('*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F') }",
    'Grant-ServiceAccess $data \'RX\' \'OI)(CI\'',
    'Grant-ServiceAccess $database \'M\' \'OI)(CI\'',
    'Grant-ServiceAccess $logs \'M\' \'OI)(CI\'',
    'Grant-ServiceAccess $backups \'M\' \'OI)(CI\'',
    'Grant-ServiceAccess $program \'RX\' \'OI)(CI\'',
    'Set-ReadOnlyServiceFile $config',
    'Protect-ServiceFile $config',
    "foreach ($path in @($data, $database, $logs, $backups, $program, $config)) { $acl = if ([IO.File]::Exists($path)) { [IO.File]::GetAccessControl($path) } else { [IO.Directory]::GetAccessControl($path) }; $sidRules = $acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]); $sids = @($sidRules | ForEach-Object { $_.IdentityReference.Value }); if ($sids -notcontains 'S-1-5-18' -or $sids -notcontains 'S-1-5-32-544' -or $sids -notcontains $script:serviceSid) { throw \"Missing expected SID ACL for [$path].\" }; if ($sids -contains 'S-1-5-32-545' -or $sids -contains 'S-1-1-0') { throw \"Unexpected Users/Everyone access on [$path].\" } }",
    "$configRules = ([IO.File]::GetAccessControl($config)).GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]); if (-not ($configRules | Where-Object { $_.IdentityReference.Value -eq $script:serviceSid -and $_.AccessControlType -eq 'Deny' -and ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::Write) -ne 0 })) { throw 'Service write deny is missing from protected config.' }",
    "Write-Output 'PASS: SID ACLs applied with icacls and verified on temporary Unicode paths'",
    '} catch { [Console]::Error.WriteLine(($_ | Out-String)); $script:testFailure = $true } finally { & (Join-Path $env:SystemRoot \'System32\\icacls.exe\') $Root \'/reset\' \'/T\' \'/C\' 2>&1 | Out-Null }',
    'if ($script:testFailure) { exit 1 }',
  ].filter(Boolean).join('\r\n')
  const wrapped = ['param([Parameter(Mandatory=$true)][string]$Root)', invokeChecked, getServiceSid, aclFunctions, script].join('\r\n')

  try {
    writeFileSync(harness, '\uFEFF' + wrapped, 'utf8')
    const run = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', harness, '-Root', root], { windowsHide: true, encoding: 'utf8', timeout: 30_000 })
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`)
    assert.match(run.stdout, /PASS: SID ACLs applied with icacls/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('service path validation uses APIs available in Windows PowerShell 5.1 and accepts only absolute local drive paths', { skip: process.platform !== 'win32' }, async () => {
  const installer = await readFile(new URL('../packaging/install-server-service.ps1', import.meta.url), 'utf8')
  assert.doesNotMatch(installer, /IsPathFullyQualified/)
  assert.match(installer, /Test-AbsoluteLocalPath \$path/)
  const helper = installer.match(/function Test-AbsoluteLocalPath\([\s\S]*?(?=\r?\nfunction Save-Acl)/)?.[0]
  assert.ok(helper, 'the actual installer path-validation function must be present')

  const root = mkdtempSync(join(tmpdir(), 'HromadaAID PowerShell 5.1 path validation '))
  const harness = join(root, 'validate-paths.ps1')
  const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const script = [
    helper,
    "$pathApi = [IO.Path].GetMethod('IsPathFullyQualified')",
    "if ($null -ne $pathApi) { throw 'Harness must run on the Windows PowerShell 5.1 .NET Framework API surface.' }",
    "$cases = @(@{ path = 'C:\\'; expected = $true }, @{ path = 'C:\\Program Files\\HromadaAID'; expected = $true }, @{ path = 'D:\\Дані HromadaAID\\База'; expected = $true }, @{ path = 'relative\\folder'; expected = $false }, @{ path = 'C:drive-relative'; expected = $false }, @{ path = '\\root-relative'; expected = $false }, @{ path = '\\\\server\\share'; expected = $false })",
    'foreach ($case in $cases) { $actual = Test-AbsoluteLocalPath $case.path; if ($actual -ne $case.expected) { throw "Unexpected validation result for [$($case.path)]: $actual" } }',
    "[Console]::Out.WriteLine('PASS: Windows PowerShell 5.1 local absolute path cases')",
  ].join('\r\n') + '\r\n'

  try {
    writeFileSync(harness, '\uFEFF' + script, 'utf8')
    const run = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', harness], { windowsHide: true, encoding: 'utf8', timeout: 30_000 })
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`)
    assert.match(run.stdout, /PASS: Windows PowerShell 5\.1 local absolute path cases/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('retry cleanup removes only an interrupted Server.next package and preserves synthetic server data', { skip: process.platform !== 'win32' }, (t) => {
  const root = mkdtempSync(join(tmpdir(), 'HromadaAID retry cleanup '))
  const program = join(root, 'Program Files', 'HromadaAID')
  const data = join(root, 'Persistent Data')
  const backups = join(root, 'Backups')
  const staged = join(program, 'Server.next')
  const database = join(data, 'Database', 'hromada-aid.sqlite')
  const config = join(data, 'server.json')
  const key = join(backups, '.hromadaaid-backup-key.dpapi')
  const archive = join(backups, 'synthetic.hraid')
  const journal = join(data, '.hromadaaid-update-state.json')
  const serviceControl = fileURLToPath(new URL('../packaging/windows-service-control.ps1', import.meta.url))
  const harness = join(root, 'retry-cleanup.ps1')
  const powershell = join(process.env.SystemRoot ?? 'C:\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  try {
    mkdirSync(join(staged, 'partial'), { recursive: true })
    mkdirSync(join(data, 'Database'), { recursive: true })
    mkdirSync(backups, { recursive: true })
    writeFileSync(join(staged, 'partial', 'payload.bin'), 'interrupted staging payload')
    writeFileSync(database, 'synthetic database sentinel')
    writeFileSync(config, '{"synthetic":true}')
    writeFileSync(key, 'synthetic DPAPI sentinel')
    writeFileSync(archive, 'synthetic archive sentinel')
    writeFileSync(journal, JSON.stringify({ phase: 'initial-install-needs-review', hadPreviousPackage: false }))
    const psSource = [
      'function Get-Service { param([string]$Name, [string]$ErrorAction); return $null }',
      `. '${serviceControl.replace(/'/g, "''")}' -Action stop-before-update -ProgramDirectory '${program.replace(/'/g, "''")}' -UpdateJournalPath '${journal.replace(/'/g, "''")}'`,
    ].join('\r\n') + '\r\n'
    writeFileSync(harness, '\uFEFF' + psSource, 'utf8')
    const run = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', harness], { windowsHide: true, encoding: 'utf8', timeout: 30_000 })
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`)
    assert.equal(existsSync(staged), false, 'stale staging files are discarded before retry')
    for (const path of [database, config, key, archive, journal]) assert.equal(existsSync(path), true, `${path} must be preserved`)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('server production dependencies deploy only in a disposable isolated workspace', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const deployScript = await readFile(new URL('./deploy-server-package.mjs', import.meta.url), 'utf8')
  assert.match(packageJson.scripts['windows:package'], /deploy-server-package\.mjs/)
  assert.doesNotMatch(packageJson.scripts['windows:package'], /pnpm --filter.*deploy/)
  assert.match(deployScript, /mkdtemp/)
  assert.match(deployScript, /cwd: workspace/)
  assert.match(deployScript, /pnpm\.cmd/)
})

test('package manifest records measured payload and support sizes for pre-copy disk checks', async () => {
  const packager = await readFile(new URL('./package-windows.mjs', import.meta.url), 'utf8')
  const installerBuilder = await readFile(new URL('./build-windows-installer.mjs', import.meta.url), 'utf8')
  assert.match(packager, /const clientBytes = await sumBytes\(clientTarget, clientFiles\)/)
  assert.match(packager, /const serverBytes = await sumBytes\(serverTarget, completeServerFiles\)/)
  assert.match(packager, /cp\(serverSource, join\(serverTarget, 'app'\), \{ recursive: true \}\)/)
  assert.match(packager, /if \(entry\.isSymbolicLink\(\)\)/)
  assert.match(packager, /sizeBytes: clientBytes/)
  assert.match(packager, /sizeBytes: serverBytes/)
  assert.match(packager, /package-integrity\.json/)
  assert.match(packager, /server-package-transaction\.mjs/)
  assert.match(installerBuilder, /CLIENT_PAYLOAD_BYTES/)
  assert.match(installerBuilder, /SERVER_PAYLOAD_BYTES/)
  assert.match(installerBuilder, /INSTALLER_SUPPORT_BYTES/)
})

test('PowerShell path validator skips server data paths for client-only installation', async () => {
  const validator = await readFile(new URL('../packaging/windows-installer-paths.ps1', import.meta.url), 'utf8')
  assert.match(validator, /ValidateSet\('client', 'server', 'server-client'\)/)
  assert.match(validator, /if \(\$Mode -ne 'client'\)/)
  assert.match(validator, /\$paths = @\{ 'програми' = \$ProgramDirectory \}/)
  assert.match(validator, /Add-VolumeRequirement/)
  assert.match(validator, /SupportBytes \+ 8MB/)
  assert.match(validator, /\$requiredText/)
  assert.doesNotMatch(validator, /67108864|64\s*\*\s*1024\s*\*\s*1024/)
  assert.match(validator, /недостатньо місця[\s\S]*\$code = 3/)
  assert.match(validator, /NTFS[\s\S]*\$code = 4/)
  assert.match(validator, /server\\\.json\|базу HromadaAID[\s\S]*\$code = 5/)
  assert.match(validator, /PREFLIGHT_ERROR\|stage=\$script:PreflightStage\|code=\$code\|reason=\$reason\|hresult=\$hresult/)
  assert.match(validator, /PREFLIGHT_ERROR\|stage=\$script:PreflightStage\|code=1\|reason=unhandled-exception\|hresult=\$hresult/)
  assert.match(validator, /'серверних даних' \{ 'data-directory'/)
})

test('folder browse callbacks preserve the complete selected path and never create directories', async () => {
  const script = (await readFile(new URL('../packaging/windows-installer.nsi', import.meta.url), 'utf8')).replace(/^\uFEFF/, '')
  const browseData = script.match(/Function BrowseData([\s\S]*?)FunctionEnd/)?.[1] ?? ''
  const browseBackups = script.match(/Function BrowseBackups([\s\S]*?)FunctionEnd/)?.[1] ?? ''
  const dataLeave = script.match(/Function DataLeave([\s\S]*?)FunctionEnd/)?.[1] ?? ''
  const backupLeave = script.match(/Function BackupLeave([\s\S]*?)FunctionEnd/)?.[1] ?? ''
  assert.match(browseData, /SelectFolderDialog "Каталог серверних даних" "\$DataDirectory"/)
  assert.match(browseData, /\$\{NSD_SetText\} \$DataEdit "\$0"/)
  assert.match(browseBackups, /SelectFolderDialog "Каталог резервних копій" "\$BackupDirectory"/)
  assert.match(browseBackups, /\$\{NSD_SetText\} \$BackupEdit "\$0"/)
  assert.match(dataLeave, /\$\{NSD_GetText\} \$DataEdit \$DataDirectory/)
  assert.match(backupLeave, /\$\{NSD_GetText\} \$BackupEdit \$BackupDirectory/)
  for (const body of [browseData, browseBackups]) assert.doesNotMatch(body, /CreateDirectory/)
})

test('PowerShell preflight accepts Unicode, not-yet-created sibling directories without creating them', { skip: process.platform !== 'win32' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'HromadaAID preflight '))
  const paths = {
    program: join(root, 'Програма'),
    data: join(root, 'Серверні дані'),
    backups: join(root, 'Резервні копії'),
  }
  try {
    const script = fileURLToPath(new URL('../packaging/windows-installer-paths.ps1', import.meta.url))
    const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const result = spawnSync(powershell, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
      '-Mode', 'server-client', '-ProgramDirectory', paths.program, '-DataDirectory', paths.data,
      '-BackupDirectory', paths.backups, '-ClientBytes', '0', '-ServerBytes', '0', '-SupportBytes', '0',
    ], { encoding: 'utf8', windowsHide: true, timeout: 20_000 })
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    for (const path of Object.values(paths)) assert.equal(existsSync(path), false, `preflight must not create ${path}`)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('PowerShell preflight returns actionable stdout diagnostics for NSIS ExecToStack on code 1', { skip: process.platform !== 'win32' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'HromadaAID preflight diagnostic '))
  const paths = {
    program: join(root, 'Програма'),
    data: `${process.env.SystemDrive ?? 'C:'}\\`,
    backups: join(root, 'Резервні копії'),
  }
  try {
    const script = fileURLToPath(new URL('../packaging/windows-installer-paths.ps1', import.meta.url))
    const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const result = spawnSync(powershell, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
      '-Mode', 'server-client', '-ProgramDirectory', paths.program, '-DataDirectory', paths.data,
      '-BackupDirectory', paths.backups, '-ClientBytes', '0', '-ServerBytes', '0', '-SupportBytes', '0',
    ], { encoding: 'utf8', windowsHide: true, timeout: 20_000 })
    assert.equal(result.status, 1)
    assert.match(result.stdout, /PREFLIGHT_ERROR\|stage=data-directory\|code=1\|reason=drive-root-not-allowed\|hresult=0/)
    assert.doesNotMatch(result.stdout, /password|token|secret/i)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('PowerShell preflight trap records exception details and safe arguments', { skip: process.platform !== 'win32' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'HromadaAID preflight exception '))
  try {
    const original = readFileSync(new URL('../packaging/windows-installer-paths.ps1', import.meta.url), 'utf8')
    const marker = "\nAdd-Type -TypeDefinition @'"
    assert.ok(original.includes(marker))
    const script = join(root, 'windows-installer-paths.ps1')
    writeFileSync(script, original.replace(marker, "\nthrow [System.InvalidOperationException]::new('synthetic diagnostic failure')" + marker), 'utf8')
    const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const result = spawnSync(powershell, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', script,
      '-Mode', 'server-client', '-ProgramDirectory', join(root, 'Program'), '-DataDirectory', join(root, 'Data'),
      '-BackupDirectory', join(root, 'Backups'), '-ClientBytes', '0', '-ServerBytes', '0', '-SupportBytes', '0',
    ], { encoding: 'utf8', windowsHide: true, timeout: 20_000 })
    assert.equal(result.status, 1)
    assert.match(result.stdout, /PREFLIGHT_ERROR\|stage=arguments\|code=1\|reason=unhandled-exception\|hresult=-?\d+\|type=System\.InvalidOperationException\|line=\d+\|detailFile=HromadaAID-preflight-[a-f0-9]+\.json\|detailWritten=True/)
    const detailName = result.stdout.match(/detailFile=([^|\r\n]+)/)?.[1]
    assert.ok(detailName)
    const detailPath = join(tmpdir(), detailName)
    try {
      const detail = JSON.parse(readFileSync(detailPath, 'utf8'))
      assert.equal(detail.stage, 'arguments')
      assert.equal(detail.script, 'windows-installer-paths.ps1')
      assert.equal(detail.arguments.mode, 'server-client')
      assert.equal(detail.arguments.dataDirectory, join(root, 'Data'))
      assert.equal(detail.exceptions[0].type, 'System.InvalidOperationException')
      assert.equal(detail.exceptions[0].message, 'synthetic diagnostic failure')
      assert.ok(detail.line > 0)
    } finally { rmSync(detailPath, { force: true }) }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('synthetic NSIS ExecToStack preserves installer path arguments and captures PowerShell stdout', { skip: process.platform !== 'win32' }, (t) => {
  const root = mkdtempSync(join(tmpdir(), 'HromadaAID NSIS contract '))
  const paths = {
    program: join(root, 'Програма з пробілами'),
    data: join(root, 'Серверні дані з пробілами'),
    backups: join(root, 'Резервні копії з пробілами'),
  }
  const helper = join(root, 'capture-arguments.ps1')
  const nsi = join(root, 'contract-test.nsi')
  const harness = join(root, 'contract-test.exe')
  const capture = join(root, 'nsis-output.txt')
  const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const json = 'param([string]$ProgramDirectory, [string]$DataDirectory, [string]$BackupDirectory)\n' +
    '$values = @($ProgramDirectory, $DataDirectory, $BackupDirectory)\n' +
    '$payload = ConvertTo-Json -InputObject $values -Compress\n' +
    '[Console]::Out.WriteLine([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($payload)))\n'
  writeFileSync(helper, json, 'utf8')
  const source = [
    'Unicode true',
    `OutFile "${harness}"`,
    'RequestExecutionLevel user',
    'SilentInstall silent',
    'Section',
    `  nsExec::ExecToStack '"${powershell}" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${helper}" -ProgramDirectory "${paths.program}" -DataDirectory "${paths.data}" -BackupDirectory "${paths.backups}"'`,
    '  Pop $0',
    '  Pop $1',
    `  FileOpen $2 "${capture}" w`,
    '  FileWrite $2 "$0|$1"',
    '  FileClose $2',
    'SectionEnd',
  ].join('\r\n') + '\r\n'
  writeFileSync(nsi, source, 'utf8')
  try {
    const cache = join(process.env.LOCALAPPDATA ?? '', 'electron-builder', 'Cache')
    const findMakensis = (directory, depth = 5) => {
      if (depth < 0 || !existsSync(directory)) return undefined
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const candidate = join(directory, entry.name)
        if (entry.isFile() && entry.name.toLowerCase() === 'makensis.exe') return candidate
        if (entry.isDirectory()) { const found = findMakensis(candidate, depth - 1); if (found) return found }
      }
    }
    const makensis = process.env.MAKENSIS_PATH ?? findMakensis(cache)
    if (!makensis) return t.skip('makensis is unavailable; NSIS source assertions and PowerShell integration tests still run.')
    execFileSync(makensis, ['/INPUTCHARSET', 'UTF8', '/V2', nsi], { windowsHide: true, timeout: 60_000 })
    const run = spawnSync(harness, ['/S'], { windowsHide: true, encoding: 'utf8', timeout: 30_000 })
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`)
    const [exitCode, stdout] = readFileSync(capture, 'utf8').split('|')
    assert.equal(exitCode, '0')
    const received = JSON.parse(Buffer.from(stdout, 'base64').toString('utf8'))
    assert.deepEqual(received, [paths.program, paths.data, paths.backups])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('NSIS ExecToStack isolates preflight from a conflicting native System.dll in PLUGINSDIR', { skip: process.platform !== 'win32' }, (t) => {
  const root = mkdtempSync(join(tmpdir(), 'HromadaAID actual NSIS preflight '))
  const paths = {
    program: join(root, 'Програма з пробілами'),
    data: join(root, 'Серверні дані з пробілами'),
    backups: join(root, 'Резервні копії з пробілами'),
  }
  const preflight = fileURLToPath(new URL('../packaging/windows-installer-paths.ps1', import.meta.url))
  const nsi = join(root, 'preflight-test.nsi')
  const harness = join(root, 'preflight-test.exe')
  const capture = join(root, 'nsis-preflight-output.txt')
  const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const installerSource = readFileSync(new URL('../packaging/windows-installer.nsi', import.meta.url), 'utf8')
  const trimFunction = installerSource.match(/Function TrimPathTrailingSeparator\r?\n[\s\S]*?FunctionEnd/)?.[0]
  assert.ok(trimFunction, 'production trailing-separator helper must be available to the harness')
  const unsafeCall = `  nsExec::ExecToStack '\"${powershell}\" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File \"$PLUGINSDIR\\windows-installer-paths.ps1\" -Mode \"server-client\" -ProgramDirectory \"$PreflightProgramDirectory\" -DataDirectory \"$PreflightDataDirectory\" -BackupDirectory \"$PreflightBackupDirectory\" -ClientBytes 388534871 -ServerBytes 125227157 -SupportBytes 63725'`
  const safeCall = `  nsExec::ExecToStack '\"${powershell}\" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File \"$PLUGINSDIR\\Preflight\\windows-installer-paths.ps1\" -Mode \"server-client\" -ProgramDirectory \"$PreflightProgramDirectory\" -DataDirectory \"$PreflightDataDirectory\" -BackupDirectory \"$PreflightBackupDirectory\" -ClientBytes 388534871 -ServerBytes 125227157 -SupportBytes 63725'`
  const source = [
    'Unicode true',
    '!include "LogicLib.nsh"',
    `OutFile \"${harness}\"`,
    'Var PreflightProgramDirectory',
    'Var PreflightDataDirectory',
    'Var PreflightBackupDirectory',
    trimFunction,
    'RequestExecutionLevel user',
    'SilentInstall silent',
    'Section',
    '  InitPluginsDir',
    '  SetOutPath \"$PLUGINSDIR\"',
    `  File /oname=System.dll \"${join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'version.dll')}\"`,
    '  CreateDirectory "$PLUGINSDIR\\Preflight"',
    `  File /oname=windows-installer-paths.ps1 \"${preflight}\"`,
    `  StrCpy $PreflightProgramDirectory \"${paths.program}\\\"`,
    `  StrCpy $PreflightBackupDirectory \"${paths.backups}\\\"`,
    `  StrCpy $PreflightDataDirectory \"${process.env.SystemDrive ?? 'C:'}\\\"`,
    '  Push $PreflightProgramDirectory',
    '  Call TrimPathTrailingSeparator',
    '  Pop $PreflightProgramDirectory',
    '  Push $PreflightBackupDirectory',
    '  Call TrimPathTrailingSeparator',
    '  Pop $PreflightBackupDirectory',
    '  Push $PreflightDataDirectory',
    '  Call TrimPathTrailingSeparator',
    '  Pop $PreflightDataDirectory',
    unsafeCall,
    '  Pop $0',
    '  Pop $1',
    '  StrCpy $4 $0',
    '  StrCpy $5 $1',
    `  StrCpy $PreflightDataDirectory \"${paths.data}\\\"`,
    '  Push $PreflightDataDirectory',
    '  Call TrimPathTrailingSeparator',
    '  Pop $PreflightDataDirectory',
    '  SetOutPath "$PLUGINSDIR\\Preflight"',
    `  File /oname=windows-installer-paths.ps1 \"${preflight}\"`,
    safeCall,
    '  Pop $2',
    '  Pop $3',
    `  FileOpen $6 \"${capture}\" w`,
    '  FileWrite $6 "$4|$5$\\r$\\n$2|$3"',
    '  FileClose $6',
    'SectionEnd',
  ].join('\r\n') + '\r\n'
  writeFileSync(nsi, source, 'utf8')
  try {
    const cache = join(process.env.LOCALAPPDATA ?? '', 'electron-builder', 'Cache')
    const findMakensis = (directory, depth = 5) => {
      if (depth < 0 || !existsSync(directory)) return undefined
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const candidate = join(directory, entry.name)
        if (entry.isFile() && entry.name.toLowerCase() === 'makensis.exe') return candidate
        if (entry.isDirectory()) { const found = findMakensis(candidate, depth - 1); if (found) return found }
      }
    }
    const makensis = process.env.MAKENSIS_PATH ?? findMakensis(cache)
    if (!makensis) return t.skip('makensis is unavailable; NSIS source assertions and PowerShell tests still run.')
    execFileSync(makensis, ['/INPUTCHARSET', 'UTF8', '/V2', nsi], { windowsHide: true, timeout: 60_000 })
    const run = spawnSync(harness, ['/S'], { windowsHide: true, encoding: 'utf8', timeout: 60_000 })
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`)
    const lines = readFileSync(capture, 'utf8').trim().split(/\r?\n/).filter(Boolean)
    assert.equal(lines.length, 2, readFileSync(capture, 'utf8'))
    const failedDivider = lines[0].indexOf('|')
    const failedCode = lines[0].slice(0, failedDivider)
    const failedOutput = lines[0].slice(failedDivider + 1)
    assert.equal(failedCode, '1')
    assert.match(failedOutput, /PREFLIGHT_ERROR\|stage=arguments\|code=1\|reason=unhandled-exception/)
    assert.match(failedOutput, /line=\d+/)
    const successDivider = lines[1].indexOf('|')
    const successCode = lines[1].slice(0, successDivider)
    const successOutput = lines[1].slice(successDivider + 1)
    assert.equal(successCode, '0')
    assert.equal(successOutput, '')
    for (const path of Object.values(paths)) assert.equal(existsSync(path), false, `preflight must not create ${path}`)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('server preparation creates new data and backup directories only when installation work begins', () => {
  const root = mkdtempSync(join(tmpdir(), 'hromada-create-targets-'))
  const options = {
    mode: 'server-client',
    programDirectory: join(root, 'Програма'),
    dataDirectory: join(root, 'Дані'),
    backupDirectory: join(root, 'Копії'),
    packageRoot: join(root, 'Програма', 'Server.next'),
  }
  try {
    assert.equal(existsSync(options.dataDirectory), false)
    assert.equal(existsSync(options.backupDirectory), false)
    prepareServerInstall(options)
    for (const path of [options.dataDirectory, join(options.dataDirectory, 'Database'), join(options.dataDirectory, 'Logs'), options.backupDirectory]) {
      assert.equal(existsSync(path), true, `${path} is created during install preparation`)
    }
    assert.equal(existsSync(join(options.dataDirectory, 'Database', 'hromada-aid.sqlite')), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('administrator setup keeps credentials in masked controls and forwards them only through child stdin', async () => {
  const helper = await readFile(new URL('../packaging/admin-setup.ps1', import.meta.url), 'utf8')
  const cli = await readFile(new URL('../server/src/create-admin.ts', import.meta.url), 'utf8')
  assert.match(helper, /UseSystemPasswordChar = \$true/)
  assert.match(helper, /Ім''я користувача/)
  assert.match(helper, /displayName = \$displayName\.Trim\(\)/)
  assert.match(helper, /RedirectStandardInput = \$true/)
  assert.match(helper, /StandardInput\.WriteLine\(\$payload\)/)
  assert.doesNotMatch(helper, /Start-Transcript|Set-Clipboard|Write-Host.*password/i)
  assert.match(cli, /--installer-stdin/)
  assert.match(cli, /createFirstAdministrator\(database, \{ displayName: input\.displayName, username: input\.username, password: input\.password \}\)/)
  assert.match(cli, /input\.password = ''/)
  assert.doesNotMatch(cli, /process\.env\.[A-Z_]*PASSWORD|--password/)
})

test('server activation preserves the old package through health verification and rejects unsafe schema rollback', async () => {
  const installer = await readFile(new URL('../packaging/install-server-service.ps1', import.meta.url), 'utf8')
  const transaction = await readFile(new URL('../packaging/server-package-transaction.mjs', import.meta.url), 'utf8')
  const activation = installer.indexOf("Invoke-PackageTransaction $stagedServer 'activate'")
  const health = installer.indexOf('Wait-ServiceHealthy $healthUrl')
  const commit = installer.indexOf("Invoke-PackageTransaction $activeServer 'healthy'")
  const cleanup = transaction.indexOf("rmSync(join(program, 'Server.previous')")
  assert.ok(activation >= 0 && health > activation && commit > health && cleanup > 0)
  assert.match(installer, /schemaVersion -le \$oldSchemaMaximum/)
  assert.match(installer, /Попередній пакет не запускався/)
  assert.match(transaction, /old-package-preserved|new-package-active|health-check/)
  assert.match(transaction, /journal\.phase !== 'healthy'/)
})

test('installer rejects relative, network, missing-drive, and overlapping directories', () => {
  const root = mkdtempSync(join(tmpdir(), 'hromada-installer-'))
  try {
    const paths = base(root)
    assert.throws(() => validateInstallerOptions({ ...paths, dataDirectory: 'relative\\data' }), /абсолютним локальним шляхом/)
    assert.throws(() => validateInstallerOptions({ ...paths, dataDirectory: '\\\\server\\share\\data' }), /абсолютним локальним шляхом/)
    assert.throws(() => validateInstallerOptions(paths, { inspectVolume: () => ({ driveType: 2, fileSystem: 'NTFS', freeBytes: 1e9 }) }), /локальному диску NTFS/)
    assert.throws(() => validateInstallerOptions({ ...paths, backupDirectory: join(paths.programDirectory, 'Backups') }), /не повинні перекриватися/)
    assert.throws(() => validateInstallerOptions({ ...paths, dataDirectory: paths.backupDirectory }), /не повинні перекриватися/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('paths with Unicode and spaces render explicit installed config and WinSW absolute targets', () => {
  const root = mkdtempSync(join(tmpdir(), 'hromada-installer-'))
  const paths = base(root)
  try {
  const config = JSON.parse(renderInstalledServerConfig(paths))
  assert.equal(config.host, '127.0.0.1')
  assert.equal(config.databasePath, win32.join(paths.dataDirectory, 'Database', 'hromada-aid.sqlite'))
  const template = readFileSync(new URL('../server/windows-service/HromadaAIDService.xml.template', import.meta.url), 'utf8')
  const xml = renderWinSWConfig(template, paths)
  assert.ok(xml.includes(`${paths.programDirectory}\\Server\\runtime\\node.exe`))
  assert.ok(xml.includes(`${paths.dataDirectory}\\server.json`))
  assert.doesNotMatch(xml, /__[A-Z_]+__/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('an existing database without config is never treated as a fresh install', () => {
  const root = mkdtempSync(join(tmpdir(), 'hromada-installer-'))
  try {
    const data = join(root, 'data')
    mkdirSync(data)
    writeFileSync(join(data, 'hromada-aid.sqlite'), 'synthetic marker only')
    const paths = { ...base(root), dataDirectory: data, programDirectory: join(root, 'program'), backupDirectory: join(root, 'backups') }
    assert.throws(() => validateInstallerOptions(paths), /без конфігурації/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('an existing server config must match the selected persistent paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'hromada-installer-'))
  try {
    const data = join(root, 'data'), program = join(root, 'program'), backups = join(root, 'backups')
    mkdirSync(data); mkdirSync(program); mkdirSync(backups)
    writeFileSync(join(data, 'server.json'), JSON.stringify({ databasePath: join(data, 'hromada-aid.sqlite'), backupDirectory: join(root, 'other-backups') }))
    assert.throws(() => validateInstallerOptions({ mode: 'server', programDirectory: program, dataDirectory: data, backupDirectory: backups }), /залиште попередні шляхи/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('existing database and DPAPI key must be present together and legacy database paths are retained', () => {
  const root = mkdtempSync(join(tmpdir(), 'hromada-installer-state-'))
  try {
    const programDirectory = join(root, 'program'), dataDirectory = join(root, 'data'), backupDirectory = join(root, 'backups')
    mkdirSync(programDirectory); mkdirSync(dataDirectory); mkdirSync(backupDirectory)
    const databasePath = join(dataDirectory, 'hromada-aid.sqlite')
    const configPath = join(dataDirectory, 'server.json')
    writeFileSync(databasePath, 'synthetic database marker')
    writeFileSync(configPath, JSON.stringify({ configVersion: 2, mode: 'local', programDirectory, host: '127.0.0.1', port: 4310, databasePath, backupDirectory }))
    const paths = { mode: 'server', programDirectory, dataDirectory, backupDirectory }
    assert.throws(() => validateInstallerOptions(paths), /повний комплект/)
    writeFileSync(join(backupDirectory, '.hromadaaid-backup-key.dpapi'), 'synthetic protected key marker')
    assert.equal(validateInstallerOptions(paths).mode, 'server')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('server preparation writes config and WinSW paths without creating SQLite', () => {
  const root = mkdtempSync(join(tmpdir(), 'hromada-installer-'))
  try {
    const programDirectory = join(root, 'Програма HromadaAID')
    const dataDirectory = join(root, 'Серверні дані')
    const backupDirectory = join(root, 'Архіви')
    const templateRoot = join(programDirectory, 'Server')
    mkdirSync(join(templateRoot, 'service'), { recursive: true })
    writeFileSync(join(templateRoot, 'service', 'HromadaAIDService.xml.template'), readFileSync(new URL('../server/windows-service/HromadaAIDService.xml.template', import.meta.url), 'utf8'))
    const result = prepareServerInstall({ mode: 'server', programDirectory, dataDirectory, backupDirectory }, templateRoot)
    assert.equal(result.configCreated, true)
    assert.equal(JSON.parse(readFileSync(result.configPath, 'utf8')).databasePath, join(dataDirectory, 'Database', 'hromada-aid.sqlite'))
    assert.equal(existsSync(result.databasePath), false)
    const serviceXml = readFileSync(join(programDirectory, 'Server', 'service', 'HromadaAIDService.xml'), 'utf8')
    assert.ok(serviceXml.includes(join(programDirectory, 'Server', 'runtime', 'node.exe')))
    assert.ok(serviceXml.includes(join(dataDirectory, 'server.json')))
    assert.equal(existsSync(join(backupDirectory, '.hromadaaid-backup-key.dpapi')), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('server preparation renders WinSW configuration into the staged package, targeting the stable active path', () => {
  const root = mkdtempSync(join(tmpdir(), 'hromada-installer-stage-'))
  try {
    const programDirectory = join(root, 'Програма HromadaAID')
    const dataDirectory = join(root, 'Дані HromadaAID')
    const backupDirectory = join(root, 'Копії HromadaAID')
    const packageRoot = join(programDirectory, 'Server.next')
    mkdirSync(join(packageRoot, 'service'), { recursive: true })
    writeFileSync(join(packageRoot, 'service', 'HromadaAIDService.xml.template'), readFileSync(new URL('../server/windows-service/HromadaAIDService.xml.template', import.meta.url), 'utf8'))
    prepareServerInstall({ mode: 'server', programDirectory, dataDirectory, backupDirectory, packageRoot }, packageRoot)
    assert.ok(existsSync(join(packageRoot, 'service', 'HromadaAIDService.xml')))
    const xml = readFileSync(join(packageRoot, 'service', 'HromadaAIDService.xml'), 'utf8')
    assert.ok(xml.includes(`${programDirectory}\\Server\\runtime\\node.exe`))
    assert.equal(existsSync(join(programDirectory, 'Server', 'service', 'HromadaAIDService.xml')), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
