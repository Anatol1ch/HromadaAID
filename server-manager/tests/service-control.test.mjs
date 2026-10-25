import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const { runServiceControl, createServiceControlRequestHandler } = await import('../../dist-server-manager/main/service-control.js')
const { serviceControlScript } = await import('../../dist-server-manager/main/windows-service-control.js')

function inspection(service = 'running', api = 'available') {
  return {
    checkedAt: '2026-10-25T10:00:00.000Z',
    installation: { status: 'installed', message: 'Встановлено.' },
    service: { status: service, message: 'Стан отримано з тестового адаптера.' },
    api: { status: api, message: 'Тестовий health-check.', contractVersion: 1 },
    configuration: { programDirectory: null, dataDirectory: null, backupDirectory: null, databasePath: null, apiAddress: 'http://127.0.0.1:4310', host: '127.0.0.1', port: 4310, transport: 'HTTP', serverVersion: '0.1.0', serviceName: 'HromadaAIDApi', serviceAccount: 'NT AUTHORITY\\LocalService', startMode: 'Auto', logDirectory: null },
    discovery: { source: 'windows_service', confidence: 'confirmed', message: 'Тестова фікстура.' },
    checks: [],
  }
}

test('start succeeds only after a fresh inspection confirms Running and API health', async () => {
  const calls = []
  const result = await runServiceControl('start', 'op-start', {
    platform: 'win32', control: async operation => { calls.push(operation); return { success: true, errorCode: null, message: 'SCM start completed.' } },
    inspect: async () => inspection('running', 'available'), failedInspection: () => inspection('unknown', 'unknown'),
  })
  assert.deepEqual(calls, ['start'])
  assert.equal(result.success, true)
  assert.equal(result.inspection.service.status, 'running')
  assert.equal(result.inspection.api.status, 'available')
})

test('stop remains successful when the service is stopped even though its API is unavailable', async () => {
  const result = await runServiceControl('stop', 'op-stop', {
    platform: 'win32', control: async () => ({ success: true, errorCode: null, message: 'SCM stop completed.' }),
    inspect: async () => inspection('stopped', 'unavailable'), failedInspection: () => inspection('unknown', 'unknown'),
  })
  assert.equal(result.success, true)
  assert.equal(result.inspection.service.status, 'stopped')
  assert.equal(result.inspection.api.status, 'unavailable')
})

test('a running service with an unavailable API is reported as an operation failure', async () => {
  const result = await runServiceControl('restart', 'op-restart', {
    platform: 'win32', control: async () => ({ success: true, errorCode: null, message: 'SCM restart completed.' }),
    inspect: async () => inspection('running', 'unavailable'), failedInspection: () => inspection('unknown', 'unknown'),
  })
  assert.equal(result.success, false)
  assert.equal(result.errorCode, 'API_UNAVAILABLE')
  assert.equal(result.inspection.service.status, 'running')
})

test('missing service and control permission failures remain distinct', async () => {
  const missing = await runServiceControl('start', 'op-missing', {
    platform: 'win32', control: async () => ({ success: false, errorCode: 'SERVICE_NOT_INSTALLED', message: 'Службу не встановлено.' }),
    inspect: async () => inspection('missing', 'not_configured'), failedInspection: () => inspection('unknown', 'unknown'),
  })
  assert.equal(missing.errorCode, 'SERVICE_NOT_INSTALLED')
  const denied = await runServiceControl('stop', 'op-denied', {
    platform: 'win32', control: async () => ({ success: false, errorCode: 'SERVICE_ACCESS_DENIED', message: 'Запустіть Server Manager від імені адміністратора.' }),
    inspect: async () => inspection('running', 'available'), failedInspection: () => inspection('unknown', 'unknown'),
  })
  assert.equal(denied.errorCode, 'SERVICE_ACCESS_DENIED')
  assert.equal(denied.inspection.service.status, 'running')
})

test('service IPC accepts only trusted fixed operations and serializes concurrent requests', async () => {
  let release
  let calls = 0
  const gate = new Promise(resolve => { release = resolve })
  const handler = createServiceControlRequestHandler(async (operation, operationId) => {
    calls++
    await gate
    return { operationId, operation, success: true, errorCode: null, message: 'Done.', inspection: inspection() }
  }, event => event === 'trusted', () => false, (() => { let id = 0; return () => `op-${++id}` })(), () => inspection())
  const first = handler('trusted', 'start')
  const concurrent = await handler('trusted', 'stop')
  assert.equal(concurrent.success, false)
  assert.equal(concurrent.errorCode, 'SERVICE_OPERATION_BUSY')
  assert.equal(calls, 1)
  release()
  assert.equal((await first).success, true)
  await assert.rejects(handler('untrusted', 'start'), /UNTRUSTED_RENDERER/)
  const invalid = await handler('trusted', 'arbitrary-command')
  assert.equal(invalid.errorCode, 'SERVICE_OPERATION_INVALID')
})

test('Windows adapter uses fixed SCM service actions, waits for state and never force-kills the service', () => {
  const start = serviceControlScript('start')
  const stop = serviceControlScript('stop')
  const restart = serviceControlScript('restart')
  for (const script of [start, stop, restart]) {
    assert.match(script, /HromadaAIDApi/)
    assert.match(script, /WaitForStatus/)
    assert.doesNotMatch(script, /Stop-Service[^\r\n]*-Force|taskkill|Stop-Process/)
  }
  assert.match(start, /Start-Service/)
  assert.match(stop, /Stop-Service/)
  assert.match(restart, /\$operation = 'restart'/)
  assert.match(stop, /Stop-Service -Name \$serviceName -ErrorAction Stop/)
  assert.match(stop, /NoServiceFoundForGivenName/)
  assert.match(stop, /SERVICE_ACCESS_DENIED/)
  assert.throws(() => serviceControlScript('arbitrary-command'), /SERVICE_OPERATION_INVALID/)
})

test('SCM PowerShell scripts parse with Windows PowerShell 5.1 without executing service operations', { skip: !existsSync(`${process.env.SystemRoot || 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`) }, () => {
  const powershell = `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
  for (const operation of ['start', 'stop', 'restart']) {
    const source = Buffer.from(serviceControlScript(operation), 'utf8').toString('base64')
    const parser = `$source=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${source}'));$tokens=$null;$errors=$null;[void][Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors);if($errors.Count){$errors|ForEach-Object{[Console]::Error.WriteLine($_.Message)};exit 1}`
    const result = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(parser, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true, timeout: 15_000 })
    assert.equal(result.error, undefined, result.error?.message)
    assert.equal(result.status, 0, result.stderr || result.stdout)
  }
})
