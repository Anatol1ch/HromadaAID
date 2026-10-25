param(
  [Parameter(Mandatory = $true)][string]$ProgramDirectory,
  [Parameter(Mandatory = $true)][string]$DataDirectory,
  [Parameter(Mandatory = $true)][string]$BackupDirectory,
  [Parameter(Mandatory = $false)][string]$PreviousServiceStateFile,
  [Parameter(Mandatory = $false)][switch]$FromServerManager,
  [Parameter(Mandatory = $false)][switch]$UpdateOnly
)
$ErrorActionPreference = 'Stop'
$serviceName = 'HromadaAIDApi'
$serviceSid = $null
$stagedServer = Join-Path $ProgramDirectory 'Server.next'
$activeServer = Join-Path $ProgramDirectory 'Server'
$previousServer = Join-Path $ProgramDirectory 'Server.previous'
$failedServer = Join-Path $ProgramDirectory 'Server.failed'
$journalPath = Join-Path $DataDirectory '.hromadaaid-update-state.json'
$config = Join-Path $DataDirectory 'server.json'
$key = Join-Path $BackupDirectory '.hromadaaid-backup-key.dpapi'
$pendingAdminPath = Join-Path $DataDirectory '.hromadaaid-first-admin-pending.json'
$aclSnapshots = @{}
$newServiceRegistered = $false
$hadOldPackage = [IO.Directory]::Exists($activeServer)
$initialInstallRetry = $false
$wasServiceRunning = $false
$oldSchemaMaximum = 0
$journal = $null
$script:InstallStage = 'arguments'
$script:LastChildExitCode = $null

function Set-InstallStage([string]$Stage) {
  $script:InstallStage = $Stage
  $script:LastChildExitCode = $null
  if ($FromServerManager) { [Console]::Out.WriteLine("HROMADAAID_INSTALL_STAGE|$Stage") }
}

function Protect-InstallDiagnosticText([string]$Text) {
  return ($Text -replace '(?i)(password|token|secret|recovery.?key|private.?key|dpapi.?key|bearer)(\s*[:=]\s*)[^\s,;]+', '$1$2[redacted]')
}

function Write-InstallFailureDiagnostic($Record) {
  $exception = $Record.Exception
  $exceptions = @()
  while ($null -ne $exception) {
    $exceptions += [ordered]@{
      type = $exception.GetType().FullName
      message = (Protect-InstallDiagnosticText $exception.Message)
      hresult = $exception.HResult
    }
    $exception = $exception.InnerException
  }
  $fileName = 'HromadaAID-service-install-' + [guid]::NewGuid().ToString('N') + '.json'
  $detailWritten = $false
  try {
    $detail = [ordered]@{
      stage = $script:InstallStage
      script = [IO.Path]::GetFileName($Record.InvocationInfo.ScriptName)
      line = $Record.InvocationInfo.ScriptLineNumber
      errorId = $Record.FullyQualifiedErrorId
      childExitCode = $script:LastChildExitCode
      exceptions = $exceptions
    }
    $detailPath = [IO.Path]::Combine([IO.Path]::GetTempPath(), $fileName)
    [IO.File]::WriteAllText($detailPath, (ConvertTo-Json -InputObject $detail -Depth 8), [Text.UTF8Encoding]::new($false))
    $detailWritten = $true
  } catch { }
  $message = Protect-InstallDiagnosticText ([string]$Record.Exception.Message)
  $hresult = $Record.Exception.HResult
  $type = $Record.Exception.GetType().FullName
  $line = $Record.InvocationInfo.ScriptLineNumber
  [Console]::Out.WriteLine("SERVICE_INSTALL_ERROR|stage=$script:InstallStage|type=$type|line=$line|hresult=$hresult|childExitCode=$script:LastChildExitCode|detailFile=$fileName|detailWritten=$detailWritten|message=$message")
}

function Invoke-Checked([string]$File, [string[]]$Arguments, [string]$Failure) {
  & $File @Arguments
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) { $script:LastChildExitCode = $exitCode; throw $Failure }
  $script:LastChildExitCode = $null
}
function Test-AbsoluteLocalPath([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path) -or $Path.StartsWith('\\')) { return $false }
  $root = [IO.Path]::GetPathRoot($Path)
  if ($root -notmatch '^[A-Za-z]:\\$') { return $false }
  try {
    [void][IO.Path]::GetFullPath($Path)
    return $true
  } catch {
    return $false
  }
}
function Get-ServiceSid([string]$Name) {
  $scPath = Join-Path $env:SystemRoot 'System32\sc.exe'
  $output = & $scPath showsid $Name 2>&1
  $exitCode = $LASTEXITCODE
  $text = $output -join "`n"
  if ($exitCode -ne 0 -or $text -notmatch '(?i)\b(S-1-5-80-(?:\d+-){4}\d+)\b') {
    throw 'Не вдалося визначити SID служби для налаштування захищених прав доступу.'
  }
  return $Matches[1]
}
function Save-Acl([string]$Path) {
  if ([IO.Directory]::Exists($Path) -or [IO.File]::Exists($Path)) { $aclSnapshots[$Path] = (Get-Acl -LiteralPath $Path).Sddl }
}
function Restore-Acls {
  foreach ($entry in $aclSnapshots.GetEnumerator()) {
    try {
      if ([IO.Directory]::Exists($entry.Key) -or [IO.File]::Exists($entry.Key)) {
        $acl = Get-Acl -LiteralPath $entry.Key
        $acl.SetSecurityDescriptorSddlForm([string]$entry.Value)
        Set-Acl -LiteralPath $entry.Key -AclObject $acl
      }
    } catch { [Console]::Error.WriteLine('Не вдалося повернути попередні права доступу; потрібне адміністративне відновлення.') }
  }
}
function Set-AclChecked([string]$Path, [string[]]$Rules, [bool]$ResetInheritance = $true) {
  $arguments = @($Path)
  if ($ResetInheritance) { $arguments += '/inheritance:r' }
  $arguments += '/grant:r'; $arguments += $Rules
  Invoke-Checked "$env:SystemRoot\System32\icacls.exe" $arguments 'Не вдалося налаштувати права доступу до вибраних каталогів.'
}
function Set-ReadOnlyServiceFile([string]$Path) {
  Set-AclChecked $Path @('*S-1-5-18:F', '*S-1-5-32-544:F')
}
function Grant-ServiceAccess([string]$Path, [string]$Permissions, [string]$Inheritance = '') {
  if ([string]::IsNullOrWhiteSpace($script:serviceSid)) { throw 'SID служби ще не підтверджено; доступ до серверних файлів не змінено.' }
  $servicePrincipal = "*$script:serviceSid"
  $inheritanceFlags = if ($Inheritance) { "($Inheritance)" } else { '' }
  Set-AclChecked $Path @("$servicePrincipal`:$inheritanceFlags$Permissions") $false
}
function Protect-ServiceFile([string]$Path) {
  Grant-ServiceAccess $Path 'R'
  $servicePrincipal = "*$script:serviceSid"
  # Replace our legacy deny ACE: icacls W also denies SYNCHRONIZE and breaks
  # synchronous reads, even when LocalService or the service SID has Allow R.
  Invoke-Checked "$env:SystemRoot\System32\icacls.exe" @($Path, '/remove:d', $servicePrincipal) 'Не вдалося оновити захист конфігураційного файла служби.'
  Invoke-Checked "$env:SystemRoot\System32\icacls.exe" @($Path, '/deny', "$servicePrincipal`:(WD,AD,WEA,WA,DE)") 'Не вдалося захистити конфігураційний файл від змін службою.'
}
function Grant-LocalServiceConfigRead {
  # LocalService needs to traverse the data directory and read the non-secret
  # server.json. Keep this built-in account away from the database, keys, logs,
  # and backups; those remain scoped to the unique service SID above.
  Invoke-Checked "$env:SystemRoot\System32\icacls.exe" @($DataDirectory, '/grant:r', '*S-1-5-19:(X)') 'Не вдалося надати LocalService доступ для проходу до конфігурації сервера.'
  Invoke-Checked "$env:SystemRoot\System32\icacls.exe" @($config, '/grant:r', '*S-1-5-19:R') 'Не вдалося надати LocalService читання конфігурації сервера.'
}
function Configure-ServiceAccess {
  $inheritance = 'OI)(CI'
  Grant-ServiceAccess $DataDirectory 'RX' $inheritance
  Grant-ServiceAccess $databaseRoot 'M' $inheritance
  Grant-ServiceAccess (Join-Path $DataDirectory 'Logs') 'M' $inheritance
  Grant-ServiceAccess $BackupDirectory 'M' $inheritance
  Grant-ServiceAccess $activeServer 'RX' $inheritance
  Protect-ServiceFile $config
  Grant-LocalServiceConfigRead
  if ($settings.tls) {
    $tlsCertificate = [IO.Path]::GetFullPath([string]$settings.tls.certificatePath)
    $tlsPrivateKey = [IO.Path]::GetFullPath([string]$settings.tls.privateKeyPath)
    if ([IO.File]::Exists($tlsCertificate)) { Protect-ServiceFile $tlsCertificate }
    if ([IO.File]::Exists($tlsPrivateKey)) { Protect-ServiceFile $tlsPrivateKey }
  }
  if ([IO.File]::Exists($key)) { Protect-ServiceFile $key }
}
function Assert-ServiceAcl([string]$Path, [string]$Sid, [Security.AccessControl.FileSystemRights]$Rights) {
  # Check both identities present in the service token. An Allow ACE for one
  # cannot override a conflicting Deny for the other (or a common service group).
  $tokenSids = @('S-1-5-19', $script:serviceSid, 'S-1-1-0', 'S-1-5-11', 'S-1-5-6')
  $rules = (Get-Acl -LiteralPath $Path -ErrorAction Stop).GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])
  $granted = 0L
  $denied = 0L
  foreach ($rule in $rules) {
    if (($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0) { continue }
    $identity = $rule.IdentityReference.Value
    if ($rule.AccessControlType -eq 'Allow' -and $identity -eq $Sid) { $granted = $granted -bor [long]$rule.FileSystemRights }
    if ($rule.AccessControlType -eq 'Deny' -and $tokenSids -contains $identity) { $denied = $denied -bor [long]$rule.FileSystemRights }
  }
  $required = [long]$Rights
  if (($denied -band $required) -ne 0) { throw "ACL забороняє необхідні права служби до '$Path' (SID $Sid). Запуск служби скасовано." }
  if (($granted -band $required) -ne $required) { throw "Не підтверджено необхідні права служби до '$Path' (SID $Sid). Запуск служби скасовано." }
}
function Assert-ServiceAccess {
  $read = [Security.AccessControl.FileSystemRights]::Read -bor [Security.AccessControl.FileSystemRights]::Synchronize
  $execute = [Security.AccessControl.FileSystemRights]::ReadAndExecute -bor [Security.AccessControl.FileSystemRights]::Synchronize
  $modify = [Security.AccessControl.FileSystemRights]::Modify -bor [Security.AccessControl.FileSystemRights]::Synchronize
  Assert-ServiceAcl $DataDirectory 'S-1-5-19' ([Security.AccessControl.FileSystemRights]::Traverse)
  Assert-ServiceAcl $DataDirectory $script:serviceSid $execute
  Assert-ServiceAcl $config 'S-1-5-19' $read
  Assert-ServiceAcl $config $script:serviceSid $read
  foreach ($path in @($databaseRoot, (Join-Path $DataDirectory 'Logs'), $BackupDirectory)) { Assert-ServiceAcl $path $script:serviceSid $modify }
  Assert-ServiceAcl ([string]$settings.databasePath) $script:serviceSid $modify
  Assert-ServiceAcl $activeServer $script:serviceSid $execute
  $protectedFiles = @($key)
  if ($settings.tls) { $protectedFiles += @([string]$settings.tls.certificatePath, [string]$settings.tls.privateKeyPath) }
  foreach ($path in $protectedFiles) { Assert-ServiceAcl $path $script:serviceSid $read }
}
function Invoke-PackageTransaction([string]$PackageRoot, [string]$Action, [string[]]$AdditionalArguments = @()) {
  $node = Join-Path $PackageRoot 'runtime\node.exe'
  $tool = Join-Path $PackageRoot 'installer\server-package-transaction.mjs'
  if (-not [IO.File]::Exists($node) -or -not [IO.File]::Exists($tool)) { throw 'Пакет не містить безпечного механізму перемикання серверних файлів.' }
  $arguments = @($tool, $Action, '--program-dir', $ProgramDirectory, '--data-dir', $DataDirectory) + $AdditionalArguments
  & $node @arguments
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) { $script:LastChildExitCode = $exitCode; throw 'Не вдалося виконати контрольоване перемикання серверного пакета.' }
  $script:LastChildExitCode = $null
}
function Get-SupportedSchemaMaximum([string]$PackageRoot) {
  $databaseModule = Join-Path $PackageRoot 'app\dist\electron\database.js'
  if (-not [IO.File]::Exists($databaseModule)) { throw 'Пакет не містить метаданих сумісності SQLite.' }
  $text = [IO.File]::ReadAllText($databaseModule)
  $versions = [regex]::Matches($text, 'version\s*:\s*(\d+)') | ForEach-Object { [int]$_.Groups[1].Value }
  if (-not $versions -or ($versions | Measure-Object -Maximum).Maximum -lt 1) { throw 'Не вдалося визначити сумісну версію схеми SQLite.' }
  return [int](($versions | Measure-Object -Maximum).Maximum)
}
function Get-DatabaseStatus([string]$Node, [string]$PackageRoot, [string]$DatabasePath) {
  $cli = Join-Path $PackageRoot 'app\dist\server\src\create-admin.js'
  if (-not [IO.File]::Exists($cli)) { throw 'Пакет не містить перевірки стану облікових записів.' }
  $output = @()
  Push-Location (Join-Path $PackageRoot 'app')
  try {
    $output = @(& $Node $cli --database $DatabasePath --status 2>&1)
    $exitCode = $LASTEXITCODE
  } finally { Pop-Location }
  if ($exitCode -ne 0) {
    $script:LastChildExitCode = $exitCode
    $details = Protect-InstallDiagnosticText (($output | ForEach-Object { [string]$_ }) -join "`n")
    if ($details.Length -gt 2500) { $details = $details.Substring(0, 2500) }
    if ($details) { throw "Не вдалося безпечно прочитати стан серверної бази. Дочірній процес: $details" }
    throw 'Не вдалося безпечно прочитати стан серверної бази; дочірній процес не повернув діагностики.'
  }
  $script:LastChildExitCode = $null
  try { return ($output | Select-Object -Last 1 | ConvertFrom-Json) }
  catch { throw 'Перевірка стану серверної бази повернула неочікуваний результат.' }
}
function Wait-ServiceRemoved {
  $deadline = [DateTime]::UtcNow.AddSeconds(20)
  while ([DateTime]::UtcNow -lt $deadline -and (Get-Service -Name $serviceName -ErrorAction SilentlyContinue)) { Start-Sleep -Milliseconds 250 }
  if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) { throw 'Windows SCM не видалив попередню реєстрацію служби.' }
}
function Register-Service([string]$Wrapper) {
  Invoke-Checked $Wrapper @('install') 'WinSW не зміг зареєструвати службу HromadaAIDApi.'
  $script:newServiceRegistered = $true
  Invoke-Checked "$env:SystemRoot\System32\sc.exe" @('sidtype', $serviceName, 'unrestricted') 'Не вдалося налаштувати service SID.'
  $sidResult = & "$env:SystemRoot\System32\sc.exe" qsidtype $serviceName 2>&1 | Out-String
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0 -or $sidResult -notmatch 'UNRESTRICTED|unrestricted') { $script:LastChildExitCode = $exitCode; throw 'Не вдалося підтвердити service SID служби.' }
  $script:LastChildExitCode = $null
  $script:serviceSid = Get-ServiceSid $serviceName
}
function Get-HealthUrl($Settings) {
  $hostName = [string]$Settings.host
  if ($hostName.Contains(':') -and -not $hostName.StartsWith('[')) { $hostName = "[$hostName]" }
  $scheme = if ($Settings.mode -eq 'network') { 'https' } else { 'http' }
  return "${scheme}://${hostName}:$([int]$Settings.port)/health"
}
function Test-HromadaServiceHealth([string]$Url) {
  try {
    $response = Invoke-WebRequest -Uri $Url -Method Get -TimeoutSec 3 -UseBasicParsing
    $body = $response.Content | ConvertFrom-Json
    return ([int]$response.StatusCode -eq 200 -and $body.service -eq 'hromada-aid-api' -and $body.status -eq 'ok')
  } catch {
    $response = $_.Exception.Response
    if ($null -eq $response) { return $false }
    try {
      $reader = [IO.StreamReader]::new($response.GetResponseStream())
      try { $body = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
      return ([int]$response.StatusCode -eq 503 -and $body.code -eq 'RESTORE_MAINTENANCE')
    } catch { return $false }
  }
}
function Wait-ServiceHealthy([string]$Url, [int]$TimeoutSeconds = 60) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    Start-Sleep -Milliseconds 500
    $service = Get-Service -Name $serviceName -ErrorAction Stop
    if ($service.Status -eq 'Running' -and (Test-HromadaServiceHealth $Url)) { return }
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "Служба або Fastify не пройшли перевірку доступності за $TimeoutSeconds секунд. Перевірте порт, TLS, конфігурацію та журнали сервера."
}
function Unregister-ServiceIfPresent([string]$Wrapper) {
  $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
  if ($null -eq $service) { return }
  if ($service.Status -ne 'Stopped') { Stop-Service -Name $serviceName -ErrorAction Stop; (Get-Service -Name $serviceName).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(45)) }
  if ([IO.File]::Exists($Wrapper)) { & $Wrapper uninstall; if ($LASTEXITCODE -ne 0) { throw 'Не вдалося видалити реєстрацію служби.' } }
  Wait-ServiceRemoved
}

try {
  Set-InstallStage 'validate-inputs'
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Для встановлення серверної служби потрібні права адміністратора.' }
  foreach ($path in @($ProgramDirectory, $DataDirectory, $BackupDirectory)) {
    if (-not (Test-AbsoluteLocalPath $path)) { throw 'Усі каталоги сервера мають бути абсолютними локальними шляхами.' }
  }
  foreach ($path in @($stagedServer, (Join-Path $DataDirectory 'Database'), (Join-Path $DataDirectory 'Logs'), $BackupDirectory)) {
    if (-not [IO.Directory]::Exists($path)) { throw "Каталог недоступний: $path" }
  }
  foreach ($path in @((Join-Path $stagedServer 'service\HromadaAIDService.exe'), (Join-Path $stagedServer 'runtime\node.exe'), $config)) {
    if (-not [IO.File]::Exists($path)) { throw "Не знайдено обов'язковий файл серверного пакета: $path" }
  }
  Set-InstallStage 'verify-package'
  $newNode = Join-Path $stagedServer 'runtime\node.exe'
  $packageVerifier = Join-Path $stagedServer 'installer\verify-server-package.mjs'
  if (-not [IO.File]::Exists($packageVerifier)) { throw 'Не знайдено перевірку повноти серверного пакета.' }
  & $newNode $packageVerifier $stagedServer
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) { $script:LastChildExitCode = $exitCode; throw 'Новий серверний пакет неповний або пошкоджений; встановлену версію не перемикали.' }
  $script:LastChildExitCode = $null
  if ([IO.File]::Exists($journalPath)) {
    try { $priorJournal = Get-Content -LiteralPath $journalPath -Raw -Encoding UTF8 | ConvertFrom-Json }
    catch { throw 'Журнал попереднього встановлення пошкоджений; автоматичне оновлення зупинено.' }
    $serviceExists = $null -ne (Get-Service -Name $serviceName -ErrorAction SilentlyContinue)
    if ($priorJournal.phase -eq 'initial-install-needs-review' -and -not $priorJournal.hadPreviousPackage -and -not $serviceExists -and -not [IO.Directory]::Exists($previousServer)) {
      $initialInstallRetry = $true
      $hadOldPackage = $false
      Remove-Item -LiteralPath $journalPath -Force
      if ([IO.Directory]::Exists($failedServer)) { Remove-Item -LiteralPath $failedServer -Recurse -Force }
    } else { throw 'Виявлено незавершений журнал оновлення сервера. Нове оновлення зупинено; потрібне контрольоване відновлення попереднього пакета.' }
  }
  if ([IO.Directory]::Exists($previousServer) -or [IO.Directory]::Exists($failedServer)) { throw 'Знайдено службовий каталог попереднього або невдалого пакета. Автоматичне видалення чи перезапис зупинено; потрібна перевірка адміністратора.' }

  Set-InstallStage 'validate-resume-state'
  Set-InstallStage 'validate-configuration-and-existing-data'
  $settings = Get-Content -LiteralPath $config -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($settings.configVersion -notin @(1, 2)) { throw 'Версія server.json несумісна із встановленою версією HromadaAID.' }
  $database = [IO.Path]::GetFullPath([string]$settings.databasePath)
  if ([IO.Path]::GetFullPath([string]$settings.backupDirectory) -ine [IO.Path]::GetFullPath($BackupDirectory)) { throw 'Каталог резервних копій не відповідає server.json.' }
  $databaseRoot = Split-Path -Parent $database
  if (-not [IO.Directory]::Exists($databaseRoot)) { throw "Каталог SQLite недоступний: $databaseRoot" }
  $databaseExists = [IO.File]::Exists($database)
  $keyExists = [IO.File]::Exists($key)
  $hasArchives = @(Get-ChildItem -LiteralPath $BackupDirectory -Filter '*.hraid' -File -ErrorAction Stop).Count -gt 0
  if (($databaseExists -xor $keyExists) -or ($hasArchives -and -not ($databaseExists -and $keyExists))) { throw 'Виявлено неповний комплект бази, DPAPI-ключа або архівів. Наявні дані збережено; потрібна окрема перевірка адміністратора.' }

  Set-InstallStage 'validate-server-preflight'
  $preflight = Join-Path $stagedServer 'app\dist\server\src\installer-preflight.js'
  & $newNode $preflight --config $config
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) { $script:LastChildExitCode = $exitCode; throw 'Конфігурація сервера, TLS або каталоги не пройшли перевірку.' }
  $script:LastChildExitCode = $null
  $newSchemaMaximum = Get-SupportedSchemaMaximum $stagedServer
  if ($hadOldPackage) {
    $oldSchemaMaximum = Get-SupportedSchemaMaximum $activeServer
    if ($newSchemaMaximum -lt $oldSchemaMaximum) { throw 'Новий сервер не підтримує всі версії SQLite, які підтримує встановлена версія. Оновлення не активовано.' }
  }

  $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
  if ($UpdateOnly -and (-not $hadOldPackage -or $null -eq $service)) {
    throw 'Режим оновлення доступний лише для наявного серверного пакета із зареєстрованою службою. Первинне встановлення не виконано.'
  }
  if ($PreviousServiceStateFile -and [IO.File]::Exists($PreviousServiceStateFile)) { $wasServiceRunning = [IO.File]::ReadAllText($PreviousServiceStateFile).Trim() -eq 'Running' }
  else { $wasServiceRunning = $null -ne $service -and $service.Status -eq 'Running' }

  Set-InstallStage 'configure-acl'
  foreach ($path in @($ProgramDirectory, $activeServer, $DataDirectory, $databaseRoot, (Join-Path $DataDirectory 'Logs'), $BackupDirectory, $config, $key)) { Save-Acl $path }
  if (-not $hadOldPackage) {
    # Initial install needs the baseline ACLs before creating data. During an
    # update, preserve live data ACLs until the service is stopped; the normal
    # service-ACL phase below applies and verifies the service access safely.
    Set-AclChecked $DataDirectory @('*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F')
    Set-AclChecked $databaseRoot @('*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F')
    Set-AclChecked (Join-Path $DataDirectory 'Logs') @('*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F')
    Set-AclChecked $BackupDirectory @('*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F')
    Set-ReadOnlyServiceFile $config
    if ($settings.tls) {
      $tlsCertificate = [IO.Path]::GetFullPath([string]$settings.tls.certificatePath)
      $tlsPrivateKey = [IO.Path]::GetFullPath([string]$settings.tls.privateKeyPath)
      if ([IO.File]::Exists($tlsCertificate)) { Save-Acl $tlsCertificate; Set-ReadOnlyServiceFile $tlsCertificate }
      if ([IO.File]::Exists($tlsPrivateKey)) { Save-Acl $tlsPrivateKey; Set-ReadOnlyServiceFile $tlsPrivateKey }
    }
  }

  Set-InstallStage 'initialize-data'
  if (-not $databaseExists -and -not $keyExists) {
    if ($hasArchives) { throw 'У каталозі резервних копій уже є архіви. Чисту ініціалізацію зупинено.' }
    if ([IO.File]::Exists($pendingAdminPath)) {
      try { $pending = Get-Content -LiteralPath $pendingAdminPath -Raw -Encoding UTF8 | ConvertFrom-Json }
      catch { throw 'Маркер незавершеного першого налаштування пошкоджений; наявні дані збережено.' }
      if ($pending.formatVersion -ne 1 -or [IO.Path]::GetFullPath([string]$pending.databasePath) -ine $database) { throw 'Маркер першого налаштування належить іншій базі; наявні дані збережено.' }
    } else {
      $pending = [ordered]@{ formatVersion = 1; databasePath = $database; createdAt = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json -Compress
      try { [IO.File]::WriteAllText($pendingAdminPath, $pending, [Text.UTF8Encoding]::new($false)) }
      catch { if (-not [IO.File]::Exists($pendingAdminPath)) { throw 'Не вдалося зафіксувати незавершений стан першого налаштування.' } }
    }
    Set-ReadOnlyServiceFile $pendingAdminPath
    $initialize = Join-Path $stagedServer 'app\dist\server\src\installer-initialization.js'
    & $newNode $initialize --config $config --confirm-initialization
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) { $script:LastChildExitCode = $exitCode; throw 'Первинну ініціалізацію не завершено; повторний запуск зможе продовжити її.' }
    $script:LastChildExitCode = $null
    $databaseExists = $true; $keyExists = [IO.File]::Exists($key)
  } else {
    $verify = Join-Path $stagedServer 'app\dist\server\src\installer-initialization.js'
    & $newNode $verify --config $config --confirm-initialization
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) { $script:LastChildExitCode = $exitCode; throw 'Наявний ключ або конфігурація несумісні; повторну ініціалізацію не виконано.' }
    $script:LastChildExitCode = $null
  }

  if (-not $hadOldPackage) {
    if ([IO.File]::Exists($key)) { Set-ReadOnlyServiceFile $key }
    Set-AclChecked $BackupDirectory @('*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F')
    if ([IO.File]::Exists($key)) { Set-ReadOnlyServiceFile $key }
  }

  Set-InstallStage 'inspect-database-and-create-admin'
  $databaseStatus = Get-DatabaseStatus $newNode $stagedServer $database
  if ([int]$databaseStatus.schemaVersion -gt $newSchemaMaximum) { throw 'Схема наявної SQLite новіша за цей пакет сервера; оновлення зупинено.' }
  if ($hadOldPackage -and [int]$databaseStatus.schemaVersion -gt $oldSchemaMaximum) { throw 'Попередній пакет не підтримує поточну версію SQLite. Оновлення з автоматичним відкатом небезпечне й зупинене.' }
  $pendingExists = [IO.File]::Exists($pendingAdminPath)
  if ($pendingExists) {
    try { $pending = Get-Content -LiteralPath $pendingAdminPath -Raw -Encoding UTF8 | ConvertFrom-Json }
    catch { throw 'Маркер незавершеного першого налаштування пошкоджений; автоматичне створення облікового запису зупинено.' }
    if ([IO.Path]::GetFullPath([string]$pending.databasePath) -ine $database) { throw 'Маркер першого налаштування належить іншій SQLite; автоматичні зміни зупинено.' }
  }
  if ($UpdateOnly -and ($databaseStatus.users -eq 0 -or $pendingExists)) {
    throw 'Оновлення зупинено: наявна база не підтверджує завершене первинне налаштування. Створення адміністратора під час оновлення заборонено; дані збережено.'
  }
  if ($databaseStatus.users -eq 0) {
    if (-not $pendingExists) { throw 'База існує без користувачів і без маркера першого встановлення. Створення адміністратора в довільній базі заборонено; потрібне окреме рішення адміністратора.' }
    $adminScript = Join-Path $stagedServer 'installer\admin-setup.ps1'
    $createAdminCli = Join-Path $stagedServer 'app\dist\server\src\create-admin.js'
    $adminArguments = @('-NoLogo', '-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $adminScript), '-NodeExecutable', ('"{0}"' -f $newNode), '-CreateAdminScript', ('"{0}"' -f $createAdminCli), '-DatabasePath', ('"{0}"' -f $database))
    $adminProcess = Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList $adminArguments -WindowStyle Hidden -Wait -PassThru
    if ($adminProcess.ExitCode -ne 0) { throw 'Першого адміністратора не створено. Наявні база, ключ і архіви збережено; повторіть встановлення для продовження.' }
    $databaseStatus = Get-DatabaseStatus $newNode $stagedServer $database
    if ($databaseStatus.users -ne 'present') { throw 'Після створення адміністратора перевірка облікового запису не пройшла.' }
  }

  # Keep all package, configuration, SQLite, compatibility and ACL checks
  # ahead of service downtime. Stop only immediately before the transaction.
  if ($null -ne $service -and $service.Status -ne 'Stopped') {
    Set-InstallStage 'stop-service'
    Stop-Service -Name $serviceName -ErrorAction Stop
    $service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(45))
    $service = Get-Service -Name $serviceName -ErrorAction Stop
    if ($service.Status -ne 'Stopped') { throw 'Windows Service не підтвердила штатну зупинку перед перемиканням пакета.' }
  }

  Set-InstallStage 'prepare-package-journal'
  $preparedArguments = @('--had-previous', ([string]$hadOldPackage).ToLowerInvariant(), '--old-schema', [string]$oldSchemaMaximum, '--schema-before', [string]$databaseStatus.schemaVersion, '--service-was-running', ([string]$wasServiceRunning).ToLowerInvariant())
  Invoke-PackageTransaction $stagedServer 'prepare' $preparedArguments
  $oldWrapper = Join-Path $activeServer 'service\HromadaAIDService.exe'
  if ($null -ne $service) {
    if ($service.Status -ne 'Stopped') { throw 'Служба має бути штатно зупинена перед оновленням серверних файлів.' }
    if (-not $hadOldPackage -or -not [IO.File]::Exists($oldWrapper)) { throw 'Не знайдено попередній WinSW для безпечного оновлення.' }
    & $oldWrapper uninstall
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) { $script:LastChildExitCode = $exitCode; throw 'WinSW не зміг зняти реєстрацію попередньої служби.' }
    $script:LastChildExitCode = $null
    Wait-ServiceRemoved
  }
  Set-InstallStage 'activate-server-package'
  $activateArguments = if ($initialInstallRetry) { @('--initial-retry', 'true') } else { @() }
  Invoke-PackageTransaction $stagedServer 'activate' $activateArguments

  $wrapper = Join-Path $activeServer 'service\HromadaAIDService.exe'
  Set-AclChecked $activeServer @('*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F')
  Set-InstallStage 'register-service-and-sid'
  Register-Service $wrapper
  Set-InstallStage 'grant-service-acl'
  Configure-ServiceAccess
  $settings = Get-Content -LiteralPath $config -Raw -Encoding UTF8 | ConvertFrom-Json
  $healthUrl = Get-HealthUrl $settings
  Set-InstallStage 'verify-service-acl'
  Assert-ServiceAccess
  Set-InstallStage 'start-service'
  Invoke-Checked $wrapper @('start') 'Windows Service не запустилася.'
  Set-InstallStage 'health-check'
  Invoke-PackageTransaction $activeServer 'health-check'
  Wait-ServiceHealthy $healthUrl
  Invoke-PackageTransaction $activeServer 'healthy'
  try { if ([IO.File]::Exists($pendingAdminPath)) { Remove-Item -LiteralPath $pendingAdminPath -Force } } catch { [Console]::Error.WriteLine('Не вдалося прибрати маркер першого налаштування; сервер пройшов health-перевірку.') }
  try {
    $finalizeArguments = if ($initialInstallRetry) { @('--initial-retry', 'true') } else { @() }
    Set-InstallStage 'finalize-update'
    Invoke-PackageTransaction $activeServer 'finalize' $finalizeArguments
  } catch { [Console]::Error.WriteLine('Сервер пройшов health-перевірку, але попередній пакет або журнал залишено для наступного контрольованого прибирання.') }
  Write-Output 'Службу HromadaAIDApi зареєстровано, запущено й перевірено. Попередній пакет видаляється лише після успішної перевірки.'
} catch {
  $caught = $_
  $failure = Protect-InstallDiagnosticText ([string]$caught.Exception.Message)
  Write-InstallFailureDiagnostic $caught
  $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
  # A validation failure must never take a healthy installed service offline.
  # Only stop a replacement/rollback service after transaction files exist.
  $transactionStarted = [IO.Directory]::Exists($previousServer) -or [IO.Directory]::Exists($failedServer) -or $newServiceRegistered
  if ($transactionStarted -and $null -ne $service -and $service.Status -ne 'Stopped') { try { Stop-Service -Name $serviceName -ErrorAction Stop; (Get-Service -Name $serviceName).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(45)) } catch { } }
  $activeWrapper = Join-Path $activeServer 'service\HromadaAIDService.exe'
  if ($newServiceRegistered -and [IO.File]::Exists($activeWrapper)) { try { & $activeWrapper uninstall 2>$null } catch { } }

  if ($hadOldPackage -and [IO.Directory]::Exists($activeServer) -and -not [IO.Directory]::Exists($previousServer)) {
    try {
      Restore-Acls
      $oldWrapper = Join-Path $activeServer 'service\HromadaAIDService.exe'
      if (-not (Get-Service -Name $serviceName -ErrorAction SilentlyContinue)) { Register-Service $oldWrapper }
      if ($wasServiceRunning) {
        $currentService = Get-Service -Name $serviceName -ErrorAction Stop
        if ($currentService.Status -ne 'Running') { Invoke-Checked $oldWrapper @('start') 'Не вдалося повторно запустити встановлену службу.' }
        Wait-ServiceHealthy (Get-HealthUrl (Get-Content -LiteralPath $config -Raw -Encoding UTF8 | ConvertFrom-Json))
      }
      if ([IO.File]::Exists($journalPath)) { Invoke-PackageTransaction $stagedServer 'discard-prepared' }
      [Console]::Error.WriteLine("Оновлення зупинено до перемикання пакета; попередній сервер залишено: $failure")
      exit 1
    } catch { $failure = 'Попередній пакет залишився на місці, але його стан служби потребує перевірки адміністратором.' }
  }

  if ([IO.Directory]::Exists($previousServer)) {
    $canRollback = $false
    try {
      $statusRoot = if ([IO.Directory]::Exists($activeServer)) { $activeServer } else { $stagedServer }
      $current = Get-DatabaseStatus (Join-Path $statusRoot 'runtime\node.exe') $statusRoot ([string]((Get-Content -LiteralPath $config -Raw -Encoding UTF8 | ConvertFrom-Json).databasePath))
      $canRollback = [int]$current.schemaVersion -le $oldSchemaMaximum
    } catch { $canRollback = $false }
    if ($canRollback -and -not [IO.Directory]::Exists($failedServer)) {
      try {
        Invoke-PackageTransaction $statusRoot 'rollback' @('--schema-version', [string]$current.schemaVersion)
        Restore-Acls
        $rollbackWrapper = Join-Path $activeServer 'service\HromadaAIDService.exe'
        Register-Service $rollbackWrapper
        if ($wasServiceRunning) {
          Invoke-Checked $rollbackWrapper @('start') 'Не вдалося запустити попередній пакет після відкату.'
          Wait-ServiceHealthy (Get-HealthUrl (Get-Content -LiteralPath $config -Raw -Encoding UTF8 | ConvertFrom-Json))
        }
        $rollbackToolRoot = if ([IO.Directory]::Exists($failedServer)) { $failedServer } elseif ([IO.Directory]::Exists($stagedServer)) { $stagedServer } else { $activeServer }
        Invoke-PackageTransaction $rollbackToolRoot 'finalize-rollback'
        [Console]::Error.WriteLine("Нове оновлення не пройшло перевірку. Попередній серверний пакет відновлено: $failure")
        exit 1
      } catch {
        try { Unregister-ServiceIfPresent (Join-Path $activeServer 'service\HromadaAIDService.exe') } catch { }
        $failure = 'Не вдалося завершити безпечний відкат. Попередній пакет і журнал збережено; потрібне адміністративне відновлення.'
      }
    } else {
      $failure = 'Версія SQLite змінилася або її сумісність неможливо підтвердити. Попередній пакет не запускався; обидва пакети та журнал збережено для адміністративного відновлення.'
    }
  } elseif ([IO.File]::Exists($journalPath)) {
    try {
      if (-not $hadOldPackage) {
        $transactionRoot = if ([IO.Directory]::Exists($activeServer)) { $activeServer } else { $stagedServer }
        Invoke-PackageTransaction $transactionRoot 'initial-needs-review'
      }
    } catch { }
  }
  Restore-Acls
  [Console]::Error.WriteLine("Встановлення сервера не завершено: $failure")
  exit 1
}
