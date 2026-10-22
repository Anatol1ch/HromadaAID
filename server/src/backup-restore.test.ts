import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openInitializedDatabase } from '../../electron/database.js'
import { HttpClient } from '../../electron/http-client.js'
import { isRestorePreview, isServerBackupList } from '../../shared/backup-contract.js'
import { BackupArchives } from './backup-archives.js'
import { BackupAdministration, assertNoPendingRestore, maintenancePath } from './backup-admin.js'
import { createRecoveryKey, decryptBackupFile, encryptBackupFile, hashFile } from './backup-crypto.js'
import { SqliteBackupService, listDailyBackups, listManualBackups, startDailyBackupScheduler } from './backup.js'
import { acquireDatabaseOwnership, upgradeRestoreCandidate, validateRestoreDatabase } from './restore-safety.js'
import { restoreOffline } from './backup-restore.js'
import { authenticateSession, createFirstAdministrator, login } from './auth.js'
import { createApp } from './app.js'

const logger = { error: (_message: string) => {}, warn: (_message: string) => {} }
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'hromada-restore-test-')), path = join(root, 'synthetic-test.sqlite'), directory = join(root, 'backups')
  const db = openInitializedDatabase(path)
  assert.equal((await createFirstAdministrator(db, { username: 'syntheticadmin', password: 'synthetic password' })).ok, true)
  const key = createRecoveryKey()
  const archives = new BackupArchives(directory, () => key.bytes)
  const service = new SqliteBackupService(db, directory, logger)
  const admin = new BackupAdministration(path, archives, service, async () => {})
  return { root, path, directory, db, archives, service, admin, key }
}
async function cleanup(root: string) {
  assert.ok(resolve(root).startsWith(join(resolve(tmpdir()), 'hromada-restore-test-')))
  await rm(root, { recursive: true, force: true })
}

test('manual and daily share one lock, retain separate accounting; format 2 decrypts independently', async () => {
  const f = await fixture()
  try {
    const operation = f.service.createManualBackup()
    assert.equal((await f.service.createDailyBackup('2026-10-22', new Date(2026, 9, 22, 13))).status, 'busy')
    assert.equal((await operation).status, 'created')
    assert.equal((await f.service.createDailyBackup('2026-10-22', new Date(2026, 9, 22, 13))).status, 'created')
    assert.equal(listManualBackups(f.directory).length, 1); assert.equal(listDailyBackups(f.directory).length, 1)
    const list = await f.archives.listAll()
    assert.equal(list.length, 2); assert.equal(f.archives.dailyOnly(list).length, 1)
    const item = list.find(item => item.kind === 'manual')!
    const output = join(f.root, 'independent-test.sqlite')
    await decryptBackupFile(join(f.directory, item.fileName), output, Buffer.from(f.key.encoded, 'base64url'))
    validateRestoreDatabase(output)
    assert.equal((await readdir(f.directory)).some(name => /partial(?:-wal|-shm)?$/.test(name)), false)
  } finally { await f.archives.stop(); f.db.close(); await cleanup(f.root) }
})

test('legacy format 1 and known schema 27 recover with an independent recovery key', async () => {
  const f = await fixture()
  try {
    const result = await f.service.createManualBackup()
    assert.ok(result.path)
    const legacy = new DatabaseSync(result.path)
    legacy.exec('DROP TABLE backup_installations; DELETE FROM schema_migrations WHERE version=28; PRAGMA user_version=27;')
    legacy.close()
    const archive = join(f.root, 'legacy.hraid'), target = join(f.root, 'legacy-restored-test.sqlite')
    await encryptBackupFile(result.path, archive, f.key.bytes)
    const preview = await f.admin.prepare(archive)
    assert.equal(preview.createdAt, null)
    await decryptBackupFile(archive, target, Buffer.from(f.key.encoded, 'base64url'))
    assert.throws(() => validateRestoreDatabase(target))
    upgradeRestoreCandidate(target)
    validateRestoreDatabase(target)
  } finally { await f.archives.stop(); f.db.close(); await cleanup(f.root) }
})

test('a daily backup retries when manual creation holds the shared lock', async () => {
  const f = await fixture()
  let scheduler: ReturnType<typeof startDailyBackupScheduler> | undefined
  try {
    const manual = f.service.createManualBackup()
    scheduler = startDailyBackupScheduler(f.service, logger, { now: () => new Date(2026, 9, 22, 13), retryDelayMs: 10 })
    await Promise.all([manual, scheduler.initialRun])
    assert.equal(listDailyBackups(f.directory).length, 1)
    assert.equal(listManualBackups(f.directory).length, 1)
  } finally { await scheduler?.stop(); await f.archives.stop(); f.db.close(); await cleanup(f.root) }
})

test('real HTTP admin operations, authorization, streaming upload/download, damage and incompatible schema', async () => {
  const f = await fixture(), app = createApp(f.db, f.archives, f.admin)
  let holdHealth = false, arrived = () => {}, unblock = () => {}
  const started = new Promise<void>(resolve => { arrived = resolve })
  const barrier = new Promise<void>(resolve => { unblock = resolve })
  app.addHook('preHandler', async request => { if (holdHealth && request.routeOptions.url === '/health') { arrived(); await barrier } })
  app.log.level = 'silent'
  const release = acquireDatabaseOwnership(f.path)
  try {
    await app.listen({ host: '127.0.0.1', port: 0 })
    const address = app.server.address(); assert.ok(address && typeof address === 'object')
    const origin = `http://127.0.0.1:${address.port}`
    const session = await login(f.db, { username: 'syntheticadmin', password: 'synthetic password' }); assert.equal(session.ok, true); if (!session.ok) return
    let token: string | undefined = session.value.token
    const http = new HttpClient(new URL(origin), 300_000, { getAccessToken: () => token })
    const routes = [
      ['GET', '/api/backups/server'], ['POST', '/api/backups/server'], ['GET', `/api/backups/server/${'a'.repeat(64)}/download`],
      ['POST', `/api/backups/server/${'a'.repeat(64)}/prepare`], ['POST', '/api/backups/restore/upload'], ['POST', '/api/backups/restore/confirm'],
    ]
    for (const [method, path] of routes) assert.equal((await fetch(origin + path, { method })).status, 401)
    const now = new Date().toISOString()
    f.db.prepare('INSERT INTO users(id,username,username_key,display_name,password_hash,status,created_at,updated_at,password_changed_at) VALUES(?,?,?,?,?,?,?,?,?)').run('synthetic-viewer', 'syntheticviewer', 'syntheticviewer', 'Synthetic viewer', 'unused', 'active', now, now, now)
    f.db.prepare('INSERT INTO user_roles(user_id,role) VALUES(?,?)').run('synthetic-viewer', 'viewer')
    // Issue a synthetic viewer session without logging token material.
    const { createHash, randomBytes } = await import('node:crypto')
    const viewerToken = randomBytes(32).toString('base64url')
    f.db.prepare('INSERT INTO user_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)').run(createHash('sha256').update(viewerToken).digest('hex'), 'synthetic-viewer', now, new Date(Date.now() + 3600000).toISOString())
    for (const [method, path] of routes) assert.equal((await fetch(origin + path, { method, headers: { authorization: `Bearer ${viewerToken}` } })).status, 403)
    const list = await http.postJson('/api/backups/server', {}, isServerBackupList)
    assert.equal(list.archives.length, 1)
    assert.equal((await http.getJson('/api/backups/server', isServerBackupList)).archives.length, 1)
    const item = list.archives[0], downloaded = join(f.root, 'download.hraid')
    await http.downloadBackup(`/api/backups/server/${item.id}/download`, downloaded, item, {}, new AbortController().signal)
    assert.equal((await hashFile(downloaded)).sha256, item.sha256)
    assert.equal((await http.getJson('/api/backups/archives', (v): v is unknown[] => Array.isArray(v)).catch(() => null)), null, 'admin without device credentials cannot use distribution API')
    const preview = await http.uploadBackup(downloaded, isRestorePreview)
    assert.ok(preview.id)
    assert.ok((await http.postJson(`/api/backups/server/${item.id}/prepare`, {}, isRestorePreview)).id)
    const damaged = await readFile(downloaded); damaged[damaged.length - 1] ^= 1
    const damagedPath = join(f.root, 'damaged.hraid'); await writeFile(damagedPath, damaged)
    await assert.rejects(http.uploadBackup(damagedPath, isRestorePreview))
    const alien = join(f.root, 'alien-test.sqlite'), alienDb = new DatabaseSync(alien)
    alienDb.exec('CREATE TABLE alien(value TEXT)'); alienDb.close()
    const incompatible = join(f.root, 'alien.hraid')
    await encryptBackupFile(alien, incompatible, f.key.bytes, { id: 'b'.repeat(64), createdAt: now, sourceSha256: (await hashFile(alien)).sha256 })
    await assert.rejects(http.uploadBackup(incompatible, isRestorePreview))
    await assert.rejects(http.postJson('/api/backups/restore/confirm', { id: preview.id, confirmationToken: 'x'.repeat(43) }))
    assert.equal(f.admin.maintenance, false)
    assert.throws(() => acquireDatabaseOwnership(f.path))
    await assert.rejects(restoreOffline(f.path, f.directory), /іншим серверним процесом/)
    holdHealth = true
    const activeRequest = fetch(origin + '/health')
    await started
    await assert.rejects(http.postJson('/api/backups/restore/confirm', { id: preview.id, confirmationToken: preview.confirmationToken }))
    assert.equal(f.admin.maintenance, false)
    unblock(); await activeRequest; holdHealth = false
    await http.postJson('/api/backups/restore/confirm', { id: preview.id, confirmationToken: preview.confirmationToken })
    assert.equal((await fetch(origin + '/health')).status, 503)
    assert.throws(() => assertNoPendingRestore(f.path))
    token = undefined
  } finally { unblock(); await app.close(); await f.archives.stop(); f.db.close(); release(); await cleanup(f.root) }
})

for (const phase of ['none', 'safety', 'prepared', 'original-renamed', 'replacement-renamed', 'installed']) {
  test(`offline restore and crash recovery at ${phase}: insurance, WAL, revoked sessions`, async () => {
    const f = await fixture()
    try {
      const session = await login(f.db, { username: 'syntheticadmin', password: 'synthetic password' }); assert.equal(session.ok, true)
      await f.service.createManualBackup()
      const item = (await f.archives.listAll())[0]
      const preview = await f.admin.prepare(join(f.directory, item.fileName))
      f.db.prepare("UPDATE programs SET short_name='changed after backup' WHERE id=(SELECT id FROM programs LIMIT 1)").run()
      await f.admin.confirm(preview.id, preview.confirmationToken)
      await f.archives.stop(); f.db.close()
      if (phase !== 'none') await assert.rejects(restoreOffline(f.path, f.directory, point => { if (point === phase) throw new Error('synthetic crash') }))
      const safety = await restoreOffline(f.path, f.directory)
      assert.ok(existsSync(safety)); assert.equal(existsSync(maintenancePath(f.path)), false)
      validateRestoreDatabase(f.path)
      const restored = new DatabaseSync(f.path)
      try {
        assert.equal((restored.prepare('SELECT COUNT(*) AS n FROM user_sessions').get() as { n: number }).n, 0)
        if (session.ok) assert.equal(authenticateSession(restored, session.value.token).ok, false)
        assert.equal(restored.prepare("SELECT 1 FROM programs WHERE short_name='changed after backup'").get(), undefined)
        assert.equal((restored.prepare('PRAGMA quick_check').get() as { quick_check: string }).quick_check, 'ok')
        assert.equal(restored.prepare('PRAGMA foreign_key_check').all().length, 0)
      } finally { restored.close() }
      const insurance = new DatabaseSync(safety, { readOnly: true })
      try { assert.ok(insurance.prepare("SELECT 1 FROM programs WHERE short_name='changed after backup'").get()) } finally { insurance.close() }
      assert.equal(existsSync(`${f.path}-wal`), false); assert.equal(existsSync(`${f.path}-shm`), false)
      assertNoPendingRestore(f.path)
    } finally { try { f.db.close() } catch { /* closed before offline restore */ }; await f.archives.stop(); await cleanup(f.root) }
  })
}
