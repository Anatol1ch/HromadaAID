// Optional full main-process route test. Uses only a disposable compiled copy and SQLite profile.
import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, rmSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { openInitializedDatabase } from '../dist-server/electron/database.js'
import { createApp } from '../dist-server/server/src/app.js'
import { createFirstAdministrator } from '../dist-server/server/src/auth.js'
import { HttpClient } from '../dist-electron/electron/http-client.js'

test('Statements IPC: isolated SQLite, independent parameters, actual Excel/PDF and exports', {skip:process.env.HROMADA_TEST_EXCEL!=='1',timeout:180000},async t=>{
 const root=mkdtempSync(join(tmpdir(),'hromada-statements-ipc-'))
 const output=join(root,'build'),profile=join(root,'profile'),runtime=join(output,'electron')
 mkdirSync(output);mkdirSync(profile)
 writeFileSync(join(output,'package.json'),'{"type":"module"}')
 const build=spawnSync(process.execPath,['node_modules/typescript/bin/tsc','-p','tsconfig.electron.json','--outDir',output],{encoding:'utf8',windowsHide:true})
 assert.equal(build.status,0,build.stdout+build.stderr)
 mkdirSync(join(runtime,'reference'))
 for(const name of ['Список.xlsx','Зведений список.xlsx','ПриватБанк.xlsx'])copyFileSync(join('reference',name),join(runtime,'reference',name))
 copyFileSync('electron/excel-templates.ps1',join(runtime,'excel-templates.ps1'))
 copyFileSync('electron/excel-privatbank.ps1',join(runtime,'excel-privatbank.ps1'))
 globalThis.__statementHandlers=new Map()
 globalThis.__statementDialogs=[]
 globalThis.__statementProfile=profile
 const security='data:text/javascript,'+encodeURIComponent('export const trustedIpcMain={handle:(channel,handler)=>globalThis.__statementHandlers.set(channel,handler)}')
 const electron='data:text/javascript,'+encodeURIComponent('export const app={getPath:()=>globalThis.__statementProfile};export const dialog={showSaveDialog:async(options)=>{globalThis.__statementDialogs.push(options);return {canceled:false,filePath:globalThis.__statementExport}}}')
 const hooks=registerHooks({resolve(specifier,context,next){if(specifier==='electron')return {url:electron,shortCircuit:true};if(specifier==='./ipc-security.js')return {url:security,shortCircuit:true};return next(specifier,context)}})
 let db,cleanup,server
 t.after(async()=>{await cleanup?.();await server?.close();db?.close();hooks.deregister();assert.equal(dirname(resolve(root)),resolve(tmpdir()));rmSync(root,{recursive:true,force:true})})
 db=openInitializedDatabase(join(root,'synthetic-server.sqlite'))
 const {registerStatementsIpc,cleanupGeneratedStatements}=await import(pathToFileURL(join(runtime,'statements-ipc.js')))
 cleanup=cleanupGeneratedStatements
 const {statementPlan}=await import(pathToFileURL(join(runtime,'statement-parameters.js')))
 db.prepare('INSERT INTO banks(id,name) VALUES(?,?)').run('bank','Вигаданий банк')
 db.prepare('INSERT INTO bank_details(id,bank_id,mfo,edrpou) VALUES(?,?,?,?)').run('detail','bank','000001','00000001')
 db.prepare('INSERT INTO recipients(id,last_name,first_name,patronymic,rnokpp,passport,bank_details_id,bank_account,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('person','Вигаданий','Отримувач','Тестович','0000000001','ТТ000001','detail','UA000000000000000000000000001','2026-01-01','2026-01-01')
 db.prepare('INSERT INTO decisions(id,decision_number,decision_date,title,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('decision','TEST','2026-01-02','','2026-01-01','2026-01-01')
 db.prepare('INSERT INTO decisions(id,decision_number,decision_date,title,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('decision-2','TEST-2','2026-02-03','','2026-01-01','2026-01-01')
 const aidTypes=db.prepare('SELECT id,short_name FROM aid_types ORDER BY id LIMIT 2').all()
 const ids=[];const selected=[]
 for(let i=0;i<14;i++) {
  const type=aidTypes[i===13?1:0],id='synthetic-'+i
  db.prepare('INSERT INTO assignments(id,recipient_id,decision_id,aid_type_id,amount_minor,status,created_at) VALUES(?,?,?,?,?,?,?)').run(id,'person',i%2?'decision-2':'decision',type.id,100000,'Призначено','2026-01-03T10:00:00.000Z')
  ids.push(id);selected.push({aidTypeId:type.id,aidTypeName:type.short_name})
 }
 await createFirstAdministrator(db,{username:'synthetic-admin',password:'synthetic password'})
 server=createApp(db);server.log.level='silent';await server.listen({host:'127.0.0.1',port:0})
 const http=new HttpClient(new URL(`http://127.0.0.1:${server.server.address().port}`))
 const login=await http.postJson('/auth/login',{username:'synthetic-admin',password:'synthetic password'},undefined,{authorize:false})
 const authenticated=new HttpClient(new URL(http.serverOrigin),5000,{getAccessToken:()=>login.token})
 registerStatementsIpc({readRows:(ids,year)=>authenticated.postJson('/api/statements/snapshot',{ids,year:Number(year)}),readBankRows:(ids,year)=>authenticated.postJson('/api/statements/bank-snapshot',{ids,year})})
 const call=(channel,...args)=>globalThis.__statementHandlers.get(channel)({},...args)
 assert.equal((await call('statements:generate','personal',ids,2026,[])).ok,false)
 assert.equal(readdirSync(join(profile,'generated-documents-temp')).filter(name=>!name.startsWith('.')).length,0)
 for(const kind of ['personal','summary']) {
  const plan=statementPlan(kind,selected)
  const parameters=plan.map((item,i)=>({...item,documentNumber:kind+'-'+i,documentDate:i===0?'2028-02-29':'2029-01-05',periodStart:'2025-01-01',periodEnd:'2025-12-31'}))
  const result=await call('statements:generate',kind,ids,2026,parameters)
  assert.equal(result.ok,true,result.message)
  assert.equal(result.documents.length,kind==='personal'?3:2)
  assert.equal(result.documents.reduce((sum,d)=>sum+d.recordCount,0),14)
  assert.equal(result.documents.reduce((sum,d)=>sum+d.totalMinor,0),1400000)
  for(let i=0;i<result.documents.length;i++) {
   const doc=result.documents[i]
   const expected=parameters.find(p=>p.documentNumber===doc.documentNumber)
   assert.ok(expected);assert.equal(doc.documentDate,expected.documentDate)
   if(kind==='personal') {
    globalThis.__statementExport=join(root,'wrong-extension.xlsx')
    assert.equal((await call('statements:save',doc.id)).ok,false,'personal export rejects a misleading extension')
   }
   const excelExtension=kind==='personal'?'xls':'xlsx'
   globalThis.__statementExport=join(root,kind+'-'+i+'.'+excelExtension)
   assert.equal((await call('statements:save',doc.id)).ok,true)
   const dialog=globalThis.__statementDialogs.at(-1)
   assert.deepEqual(dialog.filters[0].extensions,[excelExtension])
   const expectedName=kind==='personal'?'vf021324210900415'+doc.documentDate.slice(2).replaceAll('-','')+'41059569'+doc.documentNumber+'.xls':'('+doc.documentDate+')('+doc.documentNumber+') – ЗВЕДЕНИЙ СПИСОК ВИПЛАТИ.xlsx'
   assert.equal(dialog.defaultPath,expectedName)
   const excelPath=globalThis.__statementExport
   if(kind==='personal') {
    assert.equal(readFileSync(excelPath).subarray(0,8).toString('hex'),'d0cf11e0a1b11ae1')
    const powershell=join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe')
    const inspected=spawnSync(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',resolve('tests/inspect-personal-xls.ps1')],{input:JSON.stringify({path:excelPath,inspectionPath:join(root,kind+'-'+i+'.xlsx')}),encoding:'utf8',windowsHide:true})
    assert.equal(inspected.status,0,inspected.stderr)
   } else assert.equal(readFileSync(excelPath).subarray(0,2).toString(),'PK')

   globalThis.__statementExport=join(root,kind+'-'+i+'.pdf')
   assert.equal((await call('statements:save-pdf',doc.id)).ok,true)
   assert.ok(readFileSync(globalThis.__statementExport).equals(Buffer.from(doc.pdfBase64,'base64')))
   const python=join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe')
   const checked=spawnSync(python,['-c',`
import sys,zipfile,xml.etree.ElementTree as E
from pypdf import PdfReader
base,kind,number,date,count,total=sys.argv[1:]
ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(base+'.xlsx') as z:
 strings=[''.join(si.itertext()) for si in E.fromstring(z.read('xl/sharedStrings.xml'))]
 sheet=E.fromstring(z.read('xl/worksheets/sheet1.xml'))
 cells={}
 for c in sheet.findall('.//m:c',ns):
  v=c.find('m:v',ns)
  if v is not None: cells[c.attrib['r']]=strings[int(v.text)] if c.get('t')=='s' else v.text
 assert cells['A4' if kind=='personal' else 'B4'].endswith(number)
 display=date[8:10]+'.'+date[5:7]+'.'+date[:4]
 assert cells['A13' if kind=='personal' else 'B12']==display
 if kind=='summary': assert int(cells['C12'])==int(count) and float(cells['D12'])==int(total)/100
 text=' '.join(p.extract_text() or '' for p in PdfReader(base+'.pdf').pages)
 assert number in text and display in text and '01.01.2025' in text and '31.12.2025' in text
`,join(root,kind+'-'+i),kind,doc.documentNumber,doc.documentDate,String(doc.recordCount),String(doc.totalMinor)],{encoding:'utf8',windowsHide:true})
   assert.equal(checked.status,0,checked.stderr)

  }
 }
 const bank=await call('statements:generate-bank',ids.slice(0,1),2026)
 assert.equal(bank.ok,true,bank.message)
 globalThis.__statementExport=join(root,'bank.xlsx')
 assert.equal((await call('statements:save',bank.document.id)).ok,true)
 assert.deepEqual(globalThis.__statementDialogs.at(-1).filters[0].extensions,['xlsx'])
 assert.equal(globalThis.__statementDialogs.at(-1).defaultPath,'('+[new Date().getFullYear(),String(new Date().getMonth()+1).padStart(2,'0'),String(new Date().getDate()).padStart(2,'0')].join('-')+') – ВІДОМІСТЬ ДЛЯ ПРИВАТБАНКУ.xlsx')
 assert.equal(readFileSync(globalThis.__statementExport).subarray(0,2).toString(),'PK','PrivatBank stays XLSX')
 const tempRoot=join(profile,'generated-documents-temp')
 const jobCount=readdirSync(tempRoot).length
 writeFileSync(join(runtime,'excel-templates.ps1'),"$ErrorActionPreference='Stop';throw 'Synthetic conversion failure'")
 const failed=await call('statements:generate','personal',ids.slice(0,1),2026,[{aidTypeId:selected[0].aidTypeId,partIndex:0,documentNumber:'FAIL',documentDate:'2028-02-29',periodStart:'2025-01-01',periodEnd:'2025-12-31'}])
 assert.equal(failed.ok,false)
 assert.equal(readdirSync(tempRoot).length,jobCount,'failed job removed without touching successful previews')
 assert.equal(db.prepare("SELECT COUNT(*) AS count FROM assignments WHERE status='Призначено'").get().count,14)
 console.log('Actual main IPC generated and exported 3 personal + 2 summary documents; all assignment statuses preserved.')
})
