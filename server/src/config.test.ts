import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { initializationConfigArgument, installedConfigArgument, readInstalledServerConfig, readServerConfig, type InstalledServerConfig } from './config.js'
import { validateInstalledPaths } from './installed-paths.js'
import { initializeInstalledServerDatabase, openInstalledServerDatabase } from './database.js'

const volume = () => ({ driveType: 3, fileSystem: 'NTFS', freeBytes: 1024 ** 3 })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'hraid-installed-config-'))
  const programDirectory = join(root, 'Програма HromadaAID')
  const dataDirectory = join(root, 'Дані громади')
  const backupDirectory = join(root, 'Архів резервних копій')
  await Promise.all([mkdir(programDirectory), mkdir(dataDirectory), mkdir(backupDirectory)])
  const config: InstalledServerConfig = {
    configVersion: 3,
    programDirectory,
    databasePath: join(dataDirectory, 'основна база.sqlite'),
    backupDirectory,
  }
  const configPath = join(root, 'server.json')
  await writeFile(configPath, JSON.stringify(config), 'utf8')
  return { root, programDirectory, dataDirectory, backupDirectory, configPath, config }
}

test('installed config accepts explicit absolute Unicode paths and rejects unknown versions/keys', async () => {
  const f = await fixture()
  try {
    assert.deepEqual(readInstalledServerConfig(f.configPath), f.config)
    await writeFile(f.configPath, JSON.stringify({ ...f.config, configVersion: 4 }))
    assert.throws(() => readInstalledServerConfig(f.configPath), /Несумісна версія конфігурації/)
    await writeFile(f.configPath, JSON.stringify({ ...f.config, secret: 'forbidden' }))
    assert.throws(() => readInstalledServerConfig(f.configPath), /невідомий параметр/)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('installed entry requires an explicit config argument and never infers a development fallback', () => {
  assert.throws(() => installedConfigArgument([]), /лише з явним параметром --config/)
  assert.throws(() => installedConfigArgument(['--config', 'server.json']), /абсолютний локальний шлях/)
  assert.equal(installedConfigArgument(['--config', 'C:\\ProgramData\\HromadaAID\\server.json']), 'C:\\ProgramData\\HromadaAID\\server.json')
})

test('initial database creation requires an explicit confirmation flag', () => {
  assert.throws(() => initializationConfigArgument(['--config', 'C:\\ProgramData\\HromadaAID\\server.json']), /лише явна команда/)
  assert.equal(initializationConfigArgument(['--config', 'C:\\ProgramData\\HromadaAID\\server.json', '--confirm-initialization']), 'C:\\ProgramData\\HromadaAID\\server.json')
})

test('critical non-transport parameters, malformed JSON and missing files fail without rewriting config', async () => {
  const f = await fixture()
  try {
    for (const key of ['programDirectory', 'databasePath', 'backupDirectory']) {
      for (const value of ['relative.sqlite', '', null, 42]) {
        const contents = JSON.stringify({ ...f.config, [key]: value })
        await writeFile(f.configPath, contents)
        assert.throws(() => readInstalledServerConfig(f.configPath), new RegExp(key + ' має містити абсолютний шлях'))
        assert.equal(await readFile(f.configPath, 'utf8'), contents)
      }
    }
    await writeFile(f.configPath, '{invalid JSON')
    assert.throws(() => readInstalledServerConfig(f.configPath), /некоректний JSON/)
    await rm(f.configPath)
    assert.throws(() => readInstalledServerConfig(f.configPath), /не знайдено/)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('old versions and transport fields are incompatible without writes to config, SQLite or backups', async () => {
  const f = await fixture()
  const sentinel = Buffer.from('synthetic database sentinel')
  const archive = join(f.backupDirectory, 'sentinel.hraid')
  try {
    await writeFile(f.config.databasePath, sentinel)
    await writeFile(archive, sentinel)
    for (const obsolete of [
      { configVersion: 1 }, { configVersion: 2 }, { configVersion: '3' },
      { mode: 'local' }, { host: '0.0.0.0' }, { port: 4310 },
      { tls: { certificatePath: 'missing.pem', privateKeyPath: 'missing.pem' } },
    ]) {
      const contents = JSON.stringify({ ...f.config, ...obsolete })
      await writeFile(f.configPath, contents)
      assert.throws(() => readInstalledServerConfig(f.configPath), /Несумісна/)
      assert.equal(await readFile(f.configPath, 'utf8'), contents)
      assert.deepEqual(await readFile(f.config.databasePath), sentinel)
      assert.deepEqual(await readFile(archive), sentinel)
    }
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('installed path check requires existing directories and a present initialized DB on normal startup', async () => {
  const f = await fixture()
  try {
    assert.throws(() => validateInstalledPaths(f.config, { inspectVolume: volume, allowTemporaryLocationsForTests: true }), /Файл серверної бази не знайдено/)
    assert.equal(await readFile(f.configPath, 'utf8').then(Boolean), true)
    assert.throws(() => openInstalledServerDatabase(f.config.databasePath), /не знайдено/)
    await rm(f.backupDirectory, { recursive: true })
    assert.throws(() => validateInstalledPaths(f.config, { inspectVolume: volume, allowTemporaryLocationsForTests: true }), /Каталог резервних копій недоступний/)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('explicit initialization creates a database only when absent, and never overwrites an existing file', async () => {
  const f = await fixture()
  try {
    validateInstalledPaths(f.config, { initialize: true, inspectVolume: volume, allowTemporaryLocationsForTests: true })
    initializeInstalledServerDatabase(f.config.databasePath)
    const db = openInstalledServerDatabase(f.config.databasePath)
    assert.equal((db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check, 'ok')
    db.close()
    const before = await readFile(f.config.databasePath)
    assert.throws(() => validateInstalledPaths(f.config, { initialize: true, inspectVolume: volume, allowTemporaryLocationsForTests: true }), /його не перезаписує/)
    assert.throws(() => initializeInstalledServerDatabase(f.config.databasePath), /вже існує/)
    assert.deepEqual(await readFile(f.config.databasePath), before)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('database under the program tree is rejected, including through a junction', async () => {
  const f = await fixture()
  try {
    const inProgram = { ...f.config, databasePath: join(f.programDirectory, 'data.sqlite') }
    assert.throws(() => validateInstalledPaths(inProgram, { initialize: true, inspectVolume: volume, allowTemporaryLocationsForTests: true }), /поза каталогом програмних файлів/)
    const alias = join(f.root, 'program-junction')
    await symlink(f.programDirectory, alias, 'junction')
    const viaJunction = { ...f.config, databasePath: join(alias, 'data.sqlite') }
    assert.throws(() => validateInstalledPaths(viaJunction, { initialize: true, inspectVolume: volume, allowTemporaryLocationsForTests: true }), /поза каталогом програмних файлів/)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('database cannot be placed inside the backup directory and write permissions are checked', async () => {
  const f = await fixture()
  try {
    const nestedDatabase = { ...f.config, databasePath: join(f.backupDirectory, 'data.sqlite') }
    assert.throws(() => validateInstalledPaths(nestedDatabase, { initialize: true, inspectVolume: volume, allowTemporaryLocationsForTests: true }), /всередині каталогу резервних копій/)
    await symlink(f.programDirectory, join(f.backupDirectory, 'restore-staging'), 'junction')
    assert.throws(() => validateInstalledPaths(f.config, { inspectVolume: volume, allowTemporaryLocationsForTests: true }), /не може бути junction/)
    await rm(join(f.backupDirectory, 'restore-staging'), { recursive: true, force: true })
    await writeFile(f.config.databasePath, 'synthetic')
    assert.throws(() => validateInstalledPaths(f.config, { inspectVolume: volume, verifyWrite: directory => { if (directory === f.backupDirectory) throw new Error(`Немає прав на створення файлів у каталозі ${directory}.`) }, allowTemporaryLocationsForTests: true }), /Немає прав на створення файлів/)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('volume policy rejects removable, non-NTFS, and unavailable drives', async () => {
  const f = await fixture()
  try {
    const missing = () => { throw new Error('Диск D: відсутній або недоступний.') }
    assert.throws(() => validateInstalledPaths(f.config, { initialize: true, inspectVolume: missing, allowTemporaryLocationsForTests: true }), /відсутній або недоступний/)
    assert.throws(() => validateInstalledPaths(f.config, { initialize: true, inspectVolume: () => ({ ...volume(), driveType: 2 }), allowTemporaryLocationsForTests: true }), /локальним постійним диском/)
    assert.throws(() => validateInstalledPaths(f.config, { initialize: true, inspectVolume: () => ({ ...volume(), fileSystem: 'exFAT' }), allowTemporaryLocationsForTests: true }), /має розташовуватися на NTFS/)
    assert.throws(() => validateInstalledPaths(f.config, { initialize: true, inspectVolume: () => ({ ...volume(), freeBytes: 1 }), allowTemporaryLocationsForTests: true }), /недостатньо/)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('development/test mode remains isolated and has no fallback from installed mode', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hraid-dev-config-'))
  try {
    const databasePath = resolve(dir, 'synthetic-test.sqlite')
    assert.deepEqual(readServerConfig({ HROMADA_AID_API_DATABASE: databasePath, HROMADA_AID_API_HOST: '192.0.2.10', HROMADA_AID_API_PORT: '4321' }), { databasePath, backupDirectory: join(dir, 'backups') })
    assert.throws(() => readServerConfig({ HROMADA_AID_API_DATABASE: resolve(dir, 'production.sqlite') }), /назвою, що містить/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
