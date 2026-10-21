<#
.SYNOPSIS
  Starts an isolated remote-mode HromadaAID session for manual integration checks.

  The script never uses the standard Electron AppData profile or the production
  HromadaAID SQLite database. Close Electron or press Ctrl+C to stop the dev
  supervisor; the API process started by this script is then stopped as well.
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
$port = 4310
$apiUrl = "http://127.0.0.1:$port"
$serverProcess = $null

function Test-ListeningPort([int] $Port) {
  $connections = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
  return $connections.Count -gt 0
}

if (-not (Test-Path (Join-Path $root 'package.json'))) { throw 'Не знайдено корінь проєкту HromadaAID.' }
if (-not (Test-Path (Join-Path $root 'node_modules'))) { throw 'Не знайдено node_modules. Виконайте pnpm install.' }
if (Test-ListeningPort $port) { throw "Порт $port уже зайнятий. Скрипт не завершує сторонні процеси; закрийте попередній API-запуск і повторіть." }

New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
$resolvedTestRoot = [System.IO.Path]::GetFullPath($testRoot)
$resolvedDatabase = [System.IO.Path]::GetFullPath($databasePath)
if (-not $resolvedDatabase.StartsWith($resolvedTestRoot, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Тестова SQLite має бути всередині ізольованого каталогу.' }

# Both variables are inherited only by the child processes created below.
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

try {
  Write-Host 'Збираємо сервер…' -ForegroundColor Cyan
  & $pnpm server:build
  if ($LASTEXITCODE -ne 0) { throw 'Збірка сервера не пройшла.' }

  Write-Host "Запускаємо тестовий API: $apiUrl" -ForegroundColor Cyan
  $savedEnvironment = @{}
  foreach ($entry in $serverEnvironment.GetEnumerator()) { $savedEnvironment[$entry.Key] = [Environment]::GetEnvironmentVariable($entry.Key, 'Process'); [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process') }
  $serverProcess = Start-Process -FilePath $pnpm -ArgumentList @('server:start') -WorkingDirectory $root -WindowStyle Hidden -PassThru
  foreach ($entry in $savedEnvironment.GetEnumerator()) { [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process') }

  $ready = $false
  foreach ($attempt in 1..80) {
    Start-Sleep -Milliseconds 250
    try {
      $health = Invoke-RestMethod -Uri "$apiUrl/health" -TimeoutSec 1
      if ($health.status -eq 'ok' -and $health.service -eq 'hromada-aid-api') { $ready = $true; break }
    } catch {}
    if ($serverProcess.HasExited) { throw 'Тестовий API завершився до готовності. Перевірте збірку та порт 4310.' }
  }
  if (-not $ready) { throw 'Тестовий API не відповів у встановлений час.' }

  Write-Host 'Запускаємо Electron у remote mode з окремим userData…' -ForegroundColor Green
  foreach ($entry in $electronEnvironment.GetEnumerator()) { $savedEnvironment[$entry.Key] = [Environment]::GetEnvironmentVariable($entry.Key, 'Process'); [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process') }
  & $pnpm dev
  $devExit = $LASTEXITCODE
  foreach ($entry in $electronEnvironment.GetEnumerator()) { [Environment]::SetEnvironmentVariable($entry.Key, $savedEnvironment[$entry.Key], 'Process') }
  if ($devExit -ne 0) { throw "Electron dev-запуск завершився з кодом $devExit." }
} finally {
  if ($serverProcess -and -not $serverProcess.HasExited) {
    Write-Host 'Завершуємо тестовий API…' -ForegroundColor Cyan
    Stop-Process -Id $serverProcess.Id -ErrorAction SilentlyContinue
    $serverProcess.WaitForExit(5000) | Out-Null
  }
}
