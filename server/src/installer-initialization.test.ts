import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInstallInitialization } from './installer-initialization.js'
import { DatabaseSync } from 'node:sqlite'
import { initializeInstalledServerDatabase } from './database.js'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'hromada-install-state-'))
  return { root, databasePath: join(root, 'synthetic.sqlite'), keyPath: join(root, 'synthetic.dpapi'), archivePath: join(root, 'synthetic.hraid') }
}

function options(f: ReturnType<typeof fixture>, overrides: Record<string, unknown> = {}) {
  let keyCreated = false
  let confirmed = false
  let initialized = false
  return {
    databasePath: f.databasePath,
    keyExists: () => keyCreated || (requireExists(f.keyPath)),
    hasArchives: () => requireExists(f.archivePath),
    loadExistingKey: () => { assert.equal(requireExists(f.keyPath), true) },
    createKey: () => { keyCreated = true; writeFileSync(f.keyPath, 'synthetic protected-key marker', { flag: 'wx' }) },
    removeNewKey: () => { keyCreated = false; rmSync(f.keyPath, { force: true }) },
    initializeDatabase: () => { initialized = true; writeFileSync(f.databasePath, 'synthetic initialized sqlite marker', { flag: 'wx' }) },
    confirmRecoveryKey: () => { confirmed = true; return true },
    state: () => ({ keyCreated, confirmed, initialized }),
    ...overrides,
  }
}

function requireExists(path: string): boolean {
  return existsSync(path)
}

test('fresh install requires recovery-key confirmation and initializes only synthetic paths', () => {
  const f = fixture()
  try {
    const deps = options(f)
    assert.equal(runInstallInitialization(deps), 'initialized')
    assert.deepEqual(deps.state(), { keyCreated: true, confirmed: true, initialized: true })
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('first-install marker hook runs only after recovery-key confirmation and before persistent data', () => {
  const f = fixture()
  try {
    const order: string[] = []
    const deps = options(f, {
      confirmRecoveryKey: () => { order.push('confirm'); return true },
      beforeInitialize: () => { order.push('marker'); assert.equal(requireExists(f.keyPath), false); assert.equal(requireExists(f.databasePath), false) },
      createKey: () => { order.push('key'); writeFileSync(f.keyPath, 'synthetic protected-key marker', { flag: 'wx' }) },
      initializeDatabase: () => { order.push('database'); writeFileSync(f.databasePath, 'synthetic initialized sqlite marker', { flag: 'wx' }) },
    })
    assert.equal(runInstallInitialization(deps), 'initialized')
    assert.deepEqual(order, ['confirm', 'marker', 'key', 'database'])

    order.length = 0
    const existing = options(f, {
      keyExists: () => true,
      loadExistingKey: () => undefined,
      beforeInitialize: () => { order.push('unexpected-marker') },
    })
    assert.equal(runInstallInitialization(existing), 'existing')
    assert.deepEqual(order, [])
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('fresh install initializes and integrity-checks an isolated synthetic SQLite database', () => {
  const f = fixture()
  try {
    const deps = options(f, { initializeDatabase: () => initializeInstalledServerDatabase(f.databasePath) })
    assert.equal(runInstallInitialization(deps), 'initialized')
    const database = new DatabaseSync(f.databasePath, { readOnly: true })
    try {
      assert.equal((database.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check, 'ok')
      assert.ok((database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version > 0)
    } finally { database.close() }
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('reinstall with database and key never reinitializes or overwrites either', () => {
  const f = fixture()
  try {
    writeFileSync(f.databasePath, 'existing synthetic database')
    writeFileSync(f.keyPath, 'existing synthetic key')
    const deps = options(f, { keyExists: () => true, loadExistingKey: () => undefined })
    assert.equal(runInstallInitialization(deps), 'existing')
    assert.equal(requireExists(f.databasePath), true)
    assert.equal(requireExists(f.keyPath), true)
    assert.equal(deps.state().initialized, false)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('incomplete existing state and archives without a database/key fail closed', () => {
  const f = fixture()
  try {
    writeFileSync(f.keyPath, 'orphaned synthetic key')
    const deps = options(f, { keyExists: () => true })
    assert.throws(() => runInstallInitialization(deps), /комплект/)
    assert.equal(requireExists(f.keyPath), true)
    rmSync(f.keyPath)
    writeFileSync(f.archivePath, 'synthetic encrypted archive marker')
    assert.throws(() => runInstallInitialization(options(f)), /комплект/)
    assert.equal(requireExists(f.archivePath), true)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('declining recovery-key confirmation creates no persistent material', () => {
  const f = fixture()
  try {
    const deps = options(f, { confirmRecoveryKey: () => false })
    assert.throws(() => runInstallInitialization(deps), /скасовано/)
    assert.equal(requireExists(f.databasePath), false)
    assert.equal(requireExists(f.keyPath), false)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('failed initialization removes only its newly created key when no database was published', () => {
  const f = fixture()
  try {
    const deps = options(f, { initializeDatabase: () => { throw new Error('synthetic failure') } })
    assert.throws(() => runInstallInitialization(deps), /synthetic failure/)
    assert.equal(requireExists(f.databasePath), false)
    assert.equal(requireExists(f.keyPath), false)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})
