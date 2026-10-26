export type RecoveryKind = 'update' | 'resume-restore' | 'return-database'
export type RecoveryStatus = {
  update: { pending: boolean; canRecover: boolean; reason: string }
  restore: { pending: boolean; canReturn: boolean; reason: string }
}
