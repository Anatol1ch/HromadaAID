import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { openTestDatabase } from './fakes/database.mjs'
import { registerRecordsFixture } from './fakes/records-fixture.ts'
import { handlers } from './fakes/ipc-security.mjs'

test('Catalog IPC: create/edit programs and aids preserve linked assignment IDs, status and amounts',t=>{
 const root=mkdtempSync(join(tmpdir(),'hromada-catalog-test-'))
 const db=openTestDatabase(root)
 t.after(()=>{db.close();assert.equal(dirname(resolve(root)),resolve(tmpdir()));rmSync(root,{recursive:true,force:true})})
 handlers.clear();registerRecordsFixture(db)
 const list=()=>handlers.get('catalogs:list')({},true)
 const save=input=>handlers.get('catalogs:save')({},input)
 const stamp='2026-01-01T10:00:00.000Z'
 db.prepare('INSERT INTO recipients(id,last_name,first_name,created_at,updated_at) VALUES(?,?,?,?,?)').run('synthetic-person','Вигаданий','Тестовий',stamp,stamp)
 db.prepare('INSERT INTO decisions(id,decision_number,decision_date,created_at,updated_at) VALUES(?,?,?,?,?)').run('synthetic-decision','TEST','2026-01-02',stamp,stamp)
 db.prepare('INSERT INTO assignments(id,recipient_id,decision_id,aid_type_id,amount_minor,status,created_at) VALUES(?,?,?,?,?,?,?)').run('synthetic-assignment','synthetic-person','synthetic-decision','aid-social-treatment',123456,'Призначено',stamp)
 const before=db.prepare('SELECT * FROM assignments').all()
 let catalogs=list()
 const program=catalogs.programs.find(p=>p.id==='program-social')
 const aid=catalogs.aidTypes.find(a=>a.id==='aid-social-treatment')
 assert.equal(aid.programId,program.id);assert.equal(aid.assignmentCount,1)
 assert.equal(save({...program,expectedUpdatedAt:program.updatedAt,kind:'program',shortName:'Тестова змінена програма'}).ok,true)
 assert.equal(save({...aid,expectedUpdatedAt:aid.updatedAt,kind:'aidType',shortName:'Тестова змінена допомога'}).ok,true)
 assert.deepEqual(db.prepare('SELECT * FROM assignments').all(),before)
 catalogs=list()
 assert.equal(catalogs.programs.find(p=>p.id===program.id).assignmentCount,1)
 assert.equal(catalogs.aidTypes.find(a=>a.id===aid.id).assignmentCount,1)
 assert.equal(save({kind:'program',shortName:'Нова тестова програма',officialName:'Повна тестова програма',isActive:true}).ok,true)
 const added=list().programs.find(p=>p.shortName==='Нова тестова програма')
 assert.equal(save({kind:'aidType',programId:added.id,shortName:'Нова тестова допомога',officialName:'Повна тестова допомога',isActive:true}).ok,true)
 assert.equal(list().aidTypes.find(a=>a.shortName==='Нова тестова допомога').programId,added.id)
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
 assert.deepEqual(db.prepare('SELECT * FROM assignments').all(),before)
})
