import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../electron/operation-close-guard.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
const { createOperationCloseGuard } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

test('repeated window closes cannot bypass a critical operation while its warning is open', async () => {
  let busy = true, prevented = 0, warnings = 0, dismiss
  const close = createOperationCloseGuard(() => busy, () => { warnings++; return new Promise(resolve => { dismiss = resolve }) })
  const event = { preventDefault() { prevented++ } }
  close(event); close(event); close(event)
  assert.equal(prevented, 3)
  assert.equal(warnings, 1)
  dismiss(); await new Promise(resolve => setImmediate(resolve))
  close(event)
  assert.equal(prevented, 4)
  assert.equal(warnings, 2)
  busy = false
  close(event)
  assert.equal(prevented, 4, 'a completed operation must no longer block window closure')
  dismiss()
})

test('a failed warning does not release the operation close guard', async () => {
  let prevented = 0, warnings = 0
  const close = createOperationCloseGuard(() => true, async () => { warnings++; throw new Error('window message unavailable') })
  const event = { preventDefault() { prevented++ } }
  close(event)
  await new Promise(resolve => setImmediate(resolve))
  close(event)
  assert.equal(prevented, 2)
  assert.equal(warnings, 2)
})
