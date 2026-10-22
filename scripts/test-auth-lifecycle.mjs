import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openInitializedDatabase } from '../dist-server/electron/database.js'
import { createApp } from '../dist-server/server/src/app.js'
import { createFirstAdministrator, authenticateSession } from '../dist-server/server/src/auth.js'
import { isValidPassword, passwordLength } from '../dist-server/shared/password-policy.js'
import { HttpClient, HttpClientError } from '../dist-electron/electron/http-client.js'
import { RemoteAuthSession } from '../dist-electron/electron/auth-session.js'

const directory = await mkdtemp(join(tmpdir(), 'hromada-auth-test-'))
const databasePath = join(directory, 'auth-test.sqlite')
let database, app
const pass = 'abcdefgh'
const checks = []
const check = (name) => { checks.push(name); console.log(`PASS ${name}`) }
try {
  for (const n of [7,8,256,257]) assert.equal(isValidPassword('я'.repeat(n)), n >= 8 && n <= 256)
  assert.equal(isValidPassword('abcdefgh'), true)
  assert.equal(isValidPassword('        '), true)
  assert.equal(isValidPassword(' я😀 абв '), true)
  assert.equal(passwordLength('😀'.repeat(256)), 256)
  assert.equal(isValidPassword('😀'.repeat(257)), false)
  check('shared password boundaries, spaces and Unicode code points')
  database = openInitializedDatabase(databasePath)
  const bootstrap = await createFirstAdministrator(database, { username: 'admin-test', password: pass, displayName: 'Legacy arbitrary full name' })
  assert.equal(bootstrap.ok, true)
  const adminId = bootstrap.value.id
  // Reproduce an existing v26 database without changing historical migrations.
  database.exec('ALTER TABLE users DROP COLUMN first_name; ALTER TABLE users DROP COLUMN last_name; DELETE FROM schema_migrations WHERE version=27; PRAGMA user_version=26;')
  database.close()
  database = openInitializedDatabase(databasePath)
  assert.equal(database.prepare('PRAGMA user_version').get().user_version, 27)
  const migrated = database.prepare('SELECT display_name,first_name,last_name FROM users WHERE id=?').get(adminId)
  assert.equal(migrated.display_name, 'Legacy arbitrary full name'); assert.equal(migrated.first_name, null); assert.equal(migrated.last_name, null)
  check('v26 to v27 migration preserves legacy names and credentials')
  app = createApp(database); app.log.level = 'silent'
  let releaseOld, releaseData, enteredOld, enteredData
  const oldEntered = new Promise(resolve => { enteredOld = resolve })
  const dataEntered = new Promise(resolve => { enteredData = resolve })
  const oldGate = new Promise(resolve => { releaseOld = resolve })
  const dataGate = new Promise(resolve => { releaseData = resolve })
  app.get('/transport/old401', async (_req, reply) => { enteredOld(); await oldGate; return reply.status(401).send({message: 'Потрібна чинна сесія.'}) })
  app.get('/transport/old-data', async () => { enteredData(); await dataGate; return {synthetic: true} })
  await app.listen({ host:'127.0.0.1', port:0 })
  const base = new URL(`http://127.0.0.1:${app.server.address().port}`)
  let session
  const http = new HttpClient(base, 1500, {getAccessToken:()=>session?.accessToken, onUnauthorized:token=>void session?.expired(token)})
  session = new RemoteAuthSession(directory, http, ()=>{})
  await session.initialize()
  assert.equal(session.accessToken, undefined)
  assert.equal((await session.login('admin-test','wrong-password')).ok,false)
  assert.equal((await session.login('admin-test',pass)).ok,true)
  assert.equal((await http.getJson('/auth/me')).displayName,'Legacy arbitrary full name')
  await writeFile(join(directory,'remote-session.dat'),'synthetic-legacy-token')
  let restartedSession
  const restartHttp=new HttpClient(base,1500,{getAccessToken:()=>restartedSession?.accessToken})
  restartedSession=new RemoteAuthSession(directory,restartHttp,()=>{})
  await restartedSession.initialize()
  assert.equal(restartedSession.accessToken,undefined)
  assert.equal(restartedSession.currentState.status,'unauthenticated')
  check('Electron process restart requires a new login and removes legacy persisted token')
  const create = input => http.postJson('/api/users',{input})
  for (const n of [7,257]) { await assert.rejects(create({username:`invalid-${n}`,firstName:null,lastName:null,roles:['viewer'],password:'a'.repeat(n)}),e=>e.status===400) }
  const maximumUser = await create({username:'maximum-length-test',firstName:null,lastName:null,roles:['viewer'],password:'😀'.repeat(256)})
  assert.equal(maximumUser.ok,true)
  const maximumLogin = await http.postJson('/auth/login',{username:'maximum-length-test',password:'😀'.repeat(256)},undefined,{authorize:false})
  assert.equal(maximumLogin.user.username,'maximum-length-test')
  await http.postNoContent('/auth/logout',undefined,{accessToken:maximumLogin.token})
  let user = (await create({username:'synthetic-user',firstName:'Тест',lastName:'Синтетичний',roles:['viewer','planning_specialist'],password:pass})).user
  assert.equal(user.displayName,'Тест Синтетичний')
  user = (await http.putJson(`/api/users/${user.id}`,{input:{username:user.username,firstName:'Нове',lastName:'Прізвище',roles:user.roles},expectedUpdatedAt:user.updatedAt})).user
  assert.equal(user.displayName,'Нове Прізвище')
  assert.equal((await http.getJson('/api/users')).find(u=>u.id===user.id).firstName,'Нове')
  check('real HTTP create/edit names, invalid passwords and full-name responses')
  const userHttp = new HttpClient(base,1500,{getAccessToken:()=>userSession?.accessToken,onUnauthorized:token=>void userSession?.expired(token)})
  let userSession = new RemoteAuthSession(join(directory,'second'),userHttp,()=>{})
  await userSession.initialize(); assert.equal((await userSession.login(user.username,pass)).ok,true)
  assert.equal(userSession.currentState.user.displayName,'Нове Прізвище')
  assert.equal(userSession.currentState.user.permissions.includes('planning.manage'),true)
  assert.equal(userSession.currentState.user.permissions.includes('personal_data.read'),false)
  await assert.rejects(userHttp.getJson('/api/recipients'),e=>e.status===403)
  assert.equal(userSession.currentState.status,'authenticated')
  const updated = await http.putJson(`/api/users/${user.id}`,{input:{username:user.username,firstName:user.firstName,lastName:user.lastName,roles:['viewer']},expectedUpdatedAt:user.updatedAt})
  user=updated.user
  await assert.rejects(userHttp.getJson('/api/catalogs'),e=>e.status===401)
  assert.equal(userSession.accessToken,undefined)
  check('multiple roles, profile, 403 retains session and role changes revoke it')
  for(let i=0;i<4;i++) { assert.equal((await userSession.login(user.username,pass)).ok,true); await userHttp.getJson('/api/catalogs'); await userSession.logout(); assert.equal(userSession.accessToken,undefined); await assert.rejects(userHttp.getJson('/api/catalogs'),e=>e.status===401) }
  assert.equal((await userSession.login(user.username,pass)).ok,true)
  const oldToken=userSession.accessToken
  const stale401=userHttp.getJson('/transport/old401'); const staleData=userHttp.getJson('/transport/old-data')
  // Ensure both network requests entered their handlers before signing out.
  await Promise.all([oldEntered, dataEntered])
  await userSession.logout(); assert.equal((await userSession.login(user.username,pass)).ok,true)
  releaseOld(); releaseData()
  await assert.rejects(stale401,e=>e.status===401); await assert.rejects(staleData,e=>e.status===401)
  assert.equal(userSession.currentState.status,'authenticated'); assert.ok(userSession.accessToken !== oldToken)
  check('repeated login/logout and stale 401/data never affect the next session')
  await http.postJson(`/api/users/${user.id}/status`,{status:'blocked',expectedUpdatedAt:user.updatedAt})
  await assert.rejects(userHttp.getJson('/api/catalogs'),e=>e.status===401)
  assert.equal(userSession.accessToken,undefined)
  user = (await http.getJson(`/api/users/${user.id}`))
  user = (await http.postJson(`/api/users/${user.id}/status`,{status:'active',expectedUpdatedAt:user.updatedAt})).user
  user = (await http.postJson(`/api/users/${user.id}/reset-password`,{newPassword:'        ',expectedUpdatedAt:user.updatedAt})).user
  assert.equal((await userSession.login(user.username,'        ')).ok,true)
  assert.equal(userSession.currentState.status,'password-change-required')
  await assert.rejects(userHttp.getJson('/api/catalogs'),e=>e.status===403)
  assert.equal((await userSession.changePassword('        ','😀'.repeat(8))).ok,true)
  assert.equal(userSession.accessToken,undefined)
  assert.equal((await userSession.login(user.username,'😀'.repeat(8))).ok,true)
  const token=userSession.accessToken
  assert.equal(authenticateSession(database,token,Date.now()+9*60*60*1000).ok,false)
  check('blocking, reset, temporary password change, Unicode login and expiry')
  assert.equal(database.prepare('PRAGMA quick_check').get().quick_check,'ok')
  assert.equal(database.prepare('PRAGMA foreign_key_check').all().length,0)
  check('SQLite quick_check and foreign_key_check')
  await session.logout(); await userSession.logout()
  console.log(`PASS ${checks.length} integration groups; real loopback HTTP, no Fastify inject`)
} finally { if(app) await app.close(); if(database) database.close(); await rm(directory,{recursive:true,force:true}) }
