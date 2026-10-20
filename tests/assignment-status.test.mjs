import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, basename } from 'node:path'
import { openAppDatabase } from '../electron/database.ts'
import { changeAssignmentStatuses } from '../electron/assignment-status.ts'
import { eligibleAssignmentIds, keepEligibleSelection, selectionForYear, selectionState, toggleEligibleSelection } from '../src/lib/assignmentSelection.ts'

function fixture(t, statuses = ['Призначено', 'Призначено']) {
  const root = mkdtempSync(join(tmpdir(), 'hromada-aid-batch-status-test-'))
  const connections = []
  t.after(() => {
    for (const connection of connections) { try { connection.close() } catch {} }
    // Remove only the exact temporary directory created by this fixture.
    assert.equal(dirname(resolve(root)), resolve(tmpdir()))
    assert(basename(root).startsWith('hromada-aid-batch-status-test-'))
    rmSync(resolve(root), { recursive: true, force: true })
  })
  const reopen = () => { const db = openAppDatabase(root); connections.push(db); return db }
  const db = reopen()
  const stamp = '2027-01-01T09:00:00.000Z'
  db.prepare('INSERT INTO recipients(id,last_name,first_name,is_vpo,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('person', 'Вигаданий', 'Тестовий', 0, stamp, stamp)
  const decision = db.prepare('INSERT INTO decisions(id,decision_number,decision_date,created_at,updated_at) VALUES(?,?,?,?,?)')
  decision.run('d2027', 'TEST-2027', '2027-01-02', stamp, stamp)
  decision.run('d2028', 'TEST-2028', '2028-01-02', stamp, stamp)
  const insert = db.prepare('INSERT INTO assignments(id,recipient_id,decision_id,aid_type_id,amount_minor,status,created_at,updated_at,paid_on) VALUES(?,?,?,?,?,?,?,?,?)')
  statuses.forEach((status, i) => insert.run(String.fromCharCode(97 + i), 'person', 'd2027', 'aid-social-treatment', 1000000 + i * 500000, status, stamp, stamp, status === 'Виплачено' ? '2027-02-01' : null))
  insert.run('other-year', 'person', 'd2028', 'aid-social-treatment', 300000, 'Призначено', stamp, stamp, null)
  return { db, reopen }
}
const input = (status, extra = {}) => ({ assignmentIds: ['a', 'b'], year: 2027, status, ...extra })
const rows = db => db.prepare('SELECT * FROM assignments ORDER BY id').all()
const snapshot = db => JSON.stringify({ assignments: rows(db), payouts: db.prepare('SELECT * FROM payouts ORDER BY id').all() })
const assertNoPayouts = db => assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payouts').get().n, 0)

for (const [from, to] of [['Призначено', 'В роботі'], ['В роботі', 'Призначено']]) {
  test(from + ' → ' + to + ': all records updated, unrelated fields preserved', t => {
    const { db } = fixture(t, [from, from]); const before = rows(db)
    assert.deepEqual(changeAssignmentStatuses(db, input(to)), { ok: true, updatedCount: 2, unchangedCount: 0 })
    for (const row of rows(db)) {
      const old = before.find(item => item.id === row.id)
      if (row.id === 'other-year') { assert.deepEqual(row, old); continue }
      assert.equal(row.status, to)
      for (const field of ['recipient_id', 'decision_id', 'aid_type_id', 'amount_minor', 'direction', 'funding_source', 'created_at', 'paid_on']) assert.equal(row[field], old[field], field)
    }
    assertNoPayouts(db)
  })
}

test('Mixed unpaid statuses → paid: explicit date, unchanged full sums, no new payouts', t => {
  const { db } = fixture(t, ['Призначено', 'В роботі'])
  assert.equal(changeAssignmentStatuses(db, input('Виплачено', { paidOn: '2027-02-28' })).ok, true)
  const changed = rows(db).filter(row => row.id !== 'other-year')
  assert(changed.every(row => row.status === 'Виплачено' && row.paid_on === '2027-02-28'))
  assert.deepEqual(changed.map(row => row.amount_minor), [1000000, 1500000]); assertNoPayouts(db)
  const after = snapshot(db)
  const repeat = changeAssignmentStatuses(db, input('Виплачено', { paidOn: '2027-02-28' }))
  assert.equal(repeat.ok, false); assert.equal(repeat.reason, 'conflict'); assert.equal(snapshot(db), after)
})

test('Paid IDs are rejected directly by the database operation, atomically', t => {
  const { db } = fixture(t, ['Призначено', 'Виплачено']); const before = snapshot(db)
  const result = changeAssignmentStatuses(db, input('В роботі'))
  assert.equal(result.ok, false); assert.equal(result.reason, 'conflict'); assert.equal(snapshot(db), before)
})

test('Wrong year or missing ID rejects the entire batch', t => {
  const { db } = fixture(t); const before = snapshot(db)
  for (const id of ['other-year', 'missing']) {
    const result = changeAssignmentStatuses(db, input('В роботі', { assignmentIds: ['a', id] }))
    assert.equal(result.ok, false); assert.equal(snapshot(db), before)
  }
})

test('Invalid status, IDs, year and payment dates are rejected without writes', t => {
  const { db } = fixture(t); const before = snapshot(db)
  const invalid = [null, {}, input('Невідомий статус'), input('В роботі', { assignmentIds: [] }), input('В роботі', { assignmentIds: ['a', 'a'] }), input('В роботі', { assignmentIds: [1] }), input('В роботі', { year: '2027' }), input('В роботі', { year: 1999 }), ...[undefined, '', '2027-02-29', '2027-02-31', '29.02.2028', '0000-01-01', '2027-01-02T00:00:00Z'].map(paidOn => input('Виплачено', { paidOn }))]
  for (const request of invalid) { const result = changeAssignmentStatuses(db, request); assert.equal(result.ok, false); assert.equal(result.reason, 'validation'); assert.equal(snapshot(db), before) }
})

test('SQL failure on the second row rolls back the first row and releases the transaction', t => {
  const { db } = fixture(t); const before = snapshot(db)
  db.exec("CREATE TRIGGER fail_batch BEFORE UPDATE ON assignments WHEN OLD.id='b' BEGIN SELECT RAISE(ABORT, 'isolated test failure'); END")
  const result = changeAssignmentStatuses(db, input('В роботі'))
  assert.equal(result.ok, false); assert.equal(result.reason, 'storage'); assert.equal(snapshot(db), before)
  db.exec('DROP TRIGGER fail_batch')
  assert.equal(changeAssignmentStatuses(db, input('В роботі')).ok, true)
})

test('No-op statuses retain updated_at and are counted separately', t => {
  const { db } = fixture(t, ['В роботі', 'Призначено'])
  const before = db.prepare("SELECT * FROM assignments WHERE id='a'").get()
  assert.deepEqual(changeAssignmentStatuses(db, input('В роботі')), { ok: true, updatedCount: 1, unchangedCount: 1 })
  assert.deepEqual(db.prepare("SELECT * FROM assignments WHERE id='a'").get(), before)
  const after = snapshot(db)
  assert.deepEqual(changeAssignmentStatuses(db, input('В роботі')), { ok: true, updatedCount: 0, unchangedCount: 2 })
  assert.equal(snapshot(db), after)
})

test('Legacy payment rows are preserved, unpaid status clears assignment paid_on', t => {
  const { db } = fixture(t)
  db.prepare('INSERT INTO payouts(id,assignment_id,amount_minor,paid_on,created_at) VALUES(?,?,?,?,?)').run('legacy', 'a', 1000000, '2027-01-03', '2027-01-03T00:00:00.000Z')
  db.prepare("UPDATE assignments SET paid_on='2027-01-03' WHERE id='a'").run()
  const payments = JSON.stringify(db.prepare('SELECT * FROM payouts').all())
  assert.equal(changeAssignmentStatuses(db, input('В роботі')).ok, true)
  assert.equal(db.prepare("SELECT paid_on FROM assignments WHERE id='a'").get().paid_on, null)
  assert.equal(changeAssignmentStatuses(db, input('Виплачено', { paidOn: '2027-03-04' })).ok, true)
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM payouts').all()), payments)
})

test('Successful change survives closing and reopening the isolated database', t => {
  const { db, reopen } = fixture(t)
  assert.equal(changeAssignmentStatuses(db, input('Виплачено', { paidOn: '2027-04-05' })).ok, true)
  db.close()
  const reopened = reopen()
  assert.equal(reopened.prepare("SELECT COUNT(*) AS n FROM assignments WHERE status='Виплачено' AND paid_on='2027-04-05'").get().n, 2)
  assertNoPayouts(reopened)
  assert.equal(reopened.prepare('PRAGMA foreign_key_check').all().length, 0)
})

test('Selection: paid excluded, partial/all states, filtered set and year reset', () => {
  const eligible = eligibleAssignmentIds([{ id: 'a', status: 'Призначено' }, { id: 'b', status: 'В роботі' }, { id: 'c', status: 'Виплачено' }])
  assert.deepEqual(eligible, ['a', 'b'])
  assert.deepEqual(selectionState(eligible, new Set()), { checked: false, indeterminate: false })
  assert.deepEqual(selectionState(eligible, new Set(['a'])), { checked: false, indeterminate: true })
  assert.deepEqual(selectionState(eligible, new Set(eligible)), { checked: true, indeterminate: false })
  assert.deepEqual([...toggleEligibleSelection(eligible, new Set(['a']))], ['a', 'b'])
  assert.equal(toggleEligibleSelection(eligible, new Set(eligible)).size, 0)
  assert.deepEqual([...keepEligibleSelection(new Set(['a', 'b', 'c']), ['b'])], ['b'])
  assert.equal(selectionForYear({ year: 2027, ids: new Set(['a']) }, 2028, eligible).size, 0)
  assert.deepEqual([...selectionForYear({ year: 2027, ids: new Set(['a']) }, 2027, eligible)], ['a'])
  assert.deepEqual(selectionState([], new Set()), { checked: false, indeterminate: false })
})

test('Static UI/IPC flow: one bulk call, no filter/sort/year reset, guarded date entry', () => {
  const registry = readFileSync(new URL('../src/AidRegistry.tsx', import.meta.url), 'utf8')
  const success = registry.slice(registry.indexOf('{batchIds && <BatchAssignmentStatusModal'), registry.indexOf('{deletePreview &&'))
  for (const setter of ['setSearch(', 'setFilters(', 'setSort(', 'setYear(']) assert(!success.includes(setter), setter)
  assert(success.includes('setSelection({ year, ids: new Set() })'))
  assert(success.includes('void refresh(year)'))
  const modal = readFileSync(new URL('../src/components/BatchAssignmentStatusModal.tsx', import.meta.url), 'utf8')
  assert.equal((modal.match(/assignmentRepository.changeStatuses\(/g) || []).length, 1)
  assert(modal.includes('if (inFlight.current) return')); assert(modal.includes('isIsoCalendarDate(paidOn)')); assert(modal.includes("useState('')")); assert(!modal.includes('todayIsoDate'))
  const records = readFileSync(new URL('../electron/records-ipc.ts', import.meta.url), 'utf8')
  assert(records.includes("trustedIpcMain as ipcMain")); assert(records.includes("ipcMain.handle('assignments:change-statuses'"))
})
