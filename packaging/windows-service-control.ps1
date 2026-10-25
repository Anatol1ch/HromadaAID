param(
  [Parameter(Mandatory = $true)][ValidateSet('stop-before-update', 'restore-after-failure', 'uninstall')][string]$Action,
  [Parameter(Mandatory = $true)][string]$ProgramDirectory,
  [Parameter(Mandatory = $false)][string]$StateFile,
  [Parameter(Mandatory = $false)][string]$UpdateJournalPath
)
$ErrorActionPreference = 'Stop'
$serviceName = 'HromadaAIDApi'
$serverDirectory = Join-Path $ProgramDirectory 'Server'
$wrapper = Join-Path $serverDirectory 'service\HromadaAIDService.exe'

try {
  if ($Action -eq 'stop-before-update') {
    if ($UpdateJournalPath -and [IO.File]::Exists($UpdateJournalPath)) { throw 'Виявлено журнал попередньої операції сервера. Інсталяцію зупинено без змін; потрібне контрольоване відновлення за журналом.' }
    $staleStage = Join-Path $ProgramDirectory 'Server.next'
    if ([IO.Directory]::Exists($staleStage)) { throw 'Server.next уже існує. Файли збережено; перевірте незавершене встановлення або оновлення перед повторною спробою.' }
    $existingService = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($null -eq $existingService) { throw 'Зареєстровану HromadaAIDApi не знайдено. Поточний стан не підтверджує безпечне оновлення сервера.' }
  }
  if ($Action -eq 'uninstall') {
    $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    $transient = @(
      (Join-Path $ProgramDirectory 'Server.previous'),
      (Join-Path $ProgramDirectory 'Server.failed')
    ) | Where-Object { [IO.Directory]::Exists($_) }
    if ($UpdateJournalPath -and [IO.File]::Exists($UpdateJournalPath)) { $transient += $UpdateJournalPath }
    if ($transient.Count -gt 0) { throw 'Виявлено незавершений або діагностичний стан сервера. Службу й файли не змінено; спочатку перевірте журнали та каталоги транзакції.' }
    $stagedServer = Join-Path $ProgramDirectory 'Server.next'
    $activeServer = Join-Path $ProgramDirectory 'Server'
    if ([IO.Directory]::Exists($stagedServer) -and $null -ne $service) { throw 'Служба присутня разом із Server.next. Це може бути незавершене оновлення; усі файли збережено.' }
    $unservedPackage = if ([IO.Directory]::Exists($stagedServer)) { $stagedServer } elseif ([IO.Directory]::Exists($activeServer) -and $null -eq $service) { $activeServer } else { $null }
    if ($null -ne $unservedPackage) {
      $node = Join-Path $unservedPackage 'runtime\node.exe'
      $verifier = Join-Path $unservedPackage 'installer\verify-server-package.mjs'
      if (-not [IO.File]::Exists($node) -or -not [IO.File]::Exists($verifier)) { throw 'Server.next неповний; файли збережено для ручної перевірки.' }
      & $node $verifier $unservedPackage
      if ($LASTEXITCODE -ne 0) { throw 'Пакет без зареєстрованої служби не пройшов перевірку цілісності; файли збережено.' }
    }
  }
  if ($Action -eq 'restore-after-failure') {
    if (-not $StateFile -or -not [IO.File]::Exists($StateFile) -or [IO.File]::ReadAllText($StateFile).Trim() -ne 'Running') { exit 0 }
    $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($null -eq $service) { exit 0 }
    if ($service.Status -ne 'Running') {
      Start-Service -Name $serviceName -ErrorAction Stop
      (Get-Service -Name $serviceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(45))
    }
    exit 0
  }
  $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
  if ($Action -eq 'stop-before-update' -and $StateFile) {
    $state = if ($null -eq $service) { 'Absent' } else { [string]$service.Status }
    [IO.File]::WriteAllText($StateFile, $state, [Text.Encoding]::ASCII)
  }
  if ($null -eq $service) { exit 0 }
  if ($service.Status -ne 'Stopped') {
    Stop-Service -Name $serviceName -ErrorAction Stop
    (Get-Service -Name $serviceName).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(45))
  }
  if ($Action -eq 'uninstall') {
    if (-not [IO.File]::Exists($wrapper)) { throw 'Не знайдено WinSW; службу не видалено.' }
    & $wrapper uninstall
    if ($LASTEXITCODE -ne 0) { throw 'WinSW не зміг видалити реєстрацію служби.' }
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while ([DateTime]::UtcNow -lt $deadline -and (Get-Service -Name $serviceName -ErrorAction SilentlyContinue)) { Start-Sleep -Milliseconds 250 }
    if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) { throw 'Windows SCM усе ще містить службу HromadaAIDApi.' }
  }
  exit 0
} catch {
  [Console]::Error.WriteLine("Операцію зі службою не виконано: $($_.Exception.Message)")
  exit 1
}
