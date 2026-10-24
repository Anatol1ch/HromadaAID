export type CheckStatus = 'passed' | 'warning' | 'failed' | 'unknown' | 'not_checked'
export type InstallationStatus = 'not_installed' | 'installed' | 'partial_installation' | 'unknown'
export type ServiceStatus = 'running' | 'stopped' | 'other' | 'missing' | 'unknown'
export type ApiStatus = 'available' | 'unavailable' | 'invalid_response' | 'not_configured' | 'unknown'

export type InspectionCheck = {
  id: 'installation' | 'service' | 'configuration' | 'package' | 'api'
  title: string
  status: CheckStatus
  checkedAt: string
  message: string
  details?: string
}

export type InspectedConfiguration = {
  programDirectory: string | null
  dataDirectory: string | null
  backupDirectory: string | null
  databasePath: string | null
  apiAddress: string | null
  host: string | null
  port: number | null
  transport: 'HTTP' | 'HTTPS' | null
  serverVersion: string | null
  serviceName: string
  serviceAccount: string | null
  startMode: string | null
  logDirectory: string | null
}

export type InspectionSnapshot = {
  checkedAt: string
  installation: { status: InstallationStatus; message: string }
  service: { status: ServiceStatus; message: string }
  api: { status: ApiStatus; message: string; contractVersion: number | null }
  configuration: InspectedConfiguration
  checks: InspectionCheck[]
}

export type ManagerInspectionApi = {
  inspectEnvironment(): Promise<InspectionSnapshot>
}

declare global {
  interface Window {
    hromadaManager: ManagerInspectionApi
  }
}
