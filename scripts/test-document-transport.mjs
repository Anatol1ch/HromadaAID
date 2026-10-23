import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const profile = await mkdtemp(join(tmpdir(), 'hromada-document-transport-'))
const handlers = new Map()
globalThis.__syntheticDocumentProfile = profile
globalThis.__syntheticDocumentHandlers = handlers
const fakeElectron = 'data:text/javascript,' + encodeURIComponent(`export const app={getPath:()=>globalThis.__syntheticDocumentProfile};export const BrowserWindow={fromWebContents:()=>null};export const dialog={showSaveDialog:async()=>({canceled:true})}`)
const fakeIpc = 'data:text/javascript,' + encodeURIComponent(`export const trustedIpcMain={handle:(channel,handler)=>globalThis.__syntheticDocumentHandlers.set(channel,handler)}`)
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'electron') return next(fakeElectron, context)
  if (specifier === './ipc-security.js') return next(fakeIpc, context)
  return next(specifier, context)
} })
let statements, reports
try {
  statements = await import('../dist-electron/electron/statements-ipc.js')
  reports = await import('../dist-electron/electron/report-export-ipc.js')
  let reads = 0, bankReads = 0
  statements.registerStatementsIpc({ readRows: async () => { reads += 1; return [] }, readBankRows: async () => { bankReads += 1; return [] } })
  reports.registerReportExportIpc()
  for (const channel of ['statements:generate', 'statements:generate-bank', 'statements:save', 'statements:save-pdf', 'reports:generate', 'reports:save-pdf', 'reports:save-excel', 'reports:release']) assert.equal(typeof handlers.get(channel), 'function')
  assert.equal(handlers.has('statements:list'), false) // List reads belong to the main HTTP adapter.
  const personal = await handlers.get('statements:generate')({}, 'personal', ['synthetic'], 2026, [])
  const bank = await handlers.get('statements:generate-bank')({}, ['synthetic'], 2026)
  assert.equal(personal.ok, false); assert.equal(bank.ok, false)
  assert.equal(reads, 1); assert.equal(bankReads, 1)
  assert.equal((await handlers.get('statements:save')({}, 'unknown')).ok, false)
  assert.equal((await handlers.get('statements:save-pdf')({}, 'unknown')).ok, false)
  statements.registerStatementsIpc({ readRows: async () => { throw new Error('synthetic transport failure') }, readBankRows: async () => [] })
  await assert.rejects(handlers.get('statements:generate')({}, 'personal', ['synthetic'], 2026, []), /synthetic transport failure/)
  console.log('PASS document IPC registration, mandatory snapshot source, no SQL fallback and preserved export handlers (headless; Excel COM not run)')
} finally {
  await statements?.cleanupGeneratedStatements()
  await reports?.cleanupGeneratedReports()
  hooks.deregister()
  delete globalThis.__syntheticDocumentProfile
  delete globalThis.__syntheticDocumentHandlers
  assert.equal(dirname(profile), resolve(tmpdir()))
  await rm(profile, { recursive: true, force: true })
}
