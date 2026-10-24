import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { InspectionAdapters, ServiceMetadata } from './inspection-engine.js'

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

function psEncodedCommand(script: string): string { return Buffer.from(script, 'utf16le').toString('base64') }
async function queryWindowsService(): Promise<ServiceMetadata> {
  if (process.platform !== 'win32') return { installed: false, error: 'query_failed' }
  const executable = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  try {
    const result = await execFileAsync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', psEncodedCommand(serviceQueryScript)], {
      windowsHide: true, timeout: 5_000, killSignal: 'SIGTERM', maxBuffer: 32 * 1024, encoding: 'utf8',
    })
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
