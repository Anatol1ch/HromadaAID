import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { InspectionAdapters, InstallationLocator, ServiceMetadata } from './inspection-engine.js'
import { inspectionDiagnostic } from './inspection-engine.js'

const execFileAsync = promisify(execFile)
export const serviceMetadataScript = String.raw`
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding -ArgumentList $false
[Console]::OutputEncoding = $utf8
try {
  $key = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey('SYSTEM\CurrentControlSet\Services\HromadaAIDApi', $false)
  if ($null -eq $key) { exit 2 }
  try {
    $result = [ordered]@{ binaryPath = [string]$key.GetValue('ImagePath'); startName = [string]$key.GetValue('ObjectName'); start = $key.GetValue('Start') }
    [Console]::Out.WriteLine((ConvertTo-Json -InputObject $result -Compress -Depth 3))
  } finally { $key.Dispose() }
} catch {
  $failure = $_.Exception
  if (($failure -is [System.UnauthorizedAccessException]) -or ($failure -is [System.Security.SecurityException]) -or ($failure.HResult -eq -2147024891)) { exit 5 }
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

/** Classify Win32/process codes, never localized console messages. */
export function classifyScQueryFailure(error: unknown): 'missing' | 'access_denied' | 'query_failed' {
  const failure = error as NodeJS.ErrnoException
  if (Number(failure.code) === 1060) return 'missing'
  if (Number(failure.code) === 5 || failure.code === 'EACCES' || failure.code === 'EPERM') return 'access_denied'
  return 'query_failed'
}

/** sc query emits numeric TYPE then STATE fields. Ignore localized labels/captions.
 * TYPE is hexadecimal; only a Win32 service response is accepted for our WinSW service.
 */
export function parseScServiceState(stdout: string): string {
  const fields = [...stdout.matchAll(/^\s*[^:\r\n]+:\s*([0-9a-fA-F]+)(?=\s|$)[^\r\n]*$/gm)]
  const type = fields[0] ? Number.parseInt(fields[0][1], 16) : 0
  const states: Record<string, string> = { '1': 'Stopped', '2': 'StartPending', '3': 'StopPending', '4': 'Running', '5': 'ContinuePending', '6': 'PausePending', '7': 'Paused' }
  const state = fields[1] && states[fields[1][1]]
  if (!(type & 0x30) || !state) throw Object.assign(new Error('SCM response has no valid numeric service state.'), { code: 'SCM_INVALID_RESPONSE' })
  return state
}

type ReadOnlyServiceQueries = { query(): Promise<string>; metadata(): Promise<string> }
function serviceProcessFailure(error: unknown): NodeJS.ErrnoException {
  const failure = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string }
  // execFile timeout errors normally have killed/signal and a null code, not ETIMEDOUT.
  return failure.killed && failure.signal && !failure.code ? Object.assign(new Error('Service query timed out.'), { code: 'ETIMEDOUT' }) : failure
}
export async function inspectWindowsService(queries: ReadOnlyServiceQueries): Promise<ServiceMetadata> {
  let state: string
  try {
    state = parseScServiceState(await queries.query())
  } catch (error) {
    const failure = serviceProcessFailure(error)
    const classification = classifyScQueryFailure(failure)
    if (classification === 'missing') return { installed: false }
    return { installed: false, error: classification, diagnostics: [inspectionDiagnostic('service.query', 'HromadaAIDApi', failure)] }
  }
  try {
    const value = JSON.parse(await queries.metadata()) as Record<string, unknown>
    if (typeof value.binaryPath !== 'string' || !value.binaryPath.trim()) throw Object.assign(new Error('Service configuration is incomplete.'), { code: 'SERVICE_METADATA_INVALID' })
    const modes: Record<string, string> = { '0': 'Boot', '1': 'System', '2': 'Auto', '3': 'Manual', '4': 'Disabled' }
    return {
      installed: true, state,
      ...(modes[String(value.start)] ? { startMode: modes[String(value.start)] } : {}),
      ...(typeof value.startName === 'string' ? { startName: value.startName } : {}),
      binaryPath: value.binaryPath,
    }
  } catch (error) {
    // SCM already confirmed existence/state. Auxiliary metadata cannot undo that fact.
    return { installed: true, state, metadataUnavailable: true, diagnostics: [inspectionDiagnostic('service.metadata', 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\HromadaAIDApi', serviceProcessFailure(error))] }
  }
}

async function queryWindowsService(): Promise<ServiceMetadata> {
  if (process.platform !== 'win32') return { installed: false, error: 'query_failed' }
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  const sc = join(systemRoot, 'System32', 'sc.exe')
  const executable = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const options = { windowsHide: true, timeout: 5_000, killSignal: 'SIGTERM' as const, maxBuffer: 32 * 1024, encoding: 'utf8' as const }
  return inspectWindowsService({
    query: async () => (await execFileAsync(sc, ['query', 'HromadaAIDApi'], options)).stdout,
    metadata: async () => (await execFileAsync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', psEncodedCommand(serviceMetadataScript)], options)).stdout,
  })
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
