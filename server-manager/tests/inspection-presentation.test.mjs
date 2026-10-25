import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../src/inspection-presentation.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
const { apiDisplay, diagnosticLevel, inspectionFeedback, installationDisplay, notCheckedState, serviceDisplay } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)

test('manual inspection feedback distinguishes success, unavailable API, stopped service and unknown installation', () => {
  const state = { installation: { status: 'installed', message: 'Installed' }, service: { status: 'running', message: 'Running' }, api: { status: 'available', message: 'Healthy' } }
  assert.equal(inspectionFeedback(state).tone, 'success')
  assert.match(inspectionFeedback({ ...state, api: { status: 'unavailable', message: 'Timeout' } }).message, /API недоступний/)
  assert.equal(inspectionFeedback({ ...state, api: { status: 'unavailable', message: 'Timeout' } }).tone, 'error')
  assert.equal(inspectionFeedback({ ...state, service: { status: 'stopped' } }).tone, 'info')
  assert.equal(inspectionFeedback({ ...state, installation: { status: 'unknown', message: 'Access denied' } }).tone, 'error')
  assert.equal(inspectionFeedback({ ...state, installation: { status: 'not_installed' } }).tone, 'info')
})

test('unstarted inspection uses neutral information states for installation, service and API', () => {
  assert.deepEqual(notCheckedState(), { label: 'Не перевірено', tone: 'info' })
  assert.deepEqual(notCheckedState(true), { label: 'Перевіряється…', tone: 'info' })
  assert.deepEqual(installationDisplay(null), { label: 'Не перевірено', tone: 'info' })
  assert.deepEqual(serviceDisplay(null), { label: 'Не перевірено', tone: 'info' })
  assert.deepEqual(apiDisplay(null), { label: 'Не перевірено', tone: 'info' })
})

test('all expected missing components are informational only when installation is confirmed absent', () => {
  const checks = [
    { id: 'service', status: 'warning' },
    { id: 'configuration', status: 'warning' },
    { id: 'package', status: 'warning' },
    { id: 'installation', status: 'warning' },
  ]
  assert.deepEqual(checks.map(check => diagnosticLevel(check, 'not_installed')), ['info', 'info', 'info', 'info'])
  assert.equal(diagnosticLevel({ id: 'api', status: 'warning' }, 'not_installed'), 'warning')
  assert.equal(diagnosticLevel({ id: 'api', status: 'not_checked' }, 'not_installed'), 'info')
  assert.deepEqual(installationDisplay('not_installed'), { label: 'Не встановлено', tone: 'info' })
  assert.deepEqual(serviceDisplay('missing'), { label: 'Не встановлена', tone: 'info' })
  assert.deepEqual(apiDisplay('not_configured'), { label: 'Не визначено', tone: 'info' })
})

test('partial installation retains warnings and failures, and unknown inspection remains a warning', () => {
  assert.equal(diagnosticLevel({ id: 'service', status: 'warning' }, 'partial_installation'), 'warning')
  assert.equal(diagnosticLevel({ id: 'configuration', status: 'failed' }, 'partial_installation'), 'error')
  assert.equal(diagnosticLevel({ id: 'service', status: 'unknown' }, 'unknown'), 'warning')
  assert.deepEqual(installationDisplay('partial_installation'), { label: 'Частково встановлено', tone: 'warning' })
  assert.deepEqual(installationDisplay('unknown'), { label: 'Невідомо', tone: 'warning' })
  assert.deepEqual(serviceDisplay('unknown'), { label: 'Невідомо', tone: 'warning' })
})

test('verified staged package is presented as ready for initial setup without treating SCM errors as absence', () => {
  const ready = { status: 'ready_to_configure', message: 'Сервер готовий до початкового налаштування.' }
  assert.deepEqual(installationDisplay(ready.status), { label: 'Готовий до налаштування', tone: 'info' })
  assert.equal(inspectionFeedback({ installation: ready, service: { status: 'missing' }, api: { status: 'not_configured' } }).tone, 'info')
  assert.equal(diagnosticLevel({ id: 'service', status: 'warning' }, ready.status), 'info')
  assert.equal(diagnosticLevel({ id: 'service', status: 'unknown' }, 'unknown'), 'warning')
})
