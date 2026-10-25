import assert from 'node:assert/strict'
import { fork, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { HttpClient } from '../../electron/http-client.js'
import { isRestorePreview, isServerBackupList } from '../../shared/backup-contract.js'
import { createApp } from './app.js'
import { createFirstAdministrator } from './auth.js'
import { BackupAdministration, assertNoPendingRestore, maintenancePath } from './backup-admin.js'
import { BackupArchives } from './backup-archives.js'
import { parseRestoreArguments } from './backup-restore-arguments.js'
import { BackupKeyStore, createRecoveryKey, decodeRecoveryKey } from './backup-crypto.js'
import { SqliteBackupService } from './backup.js'
import { readServerConfig } from './config.js'
import { openServerDatabase } from './database.js'
import { acquireDatabaseOwnership } from './restore-safety.js'
import { formatRestoreError } from './restore-diagnostics.js'

// Separate Fastify process with the same database ownership and shutdown order
// as production. IPC is test-only and never registered in the application API.
async function serveFixture() {
  const config = readServerConfig()
  assertNoPendingRestore(config.databasePath)
  const release = acquireDatabaseOwnership(config.databasePath)
  const database = openServerDatabase(config.databasePath)
  const saved = new BackupKeyStore(config.backupDirectory).load()
  assert.ok(saved)
  const archives = new BackupArchives(config.backupDirectory, () => decodeRecoveryKey(saved.encryptionKey))
  const service = new SqliteBackupService(database, config.backupDirectory, { error: () => {}, warn: () => {} })
  const administration = new BackupAdministration(config.databasePath, archives, service, async () => {})
  const app = createApp(database, administration)
  app.log.level = 'silent'
  await app.listen({ host: '127.0.0.1', port: 0 })
  const address = app.server.address(); assert.ok(address && typeof address === 'object')
  process.once('message', async message => {
    if (message !== 'stop') return
    await app.close(); await archives.stop(); database.close(); release()
    process.disconnect?.()
  })
  process.send?.({ origin: `http://127.0.0.1:${address.port}` })
}

async function startServer(database: string, directory: string): Promise<{ child: ChildProcess; origin: string }> {
  const child = fork(fileURLToPath(import.meta.url), ['--test-server'], {
    env: { ...process.env, HROMADA_AID_API_DATABASE: database, HROMADA_AID_API_BACKUP_DIR: directory, HROMADA_AID_API_HOST: '127.0.0.1', HROMADA_AID_API_PORT: '4310' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  // Consume without printing application logs or credentials.
  child.stdout?.resume(); child.stderr?.resume()
  const origin = await new Promise<string>((resolveReady, reject) => {
    child.once('message', message => resolveReady((message as { origin: string }).origin))
    child.once('error', reject)
    child.once('exit', code => reject(new Error(`Synthetic server exited before ready (${code})`)))
  })
  return { child, origin }
}
async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return
  const stopped = new Promise<void>((resolveStopped, reject) => {
    child.once('exit', code => code === 0 ? resolveStopped() : reject(new Error('Synthetic server did not stop normally')))
  })
  child.send('stop')
  await stopped
}

if (process.argv.includes('--test-server')) {
  await serveFixture()
} else {
  test('restore arguments accept the pnpm separator and reject invalid arguments without echoing values', () => {
    const flags = ['--database', 'synthetic-test.sqlite', '--backup-dir', 'synthetic backups']
    assert.deepEqual(parseRestoreArguments(flags), parseRestoreArguments(['--', ...flags]))
    assert.equal(parseRestoreArguments([...flags, '--archive', 'synthetic.hraid', '--manager-confirmed']).managerConfirmed, true)
    assert.equal(parseRestoreArguments([...flags, '--archive', 'synthetic.hraid', '--verify-only']).verifyOnly, true)
    for (const args of [[], ['--database'], [...flags, '--unknown', 'synthetic-sensitive-value'], [...flags, '--database', 'again'], [...flags, '--recovery-key']]) {
      assert.throws(() => parseRestoreArguments(args))
    }
    assert.throws(() => parseRestoreArguments([...flags, '--manager-confirmed']))
    try { parseRestoreArguments([...flags, '--unknown', 'synthetic-sensitive-value']) }
    catch (error) { assert.equal(formatRestoreError(error).includes('synthetic-sensitive-value'), false) }
  })

  test('real HTTP confirmation → normal Fastify stop → non-TTY CLI with pnpm separator → restart', { timeout: 60000 }, async context => {
    if (process.platform !== 'win32') { context.skip('Server-key fixture requires Windows DPAPI'); return }
    const root = await mkdtemp(join(tmpdir(), 'hromada-cli-restore-test-'))
    const database = join(root, 'synthetic-test.sqlite'), directory = join(root, 'backups'), wrongDirectory = join(root, 'wrong-backups')
    let server: Awaited<ReturnType<typeof startServer>> | undefined
    const cli = fileURLToPath(new URL('./backup-restore-cli.js', import.meta.url))
    try {
      const db = openServerDatabase(database)
      assert.equal((await createFirstAdministrator(db, { username: 'syntheticadmin', password: 'synthetic password' })).ok, true)
      const program = (db.prepare('SELECT id FROM programs LIMIT 1').get() as { id: string }).id
      const original = (db.prepare('SELECT short_name FROM programs WHERE id=?').get(program) as { short_name: string }).short_name
      db.close()
      new BackupKeyStore(directory).create({ version: 1, encryptionKey: createRecoveryKey().encoded })
      server = await startServer(database, directory)
      const response = await fetch(server.origin + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'syntheticadmin', password: 'synthetic password' }) })
      assert.equal(response.status, 200)
      const { token } = await response.json() as { token: string }
      const http = new HttpClient(new URL(server.origin), 30000, { getAccessToken: () => token })
      const list = await http.postJson('/api/backups/server', {}, isServerBackupList)
      const item = list.archives[0]; assert.ok(item)
      const archivePath = join(directory, item.fileName)
      const verify = spawnSync(process.execPath, [cli, '--database', database, '--backup-dir', directory, '--archive', archivePath, '--verify-only'], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 30000 })
      assert.equal(verify.status, 0, verify.stderr)
      assert.equal(JSON.parse(verify.stdout).valid, true)
      const preview = await http.postJson(`/api/backups/server/${item.id}/prepare`, {}, isRestorePreview)
      await http.postJson('/api/backups/restore/confirm', { id: preview.id, confirmationToken: preview.confirmationToken })
      assert.equal((await fetch(server.origin + '/health')).status, 503)
      await stopServer(server.child); server = undefined
      // Only the new synthetic fixture is written, never manual-remote-test.
      const changed = new DatabaseSync(database)
      changed.prepare('UPDATE programs SET short_name=? WHERE id=?').run('synthetic change after snapshot', program); changed.close()
      const markerBefore = await readFile(maintenancePath(database), 'utf8')
      await mkdir(wrongDirectory)
      const wrong = spawnSync(process.execPath, [cli, '--', '--database', database, '--backup-dir', wrongDirectory], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 30000 })
      assert.equal(wrong.status, 1)
      assert.ok(wrong.stderr.includes('[RESTORE_PLAN_MISSING]'))
      assert.ok(wrong.stderr.includes('load-plan'))
      assert.equal(await readFile(maintenancePath(database), 'utf8'), markerBefore)
      assert.equal(wrong.stderr.includes(token), false)
      assert.equal(existsSync(`${database}.restore-journal.json`), false)
      const restored = spawnSync(process.execPath, [cli, '--', '--database', database, '--backup-dir', directory], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 30000 })
      assert.equal(restored.status, 0, restored.stderr)
      assert.equal(existsSync(maintenancePath(database)), false)
      assert.equal(existsSync(`${database}.restore-journal.json`), false)
      assert.equal(existsSync(join(directory, `hromada-aid-safety-${preview.id}.sqlite`)), true)
      const verified = new DatabaseSync(database)
      try {
        assert.equal((verified.prepare('SELECT short_name FROM programs WHERE id=?').get(program) as { short_name: string }).short_name, original)
        assert.equal((verified.prepare('PRAGMA quick_check').get() as { quick_check: string }).quick_check, 'ok')
        assert.equal(verified.prepare('PRAGMA foreign_key_check').all().length, 0)
        assert.equal((verified.prepare('SELECT count(*) AS n FROM user_sessions').get() as { n: number }).n, 0)
      } finally { verified.close() }
      const changedAgain = new DatabaseSync(database)
      changedAgain.prepare('UPDATE programs SET short_name=? WHERE id=?').run('synthetic second change', program); changedAgain.close()
      const managerRestore = spawnSync(process.execPath, [cli, '--database', database, '--backup-dir', directory, '--archive', archivePath, '--manager-confirmed'], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 30000 })
      assert.equal(managerRestore.status, 0, managerRestore.stderr)
      assert.match(managerRestore.stdout, /Відновлення завершено/)
      const managerVerified = new DatabaseSync(database)
      try { assert.equal((managerVerified.prepare('SELECT short_name FROM programs WHERE id=?').get(program) as { short_name: string }).short_name, original) } finally { managerVerified.close() }
      server = await startServer(database, directory)
      assert.equal((await fetch(server.origin + '/health')).status, 200)
      assert.equal((await fetch(server.origin + '/auth/me', { headers: { authorization: `Bearer ${token}` } })).status, 401)
      const newLogin = await fetch(server.origin + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'syntheticadmin', password: 'synthetic password' }) })
      assert.equal(newLogin.status, 200); await newLogin.body?.cancel()
    } finally {
      if (server) await stopServer(server.child)
      assert.ok(resolve(root).startsWith(join(resolve(tmpdir()), 'hromada-cli-restore-test-')))
      await rm(root, { recursive: true, force: true })
    }
  })
}
