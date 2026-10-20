import { testAddressInput } from './fakes/address.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import ts from 'typescript'
import { openAppDatabase } from '../electron/database.ts'
import { migrateAssignmentStatuses } from '../electron/migration-assignment-statuses.ts'
import { migrateBanks } from '../electron/migration-banks.ts'
import { registerBankIpc } from '../electron/bank-ipc.ts'
import { getBank, removeBank } from '../electron/bank-store.ts'
import { registerRecipientIpc } from '../electron/recipient-ipc.ts'
import { readStatementRows } from '../electron/statement-data.ts'
import { bankForDetail, bankSearchText, onlyBankDetail } from '../src/lib/bankSelection.ts'
import { handlers } from './fakes/ipc-security.mjs'

const stamp = '2026-10-01T10:00:00.000Z'
const pair = { mfo: '000001', edrpou: '00000001' }
const person = detailId => ({ lastName: 'Вигаданий', firstName: 'Приклад', patronymic: 'Тестович', rnokpp: '0000000001', passport: 'ТТ000001', sex: 'Чоловік', isVpo: false, ...testAddressInput(), phone: '', email: '', bankAccount: 'UA620000000000000000000000001', bankDetailsId: detailId })
function fixture(t, legacy = false) {
  const root = mkdtempSync(join(tmpdir(), 'hromada-aid-banks-test-'))
  const connections = []
  const open = () => { const db = openAppDatabase(root); connections.push(db); return db }
  const db = legacy ? new DatabaseSync(join(root, 'hromada-aid.sqlite')) : open()
  if (legacy) { connections.push(db); createV15(db) }
  t.after(() => {
    for (const connection of connections) try { connection.close() } catch {}
    assert.equal(dirname(resolve(root)), resolve(tmpdir()))
    assert(basename(root).startsWith('hromada-aid-banks-test-'))
    rmSync(resolve(root), { recursive: true, force: true })
  })
  const call = (channel, ...args) => {
    registerBankIpc(db); registerRecipientIpc(db)
    return handlers.get(channel)({}, ...args)
  }
  const bank = (details = [pair], name = 'Вигаданий банк') => {
    const result = call('banks:save', { name, details })
    assert.equal(result.ok, true, result.message)
    return result.bank
  }
  return { db, call, bank, open, root }
}
function createV15(db) {
  const ast = ts.createSourceFile('database.ts', readFileSync(new URL('../electron/database.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
  let migrations
  const visit = node => { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'migrations') migrations = node.initializer; ts.forEachChild(node, visit) }
  visit(ast)
  db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE')
  for (const item of migrations.elements) {
    const values = new Map(item.properties.map(property => [property.name.getText(ast), property.initializer]))
    const version = Number(values.get('version').text)
    if (version > 15) continue
    if (version === 15) migrateAssignmentStatuses(db)
    db.exec(values.get('sql').text)
    db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(version, stamp)
    db.exec(`PRAGMA user_version=${version}`)
  }
  db.exec('COMMIT')
}

test('Banks start empty; IPC creates single and multiple sets and searches every pair without losing zeros', t => {
  const { db, call, bank } = fixture(t)
  assert.deepEqual(call('banks:list'), [])
  const one = bank()
  const many = bank([pair, { mfo: '000002', edrpou: '00000002' }], 'Інший вигаданий банк')
  assert.equal(one.details.length, 1); assert.equal(many.details.length, 2)
  assert.equal(call('banks:list', 'ІНШИЙ')[0].id, many.id)
  assert.equal(call('banks:list', '000002')[0].id, many.id)
  assert.equal(call('banks:list', '00000002')[0].id, many.id)
  assert.equal(call('banks:list', "' OR 1=1 --").length, 0)
  assert.equal(call('banks:get', one.id).details[0].mfo, '000001')
  assert.equal(call('banks:details', many.id).length, 2)
  assert.throws(() => db.prepare('INSERT INTO bank_details(id,bank_id,mfo,edrpou) VALUES(?,?,?,?)').run('duplicate', one.id, pair.mfo, pair.edrpou), /UNIQUE/)
  assert.equal(db.prepare('SELECT typeof(mfo) AS m,typeof(edrpou) AS e FROM bank_details LIMIT 1').get().m, 'text')
  assert.equal(db.prepare('SELECT typeof(mfo) AS m,typeof(edrpou) AS e FROM bank_details LIMIT 1').get().e, 'text')
})

test('Bank validation rejects missing, partial, duplicate and non-text details with no writes', t => {
  const { call } = fixture(t)
  for (const input of [null, {}, { name: ' ', details: [pair] }, { name: 'Банк', details: [] }, { name: 'Банк', details: [{ mfo: '000001', edrpou: ' ' }] }, { name: 'Банк', details: [{ ...pair, mfo: 1 }] }, { name: 'Банк', details: [pair, { ...pair, mfo: ' 000001 ' }] }]) {
    assert.equal(call('banks:save', input).ok, false)
    assert.equal(call('banks:list').length, 0)
  }
})

test('Saved banks survive reopening and deleted banks are never seeded back', t => {
  const { db, bank, open } = fixture(t)
  const created = bank([pair, { mfo: '000002', edrpou: '00000002' }])
  db.close()
  const reopened = open()
  assert.deepEqual(getBank(reopened, created.id), created)
  assert.equal(removeBank(reopened, created.id).ok, true)
  reopened.close()
  const again = open()
  assert.equal(getBank(again, created.id), null)
  assert.equal(again.prepare('SELECT count(*) AS n FROM banks').get().n, 0)
})

test('Bank selection restores the saved set; only a unique pair is automatically selected', t => {
  const { bank } = fixture(t)
  const one = bank()
  const many = bank([pair, { mfo: '000002', edrpou: '00000002' }], 'Інший банк')
  assert.equal(onlyBankDetail(one), one.details[0].id)
  assert.equal(onlyBankDetail(many), '')
  assert.equal(onlyBankDetail(undefined), '')
  assert.equal(bankForDetail([one, many], many.details[1].id).id, many.id)
  assert.equal(bankForDetail([one, many], 'missing'), undefined)
  assert(bankSearchText(many).includes('000002 00000002'))
  // Switching from a selected single pair to a multiple-set bank clears the old choice.
  let selected = onlyBankDetail(one)
  selected = onlyBankDetail(many)
  assert.equal(selected, '')
})

test('Recipient IPC requires an existing set; bank edits propagate through JOIN without changing IBAN', t => {
  const { db, call, bank } = fixture(t)
  const created = bank([pair, { mfo: '000002', edrpou: '00000002' }])
  assert.equal(call('recipients:save', person('')).reason, 'validation')
  assert.equal(call('recipients:save', person('missing')).reason, 'validation')
  const input = person(created.details[1].id)
  const saved = call('recipients:save', { ...input, bankName: 'Підроблена назва', bankMfo: '999999' })
  assert.equal(saved.ok, true)
  assert.equal(saved.recipient.bankName, created.name)
  assert.equal(saved.recipient.bankMfo, '000002')
  assert.equal(saved.recipient.bankEdrpou, '00000002')
  assert.equal(call('banks:get', created.id).recipientCount, 1)
  assert.equal(call('banks:details', created.id)[1].recipientCount, 1)
  const edit = { name: 'Перейменований вигаданий банк', details: created.details.map(detail => ({ ...detail, ...(detail.id === input.bankDetailsId ? { mfo: '000009', edrpou: '00000009' } : {}) })) }
  assert.equal(call('banks:save', edit, created.id).ok, true)
  const reopened = call('recipients:get', saved.recipient.id)
  assert.equal(reopened.bankName, edit.name); assert.equal(reopened.bankMfo, '000009'); assert.equal(reopened.bankEdrpou, '00000009')
  assert.equal(reopened.bankDetailsId, input.bankDetailsId); assert.equal(reopened.bankAccount, input.bankAccount)
  const fields = db.prepare('PRAGMA table_info(recipients)').all().map(column => column.name)
  assert(fields.includes('bank_details_id'))
  for (const old of ['bank_name', 'bank_mfo', 'bank_edrpou']) assert(!fields.includes(old))
})

test('Used bank and used pair cannot be deleted through IPC or SQL; unused removals are permanent', t => {
  const { db, call, bank } = fixture(t)
  const used = bank([pair, { mfo: '000002', edrpou: '00000002' }])
  assert.equal(call('recipients:save', person(used.details[0].id)).ok, true)
  assert.equal(call('banks:remove', used.id).ok, false)
  assert.equal(call('banks:save', { name: 'Нова назва', details: [used.details[1]] }, used.id).ok, false)
  assert.equal(call('banks:get', used.id).name, used.name)
  assert.throws(() => db.prepare('DELETE FROM bank_details WHERE id=?').run(used.details[0].id), /FOREIGN KEY/)
  assert.throws(() => db.prepare('DELETE FROM banks WHERE id=?').run(used.id), /FOREIGN KEY/)
  assert.equal(call('banks:save', { name: used.name, details: [used.details[0]] }, used.id).ok, true)
  assert.equal(call('banks:details', used.id).length, 1)
  assert.equal(call('banks:save', { name: used.name, details: [] }, used.id).ok, false)
  const unused = bank([pair], 'Невикористовуваний банк')
  assert.equal(call('banks:remove', unused.id).ok, true)
  assert.equal(call('banks:get', unused.id), null)
  assert.equal(db.prepare('SELECT count(*) AS n FROM bank_details WHERE bank_id=?').get(unused.id).n, 0)
})

test('Creation and editing roll back every change on a failed detail; foreign IDs and duplicates are rejected', t => {
  const { db, call, bank } = fixture(t)
  const first = bank([pair, { mfo: '000002', edrpou: '00000002' }])
  const other = bank([pair], 'Інший банк')
  assert.equal(call('banks:save', { name: first.name, details: [other.details[0]] }, first.id).ok, false)
  assert.equal(call('banks:save', { name: first.name, details: [first.details[0], first.details[0]] }, first.id).ok, false)
  db.exec("CREATE TRIGGER reject_test_pair BEFORE INSERT ON bank_details WHEN NEW.mfo='BLOCK' BEGIN SELECT RAISE(ABORT,'synthetic'); END;")
  const snapshot = JSON.stringify(call('banks:list'))
  assert.equal(call('banks:save', { name: 'Не зберегти', details: [pair, { mfo: 'BLOCK', edrpou: '00000003' }] }).ok, false)
  assert.equal(JSON.stringify(call('banks:list')), snapshot)
  assert.equal(call('banks:save', { name: 'Не перейменувати', details: [{ ...first.details[0], mfo: '123456' }, { mfo: 'BLOCK', edrpou: '00000003' }] }, first.id).ok, false)
  assert.equal(JSON.stringify(call('banks:list')), snapshot)
  const swapped = first.details.map((detail, index) => ({ ...detail, mfo: first.details[1 - index].mfo, edrpou: first.details[1 - index].edrpou }))
  assert.equal(call('banks:save', { name: first.name, details: swapped }, first.id).ok, true)
  assert.equal(call('banks:get', first.id).details[0].mfo, first.details[1].mfo)
})

test('A failure while deleting the bank rolls back removal of all its detail sets', t => {
  const { db, call, bank } = fixture(t)
  const created = bank([pair, { mfo: '000002', edrpou: '00000002' }])
  db.exec("CREATE TRIGGER reject_bank_delete BEFORE DELETE ON banks BEGIN SELECT RAISE(ABORT,'synthetic delete failure'); END;")
  assert.equal(call('banks:remove', created.id).ok, false)
  assert.equal(call('banks:get', created.id).details.length, 2)
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0)
})

test('Document source resolves bank details, preserves zeros, year/status filters and grouping totals', t => {
  const { db, call, bank } = fixture(t)
  const created = bank()
  const recipient = call('recipients:save', person(created.details[0].id)).recipient
  const aidIds = db.prepare('SELECT id FROM aid_types LIMIT 2').all().map(row => row.id)
  db.prepare('INSERT INTO decisions(id,decision_number,decision_date,created_at,updated_at) VALUES(?,?,?,?,?)').run('test-d', 'ТЕСТ', '2027-01-01', stamp, stamp)
  for (const [id, amount, type, status] of [['a', 1000000, aidIds[0], 'Призначено'], ['b', 1500000, aidIds[0], 'В роботі'], ['c', 100, aidIds[1], 'Передано до казначейства'], ['paid', 200, aidIds[0], 'Виплачено']]) {
    db.prepare('INSERT INTO assignments(id,recipient_id,decision_id,aid_type_id,amount_minor,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id, recipient.id, 'test-d', type, amount, status, stamp, stamp)
  }
  const rows = readStatementRows(db, ['a', 'b', 'c', 'paid'], '2027')
  assert.equal(rows.length, 3)
  assert.equal(rows[0].bank_name, created.name); assert.equal(rows[0].bank_mfo, '000001'); assert.equal(rows[0].bank_edrpou, '00000001')
  assert.equal(rows[0].bank_account, person('').bankAccount)
  assert.equal(rows.filter(row => row.aid_type_id === aidIds[0]).reduce((sum, row) => sum + row.amount_minor, 0), 2500000)
  assert.equal(new Set(rows.map(row => row.aid_type_id)).size, 2)
  assert.equal(readStatementRows(db, ['a'], '2028').length, 0)
})

test('Migration 15 → 19 preserves full legacy sets, linked recipients, zeros and data after reopening', t => {
  const { db, open } = fixture(t, true)
  for (const id of ['one', 'two']) db.prepare('INSERT INTO recipients(id,last_name,first_name,bank_name,bank_mfo,bank_edrpou,bank_account,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id, 'Вигаданий', id, 'Синтетичний банк', '000001', '00000001', 'UA00001', stamp, stamp)
  db.close()
  const current = open()
  assert.equal(current.prepare('PRAGMA user_version').get().user_version, 19)
  assert.equal(current.prepare('SELECT count(*) AS n FROM banks').get().n, 1)
  assert.equal(current.prepare('SELECT count(*) AS n FROM bank_details').get().n, 1)
  const rows = current.prepare('SELECT r.id,r.bank_account,r.created_at,d.mfo,d.edrpou,b.name FROM recipients r JOIN bank_details d ON d.id=r.bank_details_id JOIN banks b ON b.id=d.bank_id').all()
  assert.equal(rows.length, 2)
  for (const row of rows) { assert.equal(row.mfo, '000001'); assert.equal(row.edrpou, '00000001'); assert.equal(row.bank_account, 'UA00001'); assert.equal(row.created_at, stamp) }
  assert.equal(current.prepare('PRAGMA foreign_key_check').all().length, 0)
  current.close()
  const again = open()
  assert.equal(again.prepare('SELECT count(*) AS n FROM bank_details').get().n, 1)
})

test('Partial legacy data stops initialization; a mid-migration failure rolls back new tables and columns', t => {
  const { db, open, root } = fixture(t, true)
  db.prepare('INSERT INTO recipients(id,last_name,first_name,bank_name,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('partial', 'Вигаданий', 'Тест', 'Неповний банк', stamp, stamp)
  db.close()
  assert.throws(open, /неповні старі реквізити/)
  const check = new DatabaseSync(join(root, 'hromada-aid.sqlite'))
  try {
    assert.equal(check.prepare('PRAGMA user_version').get().user_version, 15)
    assert.equal(check.prepare('SELECT bank_name FROM recipients').get().bank_name, 'Неповний банк')
    assert.equal(check.prepare("SELECT name FROM sqlite_schema WHERE name='banks'").get(), undefined)
    check.prepare('UPDATE recipients SET bank_name=NULL').run()
    check.exec('BEGIN IMMEDIATE')
    const exec = check.exec.bind(check)
    check.exec = sql => { exec(sql); if (sql.includes('DROP COLUMN bank_edrpou')) throw new Error('synthetic migration failure') }
    assert.throws(() => migrateBanks(check), /synthetic/)
    check.exec = exec; exec('ROLLBACK')
    assert(check.prepare('PRAGMA table_info(recipients)').all().some(column => column.name === 'bank_name'))
    assert.equal(check.prepare("SELECT name FROM sqlite_schema WHERE name='banks'").get(), undefined)
  } finally { check.close() }
})

test('Shared UI wires quick creation, automatic selection, pair search and existing ConfirmDialog (static)', () => {
  const source = readFileSync(new URL('../src/RecipientRegistry.tsx', import.meta.url), 'utf8')
  assert.match(source, /bankForDetail\(banks, form.bankDetailsId\)/)
  assert.match(source, /updateField\('bankDetailsId', onlyBankDetail\(bank\)\)/)
  assert.match(source, /setBankChoice\(bank.id\); updateField\('bankDetailsId', onlyBankDetail\(bank\)\); setShowBankForm\(false\)/)
  assert.match(source, /searchText: bankSearchText\(bank\)/)
  assert.match(source, /<BankFormModal/)
  assert.doesNotMatch(source, /textField\('bank(Name|Mfo|Edrpou)'/)
  const form = readFileSync(new URL('../src/components/BankFormModal.tsx', import.meta.url), 'utf8')
  assert.match(form, /dirty=\{dirty\}/)
  assert.match(form, /confirmModalClose\(dirty, close\)/)
  assert.match(form, /<ConfirmDialog title="Видалити реквізити\?"/)
  assert.match(form, /if \(savingRef.current\) return/)
})
