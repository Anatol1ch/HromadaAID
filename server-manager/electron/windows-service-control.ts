import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ServiceControlActionResult, ServiceControlOperation } from './service-control.js'

const execFileAsync = promisify(execFile)
const serviceName = 'HromadaAIDApi'

/** Fixed PowerShell/SCM commands; no renderer-provided command, service, or path is interpolated. */
export function serviceControlScript(operation: ServiceControlOperation): string {
  const safeOperation = operation === 'start' || operation === 'stop' || operation === 'restart' ? operation : null
  if (!safeOperation) throw new Error('SERVICE_OPERATION_INVALID')
  return String.raw`
$ErrorActionPreference = 'Stop'
$operation = '${safeOperation}'
$serviceName = '${serviceName}'
function Write-Result([bool]$success, [string]$state, [string]$code, [string]$message) {
  [Console]::Out.WriteLine((ConvertTo-Json -Compress @{ success = $success; state = $state; code = $code; message = $message }))
}
try {
  try { $service = Get-Service -Name $serviceName -ErrorAction Stop }
  catch {
    if ($_.FullyQualifiedErrorId -like 'NoServiceFoundForGivenName*') {
      Write-Result $false 'missing' 'SERVICE_NOT_INSTALLED' 'Службу HromadaAIDApi не встановлено.'
      exit 0
    }
    throw
  }
  $timeout = [TimeSpan]::FromSeconds(45)
  if ($operation -eq 'stop') {
    if ($service.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Stopped) {
      Stop-Service -Name $serviceName -ErrorAction Stop
      $service.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Stopped, $timeout)
    }
  } elseif ($operation -eq 'start') {
    if ($service.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Running) {
      if ($service.Status -eq [System.ServiceProcess.ServiceControllerStatus]::StopPending) { $service.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Stopped, $timeout) }
      Start-Service -Name $serviceName -ErrorAction Stop
      $service.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Running, $timeout)
    }
  } else {
    if ($service.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Stopped) {
      Stop-Service -Name $serviceName -ErrorAction Stop
      $service.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Stopped, $timeout)
    }
    Start-Service -Name $serviceName -ErrorAction Stop
    $service.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Running, $timeout)
  }
  $service.Refresh()
  $actual = [string]$service.Status
  $expected = if ($operation -eq 'stop') { 'Stopped' } else { 'Running' }
  if ($actual -ne $expected) { Write-Result $false $actual 'SERVICE_STATE_NOT_CONFIRMED' 'Windows не підтвердив очікуваний стан служби.'; exit 0 }
  Write-Result $true $actual '' 'Диспетчер служб Windows завершив дію.'
} catch {
  $exception = $_.Exception
  $baseException = $exception.GetBaseException()
  $accessDenied = ($exception -is [System.UnauthorizedAccessException]) -or ($exception -is [System.Security.SecurityException]) -or (($exception.HResult -band 65535) -eq 5) -or (($baseException.HResult -band 65535) -eq 5) -or ($_.FullyQualifiedErrorId -match 'AccessDenied')
  $timedOut = $exception -is [System.TimeoutException]
  $code = if ($accessDenied) { 'SERVICE_ACCESS_DENIED' } elseif ($timedOut) { 'SERVICE_TRANSITION_TIMEOUT' } elseif ($operation -eq 'start') { 'SERVICE_START_FAILED' } elseif ($operation -eq 'stop') { 'SERVICE_STOP_FAILED' } else { 'SERVICE_RESTART_FAILED' }
  $message = if ($accessDenied) { 'Потрібні права адміністратора для керування Windows Service. Запустіть Server Manager від імені адміністратора.' } elseif ($timedOut) { 'Служба не перейшла в потрібний стан за відведений час. Перевірте журнали Windows і повторіть перевірку.' } else { 'Windows не змогла виконати дію зі службою. Перевірте стан служби та журнали Windows.' }
  $state = 'unknown'
  try { $service = Get-Service -Name $serviceName -ErrorAction Stop; $state = [string]$service.Status }
  catch { if ($_.FullyQualifiedErrorId -like 'NoServiceFoundForGivenName*') { $state = 'missing' } }
  Write-Result $false $state $code $message
  exit 0
}`
}

function statusName(value: unknown): 'running' | 'stopped' | 'missing' | 'unknown' {
  if (value === 'Running') return 'running'
  if (value === 'Stopped') return 'stopped'
  if (value === 'missing') return 'missing'
  return 'unknown'
}

export async function controlWindowsService(operation: ServiceControlOperation): Promise<ServiceControlActionResult> {
  if (process.platform !== 'win32') return { success: false, errorCode: 'WINDOWS_REQUIRED', message: 'Керування Windows Service доступне лише у Windows.' }
  const executable = `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
  try {
    const result = await execFileAsync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(serviceControlScript(operation), 'utf16le').toString('base64')], {
      windowsHide: true, timeout: 50_000, killSignal: 'SIGTERM', maxBuffer: 8 * 1024, encoding: 'utf8',
    })
    const value = JSON.parse(result.stdout.trim()) as Record<string, unknown>
    if (typeof value.success !== 'boolean' || typeof value.state !== 'string' || typeof value.code !== 'string' || typeof value.message !== 'string') throw new Error('SERVICE_CONTROL_RESPONSE_INVALID')
    const code = value.code || null
    const expected = operation === 'stop' ? 'stopped' : 'running'
    const state = statusName(value.state)
    const success = value.success && state === expected
    return {
      success,
      errorCode: success ? null : code ?? (state === 'missing' ? 'SERVICE_NOT_INSTALLED' : 'SERVICE_STATE_NOT_CONFIRMED'),
      message: success ? value.message : value.message || 'Windows не підтвердила очікуваний стан служби.',
    }
  } catch (error) {
    const failure = error as NodeJS.ErrnoException
    return {
      success: false,
      errorCode: failure.code === 'ETIMEDOUT' ? 'SERVICE_TRANSITION_TIMEOUT' : failure.code === 'EACCES' || failure.code === 'EPERM' ? 'SERVICE_ACCESS_DENIED' : 'SERVICE_CONTROL_FAILED',
      message: failure.code === 'ETIMEDOUT'
        ? 'Служба не перейшла в потрібний стан за відведений час. Перевірте журнали Windows і повторіть перевірку.'
        : failure.code === 'EACCES' || failure.code === 'EPERM'
          ? 'Потрібні права адміністратора для керування Windows Service. Запустіть Server Manager від імені адміністратора.'
          : 'Не вдалося зв’язатися з диспетчером служб Windows. Перевірте діагностику та повторіть спробу.',
    }
  }
}
