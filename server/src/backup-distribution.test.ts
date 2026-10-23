import assert from 'node:assert/strict'
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { openInitializedDatabase } from '../../electron/database.js'
import { BackupInstallationIdentity, BackupReplicaStorage, type SecretProtector } from '../../electron/backup-storage.js'
import { RemoteBackupClient } from '../../electron/backup-client.js'
import { HttpClient } from '../../electron/http-client.js'
import type { BackupArchive, BackupInstallation } from '../../shared/backup-contract.js'
import { createApp } from './app.js'
import { createFirstAdministrator, hashPassword, login } from './auth.js'
import { BackupArchives } from './backup-archives.js'
import { BackupKeyStore, createRecoveryKey, decryptBackupFile, encryptBackupFile, hashFile, readArchiveMetadata } from './backup-crypto.js'
import { dueBackupDate, nextDailyBackupTime, SqliteBackupService, listDailyBackups, startDailyBackupScheduler } from './backup.js'

const temporary = () => mkdtemp(join(tmpdir(), 'hromada-replica-test-'))
const logger = { error: (_message: string) => {}, warn: (_message: string) => {} }
async function cleanup(directory: string): Promise<void> {
  assert.ok(resolve(directory).startsWith(join(resolve(tmpdir()), 'hromada-replica-test-')))
  let lastError: unknown
  for (let attempt = 0; attempt < 5; attempt++) {
    try { await rm(directory, { recursive: true, force: true }); return } catch (error) { lastError = error; await new Promise(resolve => setTimeout(resolve, 100)) }
  }
  throw new Error('Не вдалося прибрати ізольовані тестові файли.', { cause: lastError })
}
function protector(): SecretProtector {
  const key = randomBytes(32)
  return { available: () => true, encrypt: text => {
    const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce)
    return Buffer.concat([nonce, cipher.update(text), cipher.final(), cipher.getAuthTag()])
  }, decrypt: bytes => {
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); decipher.setAuthTag(bytes.subarray(-16))
    return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString('utf8')
  } }
}
async function settled(client: RemoteBackupClient): Promise<void> {
  for (let attempt = 0; attempt < 500 && client.currentState.status === 'checking'; attempt++) await new Promise(resolve => setTimeout(resolve, 10))
  assert.notEqual(client.currentState.status, 'checking')
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

test('installation credentials survive restart, differ by server and have no plaintext fallback', async () => {
  const directory = await temporary(), encryption = protector()
  try {
    const first = new BackupInstallationIdentity(directory, encryption).credential('https://first.invalid')
    const restarted = new BackupInstallationIdentity(directory, encryption)
    assert.deepEqual(restarted.credential('https://first.invalid'), first)
    const other = restarted.credential('https://second.invalid')
    assert.notEqual(other.id, first.id); assert.notEqual(other.secret, first.secret)
    assert.equal((await readFile(join(directory, 'installation.dat'))).includes(Buffer.from(first.secret)), false)
    assert.throws(() => new BackupInstallationIdentity(join(directory, 'unsafe'), { ...encryption, available: () => false }).credential('https://first.invalid'))
  } finally { await cleanup(directory) }
})

test('real loopback HTTP: user session + allowed credential, no ID spoofing, admin RBAC, replica sync, duplicate prevention and revocation', async () => {
  const directory = await temporary(), db = openInitializedDatabase(join(directory, 'api-test.sqlite'))
  const key = createRecoveryKey(), backupDirectory = join(directory, 'server-backups')
  const archives = new BackupArchives(backupDirectory, () => key.bytes)
  const service = new SqliteBackupService(db, backupDirectory, logger)
  let app: ReturnType<typeof createApp> | undefined, client: RemoteBackupClient | undefined
  try {
    const admin = await createFirstAdministrator(db, { username: 'synthetic-admin', password: 'synthetic password' }); assert.equal(admin.ok, true)
    const viewerId = randomUUID(), now = new Date().toISOString()
    db.prepare('INSERT INTO users(id,username,username_key,display_name,password_hash,status,created_at,updated_at,password_changed_at) VALUES(?,?,?,?,?,?,?,?,?)').run(viewerId, 'synthetic-viewer', 'synthetic-viewer', 'Synthetic', await hashPassword('synthetic password'), 'active', now, now, now)
    db.prepare('INSERT INTO user_roles(user_id,role) VALUES(?,?)').run(viewerId, 'viewer')
    const administrator = await login(db, { username: 'synthetic-admin', password: 'synthetic password' }), viewer = await login(db, { username: 'synthetic-viewer', password: 'synthetic password' })
    assert.ok(administrator.ok && viewer.ok)
    await service.createDailyBackup('2026-10-22', new Date(2026, 9, 22, 12))
    const catalog = await archives.list(); assert.equal(catalog.length, 1)
    assert.deepEqual(await new BackupArchives(backupDirectory, () => key.bytes).list(), catalog)
    app = createApp(db, archives); app.log.level = 'silent'
    let downloads = 0
    app.addHook('onRequest', async req => { if (/\/api\/backups\/archives\/[a-f0-9]{64}$/.test(req.url)) downloads++ })
    await app.listen({ host: '127.0.0.1', port: 0 })
    const address = app.server.address(); assert.ok(address && typeof address !== 'string')
    const base = new URL(`http://127.0.0.1:${address.port}`)
    const request = (path: string, token?: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => fetch(new URL(path, base), { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    assert.equal((await request('/api/backups/archives')).status, 401)
    assert.equal((await request(`/api/backups/archives/${catalog[0].id}`)).status, 401)
    assert.equal((await request('/api/backups/archives', administrator.value.token)).status, 403)
    assert.equal((await request(`/api/backups/archives/${catalog[0].id}`, administrator.value.token)).status, 403)
    assert.equal((await request('/api/backup-clients', viewer.value.token)).status, 403)
    const http = new HttpClient(base, 2000, { getAccessToken: () => viewer.ok ? viewer.value.token : undefined })
    const identity = new BackupInstallationIdentity(join(directory, 'identity'), protector())
    const credential = identity.credential(base.origin)
    client = new RemoteBackupClient(http, identity, join(directory, 'replicas'), 'SYNTHETIC-COMPUTER')
    client.authChanged({ status: 'authenticated', user: viewer.value.user }); await settled(client)
    assert.equal(client.currentState.status, 'disabled')
    const list = await (await request('/api/backup-clients', administrator.value.token)).json() as BackupInstallation[]
    assert.equal(list.length, 1); assert.equal('credential_hash' in list[0], false)
    assert.equal(JSON.stringify(list).includes(credential.secret), false)
    assert.equal(JSON.stringify(catalog).includes(key.encoded), false)
    const allow = async (allowed: boolean, revision: string) => request(`/api/backup-clients/${credential.id}`, administrator.value.token, 'PUT', { allowed, expectedUpdatedAt: revision })
    const permitted = await (await allow(true, list[0].updatedAt)).json() as BackupInstallation
    const spoof = { 'x-hromada-installation-id': credential.id, 'x-hromada-installation-key': randomBytes(32).toString('base64url') }
    assert.equal((await request('/api/backups/archives', viewer.value.token, 'GET', undefined, spoof)).status, 403)
    assert.equal((await request('/api/backups/installations/register', viewer.value.token, 'POST', { computerName: 'spoof' }, spoof)).status, 403)
    assert.equal((await request(`/api/backups/archives/${catalog[0].id}`, viewer.value.token, 'GET', undefined, spoof)).status, 403)
    assert.equal((await request(`/api/backup-clients/${credential.id}`, viewer.value.token, 'PUT', { allowed: true, expectedUpdatedAt: permitted.updatedAt })).status, 403)
    client.wake(); await settled(client); assert.equal(client.currentState.status, 'enabled')
    const initialDownloads = downloads
    const local = join(client.archiveDirectory!, catalog[0].fileName)
    assert.equal((await hashFile(local)).sha256, catalog[0].sha256)
    assert.equal((await readFile(local)).subarray(0, 8).toString('ascii'), 'HRAIDBKP')
    assert.equal(JSON.stringify(client.currentState).includes(viewer.value.token), false)
    assert.equal(JSON.stringify(client.currentState).includes(credential.secret), false)
    client.wake(); await settled(client); assert.equal(downloads, initialDownloads)
    assert.equal((await readdir(client.archiveDirectory!)).filter(name => name.endsWith('.hraid')).length, 1)
    assert.equal((await request(`/${catalog[0].fileName}`, viewer.value.token)).status, 404)
    for (let day = 23; day <= 30; day++) await service.createDailyBackup(`2026-10-${day}`, new Date(2026, 9, day, 12))
    const afterAbsence = await archives.list()
    assert.equal(afterAbsence.length, 9)
    client.wake(); await settled(client); assert.equal(client.currentState.status, 'enabled')
    const latestSeven = [...afterAbsence].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 7)
    assert.deepEqual((await readdir(client.archiveDirectory!)).filter(name => name.endsWith('.hraid')).sort(), latestSeven.map(item => item.fileName).sort())
    const successfulCount = downloads
    await app.close()
    client.wake(); await settled(client); assert.equal(client.currentState.status, 'error')
    assert.equal((await readdir(client.archiveDirectory!)).filter(name => name.endsWith('.hraid')).length, 7)
    app = createApp(db, archives); app.log.level = 'silent'
    app.addHook('onRequest', async req => { if (/\/api\/backups\/archives\/[a-f0-9]{64}$/.test(req.url)) downloads++ })
    await app.listen({ host: '127.0.0.1', port: address.port })
    client.wake(); await settled(client); assert.equal(client.currentState.status, 'enabled'); assert.equal(downloads, successfulCount)
    assert.equal((await allow(false, list[0].updatedAt)).status, 409)
    assert.equal((await allow(false, permitted.updatedAt)).status, 200)
    const headers = { 'x-hromada-installation-id': credential.id, 'x-hromada-installation-key': credential.secret }
    assert.equal((await request(`/api/backups/archives/${catalog[0].id}`, viewer.value.token, 'GET', undefined, headers)).status, 403)
    client.wake(); await settled(client); assert.equal(client.currentState.status, 'disabled')
    assert.equal((await hashFile(join(client.archiveDirectory!, latestSeven[0].fileName))).sha256, latestSeven[0].sha256)
    client.authChanged({ status: 'unauthenticated', user: null }); assert.equal(client.currentState.status, 'signed-out')
    assert.equal(db.prepare('PRAGMA quick_check').get()?.quick_check, 'ok')
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0)
  } finally { await client?.stop(); await app?.close(); await archives.stop(); db.close(); await cleanup(directory) }
})

test('interrupted HTTP download leaves no final file; client retention keeps seven and never prunes on a failed download', async () => {
  const directory = await temporary()
  try {
    const storage = new BackupReplicaStorage(directory, 'https://synthetic.invalid')
    for (let day = 1; day <= 9; day++) {
      const id = createHash('sha256').update(String(day)).digest('hex')
      const archive: BackupArchive = { id, fileName: `hromada-aid-client-${id}.hraid`, formatVersion: 2, createdAt: new Date(2026, 9, day).toISOString(), slotDate: `2026-10-${String(day).padStart(2, '0')}`, sha256: '0'.repeat(64), size: 100 }
      await writeFile(join(storage.directory, archive.fileName), 'synthetic completed archive')
      storage.markSaved(archive)
    }
    assert.equal(storage.records.length, 7)
    assert.equal((await readdir(storage.directory)).filter(name => name.endsWith('.hraid')).length, 7)
    const archive = { ...storage.records[0].archive, id: 'a'.repeat(64), fileName: `hromada-aid-client-${'a'.repeat(64)}.hraid` }
    const insecure = new HttpClient(new URL('http://synthetic.invalid'), 1000, { getAccessToken: () => 'synthetic-session' })
    await assert.rejects(insecure.downloadBackup(`/api/backups/archives/${archive.id}`, join(storage.directory, archive.fileName), archive, {}, new AbortController().signal), /HTTPS/)
    const interrupted = createServer((_request, response) => {
      response.writeHead(200, { 'content-length': String(archive.size), 'x-backup-sha256': archive.sha256 })
      response.write(Buffer.alloc(10))
      setTimeout(() => response.destroy(), 20)
    })
    await new Promise<void>(resolve => interrupted.listen(0, '127.0.0.1', resolve))
    try {
      const address = interrupted.address(); assert.ok(address && typeof address !== 'string')
      const http = new HttpClient(new URL(`http://127.0.0.1:${address.port}`), 1000, { getAccessToken: () => 'synthetic-session' })
      await assert.rejects(http.downloadBackup(`/api/backups/archives/${archive.id}`, join(storage.directory, archive.fileName), archive, {}, new AbortController().signal))
    } finally { await new Promise<void>((resolve, reject) => interrupted.close(error => error ? reject(error) : resolve())) }
    const entries = await readdir(storage.directory)
    assert.equal(entries.includes(archive.fileName), false); assert.equal(entries.some(name => name.endsWith('.partial')), false)
    assert.equal(entries.filter(name => name.endsWith('.hraid')).length, 7)
  } finally { await cleanup(directory) }
})
