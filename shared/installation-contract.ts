/** Transport-independent future Engine contract. This file performs no operations. */
export type InstallationOperationType = 'inspect' | 'install' | 'configure' | 'start-service' | 'stop-service' | 'update'
export type InstallationOperationStatus = 'pending' | 'running' | 'awaiting-confirmation' | 'succeeded' | 'failed' | 'cancelled'
export type InstallationStage = 'validation' | 'directories' | 'configuration' | 'initialization' | 'administrator' | 'recovery-key' | 'service' | 'health' | 'complete'

export type InstallationOperation = {
  operationId: string
  type: InstallationOperationType
  stage: InstallationStage
  status: InstallationOperationStatus
  errorCode: string | null
  /** Safe text only: never passwords, tokens, key material or raw child stdout. */
  message: string
  requiresElevation: boolean
  retry: { allowed: boolean; reason: string }
}
