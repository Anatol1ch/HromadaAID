import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openInitializedDatabase } from '../dist-server/electron/database.js'
import { createApp } from '../dist-server/server/src/app.js'
import { createManagedUser } from '../dist-server/server/src/user-admin.js'
import { login } from '../dist-server/server/src/auth.js'
import { allowedDictionarySections, effectivePermissions, hasWorkspacePage, PERMISSIONS, ROLE_PERMISSIONS, USER_ROLES, USER_ROLE_LABELS } from '../dist-server/shared/authorization.js'

const expectedPages = {
  administrator: ['home','overview','assignments','statements','reports','dictionaries','users'],
  assignment_specialist: ['home','assignments','dictionaries'],
  payment_specialist: ['home','statements'],
  planning_specialist: ['home','overview','reports','dictionaries'],
  viewer: ['home','overview'],
}
const expectedDictionaries = {
  administrator: ['people','programs','decisions','banks','plans'],
  assignment_specialist: ['people','decisions','banks'],
  payment_specialist: [],
  planning_specialist: ['programs','plans'],
  viewer: [],
}
const expectedPermissions = {
  administrator: [...PERMISSIONS],
  assignment_specialist: ['catalogs.read','personal_data.read','recipients.manage','banks.manage','decisions.read','decisions.manage','assignments.read','assignments.manage','dashboard.read'],
  payment_specialist: ['personal_data.read','dashboard.read','statements.generate','assignments.change_financial_status'],
  planning_specialist: ['catalogs.read','catalogs.manage','program_approvals.manage','dashboard.read','reports.read','planning.read','planning.manage','reports.export'],
  viewer: ['catalogs.read','dashboard.read'],
}
for (const role of USER_ROLES) {
  for (const page of ['home','overview','assignments','statements','reports','dictionaries','users']) assert.equal(hasWorkspacePage([role],page),expectedPages[role].includes(page),`${role} ${page}`)
  assert.deepEqual(allowedDictionarySections([role]),expectedDictionaries[role],`${role} dictionaries`)
  assert.deepEqual(effectivePermissions([role]),PERMISSIONS.filter(permission=>expectedPermissions[role].includes(permission)),`${role} effective permissions`)
}
assert.deepEqual(allowedDictionarySections(['payment_specialist','planning_specialist']),['programs','plans'])
assert.equal(hasWorkspacePage(['payment_specialist','planning_specialist'],'statements'),true)
assert.equal(hasWorkspacePage(['payment_specialist','planning_specialist'],'reports'),true)
assert.equal(hasWorkspacePage(['payment_specialist','planning_specialist'],'assignments'),false)
assert.deepEqual(effectivePermissions(['payment_specialist','planning_specialist']),PERMISSIONS.filter(permission=>[...expectedPermissions.payment_specialist,...expectedPermissions.planning_specialist].includes(permission)))
assert.ok(ROLE_PERMISSIONS.payment_specialist.includes('statements.generate'))
assert.ok(ROLE_PERMISSIONS.viewer.includes('catalogs.read'), 'viewer needs non-personal catalog labels for Overview charts')
assert.ok(!ROLE_PERMISSIONS.payment_specialist.includes('reports.read'))
assert.ok(!ROLE_PERMISSIONS.viewer.includes('reports.read'))
assert.ok(!ROLE_PERMISSIONS.assignment_specialist.includes('statements.generate'))
console.log('PASS page and dictionary access matrix: 5 roles + combined roles')

const directory=await mkdtemp(join(tmpdir(),'hromada-role-matrix-'))
let db,app
try {
  db=openInitializedDatabase(join(directory,'role-test.sqlite'))
  const users=[]
  for (const role of USER_ROLES) {
    const username=`synthetic-${role}`
    const input={username,firstName:null,lastName:null,roles:[role],password:'synthetic-pass-8'}
    const result=await createManagedUser(db,input)
    assert.equal(result.ok,true)
    const session=await login(db,{username,password:input.password})
    assert.equal(session.ok,true)
    users.push({role,token:session.value.token,id:result.user.id})
  }
  const combinedInput={username:'synthetic-payment-planning',firstName:null,lastName:null,roles:['payment_specialist','planning_specialist'],password:'synthetic-pass-8'}
  assert.equal((await createManagedUser(db,combinedInput)).ok,true)
  const combinedSession=await login(db,{username:combinedInput.username,password:combinedInput.password})
  assert.equal(combinedSession.ok,true)
  app=createApp(db); app.log.level='silent'
  assert.throws(() => app.get('/api/uncovered-rbac-test', async () => ({ ok: true })), /не визначено серверний дозвіл/)
  await app.listen({host:'127.0.0.1',port:0})
  const base=`http://127.0.0.1:${app.server.address().port}`
  const request=(token,path)=>fetch(new URL(path,base),{headers:{authorization:`Bearer ${token}`}})
  const writeRequest=(token,method,path,body)=>fetch(new URL(path,base),{method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)})
  const byRole=Object.fromEntries(users.map(item=>[item.role,item.token]))
  assert.equal((await fetch(new URL('/api/catalogs',base))).status,401,'business route without token')
  assert.equal((await request('invalid-token','/api/catalogs')).status,401,'business route with invalid token')
  assert.equal((await fetch(new URL('/api/catalogs?includeInactive=true',base),{method:'HEAD',headers:{authorization:'Bearer invalid-token'}})).status,401,'HEAD inherits GET authorization')
  const viewerAdminRequests=[
    ['GET','/api/users',undefined],['POST','/api/users',{input:{}}],['PUT','/api/users/not-a-user',{input:{},expectedUpdatedAt:'x'}],
    ['POST','/api/users/not-a-user/status',{status:'blocked',expectedUpdatedAt:'x'}],['POST','/api/users/not-a-user/reset-password',{newPassword:'synthetic-password',expectedUpdatedAt:'x'}],['DELETE','/api/users/not-a-user',{expectedUpdatedAt:'x'}],
  ]
  for(const [method,path,body] of viewerAdminRequests) assert.equal((await writeRequest(byRole.viewer,method,path,body)).status,403,`viewer cannot ${method} ${path}`)
  const admin=users.find(item=>item.role==='administrator')
  const currentAdmin=await (await request(byRole.administrator,`/api/users/${admin.id}`)).json()
  const removeLastRole=await writeRequest(byRole.administrator,'PUT',`/api/users/${admin.id}`,{input:{username:currentAdmin.username,firstName:currentAdmin.firstName,lastName:currentAdmin.lastName,roles:['viewer']},expectedUpdatedAt:currentAdmin.updatedAt})
  assert.equal(removeLastRole.status,409,'last active administrator cannot lose administrator role')
  assert.equal((await writeRequest(byRole.administrator,'POST',`/api/users/${admin.id}/status`,{status:'inactive',expectedUpdatedAt:currentAdmin.updatedAt})).status,409,'last active administrator cannot be deactivated')
  assert.equal((await writeRequest(byRole.administrator,'DELETE',`/api/users/${admin.id}`,{expectedUpdatedAt:currentAdmin.updatedAt})).status,409,'administrator cannot delete own account')
  assert.equal((await writeRequest(byRole.administrator,'POST',`/api/users/${admin.id}/status`,{status:'blocked',expectedUpdatedAt:currentAdmin.updatedAt})).status,409,'administrator cannot block own account')
  console.log('PASS global RBAC coverage, 401/403, administrative route denial and last/self-admin protections')
  for(const role of ['planning_specialist','viewer','payment_specialist']) {
    assert.equal((await request(byRole[role],'/api/recipients')).status,403,`${role} recipients`)
    assert.equal((await request(byRole[role],'/api/banks')).status,403,`${role} banks`)
    assert.equal((await request(byRole[role],'/api/assignments')).status,403,`${role} assignments`)
    assert.equal((await request(byRole[role],'/api/decisions/1')).status,403,`${role} decision details`)
  }
  const statementProbe=async token=>fetch(new URL('/api/statements/snapshot',base),{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({ids:['synthetic-missing'],year:new Date().getFullYear()})})
  assert.equal((await statementProbe(byRole.planning_specialist)).status,403,'planning personal statement snapshot')
  assert.equal((await statementProbe(byRole.viewer)).status,403,'viewer personal statement snapshot')
  assert.equal((await statementProbe(byRole.payment_specialist)).status,409,'payment statement snapshot permission; synthetic id absent')
  assert.equal((await request(combinedSession.value.token,`/api/reports/summary?year=${new Date().getFullYear()}&period=${encodeURIComponent(JSON.stringify({kind:'annual'}))}`)).status,200,'combined planning permission')
  assert.equal((await request(combinedSession.value.token,'/api/recipients')).status,403,'combined role does not imply personal-data access')
  for(const role of ['administrator','assignment_specialist']) {
    assert.equal((await request(byRole[role],'/api/recipients')).status,200,`${role} recipients`)
    assert.equal((await request(byRole[role],'/api/banks')).status,200,`${role} banks`)
  }
  assert.equal((await request(byRole.planning_specialist,`/api/reports/summary?year=${new Date().getFullYear()}&period=${encodeURIComponent(JSON.stringify({kind:'annual'}))}`)).status,200)
  assert.equal((await request(byRole.viewer,`/api/reports/summary?year=${new Date().getFullYear()}&period=${encodeURIComponent(JSON.stringify({kind:'annual'}))}`)).status,403)
  assert.equal((await request(byRole.viewer,`/api/dashboard?year=${new Date().getFullYear()}`)).status,200)
  assert.equal((await request(byRole.planning_specialist,`/api/dashboard?year=${new Date().getFullYear()}`)).status,200)
  assert.equal((await request(byRole.viewer,'/api/catalogs')).status,200)
  assert.equal((await request(byRole.payment_specialist,`/api/statements?year=${new Date().getFullYear()}`)).status,200)
  assert.equal((await request(byRole.viewer,`/api/statements?year=${new Date().getFullYear()}`)).status,403)
  const sensitiveMarkers=['SYNTHETIC-RECIPIENT-NAME','SYNTHETIC-RNOKPP-000001','SYNTHETIC-IBAN-UA000000000000000000000000000','SYNTHETIC-BANK-NAME','SYNTHETIC-MFO-000001','SYNTHETIC-EDRPOU-000001']
  const timestamp=new Date().toISOString()
  db.prepare('INSERT INTO banks(id,name) VALUES(?,?)').run('synthetic-private-bank','SYNTHETIC-BANK-NAME')
  db.prepare('INSERT INTO bank_details(id,bank_id,mfo,edrpou) VALUES(?,?,?,?)').run('synthetic-private-bank-detail','synthetic-private-bank','SYNTHETIC-MFO-000001','SYNTHETIC-EDRPOU-000001')
  db.prepare('INSERT INTO recipients(id,last_name,first_name,patronymic,rnokpp,bank_account,bank_details_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('synthetic-private-recipient','SYNTHETIC-RECIPIENT-NAME','Тест','Користувач','SYNTHETIC-RNOKPP-000001','SYNTHETIC-IBAN-UA000000000000000000000000000','synthetic-private-bank-detail',timestamp,timestamp)
  const activeType=db.prepare('SELECT id FROM aid_types WHERE is_active=1 ORDER BY id LIMIT 1').get()
  const sensitiveDecision='synthetic-private-decision'
  db.prepare('INSERT INTO decisions(id,decision_number,decision_date,title,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(sensitiveDecision,'SYNTHETIC-1','2026-01-01','Синтетичне рішення',timestamp,timestamp)
  db.prepare("INSERT INTO assignments(id,recipient_id,decision_id,aid_type_id,amount_minor,status,created_at,updated_at) VALUES(?,?,?,?,?,'Призначено',?,?)")
    .run('synthetic-private-assignment','synthetic-private-recipient',sensitiveDecision,activeType.id,500000,timestamp,timestamp)
  assert.equal((await writeRequest(byRole.assignment_specialist,'POST','/api/assignments',{input:{status:'Виплачено'}})).status,403,'assignment specialist cannot create paid assignment')
  assert.equal((await writeRequest(byRole.assignment_specialist,'PUT','/api/assignments/synthetic-private-assignment',{input:{status:'Виплачено'},expectedUpdatedAt:timestamp})).status,403,'assignment specialist cannot edit assignment to paid')
  assert.equal((await writeRequest(byRole.assignment_specialist,'POST','/api/assignments/change-statuses',{input:{ids:['synthetic-private-assignment'],status:'Виплачено'},requestId:'synthetic-paid-status-attempt'})).status,403,'assignment specialist cannot batch paid status')
  const paymentStatements=await (await request(byRole.payment_specialist,`/api/statements?year=${new Date().getFullYear()}`)).json()
  assert.ok(paymentStatements.assignments.some(item=>item.id==='synthetic-private-assignment'&&item.recipientName.includes('SYNTHETIC-RECIPIENT-NAME')),'payment specialist receives recipient data in statement workflow')
  db.prepare('INSERT INTO reporting_source_rows(id,source_hash,worksheet,source_row_number,item_label,data_json,formulas_json,report_as_of) VALUES(?,?,?,?,?,?,?,?)')
    .run('synthetic-raw-report-row','synthetic-private-report','ПЛАН',8,'Агрегований рядок',JSON.stringify(['SYNTHETIC-RNOKPP-000001']),JSON.stringify([null]),null)
  assert.equal((await request(byRole.planning_specialist,`/api/reports/source-rows?sheet=${encodeURIComponent('ПЛАН')}`)).status,403,'raw workbook source rows require personal-data permission')
  assert.equal((await request(byRole.viewer,`/api/reports/source-rows?sheet=${encodeURIComponent('ПЛАН')}`)).status,403,'viewer cannot read raw workbook source rows')
  const administratorSourceRows=await (await request(byRole.administrator,`/api/reports/source-rows?sheet=${encodeURIComponent('ПЛАН')}`)).json()
  assert.ok(JSON.stringify(administratorSourceRows).includes('SYNTHETIC-RNOKPP-000001'),'administrator retains raw source-row access')
  const safeRequests=[
    [byRole.viewer,'/api/catalogs'],[byRole.viewer,`/api/dashboard?year=${new Date().getFullYear()}`],
    [byRole.planning_specialist,'/api/catalogs'],[byRole.planning_specialist,`/api/dashboard?year=${new Date().getFullYear()}`],
    [byRole.planning_specialist,`/api/reports/summary?year=${new Date().getFullYear()}&period=${encodeURIComponent(JSON.stringify({kind:'annual'}))}`],
    [byRole.planning_specialist,`/api/reports/annual-plans?year=${new Date().getFullYear()}`],
    [byRole.planning_specialist,`/api/reports/plan-entries?year=${new Date().getFullYear()}`],
    [byRole.planning_specialist,'/api/program-approvals'],
  ]
  for(const [token,path] of safeRequests){const response=await request(token,path);assert.equal(response.status,200,`aggregate response ${path}`);const json=JSON.stringify(await response.json());for(const marker of sensitiveMarkers)assert.ok(!json.includes(marker),`personal marker escaped through ${path}`)}
  console.log('PASS successful viewer/planning API bodies contain no synthetic recipient or bank identifiers')
  console.log('PASS API: personal recipient/bank routes denied to payment, planning, viewer; allowed workflows return expected statuses')
  assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok')
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0)
  console.log('PASS isolated SQLite quick_check and foreign_key_check')
} finally { if(app) await app.close(); if(db) db.close(); await rm(directory,{recursive:true,force:true}) }

