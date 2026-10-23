import assert from 'node:assert/strict'
import test from 'node:test'
import { RemoteAuthSession } from './auth-session.js'
import { HttpClient } from './http-client.js'

test('wrong login remains a form error; reconnect revalidates the session and handles 403 separately from 401', async () => {
  const originalFetch = globalThis.fetch
  let session: RemoteAuthSession | undefined
  let meStatus = 200
  const user = { id: 'synthetic-user', username: 'synthetic', displayName: 'Synthetic User', firstName: 'Synthetic', lastName: 'User', roles: ['viewer'], permissions: ['dashboard.read'], mustChangePassword: false }
  const http = new HttpClient(new URL('https://synthetic.invalid'), 500, { getAccessToken: () => session?.accessToken, onUnauthorized: token => { void session?.expired(token) } })
  session = new RemoteAuthSession('unused-synthetic-profile', http, () => undefined)
  try {
    globalThis.fetch = async input => {
      const path = new URL(String(input)).pathname
      if (path === '/auth/login') return new Response(JSON.stringify({ token: 'synthetic-session-token', user, expiresAt: new Date(Date.now() + 60_000).toISOString() }), { status: 200, headers: { 'content-type': 'application/json' } })
      if (path === '/auth/me') return new Response(meStatus === 200 ? JSON.stringify(user) : JSON.stringify({ message: 'not allowed' }), { status: meStatus, headers: { 'content-type': 'application/json' } })
      throw new Error('Unexpected synthetic request')
    }
    const login = await session.login('synthetic', 'synthetic-only-password')
    assert.equal(login.ok, true)
    meStatus = 403
    const forbidden = await session.validateSession()
    assert.equal(forbidden.ok, false)
    assert.equal(forbidden.state.status, 'authenticated')
    assert.equal(forbidden.failureKind, 'permission')
    meStatus = 200
    const restored = await session.validateSession()
    assert.equal(restored.ok, true)
    assert.equal(restored.state.status, 'authenticated')
    meStatus = 401
    const expired = await session.validateSession()
    assert.equal(expired.ok, false)
    assert.equal(expired.state.status, 'unauthenticated')
    assert.equal(expired.failureKind, 'session-expired')
    assert.match(expired.message, /Час вашого сеансу минув/)
    assert.equal(session.accessToken, undefined)
  } finally { globalThis.fetch = originalFetch }
})

test('401 from login is not interpreted as expiration of an existing session', async () => {
  const originalFetch = globalThis.fetch
  let unauthorizedCallback = 0
  const http = new HttpClient(new URL('https://synthetic.invalid'), 500, { onUnauthorized: () => { unauthorizedCallback += 1 } })
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ message: 'wrong credentials' }), { status: 401, headers: { 'content-type': 'application/json' } })
    await assert.rejects(http.postJson('/auth/login', { username: 'synthetic', password: 'synthetic' }, undefined, { authorize: false }), /Неправильний логін або пароль/)
    assert.equal(unauthorizedCallback, 0)
  } finally { globalThis.fetch = originalFetch }
})

test('a delayed 401 from an earlier token cannot end a newer session', async () => {
  const originalFetch = globalThis.fetch
  let loginCount = 0
  let session: RemoteAuthSession | undefined
  const user = { id: 'synthetic-user', username: 'synthetic', displayName: 'Synthetic User', firstName: null, lastName: null, roles: ['viewer'], permissions: ['dashboard.read'], mustChangePassword: false }
  const http = new HttpClient(new URL('https://synthetic.invalid'), 500, { getAccessToken: () => session?.accessToken, onUnauthorized: token => { void session?.expired(token) } })
  session = new RemoteAuthSession('unused-synthetic-profile', http, () => undefined)
  try {
    globalThis.fetch = async () => {
      loginCount += 1
      return new Response(JSON.stringify({ token: `synthetic-token-${loginCount}`, user, expiresAt: new Date(Date.now() + 60_000).toISOString() }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    await session.login('synthetic', 'synthetic-only-password')
    const oldToken = session.accessToken
    await session.login('synthetic', 'synthetic-only-password')
    const newToken = session.accessToken
    await session.expired(oldToken)
    assert.notEqual(newToken, oldToken)
    assert.equal(session.accessToken, newToken)
    assert.equal(session.currentState.status, 'authenticated')
  } finally { globalThis.fetch = originalFetch }
})
