import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openTestDatabase } from './fakes/database.mjs'
import { registerRecordsFixture } from './fakes/records-fixture.ts'
import { executeDeletion } from '../electron/deletion-service.ts'
import { handlers } from './fakes/ipc-security.mjs'

function fixture(t) {
 const root=mkdtempSync(join(tmpdir(),'hromada-order-test-')), connections=[]
 const open=()=>{const db=openTestDatabase(root);connections.push(db);registerRecordsFixture(db);return db}
 t.after(()=>{for(const db of connections)try{db.close()}catch{};assert.equal(dirname(resolve(root)),resolve(tmpdir()));rmSync(root,{recursive:true,force:true})})
 return {db:open(),open,root}
}
const list=(inactive=true)=>handlers.get('catalogs:list')({},inactive)
const reorder=input=>handlers.get('catalogs:reorder')({},input)
const save=input=>handlers.get('catalogs:save')({},input)
const snapshot=db=>JSON.stringify({programs:db.prepare('SELECT * FROM programs ORDER BY id').all(),types:db.prepare('SELECT * FROM aid_types ORDER BY id').all()})

test('Catalog ordering: initial alphabetical order, atomic program reorder, grouped aid selectors and reopening',t=>{
 const {db,open}=fixture(t)
 const initial=list(),ids=initial.programs.map(p=>p.id)
 assert.deepEqual(ids,db.prepare('SELECT id FROM programs ORDER BY short_name,id').all().map(p=>p.id))
 assert.equal(reorder({kind:'program',ids:[...ids].reverse()}).ok,true)
 assert.deepEqual(list().programs.map(p=>p.id),[...ids].reverse())
 const grouped=list().programs.flatMap(p=>db.prepare('SELECT id FROM aid_types WHERE program_id=? ORDER BY sort_order,id').all(p.id).map(a=>a.id))
 assert.deepEqual(list().aidTypes.map(a=>a.id),grouped)
 db.close();const reopened=open()
 assert.deepEqual(list().programs.map(p=>p.id),[...ids].reverse())
 assert.equal(reopened.prepare('PRAGMA user_version').get().user_version,19)
 assert.deepEqual(reopened.prepare('PRAGMA foreign_key_check').all(),[])
})

test('Aid ordering: independent scopes, inactive entries retained, all assignment fields unchanged',t=>{
 const {db}=fixture(t)
 const stamp='2026-01-01'
 db.prepare('INSERT INTO recipients(id,last_name,first_name,created_at,updated_at) VALUES(?,?,?,?,?)').run('person','Вигаданий','Тестовий',stamp,stamp)
 db.prepare('INSERT INTO decisions(id,decision_number,decision_date,created_at,updated_at) VALUES(?,?,?,?,?)').run('decision','TEST','2026-01-02',stamp,stamp)
 db.prepare('INSERT INTO assignments(id,recipient_id,decision_id,aid_type_id,amount_minor,status,created_at) VALUES(?,?,?,?,?,?,?)').run('assignment','person','decision','aid-social-treatment',10000,'Призначено',stamp)
 const before=db.prepare('SELECT * FROM assignments').all()
 const group=list().aidTypes.filter(a=>a.programId==='program-social'),other=list().aidTypes.filter(a=>a.programId!=='program-social')
 const ids=group.map(a=>a.id).reverse()
 assert.equal(reorder({kind:'aidType',programId:'program-social',ids}).ok,true)
 assert.deepEqual(list().aidTypes.filter(a=>a.programId==='program-social').map(a=>a.id),ids)
 assert.deepEqual(list().aidTypes.filter(a=>a.programId!=='program-social'),other)
 assert.deepEqual(db.prepare('SELECT * FROM assignments').all(),before)
 assert.deepEqual(list(false).aidTypes.filter(a=>a.programId==='program-social').map(a=>a.id),group.filter(a=>a.isActive).map(a=>a.id).reverse())
})

test('Order validation rejects partial, duplicate, unknown, cross-program and stale membership without writes',t=>{
 const {db}=fixture(t),data=list(),ids=data.programs.map(p=>p.id),before=snapshot(db)
 for(const input of [null,{kind:'program',ids:ids.slice(1)},{kind:'program',ids:[ids[0],ids[0]]},{kind:'program',ids:ids.map((id,i)=>i===0?'unknown':id)},{kind:'aidType',programId:'program-social',ids:data.aidTypes.map(a=>a.id)},{kind:'aidType',programId:'unknown',ids:[]}]){
  assert.equal(reorder(input).ok,false);assert.equal(snapshot(db),before)
 }
 save({kind:'program',shortName:'Тестова нова',officialName:'Тестова нова програма'})
 assert.equal(reorder({kind:'program',ids}).ok,false)
})

test('Reordering rolls back every UPDATE when one update fails',t=>{
 const {db}=fixture(t),ids=list().programs.map(p=>p.id).reverse(),before=snapshot(db)
 db.exec(`CREATE TRIGGER fail_order BEFORE UPDATE OF sort_order ON programs WHEN NEW.id='${ids[1]}' BEGIN SELECT RAISE(ABORT,'synthetic'); END`)
 assert.equal(reorder({kind:'program',ids}).ok,false)
 assert.equal(snapshot(db),before)
})

test('New entries append, renames retain positions, program reassignment appends, deletion removes only allowed unused entry',t=>{
 const {db}=fixture(t),before=list().programs.map(p=>p.id)
 assert.equal(save({kind:'program',shortName:'А нова тестова',officialName:'Нова тестова програма'}).ok,true)
 let data=list(),added=data.programs.at(-1)
 assert.deepEqual(data.programs.slice(0,-1).map(p=>p.id),before)
 assert.equal(added.shortName,'А нова тестова')
 assert.equal(save({...added,kind:'program',shortName:'Я перейменована'}).ok,true)
 assert.equal(list().programs.at(-1).id,added.id)
 assert.equal(save({kind:'aidType',programId:'program-social',shortName:'А нова допомога',officialName:'Нова тестова допомога'}).ok,true)
 let type=list().aidTypes.filter(a=>a.programId==='program-social').at(-1)
 assert.equal(type.shortName,'А нова допомога')
 assert.equal(save({...type,kind:'aidType',programId:added.id}).ok,true)
 assert.equal(list().aidTypes.filter(a=>a.programId===added.id).at(-1).id,type.id)
 assert.equal(executeDeletion(db,'aidType',type.id).ok,true)
 assert.equal(executeDeletion(db,'program',added.id).ok,true)
 assert.deepEqual(list().programs.map(p=>p.id),before)
})

function asVersion17(db) {
 db.exec('DROP TABLE annual_aid_plans; DROP INDEX idx_programs_sort; DROP INDEX idx_aid_types_sort; ALTER TABLE programs DROP COLUMN sort_order; ALTER TABLE aid_types DROP COLUMN sort_order; DELETE FROM schema_migrations WHERE version>=18; PRAGMA user_version=17')
}
test('Migration 17→19 preserves every prior catalog value and initializes exact prior alphabetical order',t=>{
 const {db,open}=fixture(t)
 asVersion17(db)
 const before=snapshot(db),programIds=db.prepare('SELECT id FROM programs ORDER BY short_name,id').all().map(p=>p.id)
 const groups=db.prepare('SELECT id FROM programs').all().map(p=>[p.id,db.prepare('SELECT id FROM aid_types WHERE program_id=? ORDER BY short_name,id').all(p.id).map(a=>a.id)])
 db.close();const migrated=open()
 const clean=JSON.stringify({programs:migrated.prepare('SELECT * FROM programs ORDER BY id').all().map(({sort_order,...row})=>row),types:migrated.prepare('SELECT * FROM aid_types ORDER BY id').all().map(({sort_order,...row})=>row)})
 assert.equal(clean,before)
 assert.deepEqual(list().programs.map(p=>p.id),programIds)
 for(const [programId,ids] of groups)assert.deepEqual(list().aidTypes.filter(a=>a.programId===programId).map(a=>a.id),ids)
})
test('Failed migration 18 rolls back both schema additions and rankings and closes failed connection',t=>{
 const {db,root}=fixture(t)
 asVersion17(db);db.exec("CREATE TRIGGER block_migration BEFORE UPDATE ON aid_types BEGIN SELECT RAISE(ABORT,'synthetic migration failure'); END")
 const before=snapshot(db);db.close()
 assert.throws(()=>openTestDatabase(root),/synthetic migration failure/)
 const check=new DatabaseSync(join(root,'hromada-aid.sqlite'))
 try {
  assert.equal(check.prepare('PRAGMA user_version').get().user_version,17)
  assert.equal(check.prepare('SELECT MAX(version) v FROM schema_migrations').get().v,17)
  assert.equal(snapshot(check),before)
  assert.equal(check.prepare('PRAGMA table_info(programs)').all().some(c=>c.name==='sort_order'),false)
  check.exec('BEGIN EXCLUSIVE; ROLLBACK')
 } finally {check.close()}
})
