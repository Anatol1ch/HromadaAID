import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { openTestDatabase } from './fakes/database.mjs'
import { readStatementRows } from '../electron/statement-data.ts'
import { listStatementAssignments } from '../electron/statement-list-data.ts'
import { statementPlan } from '../shared/statement-parameters.ts'
import { createApp } from '../server/src/app.ts'
import { createFirstAdministrator } from '../server/src/auth.ts'
import { isStatementListResult } from '../shared/api-contract.ts'

test('bank-aware IPC generation uses fresh server snapshots and rolls back failed file packages without financial writes', async t => {
  const root = mkdtempSync(join(tmpdir(), 'hromada-bank-generation-')), profile = join(root, 'profile')
  mkdirSync(profile)
  const handlers = new Map(), dialogs = [], calls = []
  globalThis.__bankGenerationTest = { handlers, profile, root, dialogs }
  const fakeElectron = 'data:text/javascript,' + encodeURIComponent("export const app={getPath:name=>name==='logs'?globalThis.__bankGenerationTest.root:globalThis.__bankGenerationTest.profile};export const dialog={showSaveDialog:async options=>{globalThis.__bankGenerationTest.dialogs.push(options);return {canceled:true}}}")
  const fakeSecurity = 'data:text/javascript,' + encodeURIComponent('export const trustedIpcMain={handle:(name,handler)=>globalThis.__bankGenerationTest.handlers.set(name,handler)}')
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier === 'electron') return { url: fakeElectron, shortCircuit: true }
    if (specifier === './ipc-security.js') return { url: fakeSecurity, shortCircuit: true }
    return next(specifier, context)
  } })
  const db = openTestDatabase(root)
  let server, cleanup
  t.after(async () => {
    await cleanup?.(); await server?.close(); db.close(); hooks.deregister(); delete globalThis.__bankGenerationTest
    assert.equal(dirname(resolve(root)), resolve(tmpdir())); rmSync(root, { recursive: true, force: true })
  })
  const stamp = '2026-10-01T00:00:00Z'
  for (const id of ['bankA', 'bankB']) db.prepare('INSERT INTO banks(id,name) VALUES(?,?)').run(id, 'Синтетичний банк')
  for (const [id, bank, mfo] of [['a1', 'bankA', '000001'], ['a2', 'bankA', '000002'], ['b1', 'bankB', '000003']]) db.prepare('INSERT INTO bank_details(id,bank_id,mfo,edrpou) VALUES(?,?,?,?)').run(id, bank, mfo, '00000001')
  for (const [id, detail, rnokpp] of [['p1', 'a1', '0000000001'], ['p2', 'a2', '0000000002'], ['p3', 'b1', '0000000003']]) {
    db.prepare('INSERT INTO recipients(id,last_name,first_name,patronymic,rnokpp,passport,address,registered_address,bank_details_id,bank_account,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id, 'Вигаданий', 'Тестовий', 'Приклад', rnokpp, 'ТТ000001', 'Застаріла адреса проживання', 'Синтетична адреса реєстрації', detail, 'UA000000000000000000000000001', stamp, stamp)
  }
  db.prepare("UPDATE recipients SET residence_settlement_name='Структуроване проживання' WHERE id='p1'").run()
  db.prepare("UPDATE recipients SET address='Застаріле проживання p2' WHERE id='p2'").run()
  db.prepare("UPDATE recipients SET address='Застаріле проживання p3' WHERE id='p3'").run()
  db.prepare('INSERT INTO decisions(id,decision_number,decision_date,created_at,updated_at) VALUES(?,?,?,?,?)').run('decision', 'TEST', '2026-01-01', stamp, stamp)
  const aids = db.prepare('SELECT id FROM aid_types ORDER BY id LIMIT 2').all().map(row => row.id)
  for (let i = 0; i < 16; i++) db.prepare('INSERT INTO assignments(id,recipient_id,decision_id,aid_type_id,amount_minor,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run('item' + String(i).padStart(2, '0'), i < 13 ? 'p1' : i < 15 ? 'p2' : 'p3', 'decision', i < 13 || i === 15 ? aids[0] : aids[1], i < 13 ? 101 : i < 15 ? 202 : 303, ['Призначено', 'В роботі', 'Передано до казначейства'][i % 3], stamp, stamp)
  await createFirstAdministrator(db, { username: 'synthetic-admin', password: 'synthetic test password' })
  server = createApp(db); server.log.level = 'silent'
  const health = await server.inject({ url: '/health' })
  assert.equal(health.json().apiContractVersion, 1)
  const login = await server.inject({ method: 'POST', url: '/auth/login', payload: { username: 'synthetic-admin', password: 'synthetic test password' } })
  assert.equal(login.statusCode, 200)
  const headers = { authorization: 'Bearer ' + login.json().token }
  let transform = rows => rows, failAt = 0
  const read = async (endpoint, ids, year) => {
    const response = await server.inject({ method: 'POST', url: endpoint, headers, payload: { ids, year: Number(year) } })
    if (response.statusCode !== 200) throw new Error('snapshot unavailable')
    return transform(response.json())
  }
  const module = await import('../dist-electron/electron/statements-ipc.js')
  cleanup = module.cleanupGeneratedStatements
  module.registerStatementsIpc({ readRows: (ids, year) => read('/api/statements/snapshot', ids, year), readBankRows: (ids, year) => read('/api/statements/bank-snapshot', ids, year) }, async (_script, payload) => {
    calls.push(payload)
    if (failAt && calls.length === failAt) throw new Error('synthetic worker failure')
    if (payload.excelPath) writeFileSync(payload.excelPath, 'synthetic Excel output')
    if (payload.pdfPath) writeFileSync(payload.pdfPath, '%PDF synthetic output')
  })
  const listed = await server.inject({ url: '/api/statements?year=2026', headers })
  assert.equal(listed.statusCode, 200); assert.ok(isStatementListResult(listed.json()))
  const initialRows = listed.json().assignments, ids = initialRows.map(row => row.id)
  const actualSnapshot = await server.inject({ method: 'POST', url: '/api/statements/snapshot', headers, payload: { ids, year: 2026 } })
  assert.equal(actualSnapshot.statusCode, 200)
  assert.match(actualSnapshot.json().find(row => row.id === 'item00').residence_address, /Структуроване проживання/)
  assert.equal(actualSnapshot.json().find(row => row.id === 'item13').residence_address, 'Застаріле проживання p2')
  assert.notEqual(actualSnapshot.json().find(row => row.id === 'item00').residence_address, actualSnapshot.json().find(row => row.id === 'item00').registered_address)
  assert.deepEqual(new Set(initialRows.map(row => row.bankId)), new Set(['bankA', 'bankB']))
  assert.equal(listStatementAssignments(db, 2026).assignments.length, 16)
  const selection = initialRows.map(({ id, aidTypeId, bankId }) => ({ id, aidTypeId, bankId }))
  const params = kind => statementPlan(kind, initialRows).map((item, index) => ({ ...item, documentNumber: '00' + index, documentDate: '2028-02-29', periodStart: '2025-01-01', periodEnd: '2025-12-31' }))
  const call = (channel, ...args) => handlers.get(channel)({}, ...args)
  const generate = (kind, extraIds = ids, expected = selection, year = 2026, parameters = kind === 'bank' ? [] : params(kind)) => kind === 'bank' ? call('statements:generate-bank', extraIds, year, expected) : call('statements:generate', kind, extraIds, year, parameters, expected)
  const tables = ['assignments', 'decisions', 'recipients', 'banks', 'bank_details', ...(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='payouts'").get() ? ['payouts'] : [])]
  const financialState = () => JSON.stringify(tables.map(table => [table, db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()]))
  const jobNames = () => readdirSync(join(profile, 'generated-documents-temp')).filter(name => !name.startsWith('.')).sort()
  const saved = []

  await t.test('three generators preserve rows, cents, per-bank separation and all financial data', async () => {
    for (const kind of ['personal', 'summary', 'bank']) {
      const before = financialState(); calls.length = 0
      const result = await generate(kind, [...ids, ids[0]])
      assert.equal(result.ok, true, result.message)
      assert.equal(result.documents.length, kind === 'personal' ? 4 : kind === 'summary' ? 3 : 2)
      assert.equal(result.documents.reduce((sum, doc) => sum + doc.recordCount, 0), 16)
      assert.equal(result.documents.reduce((sum, doc) => sum + doc.totalMinor, 0), 2020)
      assert.equal(new Set(result.documents.map(doc => doc.fileName.toLocaleLowerCase('uk'))).size, result.documents.length)
      if (kind === 'bank') assert.deepEqual(result.documents.map(doc => [doc.bankId, doc.recordCount, doc.totalMinor]), [['bankA', 15, 1717], ['bankB', 1, 303]])
      if (kind === 'personal') {
        assert.deepEqual(calls.flatMap(payload => payload.records).map(row => row.amount).sort((a,b) => a-b), [...Array(13).fill(1.01), 2.02, 2.02, 3.03])
        const addresses = calls.flatMap(payload => payload.records).map(row => row.residenceAddress)
        assert.ok(addresses.includes('Структуроване проживання'))
        assert.ok(addresses.includes('Застаріле проживання p2'))
        assert.ok(addresses.includes('Застаріле проживання p3'))
        assert.ok(calls.every(payload => payload.records.every(row => !('registeredAddress' in row))))
      }
      if (kind === 'summary') assert.ok(calls.every(payload => payload.daily[0].dateDisplay === '29.02.2028' && payload.periodText.includes('01.01.2025')))
      assert.equal(financialState(), before)
      saved.push(...result.documents)
    }
  })
  await t.test('new snapshots supply changed amounts without taking totals from UI', async () => {
    db.prepare('UPDATE assignments SET amount_minor=555 WHERE id=?').run('item00')
    const before = financialState(), result = await generate('bank')
    assert.equal(result.ok, true, result.message); assert.equal(result.documents.reduce((sum, doc) => sum + doc.totalMinor, 0), 2474)
    assert.equal(financialState(), before)
    db.prepare('UPDATE assignments SET amount_minor=101 WHERE id=?').run('item00')
  })
  await t.test('changed bank, swapped aids, missing IDs, wrong year and status fail before worker', async () => {
    const reject = async () => {
      for (const kind of ['personal', 'summary', 'bank']) {
        const before = financialState(); calls.length = 0
        const result = await generate(kind)
        assert.equal(result.ok, false); assert.match(result.message, /Оновіть|оновіть/)
        assert.equal(calls.length, 0); assert.equal(financialState(), before)
      }
    }
    db.prepare("UPDATE recipients SET bank_details_id='b1' WHERE id='p1'").run(); await reject()
    db.prepare("UPDATE recipients SET bank_details_id='a1' WHERE id='p1'").run()
    db.prepare('UPDATE assignments SET aid_type_id=? WHERE id=?').run(aids[1], 'item00')
    db.prepare('UPDATE assignments SET aid_type_id=? WHERE id=?').run(aids[0], 'item13'); await reject()
    db.prepare('UPDATE assignments SET aid_type_id=? WHERE id=?').run(aids[0], 'item00')
    db.prepare('UPDATE assignments SET aid_type_id=? WHERE id=?').run(aids[1], 'item13')
    db.prepare("UPDATE assignments SET status='Виплачено',paid_on='2026-10-30' WHERE id='item00'").run(); await reject()
    db.prepare("UPDATE assignments SET status='Призначено',paid_on=NULL WHERE id='item00'").run()
    for (const kind of ['personal', 'summary', 'bank']) {
      calls.length = 0
      assert.equal((await generate(kind, ids, selection, 2025)).ok, false)
      assert.equal((await generate(kind, [...ids, 'missing'], [...selection, { id: 'missing', aidTypeId: aids[0], bankId: 'bankA' }])).ok, false)
      assert.equal(calls.length, 0)
    }
  })
  await t.test('missing banks, required details and duplicate snapshot IDs cannot silently drop records', async () => {
    for (const kind of ['personal', 'summary', 'bank']) {
      for (const field of ['bank_id', ...(kind === 'bank' ? ['rnokpp', 'bank_account'] : kind === 'personal' ? ['bank_mfo', 'bank_edrpou', 'bank_account', 'rnokpp', 'passport'] : ['bank_mfo', 'bank_edrpou'])]) {
        calls.length = 0; transform = rows => rows.map((row, i) => i === 0 ? { ...row, [field]: null } : row)
        const result = await generate(kind)
        assert.equal(result.ok, false, kind + ':' + field); assert.equal(calls.length, 0)
      }
      transform = rows => rows.map((row, i) => i === 1 ? rows[0] : row)
      assert.equal((await generate(kind)).ok, false)
    }
    transform = rows => rows
  })
  await t.test('personal statement requires residence address, accepts legacy residence text and ignores registration address', async () => {
    const rows = readStatementRows(db, ids, '2026')
    assert.match(rows.find(row => row.id === 'item00').residence_address, /Структуроване проживання/)
    assert.equal(rows.find(row => row.id === 'item13').residence_address, 'Застаріле проживання p2')
    db.prepare("UPDATE recipients SET registered_address=NULL,registration_postal_code=NULL,registration_region=NULL,registration_district=NULL,registration_settlement_type=NULL,registration_settlement_name=NULL,registration_street_type=NULL,registration_custom_street_type=NULL,registration_street_name=NULL,registration_building=NULL,registration_apartment=NULL WHERE id='p1'").run()
    calls.length = 0
    assert.equal((await generate('personal')).ok, true)
    assert.match(calls[0].records[0].residenceAddress, /Структуроване проживання/)
    const jobs = jobNames(); calls.length = 0
    transform = rows => rows.map(({ residence_address, ...row }) => row)
    const oldServerResult = await generate('personal')
    assert.equal(oldServerResult.ok, false)
    assert.match(oldServerResult.message, /snapshot без поля адреси проживання.*сумісність API Server із Client/i)
    assert.equal(calls.length, 0); assert.deepEqual(jobNames(), jobs)
    transform = rows => rows.map((row, index) => index === 0 ? { ...row, residence_address: null } : row)
    const result = await generate('personal')
    assert.equal(result.ok, false)
    assert.match(result.message, /адресу проживання у картці отримувача/i)
    assert.equal(calls.length, 0)
    assert.deepEqual(jobNames(), jobs)
    transform = rows => rows
  })
  await t.test('personal filename collisions are rejected before creating files', async () => {
    calls.length = 0; const jobs = jobNames()
    const result = await generate('personal', ids, selection, 2026, params('personal').map(value => ({ ...value, documentNumber: 'same' })))
    assert.equal(result.ok, false); assert.match(result.message, /різні номери/)
    assert.equal(calls.length, 0); assert.deepEqual(jobNames(), jobs)
  })
  await t.test('second-file failures discard the whole package and retain previous independent results', async () => {
    for (const kind of ['personal', 'summary', 'bank']) {
      calls.length = 0; failAt = 2; const before = financialState(), jobs = jobNames()
      const result = await generate(kind)
      assert.equal(result.ok, false); assert.equal('documents' in result, false); assert.equal(calls.length, 2)
      assert.deepEqual(jobNames(), jobs); assert.equal(financialState(), before)
      if (kind === 'bank') {
        const id = /bank_([0-9a-f-]+)\.xlsx$/.exec(calls[0].templatePath)[1]
        const count = dialogs.length
        assert.equal((await call('statements:save', id)).ok, false); assert.equal(dialogs.length, count)
      }
    }
    failAt = 0
    await call('statements:save', saved[0].id)
    assert.ok(dialogs.at(-1).properties.includes('showOverwriteConfirmation'))
    assert.equal(dialogs.at(-1).defaultPath.endsWith('.xls'), true)
  })
  assert.equal(readStatementRows(db, ids, '2026').length, 16)
})
