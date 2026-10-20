import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { openAppDatabase } from '../electron/database.ts'
import { registerRecordsIpc, listAssignments } from '../electron/records-ipc.ts'
import { changeAssignmentStatuses } from '../electron/assignment-status.ts'
import { dashboardSummary, reportSummary } from '../electron/financial-summary.ts'
import { readStatementRows } from '../electron/statement-data.ts'
import { availableAccountingYears, paymentYearError, resolveAccountingYear } from '../electron/accounting-year.ts'
import { initialAccountingYear, rememberAccountingYear } from '../src/lib/accountingYear.ts'
import { handlers } from './fakes/ipc-security.mjs'

function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'hromada-accounting-years-'))
  const db=openAppDatabase(root)
  t.after(()=>{db.close();assert.equal(dirname(resolve(root)),resolve(tmpdir()));assert(basename(root).startsWith('hromada-accounting-years-'));rmSync(root,{recursive:true,force:true})})
  db.prepare('INSERT INTO banks(id,name) VALUES(?,?)').run('bank','Вигаданий банк')
  db.prepare('INSERT INTO bank_details(id,bank_id,mfo,edrpou) VALUES(?,?,?,?)').run('detail','bank','000001','00000001')
  db.prepare('INSERT INTO recipients(id,last_name,first_name,patronymic,rnokpp,passport,bank_details_id,bank_account,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run('person','Вигаданий','Приклад','Тестович','0000000001','ТТ000001','detail','UA000000000000000000000000001','2026-01-01','2026-01-01')
  registerRecordsIpc(db)
  const call=(channel,...args)=>handlers.get(channel)({},...args)
  const decisions={}
  for(const year of [2026,2027]) {
    const result=call('decisions:save',{decisionNumber:'1',decisionDate:year+'-01-02',title:''})
    assert.equal(result.ok,true);decisions[year]=result.decision.id
  }
  const save=(year,status,amount=100,paidOn,decisionId=decisions[year])=>call('assignments:save',{recipientId:'person',decisionId,aidTypeId:'aid-social-treatment',amountMinor:amount,status,paidOn})
  return {db,call,save,decisions}
}

test('Available years grow from 2026 through current+1; saved selection survives while valid', t=>{
  assert.deepEqual(availableAccountingYears(2026),[2026,2027])
  assert.deepEqual(availableAccountingYears(2027),[2026,2027,2028])
  assert.deepEqual(availableAccountingYears(2030),[2026,2027,2028,2029,2030,2031])
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-18T12:00:00Z')})
  assert.equal(resolveAccountingYear(undefined),2026)
  assert.equal(resolveAccountingYear(2027),2027)
  const values=new Map()
  const original=Object.getOwnPropertyDescriptor(globalThis,'localStorage')
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)}})
  t.after(()=>{if(original)Object.defineProperty(globalThis,'localStorage',original);else delete globalThis.localStorage})
  assert.equal(initialAccountingYear(),2026)
  rememberAccountingYear(2027);assert.equal(initialAccountingYear(),2027)
  rememberAccountingYear(9999);assert.equal(initialAccountingYear(),2026)
})

test('Real IPC creates decisions and assignments for 2026 and keeps 2027 records separate',t=>{
  const {db,call,save}=fixture(t)
  assert.equal(save(2026,'Очікує рішення').ok,true)
  assert.equal(save(2026,'Призначено',200).ok,true)
  assert.equal(save(2027,'В роботі',300).ok,true)
  assert.equal(listAssignments(db,2026).assignments.length,2)
  assert.equal(listAssignments(db,2027).assignments.length,1)
  assert.equal(dashboardSummary(db,2026).assignmentCount,1)
  assert.equal(dashboardSummary(db,2026).totalMinor,200)
  assert.equal(dashboardSummary(db,2027).totalMinor,300)
  assert.equal(call('decisions:list').length,2)
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,19)
})

test('Individual, group and bulk saves reject cross-year dates atomically using the actual decision',t=>{
  const {db,call,save,decisions}=fixture(t)
  const a=save(2026,'Призначено').assignment
  const b=save(2026,'В роботі').assignment
  const before=JSON.stringify(db.prepare('SELECT * FROM assignments ORDER BY id').all())
  const input={recipientId:'person',decisionId:decisions[2026],decisionDate:'2027-01-02',aidTypeId:'aid-social-treatment',amountMinor:100,status:'Виплачено',paidOn:'2027-01-03'}
  const individual=call('assignments:save',input,a.id)
  assert.equal(individual.ok,false);assert.match(individual.message,/2026/)
  assert.equal(call('assignments:save',input).ok,false)
  const batch=changeAssignmentStatuses(db,{assignmentIds:[a.id,b.id],year:2026,status:'Виплачено',paidOn:'2027-01-03'})
  assert.equal(batch.ok,false);assert.equal(batch.message,individual.message)
  assert.equal(call('decisions:add-assignments',decisions[2026],[{recipientId:'person',aidTypeId:'aid-social-treatment',amountMinor:100,status:'Призначено'},{recipientId:'person',aidTypeId:'aid-social-treatment',amountMinor:100,status:'Виплачено',paidOn:'2027-01-03'}]).ok,false)
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM assignments ORDER BY id').all()),before)
  const count=call('decisions:list').length
  assert.equal(call('assignments:save',{...input,decisionId:undefined,decisionNumber:'temporary',decisionDate:'2026-12-31'}).ok,false)
  assert.equal(call('decisions:list').length,count,'auto-created decision rolled back')
  assert.equal(changeAssignmentStatuses(db,{assignmentIds:[a.id,b.id],year:2026,status:'Виплачено',paidOn:'2026-12-31'}).ok,true)
  assert.equal(call('decisions:save',{decisionNumber:'1',decisionDate:'2027-02-01',title:''},decisions[2026]).ok,false)
  assert.equal(call('decisions:get',decisions[2026]).decisionDate,'2026-01-02')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payouts').get().n,0)
  assert.equal(paymentYearError('2026-12-31',2026),'')
})

test('Annual plans use independent year keys; editing cannot move a row into another year',t=>{
  const {db,call}=fixture(t)
  for(const [year,amount] of [[2026,100000],[2027,200000]]) assert.equal(call('reports:plan-save',{year,aidTypeId:'aid-social-treatment',referenceLabel:'Тестовий план',plannedRecipientCount:10,plannedAmountMinor:amount}).ok,true)
  const old=call('reports:plan-list',2026)[0]
  assert.equal(old.plannedAmountMinor,100000)
  assert.equal(call('reports:plan-list',2027)[0].plannedAmountMinor,200000)
  assert.equal(call('reports:plan-save',{year:2027,aidTypeId:old.aidTypeId,referenceLabel:old.referenceLabel,plannedRecipientCount:10,plannedAmountMinor:5},old.id).ok,false)
  const name=db.prepare('SELECT p.short_name FROM programs p JOIN aid_types t ON t.program_id=p.id WHERE t.id=?').get('aid-social-treatment').short_name
  assert.equal(dashboardSummary(db,2026).programExecution.find(row=>row.programName===name).plannedMinor,100000)
  assert.equal(dashboardSummary(db,2027).programExecution.find(row=>row.programName===name).plannedMinor,200000)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM annual_plan_entries').get().n,2)
})

test('Monthly, quarterly and annual paid totals use paid_on within each year and exclude pending',t=>{
  const {db,call,save}=fixture(t)
  save(2026,'Призначено',100)
  save(2026,'Виплачено',200,'2026-03-31')
  save(2026,'Виплачено',300,'2026-04-01')
  save(2026,'Виплачено',400,'2026-12-31')
  save(2026,'Очікує рішення',999999)
  save(2027,'Виплачено',500,'2027-01-01')
  const sum=(year,period)=>reportSummary(db,year,period).rows.reduce((n,row)=>n+row.paidAmountMinor,0)
  assert.equal(sum(2026,{kind:'annual'}),900)
  assert.equal(sum(2027,{kind:'annual'}),500)
  for(const [month,amount] of [[1,0],[3,200],[4,300],[12,400]]) assert.equal(sum(2026,{kind:'month',value:month}),amount)
  for(const [quarter,amount] of [[1,200],[2,300],[3,0],[4,400]]) assert.equal(sum(2026,{kind:'quarter',value:quarter}),amount)
  assert.equal(sum(2026,{kind:'year-to-month',value:3}),200)
  assert.equal(dashboardSummary(db,2026).assignmentCount,4)
  assert.equal(dashboardSummary(db,2026).totalMinor,1000)
  assert.equal(dashboardSummary(db,2026).paidTotalMinor,900)
  assert.equal(call('decisions:list').find(row=>row.decisionDate.startsWith('2026')).assignmentCount,4)
})

test('Document data retains template fields, grouping, amounts and bank zeros separately for 2026 and 2027',t=>{
  const {db,save}=fixture(t)
  const a=save(2026,'Призначено',100).assignment,b=save(2026,'Передано до казначейства',200).assignment,c=save(2027,'В роботі',500).assignment
  const rows=readStatementRows(db,[a.id,b.id,c.id],'2026')
  assert.equal(rows.length,2)
  assert.equal(rows.reduce((sum,row)=>sum+row.amount_minor,0),300)
  assert(rows.every(row=>row.decision_date.startsWith('2026')&&row.bank_mfo==='000001'&&row.bank_edrpou==='00000001'))
  assert.equal(readStatementRows(db,[a.id,b.id,c.id],'2027')[0].id,c.id)
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0)
})
