import test from 'node:test'
import assert from 'node:assert/strict'

const { runServerInstallation } = await import('../../dist-server-manager/main/installation-engine.js')

function fixture({ installation = 'not_installed', users = 0, marker = true, failAt = null, resumable = false, finalApiStatus = 'available', finalServiceStatus = 'running' } = {}) {
  const calls = []
  let userStatus = users
  let serviceInstalled = false
  const request = {
    programDirectory: 'D:\\HromadaAID', dataDirectory: 'D:\\HromadaAID-Data', backupDirectory: 'E:\\HromadaAID-Backups',
    administrator: { displayName: 'Синтетична адміністраторка', username: 'synthetic-admin', password: 'Synthetic passphrase', confirmation: 'Synthetic passphrase' },
  }
  const step = name => async (...values) => {
    calls.push(name)
    if (failAt === name) throw new Error('synthetic failure')
    if (name === 'databaseStatus') return { users: userStatus }
    if (name === 'hasPendingAdminMarker') return marker
    if (name === 'createAdministrator') userStatus = 'present'
    return undefined
  }
  const adapters = {}
  adapters.wait = async () => {}
  adapters.inspect = async () => { calls.push('inspect'); return { installation: { status: serviceInstalled ? 'installed' : installation }, service: { status: serviceInstalled ? finalServiceStatus : 'missing' }, api: { status: serviceInstalled ? finalApiStatus : 'not_configured' }, configuration: { serverVersion: serviceInstalled ? '0.1.0' : null, apiAddress: serviceInstalled ? 'http://127.0.0.1:4310' : null } } }
  adapters.canResume = async () => { calls.push('canResume'); return resumable }
  for (const name of ['preflight', 'stagePackage', 'prepareConfiguration', 'recordLocator', 'initialize', 'databaseStatus', 'hasPendingAdminMarker', 'createAdministrator', 'installService']) adapters[name] = step(name)
  adapters.initialize = async (_request, confirmKey) => { calls.push('initialize'); assert.equal(await confirmKey('synthetic-recovery-key'), true) }
  adapters.installService = async () => { calls.push('installService'); if (failAt === 'installService') throw new Error('synthetic failure'); serviceInstalled = true }
  const events = []
  const run = () => runServerInstallation(request, adapters, 'synthetic-operation', event => events.push(event), async key => { calls.push(`confirm:${key}`); return true })
  return { calls, request, events, adapters, run }
}

test('first installation follows the safe order, requires saved recovery key and creates only the first admin', async () => {
  const f = fixture()
  // Use the fixture behavior as a true boundary contract; no Windows or data resources are touched.
  const result = await f.run()
  assert.deepEqual(f.calls, ['inspect', 'preflight', 'recordLocator', 'stagePackage', 'prepareConfiguration', 'initialize', 'confirm:synthetic-recovery-key', 'databaseStatus', 'hasPendingAdminMarker', 'createAdministrator', 'databaseStatus', 'installService', 'inspect'])
  assert.equal(result, undefined)
  assert.equal(f.request.administrator.password, '')
  assert.equal(f.request.administrator.confirmation, '')
  assert.equal(f.events.at(-1).status, 'succeeded')
  assert.deepEqual(f.events.at(-1).result, { service: 'running', api: 'available', serverVersion: '0.1.0', apiAddress: 'http://127.0.0.1:4310' })
})

test('existing or incomplete installation blocks a clean install before filesystem work', async () => {
  const f = fixture({ installation: 'installed' })
  await assert.rejects(f.run(), /наявну або неповну інсталяцію/)
  assert.deepEqual(f.calls, ['inspect'])
  assert.equal(f.request.administrator.password, '')
  assert.equal(f.events.at(-1).status, 'failed')
})

test('technical server-payload verification failures remain distinct from an existing partial installation', async () => {
  const f = fixture()
  f.adapters.preflight = async () => {
    throw Object.assign(new Error("Cannot find module 'server-runtime-check.mjs'"), { code: 'SERVER_PACKAGE_INVALID' })
  }
  await assert.rejects(f.run(), error => {
    assert.equal(error.code, 'SERVER_PACKAGE_INVALID')
    assert.match(error.message, /server-runtime-check\.mjs/)
    assert.doesNotMatch(error.message, /наявну або неповну інсталяцію/)
    return true
  })
  assert.equal(f.events.at(-1).errorCode, 'SERVER_PACKAGE_INVALID')
  assert.equal(f.calls.includes('stagePackage'), false)
})

test('a failed packaged-module check while considering a partial-install retry surfaces its technical cause', async () => {
  const f = fixture({ installation: 'partial_installation' })
  f.adapters.canResume = async () => {
    throw Object.assign(new Error("Cannot find module 'server-runtime-check.mjs'"), { code: 'SERVER_PACKAGE_INVALID' })
  }
  await assert.rejects(f.run(), error => error.code === 'SERVER_PACKAGE_INVALID' && /server-runtime-check/.test(error.message))
  assert.equal(f.events.at(-1).errorCode, 'SERVER_PACKAGE_INVALID')
  assert.doesNotMatch(f.events.at(-1).message, /наявну або неповну інсталяцію/)
})

test('partial install resumes only when the Windows adapter confirms the staged package and same paths', async () => {
  const f = fixture({ installation: 'partial_installation', resumable: true, users: 'present' })
  await f.run()
  assert.deepEqual(f.calls.slice(0, 5), ['inspect', 'canResume', 'preflight', 'recordLocator', 'stagePackage'])
  assert.equal(f.calls.includes('createAdministrator'), false)
  assert.equal(f.calls.at(-1), 'inspect')
})

test('empty database without the first-install marker never receives an administrator', async () => {
  const f = fixture({ marker: false })
  await assert.rejects(f.run(), /немає підтвердженого маркера/)
  assert.equal(f.calls.includes('createAdministrator'), false)
  assert.equal(f.calls.includes('installService'), false)
})

test('a failed operation stops subsequent steps, preserves data and clears password fields', async () => {
  const f = fixture({ failAt: 'createAdministrator' })
  await assert.rejects(f.run(), /synthetic failure/)
  assert.equal(f.calls.includes('installService'), false)
  assert.equal(f.request.administrator.password, '')
  assert.equal(f.request.administrator.confirmation, '')
  assert.equal(f.events.at(-1).status, 'failed')
})

test('completed installer with unconfirmed API becomes verification-required, never a clean-install retry', async () => {
  const f = fixture({ finalApiStatus: 'unavailable' })
  await f.run()
  assert.equal(f.events.at(-1).status, 'verification-required')
  assert.equal(f.events.at(-1).errorCode, 'INSTALLATION_VERIFY_PENDING')
  assert.match(f.events.at(-1).message, /API недоступний/)
  assert.equal(f.events.some(event => event.status === 'succeeded'), false)
  assert.equal(f.calls.filter(name => name === 'inspect').length, 4)
  assert.equal(f.calls.filter(name => name === 'initialize').length, 1)
  await assert.rejects(f.run(), /наявну або неповну інсталяцію/)
  assert.equal(f.calls.filter(name => name === 'initialize').length, 1)
})

test('transient post-install query failure and pending service are retried read-only, preserving all installer operations', async () => {
  const f = fixture()
  const original = f.adapters.inspect
  let attempts = 0
  const waits = []
  f.adapters.wait = async milliseconds => waits.push(milliseconds)
  f.adapters.inspect = async () => {
    const state = await original()
    attempts++
    if (attempts === 2) throw Object.assign(new Error('SCM timeout'), { code: 'ETIMEDOUT' })
    if (attempts === 3) return { ...state, service: { status: 'other' }, api: { status: 'unavailable' } }
    return state
  }
  await f.run()
  assert.equal(f.events.at(-1).status, 'succeeded')
  assert.deepEqual(waits, [1000, 2000])
  for (const operation of ['preflight', 'recordLocator', 'stagePackage', 'prepareConfiguration', 'initialize', 'createAdministrator', 'installService']) {
    assert.equal(f.calls.filter(name => name === operation).length, 1, operation)
  }
})

test('unavailable final SCM retains completed installation and permits later read-only confirmation', async () => {
  const { installationVerificationIssues } = await import('../../dist-server-manager/main/installation-contract.js')
  const f = fixture()
  const original = f.adapters.inspect
  let attempts = 0
  f.adapters.inspect = async () => {
    const state = await original()
    return ++attempts > 1 ? { ...state, installation: { status: 'unknown' }, service: { status: 'unknown' } } : state
  }
  await f.run()
  assert.equal(f.events.at(-1).status, 'verification-required')
  assert.match(f.events.at(-1).message, /стан служби невідомий/)
  assert.doesNotMatch(f.events.at(-1).message, /API недоступний/)
  f.adapters.inspect = original
  assert.deepEqual(installationVerificationIssues(await f.adapters.inspect()), [])
  assert.equal(f.calls.filter(name => name === 'installService').length, 1)
  assert.equal(f.calls.filter(name => name === 'createAdministrator').length, 1)
})

test('verification identifies service/system code, configuration and package failures without exposing raw diagnostics', async () => {
  const { installationVerificationIssues } = await import('../../dist-server-manager/main/installation-contract.js')
  const issues = installationVerificationIssues({ installation: { status: 'unknown' }, service: { status: 'unknown' }, api: { status: 'available' }, configuration: { serverVersion: null, apiAddress: 'http://127.0.0.1:4310' }, checks: [
    { id: 'service', status: 'unknown', diagnostics: [{ operation: 'service.query', target: 'HromadaAIDApi', code: 'ETIMEDOUT', message: 'private contents' }] },
    { id: 'configuration', status: 'failed' }, { id: 'package', status: 'failed' },
  ] }).join(' ')
  assert.match(issues, /стан служби невідомий \(ETIMEDOUT\)/)
  assert.match(issues, /server.json/)
  assert.match(issues, /серверного пакета/)
  assert.doesNotMatch(issues, /private contents|API недоступний/)
})
