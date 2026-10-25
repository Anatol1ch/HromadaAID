import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { BackupArchives } from './backup-archives.js'
import { BackupKeyStore, createRecoveryKey, decryptBackupFile, encryptBackupFile, hashFile, readArchiveMetadata } from './backup-crypto.js'
import { dueBackupDate, nextDailyBackupTime, SqliteBackupService, listDailyBackups, startDailyBackupScheduler } from './backup.js'

const temporary = () => mkdtemp(join(tmpdir(), 'hromada-backup-test-'))
const logger = { error: (_message: string) => {}, warn: (_message: string) => {} }
async function cleanup(directory: string): Promise<void> {
  assert.ok(resolve(directory).startsWith(join(resolve(tmpdir()), 'hromada-backup-test-')))
  let lastError: unknown
  for (let attempt = 0; attempt < 5; attempt++) {
    try { await rm(directory, { recursive: true, force: true }); return } catch (error) { lastError = error; await new Promise(resolve => setTimeout(resolve, 100)) }
  }
  throw new Error('Не вдалося прибрати ізольовані тестові файли.', { cause: lastError })
}
test('version 2 authenticates metadata, detects damage and decrypts with an independent recovery key; version 1 stays compatible', async () => {
  const directory = await temporary()
  try {
    const input = join(directory, 'synthetic-test.sqlite'), db = new DatabaseSync(input)
    db.exec("CREATE TABLE synthetic(value TEXT); INSERT INTO synthetic VALUES('synthetic only');"); db.close()
    const key = createRecoveryKey(), id = createHash('sha256').update('synthetic').digest('hex')
    const metadata = { id, createdAt: new Date().toISOString(), sourceSha256: (await hashFile(input)).sha256 }
    for (const version of [1, 2]) {
      const archive = join(directory, `v${version}.hraid`), restored = join(directory, `v${version}-restored.sqlite`)
      await encryptBackupFile(input, archive, key.bytes, version === 2 ? metadata : undefined)
      if (version === 2) assert.deepEqual(await readArchiveMetadata(archive), metadata)
      await decryptBackupFile(archive, restored, Buffer.from(key.encoded, 'base64url'))
      assert.equal((await hashFile(restored)).sha256, metadata.sourceSha256)
      const damaged = await readFile(archive); damaged[Math.floor(damaged.length / 2)] ^= 1
      await writeFile(archive, damaged)
      await assert.rejects(decryptBackupFile(archive, join(directory, 'damaged.sqlite'), key.bytes))
      assert.equal((await readdir(directory)).includes('damaged.sqlite'), false)
    }
  } finally { await cleanup(directory) }
})
test('server key uses Windows DPAPI, never replaces an existing key', async context => {
  if (process.platform !== 'win32') { context.skip('Windows DPAPI requires Windows'); return }
  const directory = await temporary()
  try {
    const key = createRecoveryKey(), store = new BackupKeyStore(directory)
    store.create({ version: 1, encryptionKey: key.encoded })
    assert.equal((await readFile(store.path)).includes(Buffer.from(key.encoded)), false)
    assert.equal(store.load()?.encryptionKey, key.encoded)
    assert.throws(() => store.create({ version: 1, encryptionKey: createRecoveryKey().encoded }))
    assert.equal(store.load()?.encryptionKey, key.encoded)
  } finally { await cleanup(directory) }
})

test('WAL backup, noon catch-up, no duplicate daily copy, server retention 14 and no partial sidecars', async () => {
  const directory = await temporary(), db = new DatabaseSync(join(directory, 'synthetic-test.sqlite'))
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE synthetic(value); INSERT INTO synthetic VALUES(123);")
  try {
    assert.equal(dueBackupDate(new Date(2026, 9, 22, 11)), '2026-10-21')
    assert.equal(dueBackupDate(new Date(2026, 9, 22, 12)), '2026-10-22')
    assert.equal(nextDailyBackupTime(new Date(2026, 9, 22, 12)).getDate(), 23)
    const backups = join(directory, 'backups'), service = new SqliteBackupService(db, backups, logger)
    let scheduler = startDailyBackupScheduler(service, logger, { now: () => new Date(2026, 9, 1, 11) })
    await scheduler.initialRun; await scheduler.stop()
    scheduler = startDailyBackupScheduler(service, logger, { now: () => new Date(2026, 9, 1, 11) })
    await scheduler.initialRun; await scheduler.stop()
    assert.equal(listDailyBackups(backups).length, 1)
    for (let day = 2; day <= 16; day++) assert.equal((await service.createDailyBackup(`2026-10-${String(day).padStart(2, '0')}`, new Date(2026, 9, day, 12))).status, 'created')
    assert.equal(listDailyBackups(backups).length, 14)
    assert.equal((await readdir(backups)).some(name => /partial|\-wal$|\-shm$/.test(name)), false)
    const copy = new DatabaseSync(listDailyBackups(backups)[0].path, { readOnly: true })
    try { assert.equal(copy.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok'); assert.equal(copy.prepare('SELECT value FROM synthetic').get()?.value, 123) } finally { copy.close() }
    assert.equal(db.prepare('PRAGMA quick_check').get()?.quick_check, 'ok')
  } finally { db.close(); await cleanup(directory) }
})
