import assert from 'node:assert/strict'
import { createServer, Server } from 'node:net'
import { DatabaseSync } from 'node:sqlite'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { networkInterfaces, tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import test from 'node:test'
import { createGracefulShutdown } from './server-lifecycle.js'
import { acquireDatabaseOwnership } from './restore-safety.js'
import { openInitializedDatabase } from '../../electron/database.js'
import { startServer } from './server-runtime.js'
import { dueBackupDate, SqliteBackupService } from './backup.js'
import { BackupKeyStore, createRecoveryKey } from './backup-crypto.js'
import { readInstalledServerConfig } from './config.js'
import { SERVER_HOST, SERVER_PORT } from './server-runtime.js'
import { validateInstalledPaths } from './installed-paths.js'
import { API_ROUTE_POLICIES } from './api-authorization.js'

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

test('one fixed IPv4 HTTP listener accepts current config, preserves SQLite, rejects a port conflict and keeps API authorization', async t => {
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

    const configPath = join(dataDirectory, 'server.json')
    const configContents = JSON.stringify({
      configVersion: 3,
      programDirectory,
      databasePath,
      backupDirectory,
    })
    await writeFile(configPath, configContents)
    const config = readInstalledServerConfig(configPath)
    validateInstalledPaths(config, {
      inspectVolume: () => ({ driveType: 3, fileSystem: 'NTFS', freeBytes: 1024 ** 3 }),
      allowTemporaryLocationsForTests: true,
    })
    process.chdir(unrelatedWorkingDirectory)
    changedWorkingDirectory = true
    const databaseBefore = await readFile(databasePath)

    const portBlocker = createServer()
    await new Promise<void>((resolve, reject) => portBlocker.once('error', reject).listen(SERVER_PORT, SERVER_HOST, resolve))
    try {
      await assert.rejects(startServer(config, true), error => {
        assert.ok(error instanceof Error)
        assert.match(error.message, /Порт 4310 зайнятий/)
        assert.equal((error.cause as NodeJS.ErrnoException).code, 'EADDRINUSE')
        return true
      })
    } finally { await new Promise<void>(resolve => portBlocker.close(() => resolve())) }
    assert.deepEqual(await readFile(databasePath), databaseBefore)
    // A failed bind releases SQLite ownership and signal handlers, so a retry can start.
    const listen = t.mock.method(Server.prototype, 'listen')
    running = await startServer(config, true)
    assert.equal(listen.mock.callCount(), 1, 'runtime must create exactly one listener')
    const listener = listen.mock.calls[0].this as Server
    assert.deepEqual(listener.address(), { address: '0.0.0.0', family: 'IPv4', port: 4310 })
    const response = await fetch('http://127.0.0.1:4310/health')
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { status: 'ok', service: 'hromada-aid-api', apiContractVersion: 1 })
    assert.equal((await fetch('http://127.0.0.2:4310/health')).status, 200)
    for (const policy of API_ROUTE_POLICIES) {
      const path = policy.url.replace(/:[^/]+/g, 'synthetic-missing')
      const denied = await fetch(`http://127.0.0.1:4310${path}`, { method: policy.method, headers: { 'x-forwarded-for': '127.0.0.1' } })
      assert.equal(denied.status, 401, `${policy.method} ${path} must require a session`)
      await denied.arrayBuffer()
    }
    assert.equal((await fetch('http://127.0.0.1:4310/auth/me')).status, 401)
    const addresses = Object.values(networkInterfaces()).flatMap(items => items ?? []).filter(item => item.family === 'IPv4' && !item.internal)
    for (const address of addresses) {
      await t.test(address.address.startsWith('100.') ? 'available Tailscale-range interface health' : 'available non-loopback IPv4 interface health', async () => {
        const result = await fetch(`http://${address.address}:4310/health`, { signal: AbortSignal.timeout(5_000) })
        assert.equal(result.status, 200)
        assert.equal((await result.json() as { service: string }).service, 'hromada-aid-api')
      })
    }
    if (!addresses.some(item => item.address.startsWith('100.'))) t.diagnostic('No assigned Tailscale-range IPv4 interface; real tailnet connectivity requires VM acceptance.')
    assert.equal(listen.mock.callCount(), 1, 'requests must not start additional listeners')
    await running.stop('TEST')
    running = undefined
    assert.deepEqual(await readFile(databasePath), databaseBefore, 'transport startup and health must preserve SQLite bytes')
    assert.equal(await readFile(configPath, 'utf8'), configContents, 'configuration must remain untouched')
  } finally {
    if (changedWorkingDirectory) process.chdir(previousWorkingDirectory)
    await running?.stop('TEST')
    await rm(root, { recursive: true, force: true })
  }
})
