import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { enforceTlsCertificateValidation, readElectronRuntimeConfig, readSavedConnectionConfig, safeTransportErrorMessage, validateServerBaseUrl } from './runtime-config.js'
import { checkServerAddress } from './connection-config.js'
import { HttpClient } from './http-client.js'

test('HTTP endpoints accept IPv4 and DNS names on the fixed port, without private-range restrictions', () => {
  for (const address of ['http://127.0.0.1:4310', 'http://localhost:4310', 'http://192.168.10.20:4310', 'http://192.0.2.15:4310', 'http://100.101.102.103:4310', 'http://server:4310', 'http://api.example-tailnet.ts.net:4310']) {
    assert.equal(validateServerBaseUrl(address).origin, new URL(address).origin)
  }
  for (const address of ['', 'http://server', 'http://server:4321', 'https://server:4310', 'file:///server', 'javascript:alert(1)', 'http://user:pass@server:4310', 'http://@server:4310', 'http://server:4310/api', 'http://server:4310/api/..', 'http://server:4310/?x=1', 'http://server:4310/#fragment', 'http://server:4310/?', 'http://[::1]:4310', 'http://0.0.0.0:4310', 'http://bad..name:4310', 'http://-bad:4310', 'http://ser\nver:4310', 'http://server\\other:4310', 'http://999.1.1.1:4310']) {
    assert.throws(() => validateServerBaseUrl(address), Error, address)
  }
})

test('saved HTTP survives restart; unsupported HTTPS is rejected without rewriting or fallback', () => {
  const root = mkdtempSync(join(tmpdir(), 'hromada-client-default-'))
  const userData = join(root, 'user'), resources = join(root, 'resources')
  const packaged = join(resources, 'server-connection.json')
  const saved = join(userData, 'server-connection.json')
  try {
    mkdirSync(userData, { recursive: true }); mkdirSync(resources, { recursive: true })
    writeFileSync(packaged, JSON.stringify({ version: 1, apiUrl: 'http://127.0.0.1:4310' }))
    assert.equal(readSavedConnectionConfig(userData, packaged).config?.apiUrl, 'http://127.0.0.1:4310')
    writeFileSync(saved, JSON.stringify({ version: 1, apiUrl: 'http://server.tailnet.ts.net:4310' }))
    assert.equal(readElectronRuntimeConfig({}, readSavedConnectionConfig(userData, packaged)).apiUrl?.origin, 'http://server.tailnet.ts.net:4310')
    const legacy = JSON.stringify({ version: 1, apiUrl: 'https://server.example.test:8443' })
    writeFileSync(saved, legacy)
    const restored = readSavedConnectionConfig(userData, packaged)
    assert.equal(restored.config, undefined)
    assert.match(restored.error ?? '', /некоректна/)
    const runtime = readElectronRuntimeConfig({}, restored)
    assert.equal(runtime.source, 'invalid')
    assert.equal(runtime.apiUrl, undefined)
    assert.match(runtime.configurationError ?? '', /некоректна/)
    assert.equal(readFileSync(saved, 'utf8'), legacy)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('redirect failures have actionable messages and global TLS verification stays enabled', () => {
  assert.match(safeTransportErrorMessage(Object.assign(new Error('fetch failed'), { cause: new Error('unexpected redirect') })) ?? '', /перенаправив запит/)
  const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  try { enforceTlsCertificateValidation(); assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, '1') }
  finally {
    if (previous === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previous
  }
})

test('HTTP health, login and bearer requests reject redirects; API paths cannot escape their origin', async () => {
  let targetRequests = 0
  const target = createServer((_request, reply) => { targetRequests++; reply.end('{}') })
  const redirect = createServer((_request, reply) => { reply.writeHead(307, { location: 'http://127.0.0.2:4310/other' }); reply.end() })
  const listen = (server: ReturnType<typeof createServer>, host: string) => new Promise<void>((resolve, reject) => server.once('error', reject).listen(4310, host, resolve))
  try {
    await listen(target, '127.0.0.2')
    await listen(redirect, '127.0.0.1')
    const health = await checkServerAddress('http://127.0.0.1:4310')
    assert.equal(health.ok, false)
    assert.match(health.message, /перенаправив запит/)
    const http = new HttpClient(new URL('http://127.0.0.1:4310'), 1_000, { getAccessToken: () => 'synthetic-session' })
    await assert.rejects(http.postJson('/auth/login', { username: 'synthetic', password: 'synthetic-only' }, undefined, { authorize: false }), /перенаправив запит/)
    await assert.rejects(http.getJson('/api/catalogs'), /перенаправив запит/)
    for (const path of ['//127.0.0.2:4310/api/catalogs', '/\\127.0.0.2:4310/api/catalogs']) {
      await assert.rejects(http.getJson(path), /іншого сервера/)
    }
    assert.equal(targetRequests, 0, 'credentials and bearer tokens must never reach the other origin')
  } finally {
    for (const server of [redirect, target]) {
      server.closeAllConnections()
      if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()))
    }
  }
})
