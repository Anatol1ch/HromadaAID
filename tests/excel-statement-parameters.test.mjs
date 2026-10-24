import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, copyFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { externalExcelScriptPath } from '../dist-electron/electron/excel-worker.js'
const python=process.env.HROMADA_TEST_PYTHON ?? join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe')
const powershell=join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe')
test('Excel COM: explicit numbers, dates and periods persist in genuine personal XLS, unchanged summary XLSX and matching PDF', {skip:process.env.HROMADA_TEST_EXCEL!=='1',timeout:180000},async t=>{
  const root=mkdtempSync(join(tmpdir(),'hromada-statement-parameters-'))
  console.log('Synthetic output directory:',root)
  t.after(()=>{if(process.env.HROMADA_KEEP_TEST_OUTPUT==='1')return;assert.equal(dirname(resolve(root)),resolve(tmpdir()));rmSync(root,{recursive:true,force:true})})
  const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex')
  const sources=['reference/Список.xlsx','reference/Зведений список.xlsx'].map(resolvePath=>resolve(resolvePath))
  const hashes=sources.map(hash)
  const snapshot=()=>{
    const p=spawnSync(powershell,['-NoProfile','-NonInteractive','-Command',"Get-Process EXCEL -ErrorAction SilentlyContinue | ForEach-Object { Write-Output ($_.Id.ToString() + ':' + $_.StartTime.ToUniversalTime().Ticks.ToString()) }"],{encoding:'utf8',windowsHide:true})
    return p.stdout.trim().split(/\r?\n/).filter(Boolean)
  }
  const before=snapshot()
  const packagedWorker=externalExcelScriptPath(resolve('release/HromadaAID-Client-portable/resources/app.asar/dist-electron/electron'),'excel-templates.ps1')
  assert.deepEqual(readFileSync(packagedWorker),readFileSync('electron/excel-templates.ps1'))
  for(const [index,kind] of ['personal','summary','personal','summary'].entries()) {
    const culture=index<2?'en-US':'uk-UA'
    const templatePath=join(root,kind+'-'+index+'.xlsx'), pdfPath=join(root,kind+'-'+index+'.pdf')
    copyFileSync(sources[kind==='personal'?0:1],templatePath)
    const dateDisplay=index===0?'29.02.2028':index===1?'17.03.2025':'05.01.2029'
    const number='SYNTHETIC-'+index
    const excelPath=kind==='personal'?join(root,kind+'-'+index+'.xls'):templatePath
    const payload={kind,templatePath,excelPath,pdfPath,documentNumber:number,periodText:'За період з 01.01.2025 по 31.12.2025',aidTypeName:'на надання матеріальної допомоги на лікування',
      records:Array.from({length:index===0?2:1},(_,i)=>({dateDisplay,amount:10000.25+i*5000.5,fullName:'Вигаданий Отримувач Тестович',bankAccount:'UA000000000000000000000000001',bankName:'Вигаданий банк',bankMfo:'000001',bankEdrpou:'00000001',rnokpp:'0000000001',passport:'ТТ000001',registeredAddress:'52151, Тестова область, Тестовий район, с. Приклад, вул. Тестова, буд. 1'})),daily:[{dateDisplay,count:2,amount:25000.75}]}
    const code=await new Promise((done,reject)=>{
      const child=spawn(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',resolve('tests/run-excel-culture.ps1'),'-Script',packagedWorker,'-Culture',culture],{windowsHide:true,stdio:['pipe','pipe','pipe']})
      let error='';child.stderr.setEncoding('utf8');child.stderr.on('data',s=>error+=s);child.stdout.resume();child.on('error',reject);child.stdin.on('error',reject);child.on('close',code=>done({code,error}));child.stdin.end(JSON.stringify(payload).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')))
    })
    assert.equal(code.code,0,code.error)
    let inspectionPath=templatePath
    if(kind==='personal') {
      assert.equal(readFileSync(excelPath).subarray(0,8).toString('hex'),'d0cf11e0a1b11ae1','real OLE/BIFF file, not renamed ZIP')
      inspectionPath=join(root,kind+'-'+index+'-reopened.xlsx')
      const inspect=spawnSync(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',resolve('tests/inspect-personal-xls.ps1')],{input:JSON.stringify({path:excelPath,baselinePath:templatePath,inspectionPath}),encoding:'utf8',windowsHide:true})
      assert.equal(inspect.status,0,inspect.stderr)
    } else assert.equal(readFileSync(excelPath).subarray(0,2).toString(),'PK','summary stays OOXML')

    const inspected=spawnSync(python,['-c',`
import sys,zipfile,xml.etree.ElementTree as E,json
from pypdf import PdfReader
import pypdfium2 as pdfium
path,pdf,kind,number,date=sys.argv[1:]
ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(path) as z:
 strings=E.fromstring(z.read('xl/sharedStrings.xml'))
 texts=[''.join(si.itertext()) for si in strings]
 sheet=E.fromstring(z.read('xl/worksheets/sheet1.xml'))
 cells={}
 for c in sheet.findall('.//m:sheetData/m:row/m:c',ns):
  v=c.find('m:v',ns)
  if v is not None: cells[c.attrib['r']]=texts[int(v.text)] if c.get('t')=='s' else v.text
 header='A4' if kind=='personal' else 'B4'
 period='A9' if kind=='personal' else 'B9'
 assert cells[header].endswith(number), cells[header]
 assert cells[period]=='За період з 01.01.2025 по 31.12.2025'
 assert cells['A13' if kind=='personal' else 'B12']==date
 if kind=='personal':
  assert cells['E13']=='000001' and cells['I13']=='0000000001'
  assert float(cells['G13'])==10000.25 and cells['H13']=='Вигаданий Отримувач Тестович'
 else: assert cells['C12']=='2' and float(cells['D12'])==25000.75
reader=PdfReader(pdf)
text=' '.join((page.extract_text() or '') for page in reader.pages)
assert number in text, text[:300]
assert date in text, text[:300]
assert '01.01.2025' in text and '31.12.2025' in text
render=pdfium.PdfDocument(pdf)
render[0].render(scale=1.2).to_pil().save(pdf+'.png')
print(json.dumps({'pages':len(reader.pages),'header':cells[header],'date':date},ensure_ascii=False))
`,inspectionPath,pdfPath,kind,number,dateDisplay],{encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'}})
    assert.equal(inspected.status,0,inspected.stderr)
    console.log(kind,culture,index,inspected.stdout.trim())
  }
  assert.deepEqual(sources.map(hash),hashes,'original templates unchanged')
  assert.deepEqual(snapshot().filter(process=>!before.includes(process)),[],'no new Excel processes remain')
})
