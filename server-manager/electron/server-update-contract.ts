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
export type ServerUpdateResult = { operationId: string; success: boolean; rolledBack: boolean; manualRecoveryRequired: boolean; message: string; details?: string }
