import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { BackupArchive } from '../../shared/backup-contract.js'
import { listDailyBackups, listManualBackups, secureBackupDirectory } from './backup.js'
import { decryptBackupFile, encryptBackupFile, hashFile, readArchiveMetadata } from './backup-crypto.js'

export class BackupArchives {
  private running: Promise<BackupArchive[]> | undefined
  private verified = new Map<string, BackupArchive>()
  private prepared = false
  constructor(readonly directory: string, private readonly key: () => Buffer) {}

  list(): Promise<BackupArchive[]> {
    if (this.running) return this.running
    const operation = this.prepare()
    this.running = operation
    void operation.finally(() => { if (this.running === operation) this.running = undefined }).catch(() => undefined)
    return operation
  }

  async stop(): Promise<void> { await this.running?.catch(() => undefined) }

  async listAll(): Promise<BackupArchive[]> { return this.list() }
  dailyOnly(items: BackupArchive[]): BackupArchive[] { return items.filter(item => item.kind !== 'manual').slice(0, 14) }
  get encryptionKey(): Buffer { return this.key() }

  private async prepare(): Promise<BackupArchive[]> {
    if (!this.prepared) { secureBackupDirectory(this.directory); this.prepared = true }
    const key = this.key()
    const daily = listDailyBackups(this.directory).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 14)
    const sources = [...daily, ...listManualBackups(this.directory)].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const result: BackupArchive[] = []
    for (const source of sources) {
      const id = createHash('sha256').update(source.name).digest('hex')
      const cached = this.verified.get(id)
      if (cached) { result.push(cached); continue }
      const parts = source.createdAt.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})$/)!
      const createdAt = new Date(+parts[1], +parts[2] - 1, +parts[3], +parts[4], +parts[5], +parts[6], +parts[7]).toISOString()
      const fileName = `hromada-aid-client-${id}.hraid`
      const finalPath = join(this.directory, fileName)
      const partial = `${finalPath}.${randomUUID()}.partial`
      const verification = `${finalPath}.${randomUUID()}.verify.partial`
      const sourceHash = await hashFile(source.path)
      try {
        const alreadyExists = existsSync(finalPath)
        if (!alreadyExists) await encryptBackupFile(source.path, partial, key, { id, createdAt, sourceSha256: sourceHash.sha256 })
        const candidate = alreadyExists ? finalPath : partial
        const metadata = await readArchiveMetadata(candidate)
        if (metadata.id !== id || metadata.createdAt !== createdAt || metadata.sourceSha256 !== sourceHash.sha256) throw new Error('Метадані резервного архіву не відповідають знімку.')
        await decryptBackupFile(candidate, verification, key)
        if ((await hashFile(verification)).sha256 !== sourceHash.sha256) throw new Error('Перевірка резервного архіву не пройдена.')
        const copy = new DatabaseSync(verification, { readOnly: true })
        try {
          const result = copy.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[]
          if (result.length !== 1 || result[0].integrity_check !== 'ok' || copy.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Архів не пройшов перевірку цілісності SQLite.')
        } finally { copy.close() }
        const checksum = await hashFile(candidate)
        if (!alreadyExists) await rename(partial, finalPath)
        const item: BackupArchive = { id, fileName, createdAt, slotDate: source.slotDate, size: checksum.size, sha256: checksum.sha256, formatVersion: 2, kind: source.name.startsWith('hromada-aid-manual-') ? 'manual' : 'automatic', integrity: 'verified' }
        this.verified.set(id, item)
        result.push(item)
      } finally {
        await rm(partial, { force: true })
        // Only this private verification file, after its SQLite handle is closed.
        for (const suffix of ['', '-wal', '-shm']) await rm(`${verification}${suffix}`, { force: true })
      }
    }
    // Only our new archive names follow the local 14-copy retention. Legacy
    // archives and recovery keys are deliberately outside this pattern.
    const retained = new Set(result.map(item => item.fileName))
    for (const name of await readdir(this.directory)) {
      if (/^hromada-aid-client-[a-f0-9]{64}\.hraid$/.test(name) && !retained.has(name)) {
        try { await rm(join(this.directory, name), { force: true }) } catch { /* A currently downloading file is retried at the next inventory refresh. */ }
      }
    }
    this.verified = new Map(result.map(item => [item.id, item]))
    return result
  }
}
