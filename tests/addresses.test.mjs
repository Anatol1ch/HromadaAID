import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import ts from 'typescript'
import { ADDRESS_TEMPLATES, SETTLEMENT_TYPES, STREET_TYPES, applyAddressTemplate, copyAddress, emptyAddress, formatAddress, normalizeAddress, validateAddress, addressColumns } from '../electron/address.ts'
import { migrateAddresses } from '../electron/migration-addresses.ts'
import { migrateAssignmentStatuses } from '../electron/migration-assignment-statuses.ts'
import { migrateBanks } from '../electron/migration-banks.ts'
import { openAppDatabase } from '../electron/database.ts'
import { registerRecipientIpc } from '../electron/recipient-ipc.ts'
import { readStatementRows } from '../electron/statement-data.ts'
import { handlers } from './fakes/ipc-security.mjs'
import { testAddress, testAddressInput } from './fakes/address.mjs'

const stamp = '2026-10-01T10:00:00.000Z'
const expected = "52151, Дніпропетровська область, Кам'янський район, с-ще Вишневе, вул. Центральна, буд. 105, кв. 10"
const full = () => ({ ...applyAddressTemplate(emptyAddress(), 'vyshneve'), streetType: 'вулиця', streetName: 'Центральна', building: '105', apartment: '10' })
function createV16(db) {
  const ast = ts.createSourceFile('database.ts', readFileSync(new URL('../electron/database.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
  let migrations
  const visit = node => { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'migrations') migrations = node.initializer; ts.forEachChild(node, visit) }
  visit(ast)
  db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE')
  for (const item of migrations.elements) {
    const values = new Map(item.properties.map(property => [property.name.getText(ast), property.initializer]))
    const version = Number(values.get('version').text)
    if (version > 16) continue
    if (version === 15) migrateAssignmentStatuses(db)
    if (version === 16) migrateBanks(db)
    db.exec(values.get('sql').text)
    db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(version, stamp)
    db.exec(`PRAGMA user_version=${version}`)
  }
  db.exec('COMMIT')
}
function fixture(t, legacy = false) {
  const root = mkdtempSync(join(tmpdir(), 'hromada-aid-address-test-'))
  const connections = []
  const open = () => { const connection = openAppDatabase(root); connections.push(connection); return connection }
  const db = legacy ? new DatabaseSync(join(root, 'hromada-aid.sqlite')) : open()
  if (legacy) { connections.push(db); createV16(db) }
  t.after(() => {
    for (const connection of connections) try { connection.close() } catch {}
    assert.equal(dirname(resolve(root)), resolve(tmpdir()))
    assert(basename(root).startsWith('hromada-aid-address-test-'))
    rmSync(resolve(root), { recursive: true, force: true })
  })
  db.prepare('INSERT INTO banks(id,name) VALUES(?,?)').run('test-bank', 'Вигаданий банк')
  db.prepare('INSERT INTO bank_details(id,bank_id,mfo,edrpou) VALUES(?,?,?,?)').run('test-detail', 'test-bank', '000001', '00000001')
  const input = () => ({ lastName: 'Вигаданий', firstName: 'Тестовий', patronymic: 'Прикладович', rnokpp: '0000000001', passport: 'ТТ000001', sex: 'Чоловік', isVpo: false, phone: '', email: '', bankAccount: 'UA620000000000000000000000001', bankDetailsId: 'test-detail', ...testAddressInput() })
  const call = (channel, ...args) => { registerRecipientIpc(db); return handlers.get(channel)({}, ...args) }
  return { db, open, input, call }
}

test('All ten built-in templates match the supplied names, postal codes and types; street data is not overwritten', () => {
  assert.deepEqual(ADDRESS_TEMPLATES.map(({ name, type, postalCode }) => [name, type, postalCode]), [
    ['Вишневе', 'селище', '52151'], ['Лозуватка', 'село', '52150'], ['Комісарівка', 'село', '52142'],
    ['Терно-Лозуватка', 'село', '52178'], ['Іванівка', 'село', '52198'], ['Ликошине', 'село', '52146'],
    ['Новоукраїнка', 'село', '52121'], ['Кулябкине', 'село', '52150'], ['Червоний Яр', 'село', '52178'], ['Байківка', 'село', '52150'],
  ])
  const draft = testAddress({ building: '12А', apartment: '3' })
  for (const template of ADDRESS_TEMPLATES) {
    const result = applyAddressTemplate(draft, template.id)
    assert.equal(result.region, 'Дніпропетровська'); assert.equal(result.district, "Кам'янський")
    assert.equal(result.settlementName, template.name); assert.equal(result.settlementType, template.type); assert.equal(result.postalCode, template.postalCode)
    assert.equal(result.streetName, draft.streetName); assert.equal(result.building, '12А'); assert.equal(result.apartment, '3')
    assert.equal(validateAddress(result).ok, true)
  }
  assert.equal(draft.region, 'Тестова')
  assert.deepEqual(applyAddressTemplate(draft, 'manual'), draft)
})

test('Formatter produces the exact agreed address, optional apartment and all settlement/street abbreviations', () => {
  assert.equal(formatAddress(full()), expected)
  assert.equal(formatAddress({ ...full(), apartment: '' }), expected.replace(', кв. 10', ''))
  for (const [settlementType, token] of SETTLEMENT_TYPES.map((type, index) => [type, ['м.', 'с-ще', 'с.'][index]])) assert(formatAddress({ ...full(), settlementType }).includes(token + ' Вишневе'))
  const abbreviations = ['вул.', 'пров.', 'просп.', 'пл.', 'бульв.', 'пр-д', 'узв.', 'наб.', 'шосе', 'алея']
  STREET_TYPES.forEach((streetType, index) => {
    const address = { ...full(), streetType, customStreetType: streetType === 'інше' ? 'алея' : '' }
    assert.equal(validateAddress(address).ok, true)
    assert(formatAddress(address).includes(abbreviations[index] + ' Центральна'))
  })
  assert.equal(formatAddress(emptyAddress()), '')
})

test('Normalization removes repeated type words without changing proper-name spelling or house suffixes', () => {
  const typed = { ...full(), postalCode: ' 52151 ', region: 'Дніпропетровська область обл.', district: "район Кам'янський район", settlementName: 'с-ще селище Вишневе', streetName: 'вул. вулиця Центральна', building: 'буд. будинок 12А', apartment: 'кв. квартира 10' }
  const result = validateAddress(typed)
  assert.equal(result.ok, true)
  assert.equal(formatAddress(result.address), expected.replace('буд. 105', 'буд. 12А'))
  for (const building of ['12А', '15/2', '12-А', '12А/1']) assert.equal(normalizeAddress({ ...full(), building }).building, building)
  assert(formatAddress({ ...full(), streetName: 'імені Марії Примаченко', building: '15/2' }).includes('вул. імені Марії Примаченко, буд. 15/2'))
  assert(formatAddress({ ...full(), streetType: 'інше', customStreetType: 'алея', streetName: 'алея Надії' }).includes('алея Надії'))
  assert.equal(normalizeAddress({ ...full(), settlementName: 'с-щеВишневе' }).settlementName, 'Вишневе')
  assert.equal(normalizeAddress({ ...full(), streetType: 'проспект', streetName: 'пр-т Миру' }).streetName, 'Миру')
  assert.equal(normalizeAddress({ ...full(), streetType: 'бульвар', streetName: 'б-р Героїв' }).streetName, 'Героїв')
})

test('Manual addresses outside the community and custom street types work without external catalogs', () => {
  const outside = { postalCode: '01001', region: 'Київська', district: 'Вишгородський', settlementType: 'місто', settlementName: 'Вишгород', streetType: 'інше', customStreetType: 'алея', streetName: 'Надії', building: '15/2', apartment: '' }
  assert.equal(validateAddress(outside).ok, true)
  assert.equal(formatAddress(outside), '01001, Київська область, Вишгородський район, м. Вишгород, алея Надії, буд. 15/2')
  assert.equal(outside.postalCode, '01001')
})

test('Every required address component is validated; postal codes and enums reject invalid values safely', () => {
  for (const key of ['postalCode', 'region', 'district', 'settlementType', 'settlementName', 'streetType', 'streetName', 'building']) {
    for (const value of ['', '   ', null, undefined, 123]) assert.equal(validateAddress({ ...full(), [key]: value }).ok, false, key)
  }
  for (const postalCode of ['1234', '123456', '12А45', '1 234', '12.34']) assert.equal(validateAddress({ ...full(), postalCode }).ok, false)
  for (const settlementType of ['toString', '__proto__', 'невідомо']) assert.equal(validateAddress({ ...full(), settlementType }).ok, false)
  assert.equal(validateAddress({ ...full(), streetType: 'toString' }).ok, false)
  assert.equal(validateAddress({ ...full(), streetType: 'інше', customStreetType: '' }).ok, false)
  assert.equal(validateAddress({ ...full(), region: 'область' }).ok, false)
  const withoutOptional = full(); delete withoutOptional.apartment; delete withoutOptional.customStreetType
  assert.equal(validateAddress(withoutOptional).ok, true)
})

test('Copying creates independent address components and preserves every value', () => {
  const registration = full()
  const residence = copyAddress(registration)
  assert.notEqual(residence, registration); assert.deepEqual(residence, registration)
  residence.building = '15/2'; residence.apartment = ''
  assert.equal(registration.building, '105'); assert.equal(registration.apartment, '10')
})

test('IPC stores components, ignores forged display text and restores both addresses after reopening', t => {
  const { db, open, input, call } = fixture(t)
  const value = { ...input(), registeredAddress: 'FORGED', address: 'FORGED', registeredAddressParts: full(), addressParts: copyAddress(full()) }
  const result = call('recipients:save', value)
  assert.equal(result.ok, true, result.message)
  assert.equal(result.recipient.registeredAddress, expected); assert.equal(result.recipient.address, expected)
  assert.deepEqual(result.recipient.registeredAddressParts, full()); assert.deepEqual(result.recipient.addressParts, full())
  const row = db.prepare('SELECT * FROM recipients WHERE id=?').get(result.recipient.id)
  assert.equal(row.registered_address, null); assert.equal(row.address, null)
  assert.equal(row.registration_postal_code, '52151'); assert.equal(row.residence_building, '105')
  db.close()
  const reopened = open(); registerRecipientIpc(reopened)
  const read = handlers.get('recipients:get')({}, result.recipient.id)
  assert.equal(read.registeredAddress, expected); assert.deepEqual(read.registeredAddressParts, full())
  const edited = { ...value, addressParts: { ...read.addressParts, building: '15/2', apartment: '' } }
  assert.equal(handlers.get('recipients:save')({}, edited, read.id).ok, true)
  const updated = handlers.get('recipients:get')({}, read.id)
  assert.equal(updated.registeredAddressParts.building, '105'); assert.equal(updated.addressParts.building, '15/2')
  assert.equal(updated.bankAccount, value.bankAccount)
})

test('Registration is mandatory, partial residence is rejected, and optional residence can be explicitly cleared', t => {
  const { input, call } = fixture(t)
  const value = input()
  assert.equal(call('recipients:save', { ...value, registeredAddressParts: null }).reason, 'validation')
  assert.equal(call('recipients:save', { ...value, addressParts: { ...value.addressParts, building: '' } }).reason, 'validation')
  assert.equal(call('recipients:save', { ...value, addressParts: null, address: 'Старий текст без складових' }).reason, 'validation')
  const created = call('recipients:save', value)
  assert.equal(created.ok, true)
  const cleared = call('recipients:save', { ...value, addressParts: null, address: '' }, created.recipient.id)
  assert.equal(cleared.ok, true); assert.equal(cleared.recipient.address, null); assert.equal(cleared.recipient.addressParts, null)
  assert.equal(cleared.recipient.registeredAddress, formatAddress(value.registeredAddressParts))
})

test('Failure while writing address components rolls back other recipient changes too', t => {
  const { db, input, call } = fixture(t)
  const created = call('recipients:save', input())
  const before = db.prepare('SELECT * FROM recipients').get()
  db.exec("CREATE TRIGGER reject_address BEFORE UPDATE OF registration_building ON recipients WHEN NEW.registration_building='BLOCK' BEGIN SELECT RAISE(ABORT,'synthetic address failure'); END;")
  assert.equal(call('recipients:save', { ...input(), firstName: 'Не зберегти', registeredAddressParts: { ...full(), building: 'BLOCK' } }, created.recipient.id).reason, 'storage')
  assert.deepEqual(db.prepare('SELECT * FROM recipients').get(), before)
})

test('Document SQL uses the shared formatter and contains the registration address, never the residence address', t => {
  const { db, input, call } = fixture(t)
  const recipient = call('recipients:save', { ...input(), registeredAddressParts: full(), addressParts: testAddress({ building: '999' }) }).recipient
  db.prepare('INSERT INTO decisions(id,decision_number,decision_date,created_at,updated_at) VALUES(?,?,?,?,?)').run('decision', 'ТЕСТ', '2027-01-02', stamp, stamp)
  const aid = db.prepare('SELECT id FROM aid_types LIMIT 1').get().id
  db.prepare('INSERT INTO assignments(id,recipient_id,decision_id,aid_type_id,amount_minor,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run('aid', recipient.id, 'decision', aid, 1000000, 'Призначено', stamp, stamp)
  const rows = readStatementRows(db, ['aid'], '2027')
  assert.equal(rows.length, 1); assert.equal(rows[0].registered_address, expected)
  assert.equal(rows[0].amount_minor, 1000000); assert.equal(rows[0].bank_mfo, '000001')
})

test('Migration 16 → 19 preserves legacy address strings and exposes them without guessing components', t => {
  const { db, open } = fixture(t, true)
  db.prepare('INSERT INTO recipients(id,last_name,first_name,address,registered_address,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('legacy', 'Вигаданий', 'Тест', 'Стара адреса проживання', 'Стара адреса реєстрації', stamp, stamp)
  const before = db.prepare('SELECT * FROM recipients').get()
  db.close()
  const current = open(); registerRecipientIpc(current)
  assert.equal(current.prepare('PRAGMA user_version').get().user_version, 19)
  const read = handlers.get('recipients:get')({}, 'legacy')
  assert.equal(read.registeredAddress, 'Стара адреса реєстрації'); assert.equal(read.address, 'Стара адреса проживання')
  assert.equal(read.registeredAddressParts, null); assert.equal(read.addressParts, null)
  const after = current.prepare('SELECT * FROM recipients').get()
  for (const [key, value] of Object.entries(before)) assert.deepEqual(after[key], value, key)
  for (const prefix of ['registration', 'residence']) for (const suffix of Object.values(addressColumns)) assert.equal(after[prefix + '_' + suffix], null)
  assert.equal(current.prepare('PRAGMA foreign_key_check').all().length, 0)
})

test('A failed address migration rolls back every column addition', t => {
  const { db } = fixture(t, true)
  const before = db.prepare('PRAGMA table_info(recipients)').all()
  const exec = db.exec.bind(db)
  exec('BEGIN IMMEDIATE')
  db.exec = sql => { exec(sql); if (sql.includes('registration_district')) throw new Error('synthetic address migration failure') }
  assert.throws(() => migrateAddresses(db), /synthetic/)
  db.exec = exec; exec('ROLLBACK')
  assert.deepEqual(db.prepare('PRAGMA table_info(recipients)').all(), before)
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 16)
})

test('Shared editor applies only on Save; cancel, dirty guard and all recipient entry points remain connected (static)', () => {
  const editor = readFileSync(new URL('../src/components/AddressEditor.tsx', import.meta.url), 'utf8')
  assert.match(editor, /initial \? copyAddress\(initial\) : emptyAddress\(\)/)
  assert.match(editor, /onSave\(result.address\)/)
  assert.match(editor, /confirmModalClose\(dirty, onClose\)/)
  assert.match(editor, /dirty=\{dirty\} onClose=\{onClose\}/)
  assert.match(editor, /formatAddress\(draft\)/)
  const form = readFileSync(new URL('../src/RecipientRegistry.tsx', import.meta.url), 'utf8')
  assert.match(form, /addressCard\('registeredAddress'\)/); assert.match(form, /addressCard\('address'\)/)
  assert.match(form, /applyAddress\('address', copyAddress\(form.registeredAddressParts\)\)/)
  assert.match(form, /applyAddress\('address', null\)/)
  assert.match(form, /onSave=\{parts => \{ applyAddress\(addressEditor, parts\); setAddressEditor\(null\) \}\}/)
  for (const file of ['AidRegistry', 'DecisionRegistry']) assert.match(readFileSync(new URL(`../src/${file}.tsx`, import.meta.url), 'utf8'), /<RecipientFormModal/)
})
