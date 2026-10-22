import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BackupArchive } from '../shared/backup-contract.js'
import { isBackupArchive } from '../shared/backup-contract.js'
import { securePrivateDirectory } from './protected-directory.js'

export function atomicPrivateFile(path: string, content: Buffer): void {
  const temporary = `${path}.${randomUUID()}.partial`
  try {
    const handle = openSync(temporary, 'wx', 0o600)
    try { writeFileSync(handle, content); fsyncSync(handle) } finally { closeSync(handle) }
    renameSync(temporary, path)
  } finally { rmSync(temporary, { force: true }) }
}

export type SecretProtector = { available(): boolean; encrypt(value: string): Buffer; decrypt(value: Buffer): string }
export class BackupInstallationIdentity {
  private value: { installations: Record<string, { id: string; secret: string }> } | undefined
  private prepared = false
  constructor(private readonly directory: string, private readonly protector: SecretProtector) {}
  credential(origin: string): { id: string; secret: string } {
    if (!this.protector.available()) throw new Error('Захищене сховище Windows недоступне. Резервування цього комп’ютера не активовано.')
    if (!this.prepared) { securePrivateDirectory(this.directory); this.prepared = true }
    const path = join(this.directory, 'installation.dat')
    if (!this.value) {
      if (existsSync(path)) {
        try {
          const parsed = JSON.parse(this.protector.decrypt(readFileSync(path))) as { installations: Record<string, { id: string; secret: string }> }
          if (!parsed.installations || typeof parsed.installations !== 'object' || Object.values(parsed.installations).some(value => !value || !/^[a-f0-9-]{36}$/.test(value.id) || typeof value.secret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.secret))) throw new Error()
          this.value = parsed
        } catch { throw new Error('Не вдалося відкрити захищену ідентифікацію інсталяції. Наявні копії збережені.') }
      } else this.value = { installations: {} }
    }
    if (!this.value.installations[origin]) {
      const next = { installations: { ...this.value.installations, [origin]: { id: randomUUID(), secret: randomBytes(32).toString('base64url') } } }
      atomicPrivateFile(path, this.protector.encrypt(JSON.stringify(next)))
      this.value = next
    }
    return { ...this.value.installations[origin] }
  }
}

export type SavedReplica = { archive: BackupArchive; receivedAt: string; acknowledged: boolean }
export class BackupReplicaStorage {
  readonly directory: string
  private saved: SavedReplica[]
  constructor(root: string, origin: string) {
    this.directory = join(root, createHash('sha256').update(origin).digest('hex'))
    securePrivateDirectory(this.directory)
    const index = join(this.directory, 'index.json')
    if (existsSync(index)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(index, 'utf8'))
        if (!Array.isArray(parsed) || parsed.some(item => !item || !isBackupArchive(item.archive) || typeof item.receivedAt !== 'string' || typeof item.acknowledged !== 'boolean')) throw new Error()
        this.saved = parsed as SavedReplica[]
      } catch { throw new Error('Не вдалося прочитати стан локальних резервних копій. Архіви не видалено.') }
    } else this.saved = []
    // Electron's profile singleton prevents a second writer to this directory.
    for (const name of readdirSync(this.directory)) if (/^hromada-aid-client-[a-f0-9]{64}\.hraid\.[a-f0-9-]{36}\.partial$/.test(name)) rmSync(join(this.directory, name), { force: true })
  }
  get records(): readonly SavedReplica[] { return this.saved }
  markSaved(archive: BackupArchive): void {
    if (!this.saved.some(item => item.archive.id === archive.id)) this.saved.push({ archive, receivedAt: new Date().toISOString(), acknowledged: false })
    const sorted = [...this.saved].sort((a, b) => b.archive.createdAt.localeCompare(a.archive.createdAt) || b.archive.id.localeCompare(a.archive.id))
    const kept = sorted.slice(0, 7)
    atomicPrivateFile(join(this.directory, 'index.json'), Buffer.from(JSON.stringify(kept)))
    this.saved = kept
    const names = new Set(kept.map(item => item.archive.fileName))
    for (const name of readdirSync(this.directory)) if (/^hromada-aid-client-[a-f0-9]{64}\.hraid$/.test(name) && !names.has(name)) rmSync(join(this.directory, name), { force: true })
  }
  acknowledge(id: string): void {
    const next = this.saved.map(item => item.archive.id === id ? { ...item, acknowledged: true } : item)
    atomicPrivateFile(join(this.directory, 'index.json'), Buffer.from(JSON.stringify(next)))
    this.saved = next
  }
}
