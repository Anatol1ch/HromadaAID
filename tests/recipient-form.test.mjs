import { testAddress, testAddressInput } from './fakes/address.mjs'
import { formatAddress } from '../electron/address.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import ts from 'typescript'
import { openTestDatabase } from './fakes/database.mjs'
import { registerRecipientFixture } from './fakes/recipient-fixture.ts'
import { recipientTextFields, validateRecipientInput } from '../electron/recipient-validation.ts'
import { handlers } from './fakes/ipc-security.mjs'
import { confirmModalClose, finishCloseConfirmation, getCloseConfirmation } from '../src/components/closeConfirmation.ts'

// Entirely fictional data, never sent to the working profile or document generators.
const complete = {
  lastName: 'Тестовий', firstName: 'Вигаданий', patronymic: 'Прикладович',
  passport: 'ТТ000001', rnokpp: '0000000001', sex: 'Чоловік', isVpo: false,
  ...testAddressInput(),
  phone: '+380000000000', email: 'fictional@example.invalid',
  bankAccount: 'UA620000000000000000000000001', bankDetailsId: 'test-detail',
}
const required = [...Object.keys(recipientTextFields).filter(key => recipientTextFields[key].required), 'registeredAddressParts', 'sex', 'isVpo']
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'hromada-aid-recipient-test-'))
  const db = openTestDatabase(root)
  t.after(() => {
    db.close()
    assert.equal(dirname(resolve(root)), resolve(tmpdir()))
    assert(basename(root).startsWith('hromada-aid-recipient-test-'))
    rmSync(resolve(root), { recursive: true, force: true })
  })
  db.prepare('INSERT INTO banks(id,name) VALUES(?,?)').run('test-bank', 'Вигаданий банк')
  db.prepare('INSERT INTO bank_details(id,bank_id,mfo,edrpou) VALUES(?,?,?,?)').run('test-detail', 'test-bank', '000001', '00000001')
  registerRecipientFixture(db)
  return { db, call: (channel, ...args) => handlers.get(channel)({}, ...args) }
}

test('Recipient IPC creates, reads and edits all fields without losing text identifiers', t => {
  const { call } = fixture(t)
  const created = call('recipients:save', complete)
  assert.equal(created.ok, true)
  const person = call('recipients:get', created.recipient.id)
  for (const [key, value] of Object.entries(complete)) assert.deepEqual(person[key], value, key)
  const updated = { ...complete, passport: 'ТТ000002', rnokpp: '0000000002', registeredAddressParts: testAddress({ building: '12А' }), registeredAddress: formatAddress(testAddress({ building: '12А' })), addressParts: testAddress({ building: '15/2' }), address: formatAddress(testAddress({ building: '15/2' })), bankAccount: 'UA350000000000000000000000002', isVpo: true, sex: 'Жінка' }
  assert.equal(call('recipients:save', updated, person.id).ok, true)
  const reopened = call('recipients:get', person.id)
  for (const [key, value] of Object.entries(updated)) assert.deepEqual(reopened[key], value, key)
  assert.equal(call('recipients:list').length, 1)
})

test('Optional address, phone and email can be blank; required strings are trimmed', t => {
  const { call } = fixture(t)
  const result = call('recipients:save', { ...complete, lastName: '  Тестовий  ', address: ' ', addressParts: null, phone: '', email: '' })
  assert.equal(result.ok, true)
  assert.equal(result.recipient.lastName, 'Тестовий')
  for (const key of ['address', 'phone', 'email']) assert.equal(result.recipient[key], null)
  assert.equal(result.recipient.isVpo, false)
})

test('IPC enforces field formats on create and edit; rejects malformed values without changing SQLite', t => {
  const { db, call } = fixture(t)
  const saved = call('recipients:save', complete).recipient
  const bad = { passport: ['AB123456', 'АВ12345', '12345678'], rnokpp: ['123', '000000000x'], phone: ['+38050', '+48123456789'], email: ['a@@b.org', 'a@b', 'a@b..org', 'a b@c.org', ' a@b.org'], bankAccount: ['UA62000000000000000000000001', 'DE620000000000000000000000001', 'UA62000000000000000000000000x'] }
  for (const [field, values] of Object.entries(bad)) for (const value of values) {
    for (const id of [undefined, saved.id]) {
      const result = call('recipients:save', {...complete,[field]:value}, id, true)
      assert.equal(result.reason,'validation',field+': '+value)
    }
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM recipients').get().n,1)
  assert.equal(call('recipients:get',saved.id).bankAccount,complete.bankAccount)
  assert.equal(call('recipients:get',saved.id).passport,complete.passport)
})

test('IPC stores uppercase passport, canonical phone and IBAN, and treats a bare phone prefix as empty', t => {
  const { call } = fixture(t)
  const result = call('recipients:save', {...complete,passport:'ав123456',phone:'+380 (50) 123-45-67',bankAccount:'ua 62 000000 0000000000000000001'})
  assert.equal(result.ok,true)
  assert.equal(result.recipient.passport,'АВ123456')
  assert.equal(result.recipient.phone,'+380501234567')
  assert.equal(result.recipient.bankAccount,complete.bankAccount)
  assert.equal(call('recipients:save',{...complete,phone:'+380'},result.recipient.id).recipient.phone,null)
})

test('IPC temporarily accepts a correctly shaped IBAN irrespective of MOD 97 on create and edit', t => {
  const { call } = fixture(t)
  const account='UA000000000000000000000000001'
  const created=call('recipients:save',{...complete,bankAccount:account})
  assert.equal(created.ok,true)
  assert.equal(created.recipient.bankAccount,account)
  const updated=call('recipients:save',{...complete,bankAccount:'UA000000000000000000000000002'},created.recipient.id)
  assert.equal(updated.ok,true)
  assert.equal(call('recipients:get',created.recipient.id).bankAccount,'UA000000000000000000000000002')
})

test('Every required field rejects blank, whitespace and missing values for create and edit', t => {
  const { db, call } = fixture(t)
  const saved = call('recipients:save', complete).recipient
  for (const key of required) {
    for (const value of ['', '   ', null, undefined]) {
      const input = { ...complete, [key]: value }
      assert.equal(validateRecipientInput(input).ok, false, key)
      for (const id of [undefined, saved.id]) {
        const result = call('recipients:save', input, id, true)
        assert.equal(result.reason, 'validation', `${key}: ${String(value)}`)
      }
    }
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM recipients').get().n, 1)
  assert.equal(call('recipients:get', saved.id).passport, complete.passport)
  assert.equal(call('recipients:save', { ...complete, sex: 'Не вказано' }, saved.id).reason, 'validation')
  assert.equal(call('recipients:save', { ...complete, isVpo: 0 }, saved.id).reason, 'validation')
})

test('Existing length limits and duplicate protections remain enforced', t => {
  const { call } = fixture(t)
  const first = call('recipients:save', complete)
  assert.equal(first.ok, true)
  assert.equal(call('recipients:save', complete).reason, 'rnokpp-match')
  const sameName = { ...complete, rnokpp: '0000000002' }
  assert.equal(call('recipients:save', sameName).reason, 'name-match')
  assert.equal(call('recipients:save', sameName, undefined, true).ok, true)
  for (const [key, { maxLength }] of Object.entries(recipientTextFields)) {
    assert.equal(call('recipients:save', { ...complete, [key]: 'x'.repeat(maxLength + 1) }, first.recipient.id).reason, 'validation', key)
  }
})

test('Legacy incomplete card opens unchanged; next save requires completion and preserves assignment links', t => {
  const { db, call } = fixture(t)
  const stamp = '2026-10-01T10:00:00.000Z'
  db.prepare('INSERT INTO recipients(id,last_name,first_name,created_at,updated_at) VALUES(?,?,?,?,?)').run('old-card', 'Старий', 'Приклад', stamp, stamp)
  const before = db.prepare('SELECT * FROM recipients WHERE id=?').get('old-card')
  const old = call('recipients:get', 'old-card')
  assert.equal(old.sex, null); assert.equal(old.isVpo, null); assert.equal(old.passport, null)
  assert.deepEqual(db.prepare('SELECT * FROM recipients WHERE id=?').get('old-card'), before)
  const input = Object.fromEntries(Object.keys(complete).map(key => [key, old[key] ?? (key === 'isVpo' ? null : '')]))
  assert.equal(call('recipients:save', input, old.id).reason, 'validation')
  assert.deepEqual(db.prepare('SELECT * FROM recipients WHERE id=?').get('old-card'), before)
  db.prepare('INSERT INTO decisions(id,decision_number,decision_date,created_at,updated_at) VALUES(?,?,?,?,?)').run('decision', 'ТЕСТ', '2027-01-01', stamp, stamp)
  const aid = db.prepare('SELECT id FROM aid_types LIMIT 1').get()
  db.prepare('INSERT INTO assignments(id,recipient_id,decision_id,aid_type_id,amount_minor,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run('assignment', old.id, 'decision', aid.id, 100, 'Призначено', stamp, stamp)
  const assignmentBefore = db.prepare('SELECT * FROM assignments WHERE id=?').get('assignment')
  assert.equal(call('recipients:save', complete, old.id).ok, true)
  assert.deepEqual(db.prepare('SELECT * FROM assignments WHERE id=?').get('assignment'), assignmentBefore)
  assert.equal(call('recipients:get', old.id).createdAt, stamp)
})

test('Shared form layout and data bindings match both registry and nested creation entry points (static)', () => {
  const source = readFileSync(new URL('../src/RecipientRegistry.tsx', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('RecipientRegistry.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const fields = []
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'textField') fields.push(node.arguments[0].text)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.deepEqual(fields, ['lastName', 'firstName', 'patronymic', 'passport', 'rnokpp', 'phone', 'email', 'bankAccount'])
  assert.match(source, /value=\{form\[key\]\}/)
  assert.match(source, /updateField\(key, value\)/)
  assert.match(source, /validateRecipientInput\(form\)/)
  assert.match(source, /recipientRepository\.save\(validation\.input, editingId, confirmSameName\)/)
  assert.match(source, /initial\)\)/)
  assert.match(source, /sex: recipient\.sex \?\? ''/)
  assert.match(source, /isVpo: recipient\.isVpo/)
  assert.match(source, /sex: '',.*isVpo: null/)
  assert.match(source, /first\?\.querySelector<HTMLElement>\('input, button'\)\?\.focus\(\)/)
  assert.match(source, /confirmModalClose\(dirty, closeForm\)/)
  assert.match(source, /dirty=\{!saving && dirty\} busy=\{saving\}/)
  assert.doesNotMatch(source, /\(за наявності\)|Усі поля необов/)
  for (const file of ['AidRegistry', 'DecisionRegistry']) {
    const entry = readFileSync(new URL(`../src/${file}.tsx`, import.meta.url), 'utf8')
    assert.match(entry, /<RecipientFormModal/)
    assert.match(entry, /recipientId: (person|recipient)\.id/)
  }
})

test('Shared unsaved-changes confirmation keeps editing on cancel and closes only on explicit confirmation', () => {
  let closed = 0
  const close = () => { closed++ }
  const owner = { isConnected: true }
  confirmModalClose(false, close, owner)
  assert.equal(closed, 1)
  confirmModalClose(true, close, owner)
  assert.equal(closed, 1)
  finishCloseConfirmation(getCloseConfirmation(), false)
  assert.equal(closed, 1)
  confirmModalClose(true, close, owner)
  const pending = getCloseConfirmation()
  finishCloseConfirmation(pending, true)
  finishCloseConfirmation(pending, true)
  assert.equal(closed, 2)
  assert.equal(getCloseConfirmation(), null)
})
