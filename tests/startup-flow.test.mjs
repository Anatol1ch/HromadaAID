import assert from 'node:assert/strict'
import test from 'node:test'
import { waitForStartupGate } from '../src/lib/startup-timing.ts'
import { welcomeHeading } from '../src/lib/welcome-name.ts'

test('startup gate waits for initialization and then enforces the minimum display duration', async () => {
  let now = 100
  const sleeps = []
  let completeInitialization
  let finished = false
  const gate = waitForStartupGate(100, 2_000, () => new Promise(resolve => { completeInitialization = resolve }), () => now, async milliseconds => { sleeps.push(milliseconds); now += milliseconds }).then(value => { finished = true; return value })
  await Promise.resolve()
  assert.deepEqual(sleeps, [])
  assert.equal(finished, false)
  completeInitialization('ready')
  await Promise.resolve()
  assert.deepEqual(sleeps, [2_000])
  assert.equal(await gate, 'ready')
  assert.equal(finished, true)
})

test('already elapsed minimum adds no delay and critical initialization errors return immediately', async () => {
  const sleeps = []
  assert.equal(await waitForStartupGate(0, 2_000, async () => 'ready', () => 3_000, async ms => sleeps.push(ms)), 'ready')
  await assert.rejects(waitForStartupGate(0, 1_500, async () => { throw new Error('synthetic') }, () => 0, async ms => sleeps.push(ms)), /synthetic/)
  assert.deepEqual(sleeps, [])
})

test('critical states returned as values skip the minimum while successful states retain it', async () => {
  const sleeps = []
  const skipIfFailed = value => !value.ok
  assert.deepEqual(await waitForStartupGate(0, 5_000, async () => ({ ok: false }), () => 0, async ms => sleeps.push(ms), skipIfFailed), { ok: false })
  assert.deepEqual(sleeps, [])
  assert.deepEqual(await waitForStartupGate(0, 5_000, async () => ({ ok: true }), () => 0, async ms => sleeps.push(ms), skipIfFailed), { ok: true })
  assert.deepEqual(sleeps, [5_000])
})

test('startup and welcome use a five second minimum', async () => {
  const app = await (await import('node:fs/promises')).readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(app, /waitForStartupGate\(startupAt, 5_000/)
  assert.match(app, /waitForStartupGate\(startedAt, 5_000/)
})

test('welcome uses only the structured first name and has a neutral fallback', () => {
  const user = { id: 'u', username: 'login-only', displayName: 'Full Display Name', firstName: '  Анатолій  ', lastName: 'Прізвище', roles: ['viewer'], permissions: ['dashboard.read'], mustChangePassword: false }
  assert.equal(welcomeHeading(user), 'Вітаємо в системі, Анатолій!')
  assert.equal(welcomeHeading({ ...user, firstName: null }), 'Вітаємо в системі!')
})
