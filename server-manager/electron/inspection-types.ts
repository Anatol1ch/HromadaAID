export type CheckStatus = 'passed' | 'warning' | 'failed' | 'unknown' | 'not_checked'
export type InstallationStatus = 'not_installed' | 'installed' | 'partial_installation' | 'unknown'
export type ServiceStatus = 'running' | 'stopped' | 'other' | 'missing' | 'unknown'
export type ApiStatus = 'available' | 'unavailable' | 'invalid_response' | 'not_configured' | 'unknown'
export type DiscoverySource = 'windows_service' | 'installer_registry' | 'standard_locations' | 'none' | 'unknown'
export type DiscoveryConfidence = 'confirmed' | 'corroborated' | 'stale' | 'untrusted' | 'unavailable'

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
  discovery: { source: DiscoverySource; confidence: DiscoveryConfidence; message: string }
  checks: InspectionCheck[]
}

export type ManagerInspectionApi = {
  inspectEnvironment(): Promise<InspectionSnapshot>
  controlService(operation: import('./service-control.js').ServiceControlOperation): Promise<import('./service-control.js').ServiceControlHandlerResult>
  getInstallDefaults(): Promise<{ programDirectory: string; dataDirectory: string; backupDirectory: string }>
  selectInstallDirectory(kind: import('./installation-contract.js').InstallDirectoryKind): Promise<string | null>
  installServer(request: import('./installation-contract.js').ServerInstallRequest): Promise<{ operationId: string; success: boolean; message?: string }>
  saveRecoveryKey(): Promise<{ saved: boolean; path?: string; message?: string }>
  confirmRecoveryKeySaved(): Promise<boolean>
  cancelRecoveryKey(): Promise<boolean>
  onInstallationUpdate(listener: (value: import('./installation-contract.js').ServerInstallUpdate) => void): () => void
  onRecoveryKeyRequired(listener: (value: { operationId: string; key: string }) => void): () => void
}

declare global {
  interface Window {
    hromadaManager: ManagerInspectionApi
  }
}
