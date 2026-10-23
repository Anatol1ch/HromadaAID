import assert from 'node:assert/strict'
import test from 'node:test'
import { waitForStartupGate } from '../src/lib/startup-timing.ts'
import { welcomeHeading } from '../src/lib/welcome-name.ts'

test('startup gate waits for both initialization and the remaining minimum duration', async () => {
  let now = 100
  const sleeps = []
  let completeInitialization
  let finished = false
  const gate = waitForStartupGate(100, 2_000, () => new Promise(resolve => { completeInitialization = resolve }), () => now, async milliseconds => { sleeps.push(milliseconds); now += milliseconds }).then(value => { finished = true; return value })
  await Promise.resolve()
  assert.deepEqual(sleeps, [2_000])
  assert.equal(finished, false)
  completeInitialization('ready')
  assert.equal(await gate, 'ready')
  assert.equal(finished, true)
})

test('already elapsed minimum does not add another delay and errors still wait the minimum', async () => {
  const sleeps = []
  assert.equal(await waitForStartupGate(0, 2_000, async () => 'ready', () => 3_000, async ms => sleeps.push(ms)), 'ready')
  await assert.rejects(waitForStartupGate(0, 1_500, async () => { throw new Error('synthetic') }, () => 0, async ms => sleeps.push(ms)), /synthetic/)
  assert.deepEqual(sleeps, [1_500])
})

test('welcome uses only the structured first name and has a neutral fallback', () => {
  const user = { id: 'u', username: 'login-only', displayName: 'Full Display Name', firstName: '  Анатолій  ', lastName: 'Прізвище', roles: ['viewer'], permissions: ['dashboard.read'], mustChangePassword: false }
  assert.equal(welcomeHeading(user), 'Вітаємо в системі, Анатолій!')
  assert.equal(welcomeHeading({ ...user, firstName: null }), 'Вітаємо в системі!')
})
