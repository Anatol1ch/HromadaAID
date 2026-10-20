param(
  [ValidateSet('Inspect', 'Stop')][string]$Action = 'Inspect',
  [int]$Port = 5175,
  [int]$OwnerId,
  [string]$ExpectedCreation,
  [string]$ExpectedCommandHash
)
$ErrorActionPreference = 'Stop'

function Get-Listeners {
  @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object LocalPort -eq $Port | Select-Object -ExpandProperty OwningProcess -Unique)
}

function Get-CommandHash([string]$CommandLine) {
  $hash = [Security.Cryptography.SHA256]::Create()
  try { [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($CommandLine))).Replace('-', '').ToLowerInvariant() }
  finally { $hash.Dispose() }
}

if ($Action -eq 'Stop') {
  # Recheck identity immediately before stopping; a recycled PID is never sufficient.
  $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$OwnerId" -ErrorAction Stop
  if (-not $owner -or -not $owner.CreationDate -or
      $owner.CreationDate.ToUniversalTime().Ticks.ToString() -cne $ExpectedCreation -or
      (Get-CommandHash $owner.CommandLine) -cne $ExpectedCommandHash) { throw 'Process identity changed. Nothing stopped.' }
  if ($owner.ParentProcessId -le 0) { throw 'Parent identity unavailable. Nothing stopped.' }
  $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($owner.ParentProcessId)" -ErrorAction Stop
  if ($parent -and (-not $parent.CreationDate -or $parent.CreationDate -le $owner.CreationDate)) {
    throw 'The parent process is still running. Nothing stopped.'
  }
  if ((Get-Listeners) -notcontains $OwnerId) { throw 'Port ownership changed. Nothing stopped.' }
  Stop-Process -Id $OwnerId -ErrorAction Stop
  exit 0
}

$owners = @(foreach ($ownerIdValue in (Get-Listeners)) {
  $owner = $null
  $parent = $null
  $inspectionError = $false
  try {
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$ownerIdValue" -ErrorAction Stop
    $parent = if ($owner -and $owner.ParentProcessId -gt 0) {
      Get-CimInstance Win32_Process -Filter "ProcessId=$($owner.ParentProcessId)" -ErrorAction Stop
    } else { $null }
  } catch { $inspectionError = $true }
  [pscustomobject]@{
    pid = [int]$ownerIdValue
    inspectionError = $inspectionError
    executablePath = $owner.ExecutablePath
    commandLine = $owner.CommandLine
    createdAtTicks = if ($owner.CreationDate) { $owner.CreationDate.ToUniversalTime().Ticks.ToString() } else { $null }
    parentPid = $owner.ParentProcessId
    parentCreatedAtTicks = if ($parent.CreationDate) { $parent.CreationDate.ToUniversalTime().Ticks.ToString() } else { $null }
  }
})
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
ConvertTo-Json -InputObject $owners -Compress
