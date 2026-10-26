import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { spawn } from 'node:child_process'
import ts from 'typescript'

async function load(name) {
  const source = readFileSync(new URL(`../electron/${name}.ts`, import.meta.url), 'utf8')
  return import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText).toString('base64')}`)
}
const { monitorChild, terminateProcessTree } = await load('managed-child')
const { createExclusiveOperation } = await load('exclusive-operation')
const { assertRecoveryApiPermission, assertWindowsRecoveryAdministrator } = await load('recovery-authorization')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
function fakeChild() { return Object.assign(new EventEmitter(), { pid: 12345, stdout: new PassThrough(), stderr: new PassThrough() }) }

test('recovery requires Windows administrator and current online backup authority, with no password-change bypass', () => {
  assert.throws(() => assertWindowsRecoveryAdministrator(false), /адміністратора Windows/)
  assert.doesNotThrow(() => assertWindowsRecoveryAdministrator(true))
  for (const user of [null, {}, { permissions: ['users.manage'], mustChangePassword: false }, { permissions: ['backups.manage'], mustChangePassword: true }]) assert.throws(() => assertRecoveryApiPermission(user), /право керування/)
  assert.doesNotThrow(() => assertRecoveryApiPermission({ permissions: ['backups.manage'], mustChangePassword: false }))
})

test('timeout holds critical lock until process close AND tree termination, and can never report success', async () => {
  const child = fakeChild()
  let confirm, locked = false, complete = false
  const gate = createExclusiveOperation(() => false, value => { locked = value })
  const operation = gate(() => monitorChild(child, { timeoutMs: 10, terminateTree: () => new Promise(resolve => { confirm = resolve }) }))
  const rejected = assert.rejects(operation, /очікування вичерпано/).then(() => { complete = true })
  await wait(25)
  child.emit('close', 0)
  await wait(5)
  assert.equal(locked, true); assert.equal(complete, false)
  await assert.rejects(gate(async () => 'second restore'), /Зачекайте/)
  confirm(true); await rejected
  assert.equal(locked, false)
})

test('unconfirmed termination never releases the lock even when the root closes', async () => {
  const child = fakeChild()
  let locked = false, warning = false
  const gate = createExclusiveOperation(() => false, value => { locked = value })
  void gate(() => monitorChild(child, { timeoutMs: 10, terminateTree: async () => false, onTimeout: value => { warning ||= value } }))
  await wait(25); child.emit('close', 1); await wait(5)
  assert.equal(locked, true); assert.equal(warning, true)
  await assert.rejects(gate(async () => undefined), /Зачекайте/)
})

test('a failed progress notification cannot interrupt timeout termination', async () => {
  const child = fakeChild()
  const outcome = monitorChild(child, { timeoutMs: 10, terminateTree: async () => { child.emit('close', 0); return true }, onTimeout: () => { throw new Error('renderer closed') } })
  await assert.rejects(outcome, /очікування вичерпано/)
})

test('a real isolated Node process and Windows descendant terminate before timeout is returned', { skip: process.platform !== 'win32' }, async () => {
  const code = `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(child.pid);setInterval(()=>{},1000)`
  const child = spawn(process.execPath, ['-e', code], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  let descendant
  child.stdout.once('data', value => { descendant = Number(String(value).trim()) })
  await assert.rejects(monitorChild(child, { timeoutMs: 500, terminateTree: () => terminateProcessTree(child) }), /очікування вичерпано/)
  assert.ok(descendant > 0)
  assert.throws(() => process.kill(descendant, 0), /ESRCH/)
})

test('exclusive recovery rejects concurrent and external operations and releases after errors', async () => {
  let external = true, owned = false, finish
  const gate = createExclusiveOperation(() => external, value => { owned = value })
  await assert.rejects(gate(async () => {}), /Зачекайте/)
  external = false
  const first = gate(() => new Promise(resolve => { finish = resolve }))
  assert.equal(owned, true)
  await assert.rejects(gate(async () => {}), /Зачекайте/)
  finish(); await first
  await assert.rejects(gate(async () => { throw new Error('failure') }), /failure/)
  assert.equal(owned, false)
})
