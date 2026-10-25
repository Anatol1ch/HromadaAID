import type { InspectionCheck } from './inspection-types.js'

export type InstallDirectoryKind = 'program' | 'data' | 'backups'

export type ServerInstallRequest = {
  programDirectory: string
  dataDirectory: string
  backupDirectory: string
  host: '127.0.0.1' | '::1'
  port: number
  administrator: { displayName: string; username: string; password: string; confirmation: string }
}

export type ServerInstallStage = 'validation' | 'preflight' | 'directories' | 'configuration' | 'recovery-key' | 'database' | 'administrator' | 'service' | 'health' | 'complete'
export type ServerInstallUpdate = {
  operationId: string
  stage: ServerInstallStage
  status: 'running' | 'awaiting-confirmation' | 'succeeded' | 'verification-required' | 'failed'
  message: string
  errorCode?: string
  result?: { service: 'running'; api: 'available'; serverVersion: string; apiAddress: string }
}

export type InstallationInspection = {
  installation: { status: string }
  service?: { status: string }
  api?: { status: string }
  configuration?: { serverVersion: string | null; apiAddress: string | null }
  checks?: Pick<InspectionCheck, 'id' | 'status' | 'details' | 'diagnostics'>[]
}

/** Shared by the coordinator and the wizard's read-only verification action. */
export function installationVerificationIssues(state: InstallationInspection): string[] {
  const issues: string[] = []
  const service: Record<string, string> = { missing: 'службу не знайдено', stopped: 'службу зупинено', other: 'служба у проміжному стані', unknown: 'стан служби невідомий' }
  const serviceDiagnostic = state.checks?.find(check => check.id === 'service')?.diagnostics?.[0]
  const systemCode = serviceDiagnostic && /^[A-Za-z0-9_.-]{1,64}$/.test(serviceDiagnostic.code) ? ` (${serviceDiagnostic.code})` : ''
  if (state.service?.status !== 'running') issues.push(`Windows Service: ${service[state.service?.status ?? 'unknown'] ?? 'стан служби не підтверджено'}${systemCode}.`)
  else if (serviceDiagnostic?.operation === 'service.metadata') issues.push(`Метадані Windows Service не підтверджено${systemCode}.`)
  const api: Record<string, string> = { unavailable: 'API недоступний', invalid_response: 'некоректна health-відповідь', not_configured: 'адресу API не підтверджено', unknown: 'перевірка API недоступна' }
  if (state.api?.status !== 'available') issues.push(`API: ${api[state.api?.status ?? 'unknown'] ?? 'готовність не підтверджено'}.`)
  if (!state.configuration?.serverVersion) issues.push('Версію серверного пакета не підтверджено.')
  if (!state.configuration?.apiAddress) issues.push('Адресу підключення не підтверджено.')
  for (const check of state.checks ?? []) {
    if (check.status === 'passed') continue
    if (check.id === 'configuration') issues.push('Читання та коректність server.json не підтверджено.')
    if (check.id === 'package') issues.push('Наявність необхідних файлів серверного пакета не підтверджено.')
  }
  if (state.installation.status !== 'installed') issues.push('Узгодженість служби, конфігурації та пакета не підтверджено.')
  return issues
}
