param(
  [Parameter(Mandatory=$true)][int]$ProcessId,
  [Parameter(Mandatory=$true)][string]$InstallerPath,
  [Parameter(Mandatory=$true)][string]$ApplicationExecutable,
  [Parameter(Mandatory=$true)][string]$ExpectedVersion,
  [Parameter(Mandatory=$true)][ValidateSet('Client','ServerManager')][string]$Component
)

$ErrorActionPreference = 'Stop'
$applicationDirectory = Split-Path -Parent $ApplicationExecutable
$markerName = if ($Component -eq 'Client') { 'client-update-success.txt' } else { 'manager-update-success.txt' }
$marker = Join-Path $applicationDirectory $markerName
$succeeded = $false
$clientStillRunning = $false

try {
  $client = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if ($client) {
    try { Wait-Process -Id $ProcessId -Timeout 600 -ErrorAction Stop }
    catch { $clientStillRunning = [bool](Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) }
  }
  if ($clientStillRunning) { throw 'Client did not exit before the install timeout.' }
  Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
  $mode = if ($Component -eq 'Client') { '/CLIENTUPDATE=1' } else { '/MANAGERUPDATE=1' }
  $process = Start-Process -FilePath $InstallerPath -ArgumentList @($mode) -Verb RunAs -Wait -PassThru
  $succeeded = $process.ExitCode -eq 0 -and (Test-Path -LiteralPath $marker) -and ((Get-Content -LiteralPath $marker -Raw -ErrorAction SilentlyContinue).Trim() -eq $ExpectedVersion)
} catch {
  # UAC cancellation and installer errors return to the old Client, which keeps the update mandatory.
} finally {
  if ($clientStillRunning) {
    try { Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.MessageBox]::Show("Server Manager або Client не завершив роботу. Setup не запускався. Закрийте програму та повторіть оновлення.", "HromadaAID") } catch { }
  } else {
    if (!$succeeded) {
      try { Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.MessageBox]::Show("Оновлення не підтверджене. Програму буде запущено повторно, а оновлення залишиться обов'язковим.", "HromadaAID") } catch { }
    }
    if (Test-Path -LiteralPath $ApplicationExecutable) { Start-Process -FilePath $ApplicationExecutable }
  }
}
