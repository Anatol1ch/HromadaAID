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
    if ($UpdateJournalPath -and [IO.File]::Exists($UpdateJournalPath)) {
      $journal = Get-Content -LiteralPath $UpdateJournalPath -Raw | ConvertFrom-Json
      $servicePresent = $null -ne (Get-Service -Name $serviceName -ErrorAction SilentlyContinue)
      $previousPresent = [IO.Directory]::Exists((Join-Path $ProgramDirectory 'Server.previous'))
      if ($journal.phase -ne 'initial-install-needs-review' -or $journal.hadPreviousPackage -or $servicePresent -or $previousPresent) {
        throw 'Попередня операція оновлення сервера перервалася. Інсталяцію зупинено без змін; потрібне контрольоване відновлення за журналом.'
      }
    }
    $staleStage = Join-Path $ProgramDirectory 'Server.next'
    if ([IO.Directory]::Exists($staleStage)) { Remove-Item -LiteralPath $staleStage -Recurse -Force }
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
