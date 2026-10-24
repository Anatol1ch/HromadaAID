import type { CheckStatus, InstallationStatus, InspectionCheck, ServiceStatus, ApiStatus } from '../electron/inspection-types'

export type PresentationTone = 'success' | 'warning' | 'error' | 'info'
export type DiagnosticLevel = 'success' | 'warning' | 'error' | 'info'

export type DisplayState = { label: string; tone: PresentationTone }

export const notCheckedState = (checking = false): DisplayState => ({
  label: checking ? 'Перевіряється…' : 'Не перевірено',
  tone: 'info',
})

export function installationDisplay(status: InstallationStatus | null, checking = false): DisplayState {
  if (status === null) return notCheckedState(checking)
  const states: Record<InstallationStatus, DisplayState> = {
    installed: { label: 'Встановлено', tone: 'success' },
    not_installed: { label: 'Не встановлено', tone: 'info' },
    partial_installation: { label: 'Частково встановлено', tone: 'warning' },
    unknown: { label: 'Невідомо', tone: 'warning' },
  }
  return states[status]
}

export function serviceDisplay(status: ServiceStatus | null, checking = false): DisplayState {
  if (status === null) return notCheckedState(checking)
  const states: Record<ServiceStatus, DisplayState> = {
    running: { label: 'Працює', tone: 'success' },
    stopped: { label: 'Зупинена', tone: 'warning' },
    other: { label: 'Проміжний стан', tone: 'warning' },
    missing: { label: 'Не встановлена', tone: 'info' },
    unknown: { label: 'Невідомо', tone: 'warning' },
  }
  return states[status]
}

export function apiDisplay(status: ApiStatus | null, checking = false): DisplayState {
  if (status === null) return notCheckedState(checking)
  const states: Record<ApiStatus, DisplayState> = {
    available: { label: 'Доступний', tone: 'success' },
    unavailable: { label: 'Недоступний', tone: 'warning' },
    invalid_response: { label: 'Некоректна відповідь', tone: 'error' },
    not_configured: { label: 'Не визначено', tone: 'info' },
    unknown: { label: 'Невідомо', tone: 'warning' },
  }
  return states[status]
}

export function diagnosticLevel(check: Pick<InspectionCheck, 'id' | 'status'>, installation: InstallationStatus | null): DiagnosticLevel {
  const absentComponent = check.id === 'service' || check.id === 'configuration' || check.id === 'package' || check.id === 'installation'
  if (installation === 'not_installed' && absentComponent && check.status === 'warning') return 'info'
  const levels: Record<CheckStatus, DiagnosticLevel> = {
    passed: 'success',
    warning: 'warning',
    failed: 'error',
    unknown: 'warning',
    not_checked: 'info',
  }
  return levels[check.status]
}
