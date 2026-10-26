import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
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
import { acknowledgeRestore, completionPath, databaseFingerprint, inspectRestoreRecovery, preparePreviousDatabaseReturn } from './restore-recovery.js'
import { fileURLToPath } from 'node:url'
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

async function completedRestoreFixture() {
  const f = await fixture()
  await f.service.createManualBackup()
  const item = (await f.archives.listAll())[0]
  const preview = await f.admin.prepare(join(f.directory, item.fileName))
  f.db.prepare("UPDATE programs SET short_name='newer state before restore' WHERE id=(SELECT id FROM programs LIMIT 1)").run()
  await f.admin.confirm(preview.id, preview.confirmationToken)
  await f.archives.stop(); f.db.close()
  await restoreOffline(f.path, f.directory)
  return f
}

test('failed API startup can return verified previous SQLite through the existing journaled engine, retaining both generations', async () => {
  const f = await completedRestoreFixture()
  try {
    const firstReceipt = JSON.parse(await readFile(completionPath(f.path), 'utf8'))
    assert.equal(inspectRestoreRecovery(f.path, f.directory).canReturn, true)
    await preparePreviousDatabaseReturn(f.path, f.directory)
    assert.equal(inspectRestoreRecovery(f.path, f.directory).pending, true)
    const cli = fileURLToPath(new URL('./backup-restore-cli.js', import.meta.url))
    execFileSync(process.execPath, [cli, '--database', f.path, '--backup-dir', f.directory, '--resume', '--manager-confirmed'], { windowsHide: true, timeout: 30_000 })
    const db = new DatabaseSync(f.path, { readOnly: true })
    try { assert.ok(db.prepare("SELECT 1 FROM programs WHERE short_name='newer state before restore'").get()) } finally { db.close() }
    validateRestoreDatabase(f.path)
    assert.ok(existsSync(`${f.path}.before-restore-${firstReceipt.id}`))
    assert.ok(existsSync(join(f.directory, `hromada-aid-safety-${firstReceipt.id}.sqlite`)))
    assert.equal((await readdir(f.directory)).filter(name => /^hromada-aid-safety-.*\.sqlite$/.test(name)).length, 2)
    assert.equal(existsSync(`${f.path}.restore-journal.json`), false)
    assert.equal(inspectRestoreRecovery(f.path, f.directory).canReturn, false, 'never offer a toggle back to the failed replacement')
    acknowledgeRestore(f.path)
    assert.equal(inspectRestoreRecovery(f.path, f.directory).canReturn, false)
    await assert.rejects(preparePreviousDatabaseReturn(f.path, f.directory), { code: 'RESTORE_RECOVERY_UNSAFE' })
  } finally { await cleanup(f.root) }
})

test('a confirmed healthy API permanently disables automatic return for that restore receipt', async () => {
  const f = await completedRestoreFixture()
  try {
    assert.equal(inspectRestoreRecovery(f.path, f.directory).canReturn, true)
    const fingerprint = databaseFingerprint(f.path)
    acknowledgeRestore(f.path)
    assert.equal(inspectRestoreRecovery(f.path, f.directory).canReturn, false)
    await assert.rejects(preparePreviousDatabaseReturn(f.path, f.directory), { code: 'RESTORE_RECOVERY_UNSAFE' })
    assert.equal(databaseFingerprint(f.path), fingerprint)
  } finally { await cleanup(f.root) }
})

for (const phase of ['original-renamed', 'replacement-renamed']) {
  test(`Manager resume CLI completes existing journal after ${phase} without reselecting an archive`, async () => {
    const f = await fixture()
    try {
      await f.service.createManualBackup()
      const preview = await f.admin.prepare(join(f.directory, (await f.archives.listAll())[0].fileName))
      await f.admin.confirm(preview.id, preview.confirmationToken)
      await f.archives.stop(); f.db.close()
      await assert.rejects(restoreOffline(f.path, f.directory, point => { if (point === phase) throw new Error('Synthetic process interruption') }))
      const cli = fileURLToPath(new URL('./backup-restore-cli.js', import.meta.url))
      execFileSync(process.execPath, [cli, '--database', f.path, '--backup-dir', f.directory, '--resume', '--manager-confirmed'], { windowsHide: true, timeout: 30_000 })
      validateRestoreDatabase(f.path)
      assert.equal(existsSync(`${f.path}.restore-journal.json`), false)
      assert.ok(existsSync(`${f.path}.before-restore-${preview.id}`))
      assert.ok(existsSync(join(f.directory, `hromada-aid-safety-${preview.id}.sqlite`)))
    } finally { try { f.db.close() } catch { /* closed before offline recovery */ }; await f.archives.stop(); await cleanup(f.root) }
  })
}

test('return refuses new records and missing evidence without overwriting either database', async () => {
  const f = await completedRestoreFixture()
  try {
    const db = new DatabaseSync(f.path)
    try { db.prepare("UPDATE programs SET short_name='new data after restore' WHERE id=(SELECT id FROM programs LIMIT 1)").run() } finally { db.close() }
    const fingerprint = databaseFingerprint(f.path)
    assert.equal(inspectRestoreRecovery(f.path, f.directory).canReturn, false)
    await assert.rejects(preparePreviousDatabaseReturn(f.path, f.directory), /Дані змінилися/)
    assert.equal(databaseFingerprint(f.path), fingerprint)
    assert.equal(existsSync(maintenancePath(f.path)), false)
    await rm(completionPath(f.path))
    await assert.rejects(preparePreviousDatabaseReturn(f.path, f.directory))
    assert.equal(databaseFingerprint(f.path), fingerprint)
  } finally { await cleanup(f.root) }
})

test('return refuses a valid but changed previous database and keeps the insurance copy', async () => {
  const f = await completedRestoreFixture()
  try {
    const record = JSON.parse(await readFile(completionPath(f.path), 'utf8'))
    const db = new DatabaseSync(`${f.path}.before-restore-${record.id}`)
    try { db.prepare("UPDATE programs SET short_name='different previous copy' WHERE id=(SELECT id FROM programs LIMIT 1)").run() } finally { db.close() }
    const fingerprint = databaseFingerprint(f.path)
    assert.equal(inspectRestoreRecovery(f.path, f.directory).canReturn, false)
    await assert.rejects(preparePreviousDatabaseReturn(f.path, f.directory), /Копії попередньої бази змінилися/)
    assert.equal(databaseFingerprint(f.path), fingerprint)
    assert.ok(existsSync(join(f.directory, `hromada-aid-safety-${record.id}.sqlite`)))
  } finally { await cleanup(f.root) }
})

test('return rechecks the current database immediately before replacement and after an interrupted preparation', async () => {
  const f = await completedRestoreFixture()
  try {
    await preparePreviousDatabaseReturn(f.path, f.directory)
    const db = new DatabaseSync(f.path)
    try { db.prepare("UPDATE programs SET short_name='external write after return plan' WHERE id=(SELECT id FROM programs LIMIT 1)").run() } finally { db.close() }
    const fingerprint = databaseFingerprint(f.path)
    await assert.rejects(restoreOffline(f.path, f.directory), /дані змінилися/)
    assert.equal(databaseFingerprint(f.path), fingerprint)
    assert.ok(existsSync(maintenancePath(f.path)))
  } finally { await cleanup(f.root) }
})

test('resume refuses unexpected writes to the replacement after interruption and retains journal and originals', async () => {
  const f = await fixture()
  try {
    await f.service.createManualBackup()
    const preview = await f.admin.prepare(join(f.directory, (await f.archives.listAll())[0].fileName))
    await f.admin.confirm(preview.id, preview.confirmationToken)
    await f.archives.stop(); f.db.close()
    await assert.rejects(restoreOffline(f.path, f.directory, point => { if (point === 'replacement-renamed') throw new Error('Synthetic interruption') }))
    const db = new DatabaseSync(f.path)
    try { db.prepare("UPDATE programs SET short_name='unexpected external write' WHERE id=(SELECT id FROM programs LIMIT 1)").run() } finally { db.close() }
    const fingerprint = databaseFingerprint(f.path)
    await assert.rejects(restoreOffline(f.path, f.directory), /база змінилася/)
    assert.equal(databaseFingerprint(f.path), fingerprint)
    assert.ok(existsSync(`${f.path}.restore-journal.json`))
    assert.ok(existsSync(`${f.path}.before-restore-${preview.id}`))
    assert.ok(existsSync(join(f.directory, `hromada-aid-safety-${preview.id}.sqlite`)))
  } finally { try { f.db.close() } catch { /* closed before offline recovery */ }; await f.archives.stop(); await cleanup(f.root) }
})

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
  const f = await fixture(), app = createApp(f.db, f.admin)
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
    const downloadResponse = await fetch(`${origin}/api/backups/server/${item.id}/download`, { headers: { authorization: `Bearer ${token}` } })
    assert.equal(downloadResponse.status, 200); await writeFile(downloaded, Buffer.from(await downloadResponse.arrayBuffer()))
    assert.equal((await hashFile(downloaded)).sha256, item.sha256)
    assert.equal((await fetch(`${origin}/api/backups/archives`, { headers: { authorization: `Bearer ${token}` } })).status, 404, 'legacy client replication route is removed')
    assert.equal((await fetch(`${origin}/api/backup-clients`, { headers: { authorization: `Bearer ${token}` } })).status, 404, 'legacy replication administration route is removed')
    const upload = async (file: string) => {
      const response = await fetch(`${origin}/api/backups/restore/upload`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' }, body: await readFile(file) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const result = await response.json()
      assert.ok(isRestorePreview(result))
      return result
    }
    const preview = await upload(downloaded)
    assert.ok(preview.id)
    assert.ok((await http.postJson(`/api/backups/server/${item.id}/prepare`, {}, isRestorePreview)).id)
    const damaged = await readFile(downloaded); damaged[damaged.length - 1] ^= 1
    const damagedPath = join(f.root, 'damaged.hraid'); await writeFile(damagedPath, damaged)
    await assert.rejects(upload(damagedPath))
    const alien = join(f.root, 'alien-test.sqlite'), alienDb = new DatabaseSync(alien)
    alienDb.exec('CREATE TABLE alien(value TEXT)'); alienDb.close()
    const incompatible = join(f.root, 'alien.hraid')
    await encryptBackupFile(alien, incompatible, f.key.bytes, { id: 'b'.repeat(64), createdAt: now, sourceSha256: (await hashFile(alien)).sha256 })
    await assert.rejects(upload(incompatible))
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
    const maintenanceResponse = await fetch(origin + '/health')
    assert.equal(maintenanceResponse.status, 503)
    assert.equal((await maintenanceResponse.json() as { code?: string }).code, 'RESTORE_MAINTENANCE')
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

test('offline restore preserves existing Backups ACLs and protects only restore-staging', { skip: process.platform !== 'win32' }, async () => {
  const f = await fixture()
  const servicePrincipal = 'NT SERVICE\\EventLog'
  const grant = (path: string, directory = false) => {
    const permission = directory ? '(OI)(CI)M' : 'M'
    execFileSync('icacls.exe', [path, '/grant', `${servicePrincipal}:${permission}`], { encoding: 'utf8', windowsHide: true })
  }
  const hasGrant = (path: string) => execFileSync('icacls.exe', [path], { encoding: 'utf8', windowsHide: true }).includes(servicePrincipal)
  try {
    assert.equal((await f.service.createManualBackup()).status, 'created')
    const archive = join(f.directory, (await f.archives.listAll())[0].fileName)
    const preview = await f.admin.prepare(archive)
    const candidate = join(f.directory, 'restore-staging', `${preview.id}.sqlite`)
    const staging = join(f.directory, 'restore-staging')
    const key = join(f.directory, '.hromadaaid-backup-key.dpapi')
    await writeFile(key, 'test sentinel; not a cryptographic key')
    await f.admin.confirm(preview.id, preview.confirmationToken)
    await f.archives.stop()
    f.db.close()

    grant(f.directory, true)
    grant(archive)
    grant(key)
    grant(staging, true)
    grant(candidate)
    for (const path of [f.directory, archive, key, staging, candidate]) assert.ok(hasGrant(path), `test ACE must exist before restore: ${path}`)

    const safety = await restoreOffline(f.path, f.directory)
    assert.ok(existsSync(safety))
    for (const path of [f.directory, archive, key, staging, candidate]) assert.ok(hasGrant(path), `restore must preserve the existing service ACE: ${path}`)
    validateRestoreDatabase(f.path)
    await preparePreviousDatabaseReturn(f.path, f.directory)
    await restoreOffline(f.path, f.directory)
    for (const path of [f.directory, archive, key]) assert.ok(hasGrant(path), `return must preserve existing server/backup/key ACL: ${path}`)
    assert.ok(existsSync(safety), 'return must retain the first insurance copy')
  } finally { try { f.db.close() } catch { /* closed before offline restore */ }; await f.archives.stop(); await cleanup(f.root) }
})
