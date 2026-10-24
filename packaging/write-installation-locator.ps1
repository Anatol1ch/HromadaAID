param(
  [Parameter(Mandatory = $true)][string]$ProgramDirectory,
  [Parameter(Mandatory = $true)][string]$DataDirectory,
  [Parameter(Mandatory = $true)][string]$BackupDirectory
)
$ErrorActionPreference = 'Stop'
try {
  $keyPath = 'HKLM:\Software\HromadaAID\Installer'
  if (-not (Test-Path -LiteralPath $keyPath)) { New-Item -Path $keyPath -Force | Out-Null }
  New-ItemProperty -LiteralPath $keyPath -Name ProgramDirectory -Value $ProgramDirectory -PropertyType String -Force | Out-Null
  New-ItemProperty -LiteralPath $keyPath -Name DataDirectory -Value $DataDirectory -PropertyType String -Force | Out-Null
  New-ItemProperty -LiteralPath $keyPath -Name BackupDirectory -Value $BackupDirectory -PropertyType String -Force | Out-Null
  [Console]::Out.WriteLine('INSTALLATION_LOCATOR_WRITTEN')
} catch {
  [Console]::Error.WriteLine('Не вдалося записати безпечні метадані розташування інсталяції.')
  exit 1
}
