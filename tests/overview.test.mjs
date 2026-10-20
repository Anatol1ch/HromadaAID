import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { openAppDatabase } from '../electron/database.ts'
import { registerRecordsIpc } from '../electron/records-ipc.ts'
import { dashboardSummary } from '../electron/financial-summary.ts'
import { overviewRows, overviewMoney, overviewTypeGroups } from '../src/lib/overview.ts'
import { handlers } from './fakes/ipc-security.mjs'

test('Overview: exact existing metrics, pending exclusion, paid dates, dynamic catalogs and manual order',t=>{
 const root=mkdtempSync(join(tmpdir(),'hromada-overview-test-')),db=openAppDatabase(root)
 t.after(()=>{db.close();assert.equal(dirname(resolve(root)),resolve(tmpdir()));rmSync(root,{recursive:true,force:true})})
 registerRecordsIpc(db)
 const list=()=>handlers.get('catalogs:list')({},true)
 const save=input=>handlers.get('catalogs:save')({},input)
 const stamp='2026-01-01'
 db.prepare('INSERT INTO recipients(id,last_name,first_name,created_at,updated_at) VALUES(?,?,?,?,?)').run('fictional-person','Вигаданий','Тестовий',stamp,stamp)
 db.prepare('INSERT INTO decisions(id,decision_number,decision_date,created_at,updated_at) VALUES(?,?,?,?,?)').run('fictional-decision','TEST','2026-01-02',stamp,stamp)
 for(const [id,status,amount,paidOn] of [['a','Призначено',10000,null],['b','Виплачено',2000,'2026-03-01'],['c','Виплачено',3000,'2026-03-02'],['d','Очікує рішення',777777,null]])db.prepare('INSERT INTO assignments(id,recipient_id,decision_id,aid_type_id,amount_minor,status,paid_on,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id,'fictional-person','fictional-decision','aid-social-treatment',amount,status,paidOn,stamp)
 assert.equal(save({kind:'program',shortName:'Довільна нова програма',officialName:'Повна нова програма'}).ok,true)
 const added=list().programs.at(-1)
 assert.equal(save({kind:'aidType',programId:added.id,shortName:'Новий вид без призначень',officialName:'Повна назва нового виду'}).ok,true)
 const ids=list().programs.map(p=>p.id).reverse()
 assert.equal(handlers.get('catalogs:reorder')({},{kind:'program',ids}).ok,true)
 const data=dashboardSummary(db,2026),catalogs=list(),view=overviewRows(data,catalogs)
 assert.equal(data.assignmentCount,3);assert.equal(data.paidCount,2)
 assert.equal(data.totalMinor,15000);assert.equal(data.paidTotalMinor,5000)
 assert.equal(data.monthlyAmountMinor[0],15000);assert.equal(data.monthlyAmountMinor[2],0)
 assert.deepEqual(view.programs.map(p=>p.programId),ids)
 assert.equal(view.programs[0].programName,added.shortName)
 assert.equal(view.types.find(type=>type.aidTypeName==='Новий вид без призначень').amountMinor,0)
 assert.deepEqual(view.types.map(type=>type.aidTypeName),catalogs.aidTypes.filter(type=>type.isActive || type.id==='aid-social-treatment').map(type=>type.shortName))
 assert.equal(view.types.reduce((sum,type)=>sum+type.amountMinor,0),data.totalMinor)
 assert.equal(view.types.reduce((sum,type)=>sum+type.count,0),data.assignmentCount)
 const before=JSON.stringify(db.prepare('SELECT * FROM assignments ORDER BY id').all())
 assert.equal(save({...added,kind:'program',shortName:'Перейменована нова програма'}).ok,true)
 assert.equal(overviewRows(dashboardSummary(db,2026),list()).programs[0].programName,'Перейменована нова програма')
 assert.equal(JSON.stringify(db.prepare('SELECT * FROM assignments ORDER BY id').all()),before)
 const empty=dashboardSummary(db,2027)
 assert.deepEqual([empty.assignmentCount,empty.paidCount,empty.totalMinor,empty.paidTotalMinor],[0,0,0,0])
 assert.equal(empty.monthlyAmountMinor.length,12)
 assert(overviewMoney(12345).includes('123,45'))
})

test('Presentation groups preserve every aggregate once, catalog order and stable program accents', async()=>{
 const {programTone}=await import('../src/lib/programTone.ts')
 const catalogs={programs:[{id:'program-veterans',shortName:'Ветерани'},{id:'program-social',shortName:'Соціальна'}],aidTypes:[{id:'v',programId:'program-veterans',shortName:'Допомога В'},{id:'s',programId:'program-social',shortName:'Допомога С'}]}
 const types=[{aidTypeName:'Допомога С',amountMinor:125,count:2},{aidTypeName:'Допомога В',amountMinor:0,count:0},{aidTypeName:'Архівна назва',amountMinor:50,count:1}]
 const groups=overviewTypeGroups(types,catalogs)
 assert.deepEqual(groups.map(g=>g.id),['program-veterans','program-social','unmatched'])
 assert.equal(groups.reduce((sum,g)=>sum+g.amountMinor,0),175)
 assert.equal(groups.flatMap(g=>g.types).length,types.length)
 assert.equal(groups.flatMap(g=>g.types).reduce((sum,t)=>sum+t.count,0),3)
 assert.notEqual(programTone('program-social'),programTone('program-veterans'))
 assert.equal(programTone('new-program'),'program-tone-neutral')
 assert.equal(programTone('Програма соціального захисту'),'program-tone-neutral')
 assert.equal(programTone('program-social'),'program-tone-social')
 assert.equal(programTone('program-veterans'),'program-tone-veterans')
 assert.equal(programTone(''),'program-tone-neutral')
})
