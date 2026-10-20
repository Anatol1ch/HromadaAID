import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import ts from 'typescript'
import { openAppDatabase } from '../electron/database.ts'
import { migrateAssignmentStatuses } from '../electron/migration-assignment-statuses.ts'
import { registerRecordsIpc } from '../electron/records-ipc.ts'
import { changeAssignmentStatuses } from '../electron/assignment-status.ts'
import { dashboardSummary, reportSummary } from '../electron/financial-summary.ts'
import { ASSIGNMENT_STATUSES, isStatementEligible } from '../electron/assignment-model.ts'
import { handlers } from './fakes/ipc-security.mjs'

const stamp = '2026-10-01T10:00:00.000Z'
function oldMigrations(db) {
  const source = ts.createSourceFile('database.ts', readFileSync(new URL('../electron/database.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
  let migrations
  const visit = node => { if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'migrations') migrations = node.initializer; ts.forEachChild(node, visit) }
  visit(source)
  assert(ts.isArrayLiteralExpression(migrations))
  db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE')
  for (const migration of migrations.elements) {
    const props = new Map(migration.properties.map(prop => [prop.name.getText(source), prop.initializer]))
    const version = Number(props.get('version').text)
    if (version > 14) continue
    assert(ts.isStringLiteral(props.get('sql')) || ts.isNoSubstitutionTemplateLiteral(props.get('sql')))
    db.exec(props.get('sql').text)
    db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(version, stamp)
    db.exec(`PRAGMA user_version=${version}`)
  }
  db.exec('COMMIT')
}

function fixture(t, legacy = false) {
  const root = mkdtempSync(join(tmpdir(), 'hromada-aid-five-status-test-'))
  const connections = []
  t.after(() => {
    for (const db of connections) { try { db.close() } catch {} }
    assert.equal(dirname(resolve(root)), resolve(tmpdir()))
    assert(basename(root).startsWith('hromada-aid-five-status-test-'))
    rmSync(resolve(root), { recursive: true, force: true })
  })
  const reopen = () => { const db = openAppDatabase(root); connections.push(db); return db }
  const db = legacy ? new DatabaseSync(join(root, 'hromada-aid.sqlite')) : reopen()
  if (legacy) { connections.push(db); oldMigrations(db) }
  db.prepare('INSERT INTO programs(id,code,short_name,official_name) VALUES(?,?,?,?)').run('test-program', 'TEST', 'Тестова програма', 'Тестова програма (вигадана)')
  db.prepare('INSERT INTO aid_types(id,code,program_id,short_name,official_name) VALUES(?,?,?,?,?)').run('test-aid', 'TEST_AID', 'test-program', 'Тестова допомога', 'Тестова матеріальна допомога (вигадана)')
  db.prepare('INSERT INTO recipients(id,last_name,first_name,is_vpo,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('person', 'Вигаданий', 'Тестовий', 0, stamp, stamp)
  for (const year of [2026, 2027, 2028]) db.prepare('INSERT INTO decisions(id,decision_number,decision_date,created_at,updated_at) VALUES(?,?,?,?,?)').run(`d${year}`, `TEST-${year}`, `${year}-01-02`, stamp, stamp)
  const add = (id, status, amount = 100, year = 2027, paidOn = null) => db.prepare('INSERT INTO assignments(id,recipient_id,decision_id,aid_type_id,amount_minor,status,created_at,updated_at,paid_on) VALUES(?,?,?,?,?,?,?,?,?)').run(id, 'person', `d${year}`, 'test-aid', amount, status, stamp, stamp, paidOn)
  const call = (channel, ...args) => { registerRecordsIpc(db); return handlers.get(channel)({}, ...args) }
  return { db, reopen, add, call }
}

test('Actual assignment IPC logic accepts pending status, requires a decision, validates paid date and clears unpaid date', t => {
  const { db, call } = fixture(t)
  const input = { recipientId: 'person', decisionId: 'd2027', aidTypeId: 'test-aid', amountMinor: 10000, status: 'Очікує рішення' }
  const created = call('assignments:save', input)
  assert.equal(created.ok, true); assert.equal(created.assignment.status, 'Очікує рішення')
  assert.equal(created.assignment.decisionId, 'd2027')
  assert.equal(call('assignments:save', { ...input, decisionId: undefined }).ok, false)
  assert.equal(call('assignments:save', { ...input, status: 'Виплачено' }, created.assignment.id).ok, false)
  for (const status of ['Призначено', 'Передано до казначейства', 'Виплачено']) {
    const result = call('assignments:save', { ...input, status, ...(status === 'Виплачено' ? { paidOn: '2027-02-28' } : {}) }, created.assignment.id)
    assert.equal(result.ok, true); assert.equal(result.assignment.status, status)
  }
  const unpaid = call('assignments:save', { ...input, status: 'В роботі', paidOn: '2028-02-29' }, created.assignment.id)
  assert.equal(unpaid.ok, true); assert.equal(unpaid.assignment.paidOn, null)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payouts').get().n, 0)
})

test('Group creation accepts all five statuses and never stores paid_on for unpaid states', t => {
  const { call } = fixture(t)
  const result = call('decisions:add-assignments', 'd2027', ASSIGNMENT_STATUSES.map(status => ({ recipientId: 'person', aidTypeId: 'test-aid', amountMinor: 500, status, paidOn: '2027-03-04' })))
  assert.equal(result.ok, true); assert.equal(result.assignments.length, 5)
  for (const row of result.assignments) assert.equal(row.paidOn, row.status === 'Виплачено' ? '2027-03-04' : null)
  assert.equal(call('decisions:get', 'd2027').assignmentCount, 4)
  assert.equal(call('decisions:get', 'd2027').assignedTotalMinor, 2000)
})

test('All unpaid states can transition directly, bulk paid state remains blocked', t => {
  const { db, add } = fixture(t)
  add('a', 'Очікує рішення'); add('b', 'Передано до казначейства')
  const update = status => changeAssignmentStatuses(db, { assignmentIds: ['a', 'b'], year: 2027, status, ...(status === 'Виплачено' ? { paidOn: '2027-05-06' } : {}) })
  for (const status of ['Призначено', 'Очікує рішення', 'В роботі', 'Передано до казначейства', 'Виплачено']) assert.equal(update(status).ok, true)
  const before = JSON.stringify(db.prepare('SELECT * FROM assignments').all())
  assert.equal(update('Очікує рішення').ok, false)
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM assignments').all()), before)
})

test('Legacy rows are not rewritten: assigned totals exclude pending and historical paid totals follow paid_on', t => {
  const { db, add } = fixture(t)
  add('a', 'Очікує рішення', 100)
  add('b', 'Призначено', 200)
  add('c', 'В роботі', 300)
  add('d', 'Передано до казначейства', 400)
  add('e', 'Виплачено', 500, 2027, '2028-02-29')
  add('f', 'Виплачено', 600, 2026, '2027-03-15')
  add('g', 'Призначено', 700, 2028)
  const dashboard = dashboardSummary(db, 2027)
  assert.equal(dashboard.assignmentCount, 4); assert.equal(dashboard.totalMinor, 1400)
  assert.equal(dashboard.monthlyAmountMinor[0], 1400)
  assert.equal(dashboard.paidCount, 1); assert.equal(dashboard.paidTotalMinor, 600)
  const program = dashboard.programExecution.find(row => row.programName === 'Тестова програма')
  assert.equal(program.amountMinor, 1400); assert.equal(program.paidMinor, 600)
  assert.equal(dashboardSummary(db, 2028).paidTotalMinor, 500)
  const summary = (year, period) => reportSummary(db, year, period).rows.find(row => row.aidTypeId === 'test-aid')
  const annual = summary(2027, { kind: 'annual' })
  assert.equal(annual.assignmentCount, 4); assert.equal(annual.amountMinor, 1400)
  assert.equal(annual.paidCount, 1); assert.equal(annual.paidAmountMinor, 600)
  assert.equal(summary(2027, { kind: 'month', value: 1 }).paidAmountMinor, 0)
  assert.equal(summary(2027, { kind: 'month', value: 3 }).paidAmountMinor, 600)
  assert.equal(summary(2028, { kind: 'month', value: 2 }).paidAmountMinor, 500)
  assert.equal(summary(2027, { kind: 'quarter', value: 1 }).paidAmountMinor, 600)
  assert.equal(summary(2027, { kind: 'year-to-month', value: 2 }).paidAmountMinor, 0)
  assert.equal(summary(2027, { kind: 'year-to-month', value: 3 }).paidAmountMinor, 600)
  assert(reportSummary(db, 2027, { kind: 'annual' }).rows.some(row => row.aidTypeId !== 'test-aid' && row.amountMinor === 0 && row.paidAmountMinor === 0))
})

test('Historical stale or invalid payment dates never become actual expenditure', t => {
  const { db, add } = fixture(t)
  add('a', 'Очікує рішення', 100, 2027, '2027-01-02')
  add('b', 'Призначено', 200, 2027, '2027-01-02')
  add('c', 'Виплачено', 300, 2027, null)
  add('d', 'Виплачено', 400, 2027, '2027-02-31')
  assert.equal(dashboardSummary(db, 2027).paidTotalMinor, 0)
  assert.equal(reportSummary(db, 2027, { kind: 'annual' }).rows.reduce((sum, row) => sum + row.paidAmountMinor, 0), 0)
  const cleaned = changeAssignmentStatuses(db, { assignmentIds: ['a'], year: 2027, status: 'Очікує рішення' })
  assert.equal(cleaned.ok, true); assert.equal(cleaned.updatedCount, 1)
  assert.equal(db.prepare("SELECT paid_on FROM assignments WHERE id='a'").get().paid_on, null)
  assert.equal(changeAssignmentStatuses(db, { assignmentIds: ['a'], year: 2027, status: 'Очікує рішення' }).updatedCount, 0)
})

test('Treasury documents accept only assigned, processing and sent-to-treasury states', () => {
  assert.deepEqual(ASSIGNMENT_STATUSES.filter(isStatementEligible), ['Призначено', 'В роботі', 'Передано до казначейства'])
  const source = readFileSync(new URL('../electron/statements-ipc.ts', import.meta.url), 'utf8')
  assert(source.includes('isStatementEligible(assignment.status)'))
  const dataSource = readFileSync(new URL('../electron/statement-data.ts', import.meta.url), 'utf8')
  assert.equal(((source + dataSource).match(/a.status IN \('Призначено','В роботі','Передано до казначейства'\)/g) || []).length, 2)
})

test('Migration 14 → 19 preserves every existing row, linked data, rowid, indexes and triggers', t => {
  const { db, reopen, add } = fixture(t, true)
  add('a', 'Призначено', 100, 2027, '2027-01-03')
  add('b', 'Виплачено', 200, 2026, '2027-01-04')
  db.prepare('INSERT INTO payouts(id,assignment_id,amount_minor,paid_on,created_at) VALUES(?,?,?,?,?)').run('legacy', 'b', 200, '2027-01-04', stamp)
  db.prepare('INSERT INTO imported_source_rows(id,source_hash,worksheet,source_row_number,assignment_id,imported_at) VALUES(?,?,?,?,?,?)').run('source', 'synthetic', 'TEST', 1, 'a', stamp)
  db.prepare('INSERT INTO import_review_items(id,import_source_row_id,reason) VALUES(?,?,?)').run('review', 'source', 'Синтетична перевірка')
  db.exec('CREATE INDEX idx_test_assignment_status ON assignments(status); CREATE TRIGGER test_assignment_trigger AFTER UPDATE OF status ON assignments BEGIN SELECT 1; END;')
  const tables = ['programs', 'aid_types', 'recipients', 'decisions', 'assignments', 'payouts', 'imported_source_rows', 'import_review_items']
  const snapshot = (connection, name) => JSON.stringify(connection.prepare(`SELECT rowid,* FROM ${name} ORDER BY rowid`).all().map(row => {
    if (name === 'programs' || name === 'aid_types') delete row.sort_order
    if (name === 'recipients') for (const key of Object.keys(row)) if (['bank_name', 'bank_mfo', 'bank_edrpou', 'bank_details_id'].includes(key) || key.startsWith('registration_') || key.startsWith('residence_')) delete row[key]
    return row
  }))
  const before = tables.map(name => snapshot(db, name))
  const objects = db.prepare("SELECT name,sql FROM sqlite_schema WHERE tbl_name='assignments' AND type IN ('index','trigger') ORDER BY name").all()
  db.close()
  const current = reopen()
  assert.equal(current.prepare('PRAGMA user_version').get().user_version, 19)
  assert.equal(current.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version, 19)
  tables.forEach((name, index) => assert.equal(snapshot(current, name), before[index], name))
  assert.deepEqual(current.prepare("SELECT name,sql FROM sqlite_schema WHERE tbl_name='assignments' AND type IN ('index','trigger') ORDER BY name").all(), objects)
  assert.equal(current.prepare('PRAGMA foreign_key_check').all().length, 0)
  assert.equal(current.prepare('PRAGMA foreign_keys').get().foreign_keys, 1)
  current.prepare("UPDATE assignments SET status='Очікує рішення' WHERE id='a'").run()
  current.prepare("UPDATE assignments SET status='Передано до казначейства' WHERE id='a'").run()
})

test('An error after rebuilding the table rolls back the entire migration', t => {
  const { db, add } = fixture(t, true)
  add('a', 'Призначено')
  const before = JSON.stringify(db.prepare('SELECT rowid,* FROM assignments').all())
  const exec = db.exec.bind(db)
  exec('BEGIN IMMEDIATE')
  db.exec = sql => { exec(sql); if (sql.startsWith('DROP TABLE assignments;')) throw new Error('Synthetic post-rebuild failure') }
  assert.throws(() => migrateAssignmentStatuses(db), /Synthetic/)
  db.exec = exec
  exec('ROLLBACK')
  assert.equal(JSON.stringify(db.prepare('SELECT rowid,* FROM assignments').all()), before)
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 14)
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0)
  assert.throws(() => db.prepare("UPDATE assignments SET status='Очікує рішення' WHERE id='a'").run(), /CHECK/)
})

test('Migration refuses unexpected cascading child tables rather than losing their records', t => {
  const { db, add, reopen } = fixture(t, true)
  add('a', 'Призначено')
  db.exec("CREATE TABLE unexpected_child(id TEXT PRIMARY KEY,assignment_id TEXT REFERENCES assignments(id) ON DELETE CASCADE); INSERT INTO unexpected_child VALUES('child','a')")
  db.close()
  assert.throws(reopen, /залежностей/)
})
