param(
  [Parameter(Mandatory = $true)][string]$ProgramDirectory,
  [Parameter(Mandatory = $true)][string]$DataDirectory,
  [Parameter(Mandatory = $true)][string]$BackupDirectory,
  [Parameter(Mandatory = $false)][string]$PreviousServiceStateFile
)
$ErrorActionPreference = 'Stop'
$serviceName = 'HromadaAIDApi'
$serviceAccount = 'NT SERVICE\HromadaAIDApi'
$server = Join-Path $ProgramDirectory 'Server'
$wrapper = Join-Path $server 'service\HromadaAIDService.exe'
$node = Join-Path $server 'runtime\node.exe'
$config = Join-Path $DataDirectory 'server.json'
$key = Join-Path $BackupDirectory '.hromadaaid-backup-key.dpapi'
$aclSnapshots = @{}
$createdService = $false
$wasServiceRunning = $false
$hadServiceBeforeUpdate = $false

function Invoke-Checked([string]$File, [string[]]$Arguments, [string]$Failure) {
  & $File @Arguments
  if ($LASTEXITCODE -ne 0) { throw $Failure }
}
function Save-Acl([string]$Path) {
  if ([IO.Directory]::Exists($Path) -or [IO.File]::Exists($Path)) { $aclSnapshots[$Path] = (Get-Acl -LiteralPath $Path).Sddl }
}
function Restore-Acls {
  foreach ($entry in $aclSnapshots.GetEnumerator()) {
    try {
      $acl = Get-Acl -LiteralPath $entry.Key
      $acl.SetSecurityDescriptorSddlForm([string]$entry.Value)
      Set-Acl -LiteralPath $entry.Key -AclObject $acl
    } catch { [Console]::Error.WriteLine('Не вдалося повернути попередній ACL для каталогу інсталяції; потрібне адміністративне відновлення.') }
  }
}
function Set-AclChecked([string]$Path, [string[]]$Rules, [bool]$ResetInheritance = $true) {
  $arguments = @($Path)
  if ($ResetInheritance) { $arguments += '/inheritance:r' }
  $arguments += '/grant:r'
  $arguments += $Rules
  Invoke-Checked "$env:SystemRoot\System32\icacls.exe" $arguments "Не вдалося налаштувати ACL для вибраного каталогу: $Path"
}
function Set-ReadOnlyServiceFile([string]$Path) {
  Set-AclChecked $Path @('SYSTEM:F', 'BUILTIN\Administrators:F', "$serviceAccount`:R")
  Invoke-Checked "$env:SystemRoot\System32\icacls.exe" @($Path, '/deny', "$serviceAccount`:(W,D)") "Не вдалося заборонити зміну захищеного файла: $Path"
}
function Remove-NewService {
  if (-not $createdService) { return }
  try { & $wrapper stop 2>$null; & $wrapper uninstall 2>$null } catch { }
}
function Test-HromadaServiceHealth([string]$Url) {
  $response = $null
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

try {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Для встановлення серверної служби потрібні права адміністратора.' }
  foreach ($path in @($ProgramDirectory, $DataDirectory, $BackupDirectory)) {
    if (-not [IO.Path]::IsPathFullyQualified($path) -or $path.StartsWith('\\')) { throw 'Усі каталоги сервера мають бути абсолютними локальними шляхами.' }
  }
  foreach ($path in @($server, (Join-Path $DataDirectory 'Database'), (Join-Path $DataDirectory 'Logs'), $BackupDirectory)) {
    if (-not [IO.Directory]::Exists($path)) { throw "Каталог недоступний: $path" }
  }
  foreach ($path in @($wrapper, $node, $config)) { if (-not [IO.File]::Exists($path)) { throw "Не знайдено обов'язковий файл серверного пакета: $path" } }
  $settings = Get-Content -LiteralPath $config -Raw | ConvertFrom-Json
  if ($settings.configVersion -notin @(1, 2)) { throw 'Версія server.json несумісна із встановленою версією HromadaAID.' }
  $database = [IO.Path]::GetFullPath([string]$settings.databasePath)
  if ([IO.Path]::GetFullPath([string]$settings.backupDirectory) -ine [IO.Path]::GetFullPath($BackupDirectory)) { throw 'Каталог резервних копій не відповідає server.json.' }
  $databaseRoot = Split-Path -Parent $database
  if (-not [IO.Directory]::Exists($databaseRoot)) { throw "Каталог SQLite недоступний: $databaseRoot" }
  $databaseExists = [IO.File]::Exists($database)
  $keyExists = [IO.File]::Exists($key)
  $hasArchives = @(Get-ChildItem -LiteralPath $BackupDirectory -Filter '*.hraid' -File -ErrorAction Stop).Count -gt 0
  if (($databaseExists -xor $keyExists) -or ($hasArchives -and -not ($databaseExists -and $keyExists))) { throw 'Виявлено неповний комплект бази, DPAPI-ключа або архівів. Наявні дані збережено; потрібна окрема перевірка адміністратора.' }

  $preflight = Join-Path $server 'app\dist\server\src\installer-preflight.js'
  if (-not [IO.File]::Exists($preflight)) { throw 'Не знайдено перевірку конфігурації серверного пакета.' }
  & $node $preflight --config $config
  if ($LASTEXITCODE -ne 0) { throw 'Конфігурація сервера, TLS або каталоги не пройшли перевірку.' }
  $tlsCertificate = if ($settings.tls) { [IO.Path]::GetFullPath([string]$settings.tls.certificatePath) } else { $null }
  $tlsPrivateKey = if ($settings.tls) { [IO.Path]::GetFullPath([string]$settings.tls.privateKeyPath) } else { $null }

  $existingService = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
  $hadServiceBeforeUpdate = $null -ne $existingService
  if ($PreviousServiceStateFile -and [IO.File]::Exists($PreviousServiceStateFile)) {
    $wasServiceRunning = [IO.File]::ReadAllText($PreviousServiceStateFile).Trim() -eq 'Running'
  } else {
    $wasServiceRunning = $null -ne $existingService -and $existingService.Status -eq 'Running'
  }
  if ($null -eq $existingService) {
    $createdService = $true
    Invoke-Checked $wrapper @('install') 'WinSW не зміг зареєструвати Windows Service.'
  } else {
    if ($existingService.Status -ne 'Stopped') { throw 'Служба має бути штатно зупинена перед оновленням серверних файлів.' }
    Invoke-Checked $wrapper @('uninstall') 'WinSW не зміг зняти реєстрацію служби перед оновленням.'
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while ([DateTime]::UtcNow -lt $deadline -and (Get-Service -Name $serviceName -ErrorAction SilentlyContinue)) { Start-Sleep -Milliseconds 250 }
    if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) { throw 'Windows SCM не видалив стару реєстрацію служби.' }
    $createdService = $true
    Invoke-Checked $wrapper @('install') 'WinSW не зміг повторно зареєструвати Windows Service.'
  }
  Invoke-Checked "$env:SystemRoot\System32\sc.exe" @('sidtype', $serviceName, 'unrestricted') 'Windows не зміг увімкнути service SID.'
  $sidResult = & "$env:SystemRoot\System32\sc.exe" qsidtype $serviceName 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0 -or $sidResult -notmatch 'UNRESTRICTED|unrestricted') { throw 'Не вдалося підтвердити service SID служби.' }

  foreach ($path in @($server, $DataDirectory, $databaseRoot, (Join-Path $DataDirectory 'Logs'), $BackupDirectory, $config, $key, $tlsCertificate, $tlsPrivateKey)) { if ($path) { Save-Acl $path } }
  Set-AclChecked $server @('SYSTEM:(OI)(CI)F', 'BUILTIN\Administrators:(OI)(CI)F', "$serviceAccount`:(OI)(CI)RX")
  Set-AclChecked $DataDirectory @('SYSTEM:(OI)(CI)F', 'BUILTIN\Administrators:(OI)(CI)F', "$serviceAccount`:(OI)(CI)RX")
  Set-AclChecked $databaseRoot @('SYSTEM:(OI)(CI)F', 'BUILTIN\Administrators:(OI)(CI)F', "$serviceAccount`:(OI)(CI)M")
  Set-AclChecked (Join-Path $DataDirectory 'Logs') @('SYSTEM:(OI)(CI)F', 'BUILTIN\Administrators:(OI)(CI)F', "$serviceAccount`:(OI)(CI)M")
  # The backup service needs to create and rotate archives. The DPAPI file itself
  # receives a separate non-inheriting read-only ACL after key initialization.
  Set-AclChecked $BackupDirectory @('SYSTEM:(OI)(CI)F', 'BUILTIN\Administrators:(OI)(CI)F', "$serviceAccount`:(OI)(CI)M")
  Set-ReadOnlyServiceFile $config
  if ($tlsCertificate) { Set-AclChecked $tlsCertificate @('SYSTEM:F', 'BUILTIN\Administrators:F', "$serviceAccount`:R") }
  if ($tlsPrivateKey) { Set-ReadOnlyServiceFile $tlsPrivateKey }

  if (-not $databaseExists -and -not $keyExists) {
    $initialize = Join-Path $server 'app\dist\server\src\installer-initialization.js'
    if (-not [IO.File]::Exists($initialize)) { throw 'Не знайдено перевірений механізм первинної ініціалізації.' }
    & $node $initialize --config $config --confirm-initialization
    if ($LASTEXITCODE -ne 0) { throw 'Первинну ініціалізацію скасовано або не завершено; користувацькі дані не видалялися.' }
  } else {
    $verify = Join-Path $server 'app\dist\server\src\installer-initialization.js'
    & $node $verify --config $config --confirm-initialization
    if ($LASTEXITCODE -ne 0) { throw 'Наявний ключ або конфігурація несумісні; повторну ініціалізацію не виконано.' }
  }

  if ([IO.File]::Exists($key)) { Set-ReadOnlyServiceFile $key }
  # Restore the service's backup-directory permissions after DPAPI setup, which
  # hardens that directory for the creating administrator by design.
  Set-AclChecked $BackupDirectory @('SYSTEM:(OI)(CI)F', 'BUILTIN\Administrators:(OI)(CI)F', "$serviceAccount`:(OI)(CI)M")
  if ([IO.File]::Exists($key)) { Set-ReadOnlyServiceFile $key }

  Invoke-Checked $wrapper @('start') 'Windows Service не запустилася.'
  $listenAddress = [string]$settings.host
  if ($listenAddress.Contains(':') -and -not $listenAddress.StartsWith('[')) { $listenAddress = "[$listenAddress]" }
  $scheme = if ($settings.mode -eq 'network') { 'https' } else { 'http' }
  $healthUrl = "${scheme}://${listenAddress}:$([int]$settings.port)/health"
  $deadline = [DateTime]::UtcNow.AddSeconds(60)
  $healthy = $false
  do {
    Start-Sleep -Milliseconds 500
    $service = Get-Service -Name $serviceName -ErrorAction Stop
    if ($service.Status -eq 'Running' -and (Test-HromadaServiceHealth $healthUrl)) { $healthy = $true; break }
  } while ([DateTime]::UtcNow -lt $deadline)
  if ($service.Status -ne 'Running' -or -not $healthy) { throw 'Служба або Fastify не пройшли перевірку доступності за 60 секунд. Перевірте порт, TLS, конфігурацію та журнали сервера.' }
  Write-Output 'Службу HromadaAIDApi зареєстровано й запущено. Дані розміщені в окремих вибраних каталогах.'
} catch {
  Remove-NewService
  Restore-Acls
  if ($hadServiceBeforeUpdate -and -not (Get-Service -Name $serviceName -ErrorAction SilentlyContinue)) {
    try {
      Invoke-Checked $wrapper @('install') 'restore-registration-failed'
      Invoke-Checked "$env:SystemRoot\System32\sc.exe" @('sidtype', $serviceName, 'unrestricted') 'restore-sid-failed'
      $createdService = $false
    } catch { [Console]::Error.WriteLine('Не вдалося відновити реєстрацію попередньої служби автоматично; серверні дані збережено.') }
  }
  if (-not $createdService -and $wasServiceRunning -and (Get-Service -Name $serviceName -ErrorAction SilentlyContinue)) {
    try { & $wrapper start 2>$null; if ($LASTEXITCODE -ne 0) { throw 'start-failed' } }
    catch { [Console]::Error.WriteLine('Попередня служба не запустилася автоматично після невдалого оновлення; потрібне ручне відновлення служби.') }
  }
  [Console]::Error.WriteLine("Встановлення серверної служби не завершено: $($_.Exception.Message)")
  exit 1
}
