export type BackupArchive = { id: string; fileName: string; createdAt: string; slotDate: string; size: number; sha256: string; formatVersion: 2; kind?: 'automatic' | 'manual'; integrity?: 'verified' }
export type ServerBackupList = { archives: BackupArchive[]; schedule: string }

function isArchive(value: unknown): value is BackupArchive {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return typeof item.id === 'string' && /^[a-f0-9]{64}$/.test(item.id) && item.fileName === `hromada-aid-client-${item.id}.hraid` &&
    typeof item.createdAt === 'string' && Number.isFinite(Date.parse(item.createdAt)) && typeof item.slotDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.slotDate) &&
    typeof item.size === 'number' && Number.isSafeInteger(item.size) && item.size > 0 && typeof item.sha256 === 'string' && /^[a-f0-9]{64}$/.test(item.sha256) && item.formatVersion === 2 &&
    (item.kind === undefined || item.kind === 'automatic' || item.kind === 'manual') && (item.integrity === undefined || item.integrity === 'verified')
}
export function isServerBackupList(value: unknown): value is ServerBackupList {
  const item = value as ServerBackupList
  return !!item && typeof item.schedule === 'string' && Array.isArray(item.archives) && item.archives.every(isArchive)
}
