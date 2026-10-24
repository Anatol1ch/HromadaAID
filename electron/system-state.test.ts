import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyHealthFailure, classifyHealthResponse, classifyHttpReachability, reconnectDelay, RESTORE_MAINTENANCE_CODE, SingleFlightProbe } from '../shared/system-state.js'
import { HttpClient, HttpClientError } from './http-client.js'
import { checkServerAddress } from './connection-config.js'

test('system status distinguishes maintenance from connectivity and ordinary HTTP errors', () => {
  assert.equal(classifyHealthResponse(200, { status: 'ok', service: 'hromada-aid-api' }), 'available')
  assert.equal(classifyHealthResponse(200, { status: 'ok', service: 'hromada-aid-api', apiContractVersion: 1 }), 'available')
  assert.equal(classifyHealthFailure(200, { status: 'ok', service: 'hromada-aid-api', apiContractVersion: 2 }), 'incompatible')
  assert.equal(classifyHealthFailure(200, { status: 'ok', service: 'hromada-aid-api', apiContractVersion: null }), 'incompatible')
  assert.equal(classifyHealthResponse(503, { code: RESTORE_MAINTENANCE_CODE, message: 'Сервер у режимі відновлення.' }), 'maintenance')
  assert.equal(classifyHealthResponse(503, { message: 'Інша помилка сервера.' }), 'unavailable')
  assert.equal(classifyHealthFailure(500, { message: 'failure' }), 'http')
  assert.equal(classifyHealthFailure(200, { status: 'ok', service: 'other' }), 'incompatible')
  assert.equal(classifyHealthFailure(503, { code: RESTORE_MAINTENANCE_CODE }), 'maintenance')
  assert.equal(classifyHttpReachability(401, {}), 'available')
  assert.equal(classifyHttpReachability(403, {}), 'available')
  assert.equal(classifyHttpReachability(400, {}), 'available')
  assert.equal(classifyHttpReachability(404, {}), 'available')
  assert.equal(classifyHttpReachability(500, {}), 'available')
  assert.equal(classifyHttpReachability(503, { code: RESTORE_MAINTENANCE_CODE }), 'maintenance')
})

test('scheduled and manual reconnect probes share one in-flight request', async () => {
  let resolveGate!: (value: number) => void
  const gate = new Promise<number>(resolve => { resolveGate = resolve })
  const flight = new SingleFlightProbe<number>()
  let starts = 0
  const probe = () => { starts += 1; return gate }
  const first = flight.run(probe)
  const second = flight.run(probe)
  assert.equal(starts, 0) // probe starts on the next microtask
  await Promise.resolve()
  assert.equal(starts, 1)
  resolveGate(42)
  assert.deepEqual(await Promise.all([first, second]), [42, 42])
  assert.deepEqual([0, 1, 2, 3, 4, 8].map(reconnectDelay), [2_000, 5_000, 10_000, 20_000, 30_000, 30_000])
})

test('a lost response never retries a write; 403 preserves the session while 401 expires it', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0, expired = 0
  const client = new HttpClient(new URL('https://synthetic.invalid'), 500, { getAccessToken: () => 'synthetic-token', onUnauthorized: () => { expired += 1 } })
  try {
    globalThis.fetch = async () => { calls += 1; throw new TypeError('network unavailable') }
    await assert.rejects(client.postJson('/api/assignments', { requestId: 'synthetic-id' }), HttpClientError)
    assert.equal(calls, 1)
    globalThis.fetch = async () => new Response(JSON.stringify({ message: 'denied' }), { status: 403, headers: { 'content-type': 'application/json' } })
    await assert.rejects(client.getJson('/api/private'), error => error instanceof HttpClientError && error.status === 403)
    assert.equal(expired, 0)
    globalThis.fetch = async () => new Response(JSON.stringify({ message: 'expired' }), { status: 401, headers: { 'content-type': 'application/json' } })
    await assert.rejects(client.getJson('/api/private'), error => error instanceof HttpClientError && error.status === 401)
    assert.equal(expired, 1)
  } finally { globalThis.fetch = originalFetch }
})

test('health probe reports network, timeout, HTTP failure and maintenance as distinct causes', async () => {
  const originalFetch = globalThis.fetch
  const failureReason = async () => {
    const result = await checkServerAddress('http://127.0.0.1:4310')
    assert.equal(result.ok, false)
    return result.ok ? undefined : result.failureReason
  }
  try {
    globalThis.fetch = async () => { throw new TypeError('offline') }
    assert.equal(await failureReason(), 'network')
    globalThis.fetch = async () => { throw new DOMException('timed out', 'TimeoutError') }
    assert.equal(await failureReason(), 'timeout')
    globalThis.fetch = async () => new Response(JSON.stringify({ message: 'failed' }), { status: 500, headers: { 'content-type': 'application/json' } })
    assert.equal(await failureReason(), 'http')
    globalThis.fetch = async () => new Response(JSON.stringify({ code: RESTORE_MAINTENANCE_CODE, message: 'Сервер у режимі відновлення.' }), { status: 503, headers: { 'content-type': 'application/json' } })
    const maintenance = await checkServerAddress('http://127.0.0.1:4310')
    assert.equal(maintenance.status, 'maintenance')
    assert.equal(maintenance.failureReason, 'maintenance')
  } finally { globalThis.fetch = originalFetch }
})
