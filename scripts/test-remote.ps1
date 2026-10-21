<#
.SYNOPSIS
  Starts an isolated remote-mode HromadaAID session for manual integration checks.

  The script never uses the standard Electron AppData profile or the production
  HromadaAID SQLite database. The Fastify process is started directly, tracked
  by its PID, and stopped only when it belongs to this test environment.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$pnpm = (Get-Command pnpm.cmd -ErrorAction Stop).Source
$node = (Get-Command node.exe -ErrorAction Stop).Source
$testRoot = Join-Path $root 'server\.data\manual-remote-test'
$databasePath = Join-Path $testRoot 'hromada-aid-remote-test.sqlite'
$profilePath = Join-Path $testRoot 'electron-user-data'
$pidPath = Join-Path $testRoot 'fastify.pid'
$port = 4310
$apiUrl = "http://127.0.0.1:$port"
$serverProcess = $null

function Get-PortOwners([int] $Port) {
  return @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique)
}

function Get-ProcessSummary([int] $ProcessId) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
  if (-not $process) { return "PID $ProcessId (процес уже завершився)" }
  $command = if ($process.CommandLine) { $process.CommandLine } else { '<командний рядок недоступний>' }
  return "PID ${ProcessId}: $command"
}

function Get-TrackedTestServer() {
  if (-not (Test-Path -LiteralPath $pidPath)) { return $null }
  $value = (Get-Content -LiteralPath $pidPath -Raw -ErrorAction SilentlyContinue).Trim()
  $processId = 0
  if (-not [int]::TryParse($value, [ref] $processId) -or $processId -le 0) { return $null }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue
  if (-not $process) { return $null }
  $expected = [Regex]::Escape((Join-Path $root 'dist-server\server\src\index.js')).Replace('\\', '[\\/]')
  if ($process.Name -notmatch '^node(\.exe)?$' -or -not $process.CommandLine -or $process.CommandLine -notmatch $expected) { return $null }
  return $process
}

function Stop-TrackedTestServer([int] $ExpectedProcessId = 0) {
  $tracked = Get-TrackedTestServer
  if (-not $tracked) { Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue; return }
  if ($ExpectedProcessId -gt 0 -and $tracked.ProcessId -ne $ExpectedProcessId) { return }
  Write-Host "Завершуємо тестовий API (PID $($tracked.ProcessId))…" -ForegroundColor Cyan
  Stop-Process -Id $tracked.ProcessId -ErrorAction SilentlyContinue
  Wait-Process -Id $tracked.ProcessId -Timeout 5 -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
}

if (-not (Test-Path (Join-Path $root 'package.json'))) { throw 'Не знайдено корінь проєкту HromadaAID.' }
if (-not (Test-Path (Join-Path $root 'node_modules'))) { throw 'Не знайдено node_modules. Виконайте pnpm install.' }

New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
$resolvedTestRoot = [System.IO.Path]::GetFullPath($testRoot)
$resolvedDatabase = [System.IO.Path]::GetFullPath($databasePath)
if (-not $resolvedDatabase.StartsWith($resolvedTestRoot, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Тестова SQLite має бути всередині ізольованого каталогу.' }

# A previous normal test may have been interrupted after Electron closed. Only a
# PID marker whose command line exactly matches this project's Fastify entry is
# eligible for cleanup; all other listeners remain untouched.
$owners = Get-PortOwners $port
if ($owners.Count) {
  $tracked = Get-TrackedTestServer
  if ($tracked -and $owners -contains $tracked.ProcessId) {
    Stop-TrackedTestServer $tracked.ProcessId
    Start-Sleep -Milliseconds 200
    $owners = Get-PortOwners $port
  }
}
if ($owners.Count) {
  $details = ($owners | ForEach-Object { Get-ProcessSummary $_ }) -join [Environment]::NewLine
  throw "Порт $port уже зайнятий стороннім або непідтвердженим процесом.`n$details`nЗакрийте цей запуск у його терміналі або перевірте процес командою Get-Process -Id <PID>, після чого повторіть скрипт."
}

$serverEnvironment = @{
  HROMADA_AID_API_HOST = '127.0.0.1'
  HROMADA_AID_API_PORT = "$port"
  HROMADA_AID_API_DATABASE = $resolvedDatabase
}
$electronEnvironment = @{
  HROMADAAID_MODE = 'remote'
  HROMADAAID_API_URL = $apiUrl
  HROMADA_AID_TEST_DATA_DIR = [System.IO.Path]::GetFullPath($profilePath)
}
$savedEnvironment = @{}

function Set-ProcessEnvironment([hashtable] $Values) {
  foreach ($entry in $Values.GetEnumerator()) {
    if (-not $savedEnvironment.ContainsKey($entry.Key)) { $savedEnvironment[$entry.Key] = [Environment]::GetEnvironmentVariable($entry.Key, 'Process') }
    [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
  }
}
function Restore-ProcessEnvironment() {
  foreach ($entry in $savedEnvironment.GetEnumerator()) { [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process') }
}

try {
  Write-Host 'Збираємо сервер…' -ForegroundColor Cyan
  & $pnpm server:build
  if ($LASTEXITCODE -ne 0) { throw 'Збірка сервера не пройшла.' }

  Write-Host "Запускаємо тестовий API: $apiUrl" -ForegroundColor Cyan
  Set-ProcessEnvironment $serverEnvironment
  $serverProcess = Start-Process -FilePath $node -ArgumentList @('dist-server/server/src/index.js') -WorkingDirectory $root -WindowStyle Hidden -PassThru
  Set-Content -LiteralPath $pidPath -Value $serverProcess.Id -NoNewline -Encoding ascii
  Restore-ProcessEnvironment

  $ready = $false
  foreach ($attempt in 1..80) {
    Start-Sleep -Milliseconds 250
    try {
      $health = Invoke-RestMethod -Uri "$apiUrl/health" -TimeoutSec 1
      if ($health.status -eq 'ok' -and $health.service -eq 'hromada-aid-api') { $ready = $true; break }
    } catch {}
    if ($serverProcess.HasExited) { throw "Тестовий API (PID $($serverProcess.Id)) завершився до готовності. Перевірте збірку та порт $port." }
  }
  if (-not $ready) { throw 'Тестовий API не відповів у встановлений час.' }

  Write-Host 'Запускаємо Electron у remote mode з окремим userData…' -ForegroundColor Green
  Set-ProcessEnvironment $electronEnvironment
  & $pnpm dev
  $devExit = $LASTEXITCODE
  Restore-ProcessEnvironment
  if ($devExit -ne 0) { throw "Electron dev-запуск завершився з кодом $devExit." }
} finally {
  Restore-ProcessEnvironment
  if ($serverProcess) { Stop-TrackedTestServer $serverProcess.Id }
}
