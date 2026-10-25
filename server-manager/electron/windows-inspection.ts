import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { InspectionAdapters, InstallationLocator, ServiceMetadata } from './inspection-engine.js'
import { inspectionDiagnostic } from './inspection-engine.js'

const execFileAsync = promisify(execFile)
const serviceQueryScript = String.raw`
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding -ArgumentList $false
[Console]::OutputEncoding = $utf8
try {
  $service = Get-CimInstance -ClassName Win32_Service -Filter "Name='HromadaAIDApi'" -ErrorAction Stop
  if ($null -eq $service) {
    [Console]::Out.WriteLine('{"installed":false}')
  } else {
    $result = [ordered]@{ installed = $true; state = [string]$service.State; startMode = [string]$service.StartMode; startName = [string]$service.StartName; binaryPath = [string]$service.PathName }
    [Console]::Out.WriteLine((ConvertTo-Json -InputObject $result -Compress -Depth 3))
  }
} catch {
  $failure = $_.Exception
  $accessDenied = ($failure -is [System.UnauthorizedAccessException]) -or ($failure -is [System.Security.SecurityException]) -or ($failure.HResult -eq -2147024891)
  if ($accessDenied) { [Console]::Error.WriteLine('SERVICE_ACCESS_DENIED'); exit 13 }
  [Console]::Error.WriteLine('SERVICE_QUERY_FAILED')
  exit 2
}`

// The installer already writes these non-secret paths under HKLM. Read them as
// a locator only; the inspection engine still verifies every referenced item.
export const locatorQueryScript = String.raw`
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding -ArgumentList $false
[Console]::OutputEncoding = $utf8
$keyPath = 'Registry::HKEY_LOCAL_MACHINE\Software\HromadaAID\Installer'
$operation = 'registry.stat'
try {
  if (-not (Test-Path -LiteralPath $keyPath)) { [Console]::Out.WriteLine('{"status":"missing"}'); exit 0 }
  $key = Get-Item -LiteralPath $keyPath -ErrorAction Stop
  $operation = 'registry.read'
  $item = Get-ItemProperty -LiteralPath $keyPath -ErrorAction Stop
  $operation = 'registry.acl'
  # Windows PowerShell 5.1 Get-Acl -LiteralPath misresolves registry provider paths.
  # Read the already opened RegistryKey ACL and request SIDs without name lookup.
  $acl = $key.GetAccessControl()
  $trustedSids = @('S-1-5-18', 'S-1-5-32-544', 'S-1-5-80-0', 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
  # Composite WriteKey/FullControl include read bits; test only mutation rights.
  $writeMask = [System.Security.AccessControl.RegistryRights]::SetValue -bor [System.Security.AccessControl.RegistryRights]::CreateSubKey -bor [System.Security.AccessControl.RegistryRights]::Delete -bor [System.Security.AccessControl.RegistryRights]::ChangePermissions -bor [System.Security.AccessControl.RegistryRights]::TakeOwnership
  $writable = $false
  foreach ($rule in $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { continue }
    if (($rule.PropagationFlags -band [System.Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0) { continue }
    $sid = $rule.IdentityReference.Value
    if ($trustedSids -notcontains $sid -and (($rule.RegistryRights -band $writeMask) -ne 0)) { $writable = $true }
  }
  $result = [ordered]@{
    status = 'available'
    programDirectory = [string]$item.ProgramDirectory
    dataDirectory = [string]$item.DataDirectory
    backupDirectory = [string]$item.BackupDirectory
    writableByUnprivileged = $writable
  }
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject $result -Compress -Depth 3))
} catch {
  $failure = $_.Exception
  while ($null -ne $failure.InnerException) { $failure = $failure.InnerException }
  $nativeCode = if ($failure -is [System.ComponentModel.Win32Exception]) { $failure.NativeErrorCode } else { $null }
  $accessDenied = ($failure.HResult -eq -2147024891) -or ($nativeCode -eq 5)
  $status = if ($accessDenied) { 'access_denied' } else { 'query_failed' }
  $code = if ($null -ne $nativeCode) { [string]$nativeCode } else { '0x' + $failure.HResult.ToString('X8') }
  [Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject @{ status = $status; operation = $operation; code = $code }))
  if ($accessDenied) { [Console]::Error.WriteLine('LOCATOR_ACCESS_DENIED'); exit 13 }
  [Console]::Error.WriteLine('LOCATOR_QUERY_FAILED')
  exit 2
}`

function psEncodedCommand(script: string): string { return Buffer.from(script, 'utf16le').toString('base64') }

/** A single bounded retry for a cold PowerShell/CIM startup timeout only. */
export async function queryServiceWithInitialTimeoutRetry<T>(query: () => Promise<T>, wait: (milliseconds: number) => Promise<void> = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))): Promise<T> {
  try {
    return await query()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ETIMEDOUT') throw error
    await wait(250)
    return query()
  }
}

/** `sc.exe query` returns a stable Win32 exit code for service absence (1060).
 * Probe SCM first so an absent service is not mistaken for a CIM/WMI failure.
 * Access denied and all other failures remain errors; they never imply absence.
 */
export function classifyScQueryFailure(error: unknown): 'missing' | 'access_denied' | 'query_failed' {
  const failure = error as NodeJS.ErrnoException & { stderr?: string; stdout?: string }
  const text = `${failure.message ?? ''} ${failure.stderr ?? ''} ${failure.stdout ?? ''}`
  if (Number(failure.code) === 1060 || /(?:error|failed)\s*[:=]?\s*1060\b/i.test(text)) return 'missing'
  if (Number(failure.code) === 5 || /(?:error|failed)\s*[:=]?\s*5\b/i.test(text) || /access is denied|access denied|0x80070005/i.test(text)) return 'access_denied'
  return 'query_failed'
}

async function queryWindowsService(): Promise<ServiceMetadata> {
  if (process.platform !== 'win32') return { installed: false, error: 'query_failed' }
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  const sc = join(systemRoot, 'System32', 'sc.exe')
  try {
    await execFileAsync(sc, ['query', 'HromadaAIDApi'], { windowsHide: true, timeout: 5_000, killSignal: 'SIGTERM', maxBuffer: 32 * 1024, encoding: 'utf8' })
  } catch (error) {
    const classification = classifyScQueryFailure(error)
    if (classification === 'missing') return { installed: false }
    return { installed: false, error: classification }
  }

  const executable = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  try {
    const result = await queryServiceWithInitialTimeoutRetry(() => execFileAsync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', psEncodedCommand(serviceQueryScript)], {
      windowsHide: true, timeout: 5_000, killSignal: 'SIGTERM', maxBuffer: 32 * 1024, encoding: 'utf8',
    }))
    const value = JSON.parse(result.stdout.trim()) as Record<string, unknown>
    if (value.installed === false) return { installed: false }
    if (value.installed !== true || typeof value.state !== 'string' || typeof value.binaryPath !== 'string') return { installed: false, error: 'query_failed' }
    return {
      installed: true,
      state: value.state,
      ...(typeof value.startMode === 'string' ? { startMode: value.startMode } : {}),
      ...(typeof value.startName === 'string' ? { startName: value.startName } : {}),
      binaryPath: value.binaryPath,
    }
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stderr?: string }
    const text = `${failure.message || ''} ${failure.stderr || ''}`
    return { installed: false, error: /SERVICE_ACCESS_DENIED|access is denied|access denied|unauthorized|0x80070005/i.test(text) ? 'access_denied' : 'query_failed' }
  }
}

export type WindowsInstallationLocator = InstallationLocator
export function classifyLocatorFailure(error: unknown): InstallationLocator {
  const failure = error as NodeJS.ErrnoException & { stdout?: string }
  let code = failure.code
  let operation = 'registry.query'
  try {
    const detail = JSON.parse(failure.stdout?.trim() ?? '') as Record<string, unknown>
    if (typeof detail.code === 'string' && /^(?:0x[0-9A-Fa-f]{8}|\d{1,10})$/.test(detail.code)) code = detail.code.toLowerCase()
    if (typeof detail.operation === 'string' && ['registry.stat', 'registry.read', 'registry.acl', 'registry.identity'].includes(detail.operation)) operation = detail.operation
  } catch { /* A child launch failure may not have stdout. */ }
  const diagnostic = inspectionDiagnostic(operation, 'HKLM\\Software\\HromadaAID\\Installer', { code })
  return { status: ['EACCES', 'EPERM', '5', '0x80070005'].includes(diagnostic.code) ? 'access_denied' : 'query_failed', diagnostic }
}
async function queryWindowsLocator(): Promise<InstallationLocator> {
  if (process.platform !== 'win32') return { status: 'query_failed' }
  const executable = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  try {
    const result = await execFileAsync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', psEncodedCommand(locatorQueryScript)], {
      windowsHide: true, timeout: 5_000, killSignal: 'SIGTERM', maxBuffer: 32 * 1024, encoding: 'utf8',
    })
    const value = JSON.parse(result.stdout.trim()) as Record<string, unknown>
    if (value.status === 'missing') return { status: 'missing' }
    if (value.status !== 'available' || typeof value.programDirectory !== 'string' || typeof value.dataDirectory !== 'string' || typeof value.backupDirectory !== 'string' || typeof value.writableByUnprivileged !== 'boolean') return { status: 'invalid', diagnostic: inspectionDiagnostic('registry.validate', 'HKLM\\Software\\HromadaAID\\Installer', { code: 'LOCATOR_INVALID_RESPONSE' }) }
    return { status: 'available', programDirectory: value.programDirectory, dataDirectory: value.dataDirectory, backupDirectory: value.backupDirectory, writableByUnprivileged: value.writableByUnprivileged }
  } catch (error) {
    return classifyLocatorFailure(error)
  }
}

async function probeApi(url: string, timeoutMs: number): Promise<Awaited<ReturnType<InspectionAdapters['probeApi']>>> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { method: 'GET', headers: { accept: 'application/json' }, redirect: 'manual', cache: 'no-store', signal: controller.signal })
    if (response.status >= 300 && response.status < 400) return { kind: 'response', status: response.status, redirected: true, body: null }
    const text = await response.text()
    if (text.length > 8_192) return { kind: 'invalid_response' }
    let body: unknown
    try { body = JSON.parse(text) } catch { return { kind: 'invalid_response' } }
    return { kind: 'response', status: response.status, redirected: false, body }
  } catch (error) {
    return (error as Error).name === 'AbortError' ? { kind: 'timeout' } : { kind: 'network_error' }
  } finally { clearTimeout(timeout) }
}

export function createWindowsInspectionAdapters(): InspectionAdapters {
  return {
    platform: process.platform,
    programFiles: process.env.ProgramFiles ?? null,
    programData: process.env.ProgramData ?? null,
    queryService: async name => name === 'HromadaAIDApi' ? queryWindowsService() : { installed: false, error: 'query_failed' },
    readInstallationLocator: queryWindowsLocator,
    exists: async path => {
      try { await stat(path); return true }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'ENOENT' || code === 'ENOTDIR') return false
        throw error
      }
    },
    readText: async path => {
      const info = await stat(path)
      if (!info.isFile() || info.size > 256 * 1024) throw Object.assign(new Error('Metadata file is not a small regular file.'), { code: 'ERR_INSPECTION_FILE' })
      return readFile(path, 'utf8')
    },
    probeApi,
    now: () => new Date(),
  }
}
