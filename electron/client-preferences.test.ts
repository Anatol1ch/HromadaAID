import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readLastLogin, saveLastLoginAfterSuccessfulLogin } from './client-preferences.js'

test('last login is saved only after successful authentication and contains no credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hromada-client-preferences-'))
  try {
    const failed = { ok: false as const, state: { status: 'unauthenticated' as const, user: null }, message: 'bad credentials' }
    await saveLastLoginAfterSuccessfulLogin(directory, failed)
    assert.equal(await readLastLogin(directory), null)

    const success = { ok: true as const, state: { status: 'authenticated' as const, user: { id: 'synthetic-user', username: 'synthetic-login', displayName: 'Synthetic', roles: ['viewer' as const], permissions: ['dashboard.read' as const], mustChangePassword: false } } }
    await saveLastLoginAfterSuccessfulLogin(directory, success)
    assert.equal(await readLastLogin(directory), 'synthetic-login')
    const stored = JSON.parse(await readFile(join(directory, 'client-preferences.json'), 'utf8'))
    assert.deepEqual(Object.keys(stored), ['lastLogin'])
    assert.equal(JSON.stringify(stored).includes('password'), false)
    assert.equal(JSON.stringify(stored).includes('token'), false)

    const nextUser = { ...success, state: { ...success.state, user: { ...success.state.user, username: 'another-login' } } }
    await saveLastLoginAfterSuccessfulLogin(directory, nextUser)
    assert.equal(await readLastLogin(directory), 'another-login')
  } finally { await rm(directory, { recursive: true, force: true }) }
})
