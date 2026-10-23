export type BackupArchive = { id: string; fileName: string; createdAt: string; slotDate: string; size: number; sha256: string; formatVersion: 2; kind?: 'automatic' | 'manual'; integrity?: 'verified' }
export type RestorePreview = { id: string; confirmationToken: string; createdAt: string | null; expiresAt: string; message: string }
export type ServerBackupList = { archives: BackupArchive[]; schedule: string }
export function isServerBackupList(value: unknown): value is ServerBackupList { const v = value as ServerBackupList; return !!v && typeof v.schedule === 'string' && Array.isArray(v.archives) && v.archives.every(isBackupArchive) }
export function isRestorePreview(value: unknown): value is RestorePreview { const v = value as RestorePreview; return !!v && typeof v.id === 'string' && typeof v.confirmationToken === 'string' && (v.createdAt === null || typeof v.createdAt === 'string') && typeof v.expiresAt === 'string' && typeof v.message === 'string' }
export type BackupInstallation = { id: string; computerName: string; allowed: boolean; lastSeenAt: string; lastBackupAt: string | null; updatedAt: string }
export type ClientBackupState = { status: 'signed-out' | 'checking' | 'disabled' | 'enabled' | 'error'; lastBackupAt?: string; message?: string }
export type BackupActionResult = { ok: boolean; message?: string }
export function isBackupInstallation(value: unknown): value is BackupInstallation {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.id === 'string' && typeof v.computerName === 'string' && typeof v.allowed === 'boolean' && typeof v.lastSeenAt === 'string' && (v.lastBackupAt === null || typeof v.lastBackupAt === 'string') && typeof v.updatedAt === 'string'
}
export function isBackupInstallationList(value: unknown): value is BackupInstallation[] { return Array.isArray(value) && value.every(isBackupInstallation) }
export function isBackupArchive(value: unknown): value is BackupArchive {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.id === 'string' && /^[a-f0-9]{64}$/.test(v.id) && v.fileName === `hromada-aid-client-${v.id}.hraid` &&
    typeof v.createdAt === 'string' && Number.isFinite(Date.parse(v.createdAt)) && typeof v.slotDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.slotDate) &&
    typeof v.size === 'number' && Number.isSafeInteger(v.size) && v.size > 0 && typeof v.sha256 === 'string' && /^[a-f0-9]{64}$/.test(v.sha256) && v.formatVersion === 2
}
export function isBackupArchiveList(value: unknown): value is BackupArchive[] { return Array.isArray(value) && value.length <= 14 && value.every(isBackupArchive) }
