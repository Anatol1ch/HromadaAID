import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../src/demo.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
const { scenarios, sections, scenarioIds } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

test('six synthetic scenarios keep service/API independent and provide safe operation results', () => {
  assert.equal(scenarioIds.length, 6)
  assert.equal(scenarios.running.service, scenarios.unavailable.service)
  assert.notEqual(scenarios.running.api, scenarios.unavailable.api)
  assert.equal(scenarios.missing.installed, false)
  assert.equal(scenarios.interrupted.operation.retry.allowed, false)
  assert.equal(scenarios.configuration.operation.errorCode, 'DEMO_TLS_REQUIRED')
  for (const scenario of Object.values(scenarios)) {
    assert.match(scenario.operation.operationId, /^demo-/)
    assert.equal(typeof scenario.operation.requiresElevation, 'boolean')
    assert.equal(typeof scenario.operation.retry.reason, 'string')
    assert.equal(scenario.operation.status === 'failed', scenario.operation.errorCode !== null)
  }
  assert.deepEqual(sections.map(section => section.id), ['overview', 'configuration', 'diagnostics', 'updates'])
})

test('renderer remains isolated and main exposes only narrowly scoped inspection and installation IPC', () => {
  const main = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8')
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const contract = readFileSync(new URL('../../shared/installation-contract.ts', import.meta.url), 'utf8')
  for (const text of [main, app, source, contract]) assert.doesNotMatch(text, /from ['"][^'"]*(?:node:sqlite|server\/src|electron\/main|auth-session|http-client|backup-client)/)
  assert.doesNotMatch(app, /\b(?:fetch|execFile|spawn|ipcMain|ipcRenderer)\s*[.(]/)
  assert.doesNotMatch(source, /\b(?:fetch|execFile|spawn|ipcMain|ipcRenderer)\s*[.(]/)
  assert.match(main, /nodeIntegration: false/)
  assert.match(main, /sandbox: true/)
  assert.match(main, /contextIsolation: true/)
  assert.match(main, /preload:.*preload\.cjs/)
  assert.match(main, /manager:inspect-environment/)
  assert.match(main, /isTrustedRenderer/)
  assert.doesNotMatch(main, /ipcMain\.handle\([^,]+,\s*\([^)]*\)\s*=>\s*[^)]*exec/i)
  const preload = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8')
  assert.match(preload, /contextBridge\.exposeInMainWorld/)
  assert.match(preload, /inspectEnvironment:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('manager:inspect-environment'\)/)
  assert.doesNotMatch(preload, /send\(|execFile|spawn|require\((?!'electron'\))/)
  assert.match(preload, /installServer:\s*request\s*=>\s*ipcRenderer\.invoke\('manager:install-server', request\)/)
  assert.doesNotMatch(preload, /manager:execute|runCommand|execCommand|shell:/i)
  for (const channel of ['manager:select-install-directory', 'manager:install-server', 'manager:save-recovery-key', 'manager:confirm-recovery-key-saved', 'manager:cancel-recovery-key']) assert.match(main, new RegExp(`ipcMain\\.handle\\('${channel}'`))
  assert.match(main, /contextIsolation: true/)
  assert.match(main, /callback\(\{ cancel: !allowed \}\)/)
  assert.doesNotMatch(contract, /^import /m)
})

test('separate renderer build contains only manager pages and a dedicated main output', () => {
  const renderer = new URL('../../dist-server-manager/renderer/', import.meta.url)
  const html = readFileSync(new URL('index.html', renderer), 'utf8')
  assert.match(html, /HromadaAID Server Manager/)
  const assets = readdirSync(new URL('assets/', renderer)).filter(name => name.endsWith('.js'))
  assert.equal(assets.length, 1)
  const bundle = readFileSync(new URL(`assets/${assets[0]}`, renderer), 'utf8')
  assert.match(bundle, /Демонстраційний режим/)
  assert.doesNotMatch(bundle, /hromadaAid\.(?:auth|backups|recipients|connection)/)
  const main = readFileSync(new URL('../../dist-server-manager/main/main.js', import.meta.url), 'utf8')
  assert.match(main, /persist:server-manager/)
  assert.ok(readFileSync(new URL('../../dist-server-manager/main/installation-recovery.js', import.meta.url), 'utf8').includes('initial-install-needs-review'))
})
