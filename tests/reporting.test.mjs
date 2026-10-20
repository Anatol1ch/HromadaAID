import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openAppDatabase } from '../electron/database.ts'
import { registerRecordsIpc } from '../electron/records-ipc.ts'
import { dashboardSummary, reportSummary } from '../electron/financial-summary.ts'
import { reportGroups, reportNumbers, reportTotals, parsePlanMoney, reportPeriodText } from '../src/lib/reporting.ts'
import { handlers } from './fakes/ipc-security.mjs'
import { previewDeletion, executeDeletion } from '../electron/deletion-service.ts'

function fixture(t) {
 const root=mkdtempSync(join(tmpdir(),'hromada-report-test-')),connections=[]
 const open=()=>{const db=openAppDatabase(root);connections.push(db);registerRecordsIpc(db);return db}
 t.after(()=>{for(const db of connections)try{db.close()}catch{};assert.equal(dirname(resolve(root)),resolve(tmpdir()));rmSync(root,{recursive:true,force:true})})
 const db=open(),call=(channel,...args)=>JSON.parse(JSON.stringify(handlers.get(channel)({},...args)))
 return {db,root,open,call}
}
const plan={year:2026,aidTypeId:'aid-social-treatment',plannedRecipientCount:10,plannedAmountMinor:100000}

test('Report headings use full year wording, Roman quarters and exact inclusive calendar ranges',()=>{
 assert.deepEqual(reportPeriodText(2027,{kind:'month',value:1}),{label:'січень 2027 року',range:'з 01.01.2027 по 31.01.2027'})
 assert.equal(reportPeriodText(2028,{kind:'month',value:2}).range,'з 01.02.2028 по 29.02.2028')
 assert.equal(reportPeriodText(2027,{kind:'month',value:2}).range,'з 01.02.2027 по 28.02.2027')
 for(const [index,end] of ['31.03.2027','30.06.2027','30.09.2027','31.12.2027'].entries()){
  const period=reportPeriodText(2027,{kind:'quarter',value:index+1})
  assert.equal(period.label,`${['I','II','III','IV'][index]} квартал 2027 року`)
  assert.equal(period.range,`з 01.${String(index*3+1).padStart(2,'0')}.2027 по ${end}`)
 }
 assert.deepEqual(reportPeriodText(2027,{kind:'annual'}),{label:'2027 року',range:'з 01.01.2027 по 31.12.2027'})
 assert.equal(reportPeriodText(2027,{kind:'year-to-date',endDate:'2027-06-15'}).range,'з 01.01.2027 по 15.06.2027')
 assert.equal(reportPeriodText(2027,{kind:'year-to-month',value:6}).range,'з 01.01.2027 по 30.06.2027')
})

test('Two-field plan preserves retired budget values and uses only planned sums in reports and Overview',t=>{
 const {db,open,call}=fixture(t)
 assert.equal(call('reports:annual-plan-save',plan).ok,true)
 assert.equal(db.prepare('SELECT budget_amount_minor value FROM annual_aid_plans').get().value,null)
 db.prepare('UPDATE annual_aid_plans SET budget_amount_minor=?').run(987654321)
 const updated={...plan,plannedRecipientCount:7,plannedAmountMinor:43210}
 assert.equal(call('reports:annual-plan-save',{...updated,budgetAmountMinor:1}).ok,true)
 assert.equal(db.prepare('SELECT budget_amount_minor value FROM annual_aid_plans').get().value,987654321)
 assert.deepEqual(call('reports:annual-plan-list',2026),[updated])
 const summary=reportSummary(db,2026,{kind:'year-to-date',endDate:'2026-12-31'})
 assert.deepEqual(reportTotals(summary.rows),[7,43210,0,0,7,43210])
 assert.equal('budgetAmountMinor' in summary.rows[0],false)
 assert.equal(dashboardSummary(db,2026).programExecution.find(row=>row.programId==='program-social').plannedMinor,43210)
 db.close();const reopened=open()
 assert.equal(reopened.prepare('SELECT budget_amount_minor value FROM annual_aid_plans').get().value,987654321)
 assert.equal(reopened.prepare('PRAGMA user_version').get().user_version,19)
})

test('Annual plan IPC: zeros, unset, independent years, validation, atomic failure and reopening',t=>{
 const {db,open,call}=fixture(t)
 assert.deepEqual(call('reports:annual-plan-list',2026),[])
 assert.equal(call('reports:annual-plan-save',plan).ok,true)
 const zero={...plan,year:2027,plannedRecipientCount:0,plannedAmountMinor:0}
 assert.equal(call('reports:annual-plan-save',zero).ok,true)
 assert.deepEqual(call('reports:annual-plan-list',2027),[zero])
 assert.deepEqual(call('reports:annual-plan-list',2026),[plan])
 for(const change of [{plannedRecipientCount:-1},{plannedRecipientCount:.5},{plannedAmountMinor:null},{aidTypeId:'absent'},{year:0},{plannedAmountMinor:Number.MAX_SAFE_INTEGER+1}])assert.equal(call('reports:annual-plan-save',{...plan,...change}).ok,false)
 db.exec("CREATE TRIGGER fail_plan BEFORE UPDATE ON annual_aid_plans BEGIN SELECT RAISE(ABORT,'synthetic'); END")
 assert.equal(call('reports:annual-plan-save',{...plan,plannedRecipientCount:30}).ok,false)
 assert.deepEqual(call('reports:annual-plan-list',2026),[plan])
 db.close();open();assert.deepEqual(call('reports:annual-plan-list',2026),[plan])
 assert.equal(parsePlanMoney('0,00'),0);assert.equal(parsePlanMoney('1 234,56'),123456);assert.equal(parsePlanMoney('1.001'),null);assert.equal(parsePlanMoney(''),null)
})

test('Migration 18→19 aggregates existing plans without modifying originals or assignments',t=>{
 const {db,open}=fixture(t)
 db.exec('DROP TABLE annual_aid_plans; DELETE FROM schema_migrations WHERE version=19; PRAGMA user_version=18')
 const insert=db.prepare('INSERT INTO annual_plan_entries(id,year,aid_type_id,reference_label,planned_recipient_count,planned_amount_minor,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
 insert.run('p1',2026,plan.aidTypeId,'A',3,200,'stamp','stamp');insert.run('p2',2026,plan.aidTypeId,'B',null,300,'stamp','stamp')
 insert.run('p3',2027,plan.aidTypeId,'C',null,0,'stamp','stamp')
 const original=db.prepare('SELECT * FROM annual_plan_entries ORDER BY id').all()
 db.close();const next=open()
 assert.equal(next.prepare('PRAGMA user_version').get().user_version,19)
 assert.deepEqual(next.prepare('SELECT * FROM annual_plan_entries ORDER BY id').all(),original)
 const totals=next.prepare('SELECT year,planned_recipient_count n,planned_amount_minor amount,budget_amount_minor budget FROM annual_aid_plans ORDER BY year').all()
 assert.deepEqual(totals.map(row=>({...row})),[{year:2026,n:3,amount:500,budget:null},{year:2027,n:null,amount:0,budget:null}])
 assert.deepEqual(next.prepare('PRAGMA foreign_key_check').all(),[])
})

test('Failed migration 19 rolls back its schema and version and leaves the connection unlocked',t=>{
 const {db,root}=fixture(t)
 db.exec('DROP TABLE annual_aid_plans; DELETE FROM schema_migrations WHERE version=19; PRAGMA user_version=18; CREATE TABLE annual_aid_plans(conflict TEXT)')
 db.close();assert.throws(()=>openAppDatabase(root),/already exists/)
 const check=new DatabaseSync(join(root,'hromada-aid.sqlite'))
 try {assert.equal(check.prepare('PRAGMA user_version').get().user_version,18);assert.equal(check.prepare('SELECT MAX(version) n FROM schema_migrations').get().n,18);check.exec('BEGIN EXCLUSIVE;ROLLBACK')}finally{check.close()}
})

test('All four reports include full ordered catalogs, inactive types and empty programs with zero values',t=>{
 const {db,call}=fixture(t)
 db.exec("UPDATE aid_types SET is_active=0; UPDATE programs SET sort_order=100-sort_order")
 assert.equal(call('catalogs:save',{kind:'program',shortName:'Порожня',officialName:'Порожня програма'}).ok,true)
 const expected=db.prepare('SELECT t.id FROM aid_types t JOIN programs p ON p.id=t.program_id ORDER BY p.sort_order,p.id,t.sort_order,t.id').all().map(row=>row.id)
 for(const period of [{kind:'month',value:3},{kind:'quarter',value:2},{kind:'annual'},{kind:'year-to-date',endDate:'2026-04-15'}]){
  const report=reportSummary(db,2026,period)
  assert.equal(report.periodLabel.toLocaleLowerCase('uk'),reportPeriodText(2026,period).label.toLocaleLowerCase('uk'))
  assert.deepEqual(report.rows.map(row=>row.aidTypeId),expected)
  assert(report.rows.every(row=>reportNumbers(row).every(n=>n===0)))
  assert.equal(reportGroups(report).length,3);assert.deepEqual(reportTotals(report.rows),[0,0,0,0,0,0])
 }
})

test('Paid dates define month/quarter/year/cutoff; existing count methodology and plan−fact remain intact',t=>{
 const {db,call}=fixture(t)
 db.prepare('INSERT INTO recipients(id,last_name,first_name,created_at,updated_at) VALUES(?,?,?,?,?)').run('r','Тест','Приклад','stamp','stamp')
 db.prepare('INSERT INTO decisions(id,decision_number,decision_date,created_at,updated_at) VALUES(?,?,?,?,?)').run('d','1','2026-01-01','stamp','stamp')
 const add=(id,status,date,amount)=>db.prepare('INSERT INTO assignments(id,recipient_id,decision_id,aid_type_id,status,paid_on,amount_minor,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id,'r','d',plan.aidTypeId,status,date,amount,'stamp')
 add('a','Виплачено','2026-03-15',100);add('b','Виплачено','2026-03-16',200);add('c','Виплачено','2026-04-01',400)
 add('pending','Очікує рішення',null,900);add('assigned','Призначено',null,900)
 add('old','Виплачено','2025-12-31',800);add('invalid','Виплачено','2026-02-31',800)
 assert.equal(call('reports:annual-plan-save',{...plan,plannedRecipientCount:1,plannedAmountMinor:500}).ok,true)
 const row=period=>reportSummary(db,2026,period).rows.find(row=>row.aidTypeId===plan.aidTypeId)
 assert.equal(row({kind:'month',value:3}).paidAmountMinor,300)
 assert.equal(row({kind:'quarter',value:1}).paidCount,2,'count assignments, even for same recipient')
 assert.equal(row({kind:'annual'}).paidAmountMinor,700)
 assert.deepEqual(reportNumbers(row({kind:'year-to-date',endDate:'2026-03-15'})),[1,500,1,100,0,400])
 assert.deepEqual(reportNumbers(row({kind:'annual'})),[1,500,3,700,-2,-200])
 assert.equal(dashboardSummary(db,2026).programExecution.find(row=>row.programId==='program-social').plannedMinor,500)
 for(const period of [{kind:'year-to-date',endDate:'2027-01-01'},{kind:'year-to-date',endDate:'2026-02-31'},{kind:'month',value:13},null])assert.throws(()=>reportSummary(db,2026,period))
})

test('Existing confirmed catalog deletion accounts for annual plans and rolls back on failure',t=>{
 const {db,call}=fixture(t)
 assert.equal(call('reports:annual-plan-save',plan).ok,true)
 assert(previewDeletion(db,'aidType',plan.aidTypeId).dependencies.some(item=>item.label==='Річні планові показники'&&item.count===1))
 db.exec("CREATE TRIGGER fail_type_delete BEFORE DELETE ON aid_types BEGIN SELECT RAISE(ABORT,'synthetic'); END")
 assert.equal(executeDeletion(db,'aidType',plan.aidTypeId).ok,false)
 assert.deepEqual(call('reports:annual-plan-list',2026),[plan])
 db.exec('DROP TRIGGER fail_type_delete')
 assert.equal(executeDeletion(db,'aidType',plan.aidTypeId).ok,true)
 assert.deepEqual(call('reports:annual-plan-list',2026),[])
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
})
