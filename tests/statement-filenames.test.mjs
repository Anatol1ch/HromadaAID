import { spawnSync } from 'node:child_process'
import test from 'node:test'
import assert from 'node:assert/strict'
import { bankStatementFileName, documentNumberError, statementFileName } from '../electron/statement-filenames.ts'
import { statementParameterErrors } from '../electron/statement-parameters.ts'
const value={documentNumber:'04',documentDate:'2026-10-12'}
test('All three exact default names use the document date and preserve every leading zero',()=>{
 assert.equal(statementFileName('personal',value),'vf0213242109004152610124105956904.xls')
 assert.equal(statementFileName('summary',value),'(2026-10-12)(04) – ЗВЕДЕНИЙ СПИСОК ВИПЛАТИ.xlsx')
 assert.equal(bankStatementFileName(new Date(2026,9,18)), '(2026-10-18) – ВІДОМІСТЬ ДЛЯ ПРИВАТБАНКУ.xlsx')
 assert.equal(statementFileName('personal',{documentDate:'2028-02-29',documentNumber:'0004'}),'vf021324210900415280229410595690004.xls')
 assert.equal(statementFileName('summary',{...value,documentNumber:'А-004'}),'(2026-10-12)(А-004) – ЗВЕДЕНИЙ СПИСОК ВИПЛАТИ.xlsx')
 assert.equal(bankStatementFileName(new Date(2029,0,5)), '(2029-01-05) – ВІДОМІСТЬ ДЛЯ ПРИВАТБАНКУ.xlsx')
})
test('Unsafe numbers are rejected consistently, never silently rewritten',()=>{
 for(const number of ['', ' ', '01/02','..\\file','a:b','a*b','a?b','a"b','a<b','a>b','a|b','a\n0','a\u00000','a'.repeat(256)]) {
  assert.ok(documentNumberError(number),JSON.stringify(number))
  assert.ok(statementParameterErrors({...value,documentNumber:number,aidTypeId:'a',partIndex:0,periodStart:'2025-01-01',periodEnd:'2025-12-31'}).documentNumber)
 }
})

test('Bank filename follows local midnight rather than UTC, in either offset direction',()=>{
 for(const [timezone,instant,expected] of [['Europe/Kyiv','2026-10-17T21:30:00Z','2026-10-18'],['America/Los_Angeles','2026-10-19T01:30:00Z','2026-10-18']]) {
  const source='import { bankStatementFileName } from '+JSON.stringify(new URL('../electron/statement-filenames.ts',import.meta.url).href)+';process.stdout.write(bankStatementFileName(new Date('+JSON.stringify(instant)+')))'
  const result=spawnSync(process.execPath,['--import',new URL('./source-loader.mjs',import.meta.url).href,'--input-type=module','-e',source],{encoding:'utf8',env:{...process.env,TZ:timezone},windowsHide:true})
  assert.equal(result.status,0,result.stderr)
  assert.equal(result.stdout,'('+expected+') – ВІДОМІСТЬ ДЛЯ ПРИВАТБАНКУ.xlsx')
 }
})
