import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openInitializedDatabase } from '../dist-server/electron/database.js'
import { createApp } from '../dist-server/server/src/app.js'
import { createFirstAdministrator } from '../dist-server/server/src/auth.js'
import { HttpClient } from '../dist-electron/electron/http-client.js'
import { RemoteAuthSession } from '../dist-electron/electron/auth-session.js'
import { checkServerAddress, saveServerAddress, switchRemoteServer } from '../dist-electron/electron/connection-config.js'
import { readElectronRuntimeConfig, readSavedConnectionConfig, validateServerBaseUrl } from '../dist-electron/electron/runtime-config.js'

const root = await mkdtemp(join(tmpdir(), 'hromada-connection-test-'))
const userData = join(root, 'electron-user-data')
const database1 = openInitializedDatabase(join(root, 'server-one.sqlite'))
const database2 = openInitializedDatabase(join(root, 'server-two.sqlite'))
let app1, app2, session, healthProbe, wrongProtocol, timeoutServer, closedPort
let releaseDelayed, signalDelayed
let invalidatedCount = 0
const entered = new Promise(resolve => { signalDelayed = resolve })
const delayedGate = new Promise(resolve => { releaseDelayed = resolve })
const pass = 'synthetic pass 😀'

try {
  await mkdir(userData, { recursive: true })
  assert.throws(() => validateServerBaseUrl(''), /адресу/i)
  assert.throws(() => validateServerBaseUrl('http://server.example'), /HTTPS/i)
  assert.throws(() => validateServerBaseUrl('https://user:pass@example.org'), /базову адресу/i)
  assert.throws(() => validateServerBaseUrl('https://example.org/api'), /базову адресу/i)
  assert.throws(() => validateServerBaseUrl('https://example.org/?secret=x'), /базову адресу/i)
  assert.equal(validateServerBaseUrl('http://127.0.0.1:4310/').origin, 'http://127.0.0.1:4310')
  assert.equal(validateServerBaseUrl('http://[::1]:4310').origin, 'http://[::1]:4310')
  assert.match(readElectronRuntimeConfig({}).configurationError, /адресу сервера/)
  assert.equal(readElectronRuntimeConfig({}).apiUrl, undefined)
  const environmentConfig = readElectronRuntimeConfig({ HROMADAAID_API_URL: 'http://127.0.0.1:4310' }, { config: { apiUrl: 'https://saved.example' } })
  assert.equal(environmentConfig.apiUrl.origin, 'http://127.0.0.1:4310')
  assert.equal(environmentConfig.source, 'environment')
  assert.equal(environmentConfig.lockedReason?.includes('HROMADAAID_API_URL'), true)
  await writeFile(join(userData, 'server-connection.json'), '{broken')
  const corrupt = readElectronRuntimeConfig({}, readSavedConnectionConfig(userData))
  assert.equal(corrupt.source, 'invalid')
  assert.equal(corrupt.apiUrl, undefined)
  assert.match(corrupt.configurationError, /перевірте/i)
  await rm(join(userData, 'server-connection.json'))
  console.log('PASS URL policy, server-only startup, environment priority and corrupt-config fail-closed behavior')

  await createFirstAdministrator(database1, { displayName: 'Synthetic One', username: 'synthetic-one', password: pass })
  await createFirstAdministrator(database2, { displayName: 'Synthetic Two', username: 'synthetic-two', password: pass })
  app1 = createApp(database1); app1.log.level = 'silent'
  app2 = createApp(database2); app2.log.level = 'silent'
  const secondServerAuthHeaders = []
  app2.addHook('onRequest', async request => { secondServerAuthHeaders.push(request.headers.authorization) })
  app1.get('/connection/delayed-401', async (_request, reply) => { signalDelayed(); await delayedGate; return reply.status(401).send({ message: 'synthetic' }) })
  await Promise.all([app1.listen({ host: '127.0.0.1', port: 0 }), app2.listen({ host: '127.0.0.1', port: 0 })])
  const base1 = new URL(`http://127.0.0.1:${app1.server.address().port}`)
  const base2 = new URL(`http://127.0.0.1:${app2.server.address().port}`)
  const checked = await checkServerAddress(base1.origin)
  assert.deepEqual(checked, { ok: true, apiUrl: base1.origin, status: 'available', message: 'Сервер доступний.' })
  await saveServerAddress(userData, base1.origin)
  assert.equal(readSavedConnectionConfig(userData).config.apiUrl, base1.origin)
  assert.equal(readElectronRuntimeConfig({}, readSavedConnectionConfig(userData)).apiUrl.origin, base1.origin)

  let healthAuthorization
  healthProbe = createServer((request, response) => {
    healthAuthorization = request.headers.authorization
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ status: 'ok', service: 'hromada-aid-api' }))
  })
  await new Promise(resolve => healthProbe.listen(0, '127.0.0.1', resolve))
  const probeAddress = new URL(`http://127.0.0.1:${healthProbe.address().port}`)
  assert.equal((await checkServerAddress(probeAddress.origin)).ok, true)
  assert.equal(healthAuthorization, undefined)
  await new Promise(resolve => healthProbe.close(resolve))
  wrongProtocol = createServer((_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end('{"status":"ok","service":"other"}') })
  await new Promise(resolve => wrongProtocol.listen(0, '127.0.0.1', resolve))
  const wrongAddress = new URL(`http://127.0.0.1:${wrongProtocol.address().port}`)
  assert.equal((await checkServerAddress(wrongAddress.origin)).ok, false)
  await new Promise(resolve => wrongProtocol.close(resolve))

  const http = new HttpClient(base1, 1500, { getAccessToken: () => session?.accessToken, onUnauthorized: token => { invalidatedCount++; void session?.expired(token) } })
  session = new RemoteAuthSession(userData, http, () => {})
  await session.initialize()
  assert.equal((await session.login('synthetic-one', pass)).ok, true)
  const oldToken = session.accessToken
  const staleRequest = http.getJson('/connection/delayed-401')
  await entered

  const unavailable = await switchRemoteServer(userData, 'http://127.0.0.1:1', http, session, () => { throw new Error('unavailable target cannot activate') })
  assert.equal(unavailable.ok, false)
  assert.equal(session.currentState.status, 'authenticated')
  assert.equal(readSavedConnectionConfig(userData).config.apiUrl, base1.origin)
  const switched = await switchRemoteServer(userData, base2.origin, http, session, url => assert.equal(url.origin, base2.origin))
  assert.equal(switched.ok, true)
  assert.equal(session.accessToken, undefined)
  assert.equal(session.currentState.status, 'unauthenticated')
  assert.equal(readSavedConnectionConfig(userData).config.apiUrl, base2.origin)
  assert.equal(readElectronRuntimeConfig({}, readSavedConnectionConfig(userData)).apiUrl.origin, base2.origin)
  const oldTokenResponse = await fetch(new URL('/auth/me', base1), { headers: { authorization: `Bearer ${oldToken}` } })
  assert.equal(oldTokenResponse.status, 401)
  assert.equal((await session.login('synthetic-two', pass)).ok, true)
  assert.equal(session.currentState.user.username, 'synthetic-two')
  assert.equal(secondServerAuthHeaders.every(header => header !== `Bearer ${oldToken}`), true)
  const newToken = session.accessToken
  releaseDelayed()
  await assert.rejects(staleRequest, /попередньої адреси сервера/i)
  assert.equal(invalidatedCount, 0)
  assert.equal(session.currentState.status, 'authenticated')
  assert.equal(session.accessToken, newToken)
  console.log('PASS server switch revokes old session, persists across restart, does not send old token to new origin, and ignores stale 401')

  closedPort = createServer()
  await new Promise(resolve => closedPort.listen(0, '127.0.0.1', resolve))
  const unavailableAddress = `http://127.0.0.1:${closedPort.address().port}`
  await new Promise(resolve => closedPort.close(resolve))
  assert.equal((await checkServerAddress(unavailableAddress, 100)).ok, false)
  timeoutServer = createServer(() => {})
  await new Promise(resolve => timeoutServer.listen(0, '127.0.0.1', resolve))
  const timeoutAddress = `http://127.0.0.1:${timeoutServer.address().port}`
  const timeout = await checkServerAddress(timeoutAddress, 50)
  assert.equal(timeout.ok, false)
  assert.match(timeout.message, /встановлений час/i)
  timeoutServer.closeAllConnections()
  await new Promise(resolve => timeoutServer.close(resolve))
  const finalConfig = JSON.parse(await readFile(join(userData, 'server-connection.json'), 'utf8'))
  assert.deepEqual(Object.keys(finalConfig).sort(), ['apiUrl', 'version'])
  assert.equal(finalConfig.apiUrl, base2.origin)
  for (const database of [database1, database2]) {
    assert.equal(database.prepare('PRAGMA quick_check').get().quick_check, 'ok')
    assert.equal(database.prepare('PRAGMA foreign_key_check').all().length, 0)
  }
  console.log('PASS unavailable/wrong-protocol/timeout checks leave persisted address unchanged and config contains only the URL')
  console.log('PASS isolated SQLite integrity checks')
} finally {
  releaseDelayed?.()
  await session?.logout().catch(() => undefined)
  await app1?.close().catch(() => undefined)
  await app2?.close().catch(() => undefined)
  for (const server of [healthProbe, wrongProtocol, closedPort, timeoutServer]) {
    if (server?.listening) {
      server.closeAllConnections?.()
      await new Promise(resolve => server.close(resolve))
    }
  }
  database1.close(); database2.close()
  await rm(root, { recursive: true, force: true })
}
