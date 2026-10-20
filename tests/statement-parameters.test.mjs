import test from 'node:test'
import assert from 'node:assert/strict'
import { statementPlan, statementKey, statementParameterErrors, validateStatementParameters, statementPeriodText } from '../electron/statement-parameters.ts'
const rows=[...Array.from({length:13},()=>({aidTypeId:'a',aidTypeName:'Вид А'})),{aidTypeId:'b',aidTypeName:'Вид Б'}]
const parameters=plan=>plan.map((item,index)=>({...item,documentNumber:'Номер-'+index,documentDate:'2028-02-29',periodStart:'2025-01-01',periodEnd:'2025-12-31'}))
test('Document plan preserves aid grouping and personal capacity of 12; each part has its own key',()=>{
  const plan=statementPlan('personal',rows)
  assert.deepEqual(plan.map(p=>[statementKey(p),p.recordCount]),[['a:0',12],['a:1',1],['b:0',1]])
  assert.deepEqual(statementPlan('summary',rows).map(p=>p.recordCount),[13,1])
})
test('All parameters required, real calendar dates and period order validated without working-year restriction',()=>{
  const plan=statementPlan('personal',rows), values=parameters(plan)
  assert.equal(validateStatementParameters(values,plan).length,3)
  assert.equal(statementPeriodText(values[0]),'За період з 01.01.2025 по 31.12.2025')
  for(const field of ['documentNumber','documentDate','periodStart','periodEnd']) assert.ok(statementParameterErrors({...values[0],[field]:' '})[field])
  assert.ok(statementParameterErrors({...values[0],documentDate:'2026-02-29'}).documentDate)
  assert.ok(statementParameterErrors({...values[0],documentDate:'2026-04-31'}).documentDate)
  assert.ok(statementParameterErrors({...values[0],periodEnd:'2024-01-01'}).periodEnd)
  assert.equal(validateStatementParameters(values.slice(1),plan),null)
  assert.equal(validateStatementParameters([values[0],values[0],values[2]],plan),null)
  assert.equal(validateStatementParameters([{...values[0],aidTypeId:'other'},...values.slice(1)],plan),null)
  assert.equal(validateStatementParameters(null,plan),null)
  const unique=validateStatementParameters(values,plan)
  assert.equal(new Set(unique.map(p=>p.documentNumber)).size,3)
})
