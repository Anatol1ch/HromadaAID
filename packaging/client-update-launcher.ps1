param(
  [Parameter(Mandatory=$true)][int]$ClientProcessId,
  [Parameter(Mandatory=$true)][string]$InstallerPath,
  [Parameter(Mandatory=$true)][string]$ClientExecutable,
  [Parameter(Mandatory=$true)][string]$ExpectedVersion
)

$ErrorActionPreference = 'Stop'
$clientDirectory = Split-Path -Parent $ClientExecutable
$marker = Join-Path $clientDirectory 'client-update-success.txt'
$succeeded = $false
$clientStillRunning = $false

try {
  $client = Get-Process -Id $ClientProcessId -ErrorAction SilentlyContinue
  if ($client) {
    try { Wait-Process -Id $ClientProcessId -Timeout 600 -ErrorAction Stop }
    catch { $clientStillRunning = [bool](Get-Process -Id $ClientProcessId -ErrorAction SilentlyContinue) }
  }
  if ($clientStillRunning) { throw 'Client did not exit before the install timeout.' }
  Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
  $process = Start-Process -FilePath $InstallerPath -ArgumentList @('/CLIENTUPDATE=1') -Verb RunAs -Wait -PassThru
  $succeeded = $process.ExitCode -eq 0 -and (Test-Path -LiteralPath $marker) -and ((Get-Content -LiteralPath $marker -Raw -ErrorAction SilentlyContinue).Trim() -eq $ExpectedVersion)
} catch {
  # UAC cancellation and installer errors return to the old Client, which keeps the update mandatory.
} finally {
  if (!$clientStillRunning) {
    if (!$succeeded) {
      try { Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.MessageBox]::Show("Оновлення не підтверджене. Client буде запущено повторно, а оновлення залишиться обов'язковим.", "HromadaAID") } catch { }
    }
    if (Test-Path -LiteralPath $ClientExecutable) { Start-Process -FilePath $ClientExecutable }
  }
}
