param(
  [Parameter(Mandatory=$true)][int]$ProcessId,
  [Parameter(Mandatory=$true)][string]$InstallerPath,
  [Parameter(Mandatory=$true)][string]$ApplicationExecutable,
  [Parameter(Mandatory=$true)][string]$ExpectedVersion,
  [Parameter(Mandatory=$true)][string]$LogPath,
  [Parameter(Mandatory=$true)][ValidateSet('Client','ServerManager')][string]$Component,
  [string]$ReadyPath = '',
  [string]$HandoffPath = ''
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$applicationDirectory = Split-Path -Parent $ApplicationExecutable
$markerName = if ($Component -eq 'Client') { 'client-update-success.txt' } else { 'manager-update-success.txt' }
$marker = Join-Path $applicationDirectory $markerName
$succeeded = $false
$restartFailed = $false
$clientStillRunning = $false
$failureMessage = 'Оновлення не підтверджено.'

function Write-UpdateLog([string]$Stage, [hashtable]$Details = @{}) {
  try {
    $directory = Split-Path -Parent $LogPath
    if ($directory) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
    $record = [ordered]@{
      timestamp = [DateTime]::UtcNow.ToString('o')
      component = $Component
      stage = $Stage
      launcherProcessId = $PID
      powershellVersion = $PSVersionTable.PSVersion.ToString()
      workingDirectory = (Get-Location).Path
      processId = $ProcessId
      installerPath = $InstallerPath
      applicationExecutable = $ApplicationExecutable
      expectedVersion = $ExpectedVersion
      details = $Details
    }
    $line = $record | ConvertTo-Json -Compress -Depth 4
    [Console]::Out.WriteLine($line)
    Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
  } catch { [Console]::Error.WriteLine('main-log-write-failed: ' + $_.Exception.Message) }
}

# A startup acknowledgement precedes application shutdown. No NSIS/restart on failed handoff.
if ($ReadyPath) {
  try {
    Write-UpdateLog 'launcher-started' @{ logPath = $LogPath }
    [IO.File]::WriteAllText($ReadyPath, (@{ launcherProcessId = $PID } | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while (!(Test-Path -LiteralPath $HandoffPath -PathType Leaf)) {
      if ([DateTime]::UtcNow -ge $deadline) { throw 'Electron не підтвердив передачу керування; Setup не запускався.' }
      Start-Sleep -Milliseconds 50
    }
  } catch {
    Write-UpdateLog 'handoff-failed' @{ error = $_.Exception.Message }
    exit 1
  }
}

try {
  if (!$ReadyPath) { Write-UpdateLog 'launcher-started' @{ logPath = $LogPath } }
  $client = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if ($client) {
    Write-UpdateLog 'waiting-for-application-exit' @{ processName = $client.ProcessName }
    try { Wait-Process -Id $ProcessId -Timeout 600 -ErrorAction Stop }
    catch { $clientStillRunning = [bool](Get-Process -Id $ProcessId -ErrorAction SilentlyContinue); Write-UpdateLog 'application-exit-wait-failed' @{ stillRunning = $clientStillRunning; error = $_.Exception.Message } }
  }
  if ($clientStillRunning) { $failureMessage = 'Server Manager або Client не завершив роботу. Setup не запускався. Закрийте програму та повторіть оновлення.'; throw $failureMessage }
  Write-UpdateLog 'application-exited' @{ installerExists = (Test-Path -LiteralPath $InstallerPath -PathType Leaf) }
  if (-not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) { $failureMessage = 'Завантажений Setup відсутній. Повторно завантажте оновлення.'; throw $failureMessage }
  $previousMarkerWriteTicks = $null
  if (Test-Path -LiteralPath $marker -PathType Leaf) {
    $previousMarkerWriteTicks = (Get-Item -LiteralPath $marker).LastWriteTimeUtc.Ticks
    try { Remove-Item -LiteralPath $marker -Force -ErrorAction Stop }
    catch { Write-UpdateLog 'previous-marker-retained' @{ error = $_.Exception.Message } }
  }
  # The unelevated launcher may not delete a Program Files marker. Require a new
  # write by this Setup attempt even if a previous marker could not be removed.
  $attemptStartedUtc = [DateTime]::UtcNow
  $mode = if ($Component -eq 'Client') { '/CLIENTUPDATE=1' } else { '/MANAGERUPDATE=1' }
  Write-UpdateLog 'elevation-requested' @{ arguments = @($mode); installerExists = (Test-Path -LiteralPath $InstallerPath -PathType Leaf); installerLength = (Get-Item -LiteralPath $InstallerPath).Length; attemptStartedUtc = $attemptStartedUtc.ToString('o') }
  $process = Start-Process -FilePath $InstallerPath -ArgumentList @($mode) -Verb RunAs -PassThru
  if (-not $process) { $failureMessage = 'Windows не підтвердив створення процесу Setup.'; throw $failureMessage }
  $null = $process.Handle
  Write-UpdateLog 'installer-process-created' @{ childProcessId = $process.Id; arguments = @($mode) }
  $process.WaitForExit()
  $exitCode = $process.ExitCode
  Write-UpdateLog 'installer-process-exited' @{ childProcessId = $process.Id; exitCode = $exitCode; markerExists = (Test-Path -LiteralPath $marker) }
  $freshMarker = $false
  $markerVersion = $null
  if (Test-Path -LiteralPath $marker -PathType Leaf) {
    $markerInfo = Get-Item -LiteralPath $marker
    $markerVersion = (Get-Content -LiteralPath $marker -Raw).Trim()
    $freshMarker = $markerInfo.LastWriteTimeUtc -ge $attemptStartedUtc -and ($null -eq $previousMarkerWriteTicks -or $markerInfo.LastWriteTimeUtc.Ticks -ne $previousMarkerWriteTicks)
  }
  $installedVersion = (Get-Item -LiteralPath $ApplicationExecutable).VersionInfo.ProductVersion
  # electron-builder can represent SemVer 0.1.1 as Windows ProductVersion 0.1.1.0.
  $versionMatches = $installedVersion -ceq $ExpectedVersion -or $installedVersion -ceq ($ExpectedVersion + '.0')
  Write-UpdateLog 'installed-component-verified' @{ freshMarker = $freshMarker; markerVersion = $markerVersion; installedVersion = $installedVersion; versionMatches = $versionMatches }
  $succeeded = $exitCode -eq 0 -and $freshMarker -and $markerVersion -ceq $ExpectedVersion -and $versionMatches
  if ($succeeded) { Write-UpdateLog 'update-confirmed' @{ version = $ExpectedVersion } }
  elseif ($exitCode -ne 0) { $failureMessage = "Windows Setup завершився з кодом $exitCode. Перевірте журнал Setup і повторіть оновлення." }
  else { $failureMessage = 'Setup завершився, але нову версію не підтверджено. Перевірте журнали встановлення перед повторною спробою.' }
} catch {
  $exception = $_.Exception
  $nativeCode = $null
  if ($exception.PSObject.Properties.Name -contains 'NativeErrorCode') { $nativeCode = $exception.NativeErrorCode }
  if ($nativeCode -eq 1223) { $failureMessage = 'Запит UAC скасовано. Оновлення не підтверджено; його можна повторити.' }
  elseif ($_.Exception.Message -and $failureMessage -eq 'Оновлення не підтверджено.') { $failureMessage = $_.Exception.Message }
  Write-UpdateLog 'launcher-error' @{ errorType = $exception.GetType().FullName; error = $exception.Message; nativeErrorCode = $nativeCode }
} finally {
  if ($clientStillRunning) {
    Write-UpdateLog 'application-restart-skipped' @{ reason = 'application-still-running' }
    try { Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.MessageBox]::Show("$failureMessage`r`nДіагностика: $LogPath", 'HromadaAID') } catch { }
  } else {
    if (!$succeeded) {
      Write-UpdateLog 'update-not-confirmed' @{ message = $failureMessage; installerExists = (Test-Path -LiteralPath $InstallerPath); markerExists = (Test-Path -LiteralPath $marker) }
      try { Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.MessageBox]::Show("$failureMessage`r`nПрограму буде запущено повторно. Діагностика: $LogPath", 'HromadaAID') } catch { }
    }
    if (Test-Path -LiteralPath $ApplicationExecutable) {
      try { $restart = Start-Process -FilePath $ApplicationExecutable -PassThru; Write-UpdateLog 'application-restarted' @{ processId = $restart.Id; succeeded = $succeeded } }
      catch {
        $restartFailed = $true
        Write-UpdateLog 'application-restart-failed' @{ error = $_.Exception.Message }
        try { Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.MessageBox]::Show("Не вдалося автоматично запустити програму. Відкрийте її штатним ярликом. Перевірте результат оновлення перед повторною спробою.`r`nДіагностика: $LogPath", 'HromadaAID') } catch { }
      }
    } else { Write-UpdateLog 'application-restart-skipped' @{ reason = 'application-executable-not-found' } }
  }
}
Write-UpdateLog 'launcher-completed' @{ exitCode = $(if ($succeeded -and !$restartFailed) { 0 } else { 1 }); succeeded = $succeeded; restartFailed = $restartFailed }
if (!$succeeded -or $restartFailed) { exit 1 }
