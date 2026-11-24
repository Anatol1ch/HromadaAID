import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { openTestDatabase } from './fakes/database.mjs'
import { createApp } from '../server/src/app.ts'
import { createFirstAdministrator } from '../server/src/auth.ts'
import { ROLE_PERMISSIONS } from '../shared/authorization.ts'
import { API_ROUTE_POLICIES } from '../server/src/api-authorization.ts'
import { previewDeletion, executeDeletion } from '../electron/deletion-service.ts'

test('assignment specialist deletes allowed statuses only, through assignment-scoped authorized API', async t => {
  const root = mkdtempSync(join(tmpdir(), 'hromada-assignment-delete-'))
  assert.ok(relative(resolve(tmpdir()), resolve(root)) && !isAbsolute(relative(resolve(tmpdir()), resolve(root))))
  const db = openTestDatabase(root)
  let app
  t.after(async () => { await app?.close(); db.close(); rmSync(root, { recursive: true, force: true }) })
  const stamp = '2026-11-01T00:00:00Z'
  db.prepare('INSERT INTO recipients(id,last_name,first_name,created_at,updated_at) VALUES(?,?,?,?,?)').run('person', 'Тестовий', 'Синтетичний', stamp, stamp)
  db.prepare('INSERT INTO decisions(id,decision_number,decision_date,created_at,updated_at) VALUES(?,?,?,?,?)').run('decision', 'SYN', '2026-01-01', stamp, stamp)
  const aidTypeId = db.prepare('SELECT id FROM aid_types LIMIT 1').get().id
  for (const [id, status] of [['assigned', 'Призначено'], ['working', 'В роботі'], ['treasury', 'Передано до казначейства'], ['paid', 'Виплачено']]) {
    db.prepare('INSERT INTO assignments(id,recipient_id,decision_id,aid_type_id,amount_minor,status,paid_on,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id, 'person', 'decision', aidTypeId, 10000, status, status === 'Виплачено' ? '2026-01-15' : null, stamp, stamp)
  }
  db.prepare('INSERT INTO imported_source_rows(id,source_hash,worksheet,source_row_number,assignment_id,imported_at) VALUES(?,?,?,?,?,?)').run('source-assigned', 'synthetic', 'TEST', 1, 'assigned', stamp)
  db.prepare('INSERT INTO import_review_items(id,import_source_row_id,reason) VALUES(?,?,?)').run('review-assigned', 'source-assigned', 'Синтетична перевірка')
  const created = await createFirstAdministrator(db, { username: 'specialist', password: 'synthetic password' })
  assert.equal(created.ok, true)
  const specialistId = created.value.id
  db.prepare('DELETE FROM user_roles WHERE user_id=?').run(specialistId)
  db.prepare("INSERT INTO user_roles(user_id,role) VALUES(?,'assignment_specialist')").run(specialistId)
  app = createApp(db); app.log.level = 'silent'
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { username: 'specialist', password: 'synthetic password' } })
  assert.equal(login.statusCode, 200)
  const headers = { authorization: `Bearer ${login.json().token}` }
  for (const id of ['assigned', 'working', 'treasury']) {
    const preview = await app.inject({ url: `/api/assignments/${id}/deletion-preview`, headers })
    assert.equal(preview.statusCode, 200)
    if (id === 'assigned') assert.ok(preview.json().dependencies.some(item => item.label === 'Рядки історії імпорту' && item.count === 1))
    const result = await app.inject({ method: 'POST', url: `/api/assignments/${id}/delete`, headers, payload: { confirmationToken: preview.json().confirmationToken } })
    assert.equal(result.statusCode, 200)
    assert.equal(result.json().ok, true)
    assert.equal(db.prepare('SELECT 1 FROM assignments WHERE id=?').get(id), undefined)
    if (id === 'assigned') {
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM imported_source_rows WHERE assignment_id='assigned'").get().n, 0)
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM import_review_items WHERE id='review-assigned'").get().n, 0)
    }
  }
  const blocked = await app.inject({ url: '/api/assignments/paid/deletion-preview', headers })
  assert.equal(blocked.json().status, 'Виплачено')
  const directAttempt = await app.inject({ method: 'POST', url: '/api/assignments/paid/delete', headers, payload: { confirmationToken: blocked.json().confirmationToken } })
  assert.equal(directAttempt.statusCode, 409)
  assert.equal(directAttempt.json().reason, 'status')
  assert.equal(db.prepare("SELECT status FROM assignments WHERE id='paid'").get().status, 'Виплачено')
  assert.equal(db.prepare("SELECT SUM(amount_minor) AS total FROM assignments").get().total, 10000)
  assert.equal((await app.inject({ url: '/api/deletion/assignment/paid', headers })).statusCode, 403)
  assert.equal((await app.inject({ url: `/api/deletion/recipient/person`, headers })).statusCode, 403)
  assert.equal((await app.inject({ method: 'POST', url: '/api/deletion/recipient/person', headers, payload: { confirmationToken: 'x' } })).statusCode, 403)
  assert.equal(ROLE_PERMISSIONS.assignment_specialist.includes('protected_entities.delete'), false)
  assert.equal(ROLE_PERMISSIONS.assignment_specialist.includes('assignments.delete'), true)
  for (const role of ['payment_specialist', 'planning_specialist', 'viewer']) {
    assert.equal(ROLE_PERMISSIONS[role].includes('assignments.delete'), false, `${role} does not gain assignment deletion`)
    assert.equal(ROLE_PERMISSIONS[role].includes('protected_entities.delete'), false)
  }
  assert.ok(API_ROUTE_POLICIES.some(item => item.url === '/api/deletion/:entity/:id' && item.permissions.includes('protected_entities.delete')))
  assert.ok(ROLE_PERMISSIONS.administrator.includes('protected_entities.delete'))
  db.prepare("UPDATE user_roles SET role='administrator' WHERE user_id=?").run(specialistId)
  const adminLogin = await app.inject({ method: 'POST', url: '/auth/login', payload: { username: 'specialist', password: 'synthetic password' } })
  assert.equal(adminLogin.statusCode, 200)
  const adminHeaders = { authorization: `Bearer ${adminLogin.json().token}` }
  const adminPreview = await app.inject({ url: '/api/deletion/assignment/paid', headers: adminHeaders })
  assert.equal(adminPreview.statusCode, 200)
  const adminDelete = await app.inject({ method: 'POST', url: '/api/deletion/assignment/paid', headers: adminHeaders, payload: { confirmationToken: adminPreview.json().confirmationToken } })
  assert.equal(adminDelete.json().ok, true, 'administrator retains existing paid-assignment deletion permission')
  assert.equal(db.prepare("SELECT 1 FROM assignments WHERE id='paid'").get(), undefined)
})

test('transactional status and historical payout guard reject stale previews without deleting financial dependencies', t => {
  const root = mkdtempSync(join(tmpdir(), 'hromada-assignment-race-'))
  const db = openTestDatabase(root)
  t.after(() => { db.close(); rmSync(root, { recursive: true, force: true }) })
  const stamp = '2026-11-01T00:00:00Z'
  db.prepare('INSERT INTO recipients(id,last_name,first_name,created_at,updated_at) VALUES(?,?,?,?,?)').run('person', 'Тестовий', 'Синтетичний', stamp, stamp)
  db.prepare('INSERT INTO decisions(id,decision_number,decision_date,created_at,updated_at) VALUES(?,?,?,?,?)').run('decision', 'SYN', '2026-01-01', stamp, stamp)
  const aidTypeId = db.prepare('SELECT id FROM aid_types LIMIT 1').get().id
  const insert = db.prepare('INSERT INTO assignments(id,recipient_id,decision_id,aid_type_id,amount_minor,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
  insert.run('race', 'person', 'decision', aidTypeId, 777, 'В роботі', stamp, stamp)
  const preview = previewDeletion(db, 'assignment', 'race')
  db.prepare("UPDATE assignments SET status='Виплачено',paid_on='2026-01-15' WHERE id='race'").run()
  db.prepare('INSERT INTO payouts(id,assignment_id,amount_minor,paid_on,created_at) VALUES(?,?,?,?,?)').run('payout', 'race', 777, '2026-01-15', stamp)
  const before = db.prepare('SELECT * FROM payouts WHERE assignment_id=?').get('race')
  const rejected = executeDeletion(db, 'assignment', 'race', preview.confirmationToken, true)
  assert.equal(rejected.ok, false)
  assert.equal(rejected.reason, 'status')
  assert.equal(db.prepare("SELECT status FROM assignments WHERE id='race'").get().status, 'Виплачено')
  assert.deepEqual(db.prepare('SELECT * FROM payouts WHERE assignment_id=?').get('race'), before)
  // A stale/incorrect token cannot delete an otherwise non-paid assignment either.
  db.prepare("UPDATE assignments SET status='В роботі',paid_on=NULL WHERE id='race'").run()
  db.prepare('DELETE FROM payouts WHERE assignment_id=?').run('race')
  assert.equal(executeDeletion(db, 'assignment', 'race', 'stale-token', true).reason, 'changed')
  assert.ok(db.prepare("SELECT 1 FROM assignments WHERE id='race'").get())
  insert.run('concurrent', 'person', 'decision', aidTypeId, 555, 'В роботі', stamp, stamp)
  const concurrentPreview = previewDeletion(db, 'assignment', 'concurrent')
  db.prepare("UPDATE assignments SET status='Призначено' WHERE id='concurrent'").run()
  assert.equal(executeDeletion(db, 'assignment', 'concurrent', concurrentPreview.confirmationToken, true).reason, 'changed')
  assert.ok(db.prepare("SELECT 1 FROM assignments WHERE id='concurrent'").get())
})
