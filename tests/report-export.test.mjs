import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { reportPdfFileName, isReportPdfKind } from '../electron/report-filenames.ts'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'

const handlers=new Map()
globalThis.__reportHandlers=handlers
const fakeSecurity='data:text/javascript,'+encodeURIComponent('export const trustedIpcMain={handle:(channel,handler)=>globalThis.__reportHandlers.set(channel,handler)}')
const fakeElectron='data:text/javascript,'+encodeURIComponent('export const BrowserWindow={fromWebContents:sender=>sender.owner};export const dialog={showSaveDialog:(...args)=>globalThis.__reportSaveDialog(...args)}')
const hooks=registerHooks({resolve(specifier,context,next){
 if(context.parentURL?.endsWith('/report-export-ipc.ts')){
  if(specifier==='electron')return next(fakeElectron,context)
  if(specifier==='./ipc-security.js')return next(fakeSecurity,context)
 }
 return next(specifier,context)
}})
const {registerReportExportIpc}=await import('../electron/report-export-ipc.ts')
registerReportExportIpc();hooks.deregister()
const save=(sender,name)=>handlers.get('reports:save-pdf')({sender},name)

test('Report PDF export uses portrait A4, the local creation filename and exact captured bytes',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date(2026,9,18,12).getTime()})
 const root=mkdtempSync(join(tmpdir(),'hromada-report-export-'))
 t.after(()=>{assert.equal(dirname(resolve(root)),resolve(tmpdir()));rmSync(root,{recursive:true,force:true})})
 const bytes=Buffer.from('%PDF-synthetic'),options=[],owner={synthetic:true}
 const sender={owner,printToPDF:async input=>{options.push(input);return bytes}}
 globalThis.__reportSaveDialog=async(window,config)=>{assert.equal(window,owner);assert.equal(config.defaultPath,'[26-10-18][0213242][ЗВІТ] – МІСЯЦЬ.pdf');return {filePath:join(root,'chosen.pdf'),canceled:false}}
 assert.deepEqual(await save(sender,'month'),{ok:true})
 assert.deepEqual(options,[{pageSize:'A4',landscape:false,printBackground:true,preferCSSPageSize:true}])
 assert.deepEqual(readFileSync(join(root,'chosen.pdf')),bytes)
 globalThis.__reportSaveDialog=async()=>({canceled:true})
 assert.deepEqual(await save(sender,'month'),{ok:false,canceled:true});assert.deepEqual(readdirSync(root),['chosen.pdf'])
 globalThis.__reportSaveDialog=async()=>{throw Error('synthetic dialog error')}
 assert.equal((await save(sender,'month')).ok,false)
 assert.equal((await save({owner,printToPDF:async()=>{throw Error('synthetic print error')}},'month')).ok,false)
 assert.equal((await save({owner:null},'month')).ok,false)
})

test('PDF filenames: exact punctuation, two-digit local date and all four tab names',()=>{
 const date=new Date(2026,9,18,12)
 for(const [kind,label] of Object.entries({month:'МІСЯЦЬ',quarter:'КВАРТАЛ',annual:'РІК',cumulative:'З ПОЧАТКУ РОКУ'})){
  assert.equal(reportPdfFileName(kind,date),`[26-10-18][0213242][ЗВІТ] – ${label}.pdf`)
  assert.equal(isReportPdfKind(kind),true)
 }
 assert.equal(reportPdfFileName('annual',new Date(2027,0,2)),'[27-01-02][0213242][ЗВІТ] – РІК.pdf')
 for(const invalid of [null,{},'__proto__','toString','year','annual.pdf'])assert.equal(isReportPdfKind(invalid),false)
})

test('PDF naming uses local calendar dates on either side of UTC midnight',()=>{
 const before=process.env.TZ
 try {
  process.env.TZ='Europe/Kyiv'
  assert.equal(reportPdfFileName('month',new Date('2026-01-01T22:30:00Z')),'[26-01-02][0213242][ЗВІТ] – МІСЯЦЬ.pdf')
  process.env.TZ='America/Los_Angeles'
  assert.equal(reportPdfFileName('month',new Date('2026-01-01T01:30:00Z')),'[25-12-31][0213242][ЗВІТ] – МІСЯЦЬ.pdf')
 } finally {if(before===undefined)delete process.env.TZ;else process.env.TZ=before}
})

test('All export modes use the main-process filename; date is read after PDF capture crosses local midnight',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date(2026,9,18,23,59,59).getTime()})
 const paths=[],owner={synthetic:true}
 globalThis.__reportSaveDialog=async(_owner,config)=>{paths.push(config.defaultPath);return{canceled:true}}
 let captures=0
 const sender={owner,printToPDF:async()=>{if(!captures++)t.mock.timers.tick(2000);return Buffer.from('%PDF-synthetic')}}
 for(const kind of ['month','quarter','annual','cumulative'])assert.deepEqual(await save(sender,kind),{ok:false,canceled:true})
 assert.deepEqual(paths,['МІСЯЦЬ','КВАРТАЛ','РІК','З ПОЧАТКУ РОКУ'].map(label=>`[26-10-19][0213242][ЗВІТ] – ${label}.pdf`))
 assert.equal((await save(sender,'invalid')).ok,false);assert.equal(captures,4)
})
