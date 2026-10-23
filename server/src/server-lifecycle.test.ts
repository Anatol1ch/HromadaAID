import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { DatabaseSync } from 'node:sqlite'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import test from 'node:test'
import { createGracefulShutdown } from './server-lifecycle.js'
import { acquireDatabaseOwnership } from './restore-safety.js'
import { openInitializedDatabase } from '../../electron/database.js'
import { startServer } from './server-runtime.js'
import { dueBackupDate, SqliteBackupService } from './backup.js'
import { BackupKeyStore, createRecoveryKey } from './backup-crypto.js'
import type { InstalledServerConfig } from './config.js'
import { validateInstalledPaths } from './installed-paths.js'

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

test('shutdown is idempotent, closes resources in order, and continues after a cleanup error', async () => {
  const order: string[] = []
  const errors: string[] = []
  let failureCallbackCalled = false
  const shutdown = createGracefulShutdown([
    { name: 'http', close: async () => { order.push('http') } },
    { name: 'scheduler', close: async () => { order.push('scheduler'); throw new Error('synthetic') } },
    { name: 'sqlite', close: async () => { order.push('sqlite') } },
  ], { info: () => undefined, warn: () => undefined, error: message => errors.push(message) }, { onCleanupFailure: () => { failureCallbackCalled = true } })

  const first = shutdown('SIGTERM')
  const second = shutdown('SIGINT')
  assert.equal(first, second)
  await first
  assert.deepEqual(order, ['http', 'scheduler', 'sqlite'])
  assert.deepEqual(errors, [
    'Не вдалося завершити ресурс «scheduler».',
    'HromadaAID API завершив роботу з помилкою під час закриття ресурсів.',
  ])
  assert.equal(failureCallbackCalled, true)
})

test('shutdown timeout reports a stuck phase but waits and keeps SQLite open', async () => {
  const httpClose = deferred()
  const timedOut = deferred<string>()
  let sqliteClosed = false
  const logs: string[] = []
  const shutdown = createGracefulShutdown([
    { name: 'HTTP-запити Fastify', close: () => httpClose.promise },
    { name: 'SQLite', close: () => { sqliteClosed = true } },
  ], {
    info: () => undefined,
    warn: () => undefined,
    error: message => { logs.push(message); timedOut.resolve(message) },
  }, { timeoutMs: 15 })

  const pending = shutdown('SIGTERM')
  assert.equal(shutdown('SIGTERM'), pending)
  assert.match(await timedOut.promise, /Очікування продовжується; SQLite не закривається передчасно/)
  assert.equal(sqliteClosed, false)
  assert.equal(logs.length, 1)
  httpClose.resolve()
  await pending
  assert.equal(sqliteClosed, true)
})

test('Fastify stops accepting requests and drains active work before SQLite closes', async t => {
  const app = Fastify({ logger: false })
  const database = new DatabaseSync(':memory:')
  const entered = deferred()
  const finishRequest = deferred()
  let databaseClosed = false

  app.get('/synthetic', async () => {
    entered.resolve()
    await finishRequest.promise
    return { ok: true }
  })
  await app.listen({ host: '127.0.0.1', port: 0 })
  const address = app.server.address()
  assert.ok(address && typeof address === 'object')
  const origin = `http://127.0.0.1:${address.port}`
  t.after(async () => {
    finishRequest.resolve()
    await app.close().catch(() => undefined)
    if (!databaseClosed) database.close()
  })

  const activeRequest = fetch(`${origin}/synthetic`, { headers: { connection: 'close' } })
  await entered.promise
  const shutdown = createGracefulShutdown([
    { name: 'HTTP-запити Fastify', close: () => app.close() },
    { name: 'SQLite', close: () => { database.close(); databaseClosed = true } },
  ], { info: () => undefined, warn: () => undefined, error: message => assert.fail(message) }, { timeoutMs: 1_000 })('SIGTERM')

  assert.equal(databaseClosed, false)
  assert.equal(database.prepare('SELECT 1 AS ok').get()?.ok, 1)
  await assert.rejects(fetch(`${origin}/synthetic`), /fetch failed|ECONNREFUSED|socket/i)
  finishRequest.resolve()
  assert.deepEqual(await activeRequest.then(response => response.json()), { ok: true })
  await shutdown
  assert.equal(databaseClosed, true)
  assert.throws(() => database.prepare('SELECT 1'), /not open/i)
})

test('a second server process cannot acquire the same synthetic database lock', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hraid-service-lock-test-'))
  const databasePath = join(root, 'isolated-test.sqlite')
  try {
    const release = acquireDatabaseOwnership(databasePath)
    try { assert.throws(() => acquireDatabaseOwnership(databasePath), /іншим серверним процесом/) }
    finally { release() }
    const releaseAfterOwnerClosed = acquireDatabaseOwnership(databasePath)
    releaseAfterOwnerClosed()
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('server starts from absolute synthetic paths while CWD is unrelated, serves health, and shuts down cleanly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hraid-server-lifecycle-test-'))
  const previousWorkingDirectory = process.cwd()
  let running: Awaited<ReturnType<typeof startServer>> | undefined
  let changedWorkingDirectory = false
  try {
    const programDirectory = join(root, 'program')
    const dataDirectory = join(root, 'data')
    const backupDirectory = join(root, 'backups')
    const unrelatedWorkingDirectory = join(root, 'інший робочий каталог')
    await Promise.all([mkdir(programDirectory), mkdir(dataDirectory), mkdir(backupDirectory), mkdir(unrelatedWorkingDirectory)])
    const recoveryKey = createRecoveryKey()
    new BackupKeyStore(backupDirectory).create({ version: 1, encryptionKey: recoveryKey.encoded })
    recoveryKey.bytes.fill(0)
    const databasePath = join(dataDirectory, 'synthetic-test.sqlite')
    const database = openInitializedDatabase(databasePath)
    try {
      const snapshotTime = new Date()
      const syntheticBackups = new SqliteBackupService(database, backupDirectory, { error: () => undefined, warn: () => undefined }, false)
      await syntheticBackups.createDailyBackup(dueBackupDate(snapshotTime), snapshotTime)
    } finally { database.close() }

    const portProbe = createServer()
    await new Promise<void>(resolve => portProbe.listen(0, '127.0.0.1', resolve))
    const address = portProbe.address()
    assert.ok(address && typeof address === 'object')
    await new Promise<void>(resolve => portProbe.close(() => resolve()))

    const config: InstalledServerConfig = {
      configVersion: 2,
      mode: 'local',
      programDirectory,
      host: '127.0.0.1',
      port: address.port,
      databasePath,
      backupDirectory,
    }
    validateInstalledPaths(config, {
      inspectVolume: () => ({ driveType: 3, fileSystem: 'NTFS', freeBytes: 1024 ** 3 }),
      allowTemporaryLocationsForTests: true,
    })
    process.chdir(unrelatedWorkingDirectory)
    changedWorkingDirectory = true
    running = await startServer(config, true)
    const response = await fetch(`http://127.0.0.1:${address.port}/health`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { status: 'ok', service: 'hromada-aid-api' })
  } finally {
    if (changedWorkingDirectory) process.chdir(previousWorkingDirectory)
    await running?.stop('TEST')
    await rm(root, { recursive: true, force: true })
  }
})
