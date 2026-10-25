import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import ts from 'typescript'
import { HttpClient, HttpClientError } from '../dist-electron/electron/http-client.js'
import { RemoteAuthSession } from '../dist-electron/electron/auth-session.js'
import { readElectronRuntimeConfig, readSavedConnectionConfig } from '../dist-electron/electron/runtime-config.js'
import { openInitializedDatabase } from '../dist-server/electron/database.js'
import { createApp } from '../dist-server/server/src/app.js'
import { createFirstAdministrator } from '../dist-server/server/src/auth.js'

const root = resolve('dist-electron')
let modules = 0
async function inspect(directory) {
  for (const file of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, file.name)
    if (file.isDirectory()) { await inspect(path); continue }
    if (!/\.(?:js|cjs|mjs)$/.test(file.name)) continue
    modules += 1
    const source = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true)
    const visit = node => {
      if (ts.isStringLiteral(node)) assert(!/^(?:node:sqlite|sqlite3|better-sqlite3)$/.test(node.text), `SQLite dependency shipped in client: ${file.name}`)
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
}
await inspect(root)
assert(modules > 0)
console.log('PASS generated Electron package contains no SQLite dependency, including stale outputs')

const temporary = await mkdtemp(join(tmpdir(), 'hromada-server-only-test-'))
const profile = join(temporary, 'client-profile')
let database, app, session
const password = 'synthetic password'
try {
  await mkdir(profile)
  const sentinel = Buffer.from('synthetic legacy file; never open as SQLite')
  await writeFile(join(profile, 'hromada-aid.sqlite'), sentinel)
  assert.match(readElectronRuntimeConfig({}).configurationError, /адресу сервера/)
  assert.equal(readElectronRuntimeConfig({ HROMADAAID_MODE: 'local' }).apiUrl, undefined)
  assert.equal(readElectronRuntimeConfig({ HROMADAAID_MODE: 'local' }, { config: { apiUrl: 'http://127.0.0.1:4310' } }).apiUrl.origin, 'http://127.0.0.1:4310')
  assert.equal(readSavedConnectionConfig(profile).config, undefined)
  const legacyConfig = join(profile, 'server-connection.json')
  await writeFile(legacyConfig, JSON.stringify({ version: 1, mode: 'local', databasePath: join(profile, 'hromada-aid.sqlite') }))
  const unsupported = readElectronRuntimeConfig({ HROMADAAID_MODE: 'local' }, readSavedConnectionConfig(profile))
  assert.equal(unsupported.apiUrl, undefined)
  assert.equal(unsupported.source, 'invalid')
  assert.match(unsupported.configurationError, /налаштуваннях/i)
  await rm(legacyConfig)
  const unconfigured = new HttpClient(undefined)
  await assert.rejects(unconfigured.getJson('/health', undefined, { authorize: false }), /Налаштуйте адресу сервера/)

  database = openInitializedDatabase(join(temporary, 'synthetic-server.sqlite'))
  await createFirstAdministrator(database, { displayName: 'Synthetic Administrator', username: 'synthetic-admin', password })
  app = createApp(database); app.log.level = 'silent'
  await app.listen({ host: '127.0.0.1', port: 0 })
  const origin = new URL(`http://127.0.0.1:${app.server.address().port}`)
  assert.equal((await fetch(new URL('/api/catalogs', origin))).status, 401)
  const http = new HttpClient(origin, 1_000, { getAccessToken: () => session?.accessToken, onUnauthorized: token => { void session?.expired(token) } })
  session = new RemoteAuthSession(profile, http, () => undefined)
  await session.initialize()
  assert.equal(session.currentState.status, 'unauthenticated')
  assert.equal((await session.login('synthetic-admin', password)).ok, true)
  assert((await http.getJson('/api/catalogs')).programs.length > 0)
  const bank = await http.postJson('/api/banks', { input: { name: 'Synthetic Bank', details: [{ mfo: '000001', edrpou: '00000001' }] } })
  assert.equal(bank.ok, true)
  const updated = await http.putJson(`/api/banks/${bank.bank.id}`, { input: { name: 'Synthetic Updated', details: bank.bank.details }, expectedUpdatedAt: bank.bank.updatedAt })
  assert.equal(updated.ok, true)
  assert.equal((await http.getJson('/api/banks'))[0].name, 'Synthetic Updated')
  assert.equal(database.prepare('SELECT name FROM banks WHERE id=?').get(bank.bank.id).name, 'Synthetic Updated')

  const viewer = await http.postJson('/api/users', { input: { username: 'synthetic-viewer', firstName: 'Synthetic', lastName: 'Viewer', roles: ['viewer'], password } })
  assert.equal(viewer.ok, true)
  database.prepare('UPDATE users SET must_change_password=0 WHERE id=?').run(viewer.user.id)
  const viewerLogin = await http.postJson('/auth/login', { username: 'synthetic-viewer', password }, undefined, { authorize: false })
  const viewerHttp = new HttpClient(origin, 1_000, { getAccessToken: () => viewerLogin.token })
  for (const path of ['/api/recipients', '/api/users', '/api/backup-clients']) await assert.rejects(viewerHttp.getJson(path), error => error instanceof HttpClientError && error.status === 403)
  assert.equal((await session.validateSession()).ok, true)
  assert.equal(database.prepare('PRAGMA quick_check').get().quick_check, 'ok')
  assert.equal(database.prepare('PRAGMA foreign_key_check').all().length, 0)
  await app.close(); app = undefined
  await assert.rejects(http.getJson('/api/banks'), HttpClientError)
  assert.deepEqual(await readFile(join(profile, 'hromada-aid.sqlite')), sentinel)
  console.log('PASS real HTTP login, RBAC 401/403, catalog read, bank create/update, server SQLite integrity and no local fallback')
} finally {
  await app?.close()
  database?.close()
  assert.equal(dirname(temporary), resolve(tmpdir()))
  await rm(temporary, { recursive: true, force: true })
}
