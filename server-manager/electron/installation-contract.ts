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
  status: 'running' | 'awaiting-confirmation' | 'succeeded' | 'failed'
  message: string
  errorCode?: string
  result?: { service: 'running'; api: 'available'; serverVersion: string; apiAddress: string }
}
