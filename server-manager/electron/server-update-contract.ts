export type ServerUpdatePreview = {
  id: string
  sourceName: string
  currentVersion: string
  newVersion: string
  apiContract: string
  sqliteRange: { minimum: number; maximum: number }
  currentSchema: number
  sameVersion: boolean
  authenticity: 'unsigned'
}
export type ServerUpdateStage = 'package' | 'compatibility' | 'prepare' | 'stop' | 'switch' | 'start' | 'health' | 'complete'
export type ServerUpdateProgress = { operationId: string; stage: ServerUpdateStage; message: string }
export type ServerUpdateResult = { operationId: string; success: boolean; rolledBack: boolean; manualRecoveryRequired: boolean; failureKind?: 'preparation' | 'rolled_back' | 'recovery_required'; message: string; details?: string }
export type ReleaseUpdateState = { installedVersion: string; checkedAt?: string; availableVersion?: string; notes?: string; status: 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'verifying' | 'ready' | 'installing' | 'restarting' | 'error'; receivedBytes?: number; totalBytes?: number; error?: string; confirmed: boolean }
export type ServerReleaseState = { installedVersion: string | null; availableVersion?: string; checkedAt?: string; notes?: string; status: 'unknown' | 'up-to-date' | 'available' | 'downloading' | 'verifying' | 'ready' | 'error'; receivedBytes?: number; totalBytes?: number; error?: string; packagePath?: string; artifact?: { component: 'installer' | 'server'; name: string; sha256: string; sizeBytes: number; packageIntegrity?: string }; url?: string }
