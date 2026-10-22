import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openInitializedDatabase } from '../dist-server/electron/database.js'
import { createApp } from '../dist-server/server/src/app.js'
import { createManagedUser } from '../dist-server/server/src/user-admin.js'
import { login } from '../dist-server/server/src/auth.js'
import { allowedDictionarySections, hasWorkspacePage, ROLE_PERMISSIONS, USER_ROLES, USER_ROLE_LABELS } from '../dist-server/shared/authorization.js'

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
for (const role of USER_ROLES) {
  for (const page of ['home','overview','assignments','statements','reports','dictionaries','users']) assert.equal(hasWorkspacePage([role],page),expectedPages[role].includes(page),`${role} ${page}`)
  assert.deepEqual(allowedDictionarySections([role]),expectedDictionaries[role],`${role} dictionaries`)
}
assert.deepEqual(allowedDictionarySections(['payment_specialist','planning_specialist']),['programs','plans'])
assert.equal(hasWorkspacePage(['payment_specialist','planning_specialist'],'statements'),true)
assert.equal(hasWorkspacePage(['payment_specialist','planning_specialist'],'reports'),true)
assert.equal(hasWorkspacePage(['payment_specialist','planning_specialist'],'assignments'),false)
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
    users.push({role,token:session.value.token})
  }
  const combinedInput={username:'synthetic-payment-planning',firstName:null,lastName:null,roles:['payment_specialist','planning_specialist'],password:'synthetic-pass-8'}
  assert.equal((await createManagedUser(db,combinedInput)).ok,true)
  const combinedSession=await login(db,{username:combinedInput.username,password:combinedInput.password})
  assert.equal(combinedSession.ok,true)
  app=createApp(db); app.log.level='silent'; await app.listen({host:'127.0.0.1',port:0})
  const base=`http://127.0.0.1:${app.server.address().port}`
  const request=(token,path)=>fetch(new URL(path,base),{headers:{authorization:`Bearer ${token}`}})
  const byRole=Object.fromEntries(users.map(item=>[item.role,item.token]))
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
  console.log('PASS API: personal recipient/bank routes denied to payment, planning, viewer; allowed workflows return expected statuses')
  assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok')
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0)
  console.log('PASS isolated SQLite quick_check and foreign_key_check')
} finally { if(app) await app.close(); if(db) db.close(); await rm(directory,{recursive:true,force:true}) }

