import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { enforceTlsCertificateValidation, readSavedConnectionConfig, safeTransportErrorMessage, validateServerBaseUrl } from './runtime-config.js'

const fixture = (name: string) => readFileSync(resolve(process.cwd(), 'server', 'test-fixtures', name))

test('server address validation permits HTTPS anywhere and HTTP only on loopback', () => {
  assert.equal(validateServerBaseUrl('http://127.0.0.1:4310').protocol, 'http:')
  assert.equal(validateServerBaseUrl('http://[::1]:4310').protocol, 'http:')
  assert.equal(validateServerBaseUrl('https://192.0.2.15:4310').protocol, 'https:')
  assert.throws(() => validateServerBaseUrl('http://192.0.2.15:4310'), /Для віддаленого сервера потрібен HTTPS/)
  assert.throws(() => validateServerBaseUrl('http://user:pass@127.0.0.1:4310'), /Для віддаленого сервера потрібен HTTPS/)
})

test('server-plus-client package default is used only when no per-user address exists', () => {
  const root = mkdtempSync(join(tmpdir(), 'hromada-client-default-'))
  const userData = join(root, 'user'), resources = join(root, 'resources')
  const packaged = join(resources, 'server-connection.json')
  try {
    mkdirSync(userData, { recursive: true })
    mkdirSync(resources, { recursive: true })
    writeFileSync(packaged, JSON.stringify({ version: 1, apiUrl: 'http://127.0.0.1:4310' }))
    assert.equal(readSavedConnectionConfig(userData, packaged).config?.apiUrl, 'http://127.0.0.1:4310')
    writeFileSync(join(userData, 'server-connection.json'), JSON.stringify({ version: 1, apiUrl: 'https://server.example.test' }))
    assert.equal(readSavedConnectionConfig(userData, packaged).config?.apiUrl, 'https://server.example.test')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('TLS and redirect failures become safe user-facing messages', () => {
  assert.match(safeTransportErrorMessage(Object.assign(new Error('fetch failed'), { cause: Object.assign(new Error('certificate error'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' }) })) ?? '', /сертифікат сервера недовірений/)
  assert.match(safeTransportErrorMessage(Object.assign(new Error('fetch failed'), { cause: new Error('unexpected redirect') })) ?? '', /перенаправив запит/)
})

test('client overrides an inherited setting that would disable TLS verification', () => {
  const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  try {
    enforceTlsCertificateValidation()
    assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, '1')
  } finally {
    if (previous === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previous
  }
})

test('Node fetch rejects untrusted TLS, hostname mismatch and HTTPS-to-HTTP redirects', async () => {
  const cert = fixture('tls-test-cert.pem'), key = fixture('tls-test-key.pem')
  const counters = { insecureTarget: 0 }
  const insecureTarget = createHttpServer((_request, reply) => { counters.insecureTarget += 1; reply.end(JSON.stringify({ status: 'ok', service: 'hromada-aid-api' })) })
  await new Promise<void>(resolveListen => insecureTarget.listen(0, '127.0.0.1', resolveListen))
  const insecurePort = (insecureTarget.address() as import('node:net').AddressInfo).port
  const healthy = createHttpsServer({ cert, key }, (_request, reply) => reply.end(JSON.stringify({ status: 'ok', service: 'hromada-aid-api' })))
  const redirect = createHttpsServer({ cert, key }, (_request, reply) => { reply.writeHead(302, { location: `http://127.0.0.1:${insecurePort}/health` }); reply.end() })
  await Promise.all([healthy, redirect].map(server => new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen))))
  const healthyPort = (healthy.address() as import('node:net').AddressInfo).port
  const redirectPort = (redirect.address() as import('node:net').AddressInfo).port
  const moduleUrl = pathToFileURL(resolve(process.cwd(), 'dist-electron', 'electron', 'connection-config.js')).href
  const script = `import { checkServerAddress } from ${JSON.stringify(moduleUrl)};
    import { enforceTlsCertificateValidation } from ${JSON.stringify(pathToFileURL(resolve(process.cwd(), 'dist-electron', 'electron', 'runtime-config.js')).href)};
    enforceTlsCertificateValidation();
    const [good, mismatch, downgrade] = await Promise.all([
      checkServerAddress('https://localhost:${healthyPort}'),
      checkServerAddress('https://127.0.0.1:${healthyPort}'),
      checkServerAddress('https://localhost:${redirectPort}')
    ]);
    console.log(JSON.stringify({good, mismatch, downgrade}));`
  const run = (trustTestCert: boolean) => new Promise<{ code: number | null; stdout: string; stderr: string }>((resolveRun, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' }
    delete env.NODE_EXTRA_CA_CERTS
    if (trustTestCert) env.NODE_EXTRA_CA_CERTS = resolve(process.cwd(), 'server', 'test-fixtures', 'tls-test-cert.pem')
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('close', code => resolveRun({ code, stdout, stderr }))
  })
  try {
    const untrusted = await run(false)
    assert.equal(untrusted.code, 0, untrusted.stderr)
    const untrustedResult = JSON.parse(untrusted.stdout.trim()) as { good: { ok: boolean; message: string } }
    assert.equal(untrustedResult.good.ok, false)
    assert.match(untrustedResult.good.message, /сертифікат сервера недовірений/)

    const trusted = await run(true)
    assert.equal(trusted.code, 0, trusted.stderr)
    const result = JSON.parse(trusted.stdout.trim()) as { good: { ok: boolean }; mismatch: { ok: boolean; message: string }; downgrade: { ok: boolean; message: string } }
    assert.equal(result.good.ok, true)
    assert.equal(result.mismatch.ok, false)
    assert.match(result.mismatch.message, /сертифікат сервера недовірений/)
    assert.equal(result.downgrade.ok, false)
    assert.match(result.downgrade.message, /перенаправив запит/)
    assert.equal(counters.insecureTarget, 0, 'redirect target must never receive the health request')
  } finally {
    await Promise.all([healthy, redirect, insecureTarget].map(server => new Promise<void>(resolveClose => server.close(() => resolveClose()))))
  }
})
