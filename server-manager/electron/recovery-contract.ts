export type RecoveryKind = 'update' | 'resume-restore' | 'return-database'
export type UpdateArtifactDiagnostic = { name: string; path: string; kind: 'directory' | 'file' | 'symbolic-link' | 'other'; modifiedAt?: string }
export type UpdateJournalDiagnostic = { name: string; path: string; exists: boolean; kind?: 'file' | 'directory' | 'symbolic-link' | 'other'; modifiedAt?: string }
export type RecoveryStatus = {
  update: { pending: boolean; canRecover: boolean; reason: string; journal?: UpdateJournalDiagnostic; artifacts?: UpdateArtifactDiagnostic[] }
  restore: { pending: boolean; canReturn: boolean; reason: string }
}
