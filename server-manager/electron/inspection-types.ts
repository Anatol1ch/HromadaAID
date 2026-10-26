export type CheckStatus = 'passed' | 'warning' | 'failed' | 'unknown' | 'not_checked'
export type InstallationStatus = 'not_installed' | 'ready_to_configure' | 'installed' | 'partial_installation' | 'unknown'
export type ServiceStatus = 'running' | 'stopped' | 'other' | 'missing' | 'unknown'
export type ApiStatus = 'available' | 'unavailable' | 'invalid_response' | 'not_configured' | 'unknown'
export type DiscoverySource = 'windows_service' | 'installer_registry' | 'standard_locations' | 'none' | 'unknown'
export type DiscoveryConfidence = 'confirmed' | 'corroborated' | 'stale' | 'untrusted' | 'unavailable'

export type InspectionDiagnostic = { operation: string; target: string; code: string; message: string }

export type InspectionCheck = {
  id: 'installation' | 'service' | 'configuration' | 'package' | 'api'
  title: string
  status: CheckStatus
  checkedAt: string
  message: string
  details?: string
  diagnostics?: InspectionDiagnostic[]
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
  updateReadiness?: { ready: boolean; reason: string }
  checks: InspectionCheck[]
}

export type ManagerInspectionApi = {
  releaseUpdateState(): Promise<{ manager: import('./server-update-contract.js').ReleaseUpdateState; server: import('./server-update-contract.js').ServerReleaseState }>
  checkReleaseUpdates(): Promise<{ manager: import('./server-update-contract.js').ReleaseUpdateState; server: import('./server-update-contract.js').ServerReleaseState }>
  downloadManagerUpdate(): Promise<{ packagePath: string; version: string }>
  installManagerUpdate(): Promise<boolean>
  downloadServerRelease(): Promise<{ preview: import('./server-update-contract.js').ServerUpdatePreview }>
  onReleaseUpdateState(listener: (value: { manager: import('./server-update-contract.js').ReleaseUpdateState; server: import('./server-update-contract.js').ServerReleaseState }) => void): () => void
  recoveryStatus(): Promise<import('./recovery-contract.js').RecoveryStatus>
  recoverOperation(kind: import('./recovery-contract.js').RecoveryKind, confirmed: true): Promise<{ success: boolean; message: string }>
  onRecoveryProgress(listener: (value: { message: string }) => void): () => void
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
  selectServerUpdatePackage(): Promise<{ preview: import('./server-update-contract.js').ServerUpdatePreview | null; error?: string; details?: string; code?: string }>
  applyServerUpdate(previewId: string): Promise<import('./server-update-contract.js').ServerUpdateResult>
  cancelServerUpdatePreview(previewId: string): Promise<boolean>
  onServerUpdateProgress(listener: (value: import('./server-update-contract.js').ServerUpdateProgress) => void): () => void
  backupSession(): Promise<{ username: string; displayName: string | null } | null>
  backupLogin(username: string, password: string): Promise<{ username: string; displayName: string | null }>
  backupLogout(): Promise<boolean>
  backupList(): Promise<import('./backup-contract.js').ServerBackupList>
  backupCreate(): Promise<import('./backup-contract.js').ServerBackupList>
  backupExport(id: string): Promise<{ canceled: boolean; message?: string }>
  backupImport(recoveryKey?: string): Promise<{ id: string; fileName: string; createdAt: string | null; size: number } | null>
  backupVerify(id: string, recoveryKey?: string): Promise<{ createdAt: string | null; size: number }>
  backupOpenFolder(): Promise<boolean>
  backupRestore(id: string, confirmed: true, recoveryKey?: string): Promise<{ success: boolean; message: string }>
  onBackupProgress(listener: (value: { stage: string; message: string }) => void): () => void
}

declare global {
  interface Window {
    hromadaManager: ManagerInspectionApi
  }
}
