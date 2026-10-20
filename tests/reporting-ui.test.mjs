import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { openAppDatabase } from '../electron/database.ts'
import { reportSummary } from '../electron/financial-summary.ts'
import { registerRecordsIpc } from '../electron/records-ipc.ts'
import { handlers } from './fakes/ipc-security.mjs'
import { reportBudgetCode, reportCount, reportMoney } from '../src/lib/reporting.ts'
const runtime=join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const require=createRequire(import.meta.url),{chromium}=require(runtime),{expect}=require(join(runtime,'test.js'))
let server,browser,root,origin,summary,catalogs
before(async()=>{
 root=await mkdtemp(join(tmpdir(),'hromada-report-ui-'))
 const db=openAppDatabase(root)
 summary=reportSummary(db,2027,{kind:'annual'})
 catalogs={programs:db.prepare('SELECT id,short_name shortName,official_name officialName,is_active isActive FROM programs ORDER BY sort_order,id').all(),aidTypes:db.prepare('SELECT t.id,t.short_name shortName,t.official_name officialName,t.program_id programId,t.is_active isActive FROM aid_types t JOIN programs p ON p.id=t.program_id ORDER BY p.sort_order,p.id,t.sort_order,t.id').all()}
 db.close()
 server=await createServer({configFile:false,plugins:[react(),{name:'report-fixture',configureServer(vite){vite.middlewares.use('/__report_test__',async(_req,res,next)=>{try{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(await vite.transformIndexHtml('/__report_test__','<!doctype html><html lang="uk"><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/tests/keyboard-fixture.tsx"></script></body></html>'))}catch(e){next(e)}})}}],cacheDir:join(root,'vite'),server:{host:'127.0.0.1',port:0,hmr:false},clearScreen:false})
 await server.listen();origin=`http://127.0.0.1:${server.httpServer.address().port}`
 browser=await chromium.launch({channel:'msedge',headless:true})
})
after(async()=>{await browser?.close();await server?.close();if(root){assert.equal(dirname(resolve(root)),resolve(tmpdir()));await rm(root,{recursive:true,force:true})}})
async function pageFor(t,view='reports'){
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(5000)
 const errors=[];page.on('pageerror',e=>errors.push(e.message));t.after(async()=>{await page.close();assert.deepEqual(errors,[])})
 await page.addInitScript(({summary,catalogs})=>{
  window.__summary=summary;window.__catalogs=catalogs;window.__plans=[];window.__saves=[];window.__reports=[];window.__pdf=[];window.__fail=false
  window.hromadaAid={catalogs:{list:async()=>window.__catalogs},recipients:{list:async()=>[]},decisions:{list:async()=>[]},reports:{summary:async(year,period)=>{window.__reports.push({year,period});return {...window.__summary,year,periodLabel:period.kind==='year-to-date'?`З 01.01.${year} по ${period.endDate}`:`Тестовий період ${period.kind} ${year}`}},annualPlanList:async year=>window.__plans.filter(p=>p.year===year),annualPlanSave:async input=>{window.__saves.push(input);await new Promise(r=>setTimeout(r,100));if(window.__fail)return{ok:false,message:'Тестова помилка збереження'};window.__plans=window.__plans.filter(p=>p.year!==input.year||p.aidTypeId!==input.aidTypeId).concat(input);return {ok:true}},savePdf:async name=>{window.__pdf.push(name);return{ok:true}}}}
 },{summary,catalogs})
 await page.goto(origin+'/__report_test__');await page.getByRole('button',{name:view,exact:true}).click();return page
}

test('Planning modal: blank vs zero, all fields, invalid focus, failure preservation, dirty cancel and live catalog refresh',async t=>{
 const page=await pageFor(t,'dictionaries')
 await page.getByRole('tab',{name:'Планові показники',exact:true}).click()
 await expect(page.locator('.planning-program .planning-table tbody tr')).toHaveCount(catalogs.aidTypes.length)
 await expect(page.locator('.planning-program .planning-table').first()).toContainText('Не встановлено')
 await page.getByRole('button',{name:'Встановити план',exact:true}).first().click()
 const dialog=page.getByRole('dialog',{name:'Встановити план',exact:true}),inputs=dialog.locator('input[data-plan-field]')
 await expect(inputs).toHaveCount(2);await expect(dialog).not.toContainText('Бюджетні призначення');await expect(inputs.first()).toBeFocused()
 await dialog.getByRole('button',{name:'Зберегти план',exact:true}).click();await expect(dialog.locator('.recipient-field-error')).toHaveCount(2);await expect(inputs.first()).toBeFocused()
 for(let index=0;index<2;index++)await inputs.nth(index).fill('0')
 await page.evaluate(()=>{window.__fail=true})
 await page.keyboard.press('Control+Enter');await expect(dialog).toContainText('Тестова помилка збереження');await expect(inputs.first()).toHaveValue('0')
 await page.evaluate(()=>{window.__fail=false})
 await page.keyboard.press('Control+Enter');await expect(dialog).toHaveCount(0)
 await expect(page.getByRole('button',{name:'Редагувати план',exact:true})).toHaveCount(1)
 const saved=await page.evaluate(()=>window.__saves);assert.equal(saved.length,2);assert.equal(saved[1].plannedRecipientCount,0);assert.equal(saved[1].plannedAmountMinor,0);assert.equal('budgetAmountMinor' in saved[1],false)
 await page.getByRole('button',{name:'Редагувати план',exact:true}).click();await expect(page.locator('[data-plan-field="amount"]')).toHaveValue('0,00')
 await page.locator('[data-plan-field="amount"]').fill('123,45');await page.keyboard.press('Escape');await expect(page.getByRole('alertdialog')).toContainText('Закрити без збереження?');await page.getByRole('button',{name:'Продовжити редагування'}).click();await expect(page.locator('[data-plan-field="amount"]')).toHaveValue('123,45')
 await page.locator('[data-plan-field="count"]').fill('5')
 await page.getByRole('dialog').getByRole('button',{name:'Зберегти план'}).click();await expect(page.getByRole('dialog')).toHaveCount(0)
 await expect(page.locator('.planning-program .planning-table').first()).toContainText('123,45 грн')
 await expect(page.getByLabel('Загальний підсумок плану')).toContainText('123,45 грн')
 await expect(page.locator('.planning-program .planning-table').first().locator('tfoot')).toContainText('123,45 грн')
 await expect(page.locator('.planning-program .planning-table').first().locator('tfoot td').first()).toHaveText('5')
 await page.locator('.planning-program .planning-table').last().getByRole('button',{name:'Встановити план',exact:true}).first().click()
 await page.locator('[data-plan-field="count"]').fill('3');await page.locator('[data-plan-field="amount"]').fill('200,00')
 await page.getByRole('dialog').getByRole('button',{name:'Зберегти план'}).click();await expect(page.getByRole('dialog')).toHaveCount(0)
 await expect(page.getByLabel('Загальний підсумок плану')).toContainText('323,45 грн')
 await expect(page.locator('.planning-total-table tbody td').first()).toHaveText('8')
 await expect(page.locator('.planning-program .planning-table').last().locator('tfoot')).toContainText('200,00 грн')
 await expect(page.getByRole('columnheader',{name:'Бюджетні призначення',exact:true})).toHaveCount(0)
 if(process.env.HROMADA_REPORT_SCREENSHOT)await page.screenshot({path:process.env.HROMADA_REPORT_SCREENSHOT,fullPage:true})
 await page.evaluate(()=>{window.__catalogs.aidTypes.push({id:'new',programId:window.__catalogs.programs[0].id,shortName:'Новий тестовий вид',officialName:'Новий тестовий вид',isActive:true});window.dispatchEvent(new Event('hromada:catalogs-changed'))})
 await expect(page.locator('.planning-program .planning-table')).toContainText(['Новий тестовий вид',...Array(catalogs.programs.length-1).fill('')])
})

test('Planning alignment 52: shared columns align headers, rows, program totals and annual total at every width',async t=>{
 const page=await pageFor(t,'dictionaries')
 await page.getByRole('tab',{name:'Планові показники',exact:true}).click()
 await page.evaluate(()=>{
  const first=window.__catalogs.aidTypes[0],other=window.__catalogs.aidTypes.find(t=>t.programId!==first.programId)
  window.__plans=[{year:2027,aidTypeId:first.id,plannedRecipientCount:5,plannedAmountMinor:12345},{year:2027,aidTypeId:other.id,plannedRecipientCount:3,plannedAmountMinor:20000}]
  window.dispatchEvent(new Event('hromada:catalogs-changed'))
 })
 await expect(page.locator('.planning-total-table tbody td').nth(0)).toHaveText('8')
 await expect(page.locator('.planning-total-table tbody td').nth(1)).toHaveText('323,45 грн')
 await expect(page.locator('.planning-total-table tbody td').nth(2)).toHaveText('')
 const columns=async locator=>locator.evaluateAll(cells=>cells.map(cell=>{const r=cell.getBoundingClientRect();return {x:r.x,width:r.width,align:getComputedStyle(cell).textAlign}}))
 for(const width of [1440,1200,1040,760,480,360]){
  await page.setViewportSize({width,height:1000})
  const reference=await columns(page.locator('.planning-program .planning-table').first().locator('thead th'))
  const rows=page.locator('.planning-program .planning-table tbody tr, .planning-program .planning-table tfoot tr, .planning-total-table tbody tr')
  for(let index=0;index<await rows.count();index++){
   const cells=await columns(rows.nth(index).locator(':scope > th, :scope > td'))
   assert.equal(cells.length,4)
   cells.forEach((cell,i)=>assert(Math.abs(cell.x-reference[i].x)<1&&Math.abs(cell.width-reference[i].width)<1,'shared column '+i+' at '+width))
   assert.equal(cells[1].align,'center');assert.equal(cells[2].align,'center')
  }
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'table scroll stays inside panel '+width)
 }
 if(process.env.HROMADA_PLANNING_SCREENSHOT){await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:process.env.HROMADA_PLANNING_SCREENSHOT,fullPage:true})}
})

test('Reports: four modes, full zero catalog, centered values, cutoff validation and live refresh',async t=>{
 const page=await pageFor(t)
 await expect(page.getByRole('tab')).toHaveCount(4);await expect(page.getByRole('combobox',{name:'Показники звітності'})).toHaveCount(0)
 const table=page.locator('.reporting-screen .aid-report-table')
 await expect(table.locator('tbody tr:not(.aid-report-program):not(.aid-report-subtotal)')).toHaveCount(catalogs.aidTypes.length)
 await expect(table.locator('tfoot')).toContainText('0,00 грн')
 assert.equal(await table.locator('td').first().evaluate(el=>getComputedStyle(el).textAlign),'center')
 for(const label of ['Квартал','Рік','Від початку року']){await page.getByRole('tab',{name:label,exact:true}).click();await expect(page.getByRole('button',{name:'Зберегти PDF',exact:true})).toBeEnabled()}
 await expect(table.getByRole('columnheader')).toHaveCount(10*catalogs.programs.length)
 const input=page.getByPlaceholder('ДД.ММ.РРРР');await input.fill('31.02.2027');await input.blur();await expect(page.getByRole('button',{name:'Зберегти PDF',exact:true})).toBeDisabled()
 await input.fill('15.06.2027');await input.blur();await expect(table.first()).toBeVisible();await expect.poll(()=>page.evaluate(()=>window.__reports.at(-1).period.endDate)).toBe('2027-06-15')
 await page.evaluate(()=>{window.__summary.rows[0].paidCount=2;window.__summary.rows[0].paidAmountMinor=12345;window.dispatchEvent(new Event('hromada:catalogs-changed'))})
 await expect(table.locator('tfoot')).toContainText('123,45 грн');await expect(table.locator('tfoot')).toContainText('-123,45 грн')
 for(const width of [1440,1024,720]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page must not overflow');assert(await table.first().evaluate(el=>el.parentElement.scrollWidth>=el.parentElement.clientWidth))}
})

test('Report controls 50: full-width equal segments, keyboard modes and styled year-bounded calendar',async t=>{
 const page=await pageFor(t),nav=page.getByRole('tablist',{name:'Період звіту'}),tabs=nav.getByRole('tab')
 for(const width of [1440,1040,720,480,360]){
  await page.setViewportSize({width,height:1000})
  const rects=await tabs.evaluateAll(elements=>elements.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}))
  assert(rects.every(r=>Math.abs(r.width-rects[0].width)<1&&Math.abs(r.height-rects[0].height)<1&&Math.abs(r.y-rects[0].y)<1),'four equal horizontal segments '+width)
  const navBox=await nav.boundingBox(),controlBox=await page.locator('.reporting-controls').boundingBox()
  assert(Math.abs(navBox.width-controlBox.width)<1&&Math.abs(navBox.x-controlBox.x)<1,'full content width')
  assert(navBox.y+navBox.height<controlBox.y,'navigation is separate and above parameters')
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no page overflow '+width)
 }
 await page.setViewportSize({width:1040,height:1000})
 await tabs.first().focus();await page.keyboard.press('ArrowRight');await expect(tabs.nth(1)).toBeFocused();await expect(tabs.nth(1)).toHaveAttribute('aria-selected','true')
 await page.keyboard.press('End');await expect(tabs.last()).toBeFocused();await expect(tabs.last()).toHaveAttribute('aria-selected','true')
 const input=page.getByPlaceholder('ДД.ММ.РРРР')
 await expect(input).toHaveAttribute('type','text');await expect(page.locator('.reporting-controls input[type="date"]')).toHaveCount(0)
 await expect(input).toHaveValue('31.12.2027')
 const dateStyle=await input.evaluate(el=>{const s=getComputedStyle(el);return {height:el.getBoundingClientRect().height,radius:s.borderRadius,border:s.borderTopWidth}})
 assert.equal(dateStyle.height,44);assert.equal(dateStyle.radius,'8px');assert.equal(dateStyle.border,'1px')
 await input.focus();await page.keyboard.press('ArrowDown')
 const calendar=page.getByRole('dialog',{name:'Календар вибору дати'})
 await expect(calendar).toBeVisible();await expect(calendar.getByRole('button',{name:'Наступний місяць',exact:true})).toBeDisabled()
 await page.keyboard.press('Escape');await expect(calendar).toHaveCount(0);await expect(input).toBeFocused()
 await input.fill('01.01.2028');await input.blur();await expect(input).toHaveAttribute('aria-invalid','true');await expect(page.getByRole('button',{name:'Зберегти PDF',exact:true})).toBeDisabled()
 await input.fill('15.06.2027');await input.blur();await page.getByRole('button',{name:'Відкрити календар',exact:true}).click()
 await expect(calendar).toBeVisible();await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter')
 await expect(calendar).toHaveCount(0);await expect(input).toHaveValue('16.06.2027')
 await expect.poll(()=>page.evaluate(()=>window.__reports.at(-1).period.endDate)).toBe('2027-06-16')
 await tabs.first().click()
 await expect(nav.locator('[aria-selected="true"]')).toHaveCount(1)
 await expect.poll(()=>tabs.last().evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
 assert.equal(await page.getByRole('combobox',{name:'Місяць',exact:true}).evaluate(el=>el.getBoundingClientRect().height),44)
 if(process.env.HROMADA_REPORT_SCREENSHOT)await page.screenshot({path:process.env.HROMADA_REPORT_SCREENSHOT+'.controls.png',fullPage:true})
})

test('Report presentation 51: program totals share the name row, titles and ranges match print, no duplicate explanations',async t=>{
 const page=await pageFor(t)
 await page.evaluate(()=>{
  Object.assign(window.__summary.rows[0],{plannedRecipientCount:10,plannedAmountMinor:100000,paidCount:3,paidAmountMinor:25000})
  Object.assign(window.__summary.rows[1],{plannedRecipientCount:5,plannedAmountMinor:50000,paidCount:0,paidAmountMinor:0})
  window.dispatchEvent(new Event('hromada:catalogs-changed'))
 })
 for(const [index,label] of ['Місяць','Квартал','Рік','Від початку року'].entries()){
  await page.getByRole('tab',{name:label,exact:true}).click()
  if(index===3){await page.getByPlaceholder('ДД.ММ.РРРР').fill('15.06.2027');await page.getByPlaceholder('ДД.ММ.РРРР').blur()}
  await expect(page.getByRole('button',{name:'Зберегти PDF',exact:true})).toBeEnabled()
  const title=index===3?'Звіт про виконання річного плану':'Звіт про фактично виплачені матеріальні допомоги'
  await expect(page.locator('.reporting-screen h2')).toHaveText(title+(index===2?' за 2027 рік':''))
  await expect(page.locator('.reporting-period > span')).toHaveCount(0)
  await expect(page.locator('.reporting-method, .report-paper footer, .aid-report-subtotal')).toHaveCount(0)
  await expect(page.locator('.reporting-screen')).not.toContainText('Разом за програмою')
  await expect(page.locator('.reporting-screen > header')).not.toContainText(' р.')
  const header=page.locator('.report-paper > header')
  assert.deepEqual(await header.locator(':scope > *').allTextContents(),[reportInstitutionForTest.toLocaleUpperCase('uk'),title.toLocaleUpperCase('uk'),reportBudgetCode.toLocaleUpperCase('uk'),`з 01.01.2027 по ${['31.01.2027','31.03.2027','31.12.2027','15.06.2027'][index]}`])
  assert.equal(await page.locator('.report-paper').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)')
  for(const scope of ['.reporting-screen','.report-paper']){
   const table=page.locator(scope+' .aid-report-table'),program=table.locator('.aid-report-program').first()
   assert.equal(await program.locator('th').evaluate(el=>el.colSpan),1)
   const numbers=index===3?[15,150000,3,25000,12,125000]:[3,25000]
   const formatted=numbers.map((n,i)=>i%2?reportMoney(n):reportCount(n))
   assert.deepEqual((await program.locator('td').allTextContents()).map(text=>text.replace(/\u00a0/g,' ')),formatted.map(text=>text.replace(/\u00a0/g,' ')))
   assert.deepEqual((await table.locator('tfoot td').allTextContents()).map(text=>text.replace(/\u00a0/g,' ')),formatted.map(text=>text.replace(/\u00a0/g,' ')),'program summary is not counted twice')
   await expect(table.locator('tbody tr:not(.aid-report-program)')).toHaveCount(catalogs.aidTypes.length)
  }
 }
 if(process.env.HROMADA_REPORT_SCREENSHOT)await page.screenshot({path:process.env.HROMADA_REPORT_SCREENSHOT+'.structure.png',fullPage:true})
})

test('Print appearance: transparent document on white A4, uniform program rows and only group separators',async t=>{
 const page=await pageFor(t)
 await page.getByRole('tab',{name:'Від початку року',exact:true}).click()
 await expect(page.getByRole('button',{name:'Зберегти PDF',exact:true})).toBeEnabled()
 const read=()=>page.locator('.report-paper').evaluate(paper=>{
  const style=selector=>getComputedStyle(paper.querySelector(selector))
  const cells=Array.from(paper.querySelectorAll('tbody tr:not(.aid-report-program)')).map(row=>Array.from(row.children).map(cell=>({background:getComputedStyle(cell).backgroundColor,left:parseFloat(getComputedStyle(cell).borderLeftWidth),align:getComputedStyle(cell).textAlign})))
  return {white:getComputedStyle(paper).backgroundColor,radius:style('.report-paper-table').borderRadius,clip:style('.report-paper-table').overflow,
   heading:style('thead th').backgroundColor,program:style('.aid-report-program td').backgroundColor,total:style('tfoot td').backgroundColor,
   titleWeight:style('h2').fontWeight,institutionWeight:style('.report-paper-institution').fontWeight,cells}
 })
 const screen=await read()
 assert.equal(screen.white,'rgba(0, 0, 0, 0)');assert.equal(screen.radius,'6px');assert.equal(screen.clip,'hidden')
 assert.equal(screen.heading,'rgb(237, 245, 239)');assert.equal(screen.program,'rgb(243, 245, 244)');assert.equal(screen.total,'rgb(229, 240, 231)')
 assert(Number(screen.titleWeight)>Number(screen.institutionWeight))
 for(const row of screen.cells){row.forEach((cell,index)=>{assert.equal(cell.background,'rgb(255, 255, 255)');if(index>0)assert.equal(cell.align,'center');assert.equal(cell.left>0,index===1||index===3||index===5)})}
 await page.emulateMedia({media:'print'})
 assert.deepEqual(await read(),screen,'preview and PDF use the same table styling')
 await page.emulateMedia({media:'screen'})
})

test('All four real-catalog print layouts produce complete portrait A4 PDFs; long data warns without clipping',async t=>{
 const page=await pageFor(t),paths=[]
 for(const [index,label] of ['Місяць','Квартал','Рік','Від початку року'].entries()){
  await page.getByRole('tab',{name:label,exact:true}).click();await expect(page.getByRole('button',{name:'Зберегти PDF',exact:true})).toBeEnabled()
  const path=join(root,`report-${index}.pdf`);await page.pdf({path,preferCSSPageSize:true,printBackground:true});paths.push(path)
  const buffer=await readFile(path);assert(buffer.length>15000)
  if(process.env.HROMADA_REPORT_PRINT_OUTPUT_DIR)await (await import('node:fs/promises')).copyFile(path,join(process.env.HROMADA_REPORT_PRINT_OUTPUT_DIR,`report-${index}.pdf`))
  const measured=await page.locator('.report-paper').evaluate(el=>({height:el.getBoundingClientRect().height,font:el.style.fontSize,width:el.scrollWidth}));console.log(label,measured)
 }
 // Python checks page count, page dimensions, all complete official names and zero totals.
 const {spawnSync}=await import('node:child_process')
 const python=join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe')
 const validation=spawnSync(python,['-c',`import sys,json,pdfplumber\nfrom pypdf import PdfReader\nitems=json.loads(sys.argv[1])\nfor path in sys.argv[2:]:\n r=PdfReader(path)\n assert len(r.pages)==1,(path,len(r.pages))\n p=r.pages[0];assert abs(float(p.mediabox.width)-595.28)<2 and abs(float(p.mediabox.height)-841.89)<2\n with pdfplumber.open(path) as document:\n  sheet=document.pages[0];chars=[c for c in sheet.chars if c['text'].strip()];margin=12*72/25.4\n  assert min(c['x0'] for c in chars)>=margin and max(c['x1'] for c in chars)<=sheet.width-margin,(path,'horizontal margins',min(c['x0'] for c in chars),max(c['x1'] for c in chars),sheet.width)\n  assert min(c['top'] for c in chars)>=margin and max(c['bottom'] for c in chars)<=sheet.height-margin,(path,'vertical margins')\n text=' '.join(p.extract_text().split())\n for name in items:\n  assert ''.join(name.split()) in ''.join(text.split()),(path,name)\n assert 'Загальний підсумок' in text and '0,00 грн' in text\n assert 'Разом за програмою' not in text and 'Кількість —' not in text and 'Різниця =' not in text\n expected_title='ЗВІТ ПРО ВИКОНАННЯ РІЧНОГО ПЛАНУ' if path.endswith('report-3.pdf') else 'ЗВІТ ПРО ФАКТИЧНО ВИПЛАЧЕНІ МАТЕРІАЛЬНІ ДОПОМОГИ'\n assert ''.join(expected_title.split()) in ''.join(text.split())\n expected_end='31.01.2027' if path.endswith('report-0.pdf') else '31.03.2027' if path.endswith('report-1.pdf') else '31.12.2027'\n assert 'з01.01.2027по'+expected_end in ''.join(text.split())\nprint('4 complete one-page portrait A4 PDFs verified')`,JSON.stringify([reportInstitutionForTest.toLocaleUpperCase('uk'),reportBudgetCode.toLocaleUpperCase('uk'),...summary.programs.map(p=>p.officialName),...summary.rows.map(r=>r.officialName)]),...paths],{encoding:'utf8'})
 assert.equal(validation.status,0,validation.stdout+validation.stderr);console.log(validation.stdout)
 // Render the print layout without leaving artifacts in the user's workspace.
 const preview=process.env.HROMADA_REPORT_PRINT_PREVIEW??join(root,'report-preview.png')
 const render=spawnSync(python,['-c',"import pypdfium2 as p,sys;d=p.PdfDocument(sys.argv[1]);d[0].render(scale=1.5).to_pil().save(sys.argv[2])",paths[3],preview],{encoding:'utf8'});assert.equal(render.status,0,render.stderr)
 await page.evaluate(()=>{const base=window.__summary.rows[0];window.__summary.rows=Array.from({length:100},(_,i)=>({...base,aidTypeId:`long-${i}`,officialName:`Довга тестова назва ${i} — ${base.officialName}`}));window.dispatchEvent(new Event('hromada:catalogs-changed'))})
 await expect(page.locator('.reporting-fit-warning')).toBeVisible();await page.getByRole('button',{name:'Зберегти PDF',exact:true}).click();await expect(page.getByRole('alertdialog')).toContainText('кількох сторінок')
 assert.equal(await page.evaluate(()=>window.__pdf.length),0)
 await page.getByRole('button',{name:'Зберегти всі сторінки',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__pdf.length)).toBe(1)
 await expect(page.locator('.reporting-screen tbody tr:not(.aid-report-program):not(.aid-report-subtotal)')).toHaveCount(100)
 const longPath=join(root,'report-long.pdf');await page.pdf({path:longPath,preferCSSPageSize:true,printBackground:true})
 const longCheck=spawnSync(python,['-c',"from pypdf import PdfReader;import sys;r=PdfReader(sys.argv[1]);assert len(r.pages)>1;text=''.join(''.join(p.extract_text().split()) for p in r.pages);assert all('Довгатестованазва'+str(i)+'—' in text for i in range(100));print('All 100 long rows retained across',len(r.pages),'pages')",longPath],{encoding:'utf8'})
 assert.equal(longCheck.status,0,longCheck.stdout+longCheck.stderr);console.log(longCheck.stdout)
})
const reportInstitutionForTest='Виконавчий комітет Вишнівської селищної ради'

test('Actual App reporting container stays within desktop width and prints without navigation',async t=>{
 const page=await pageFor(t,'app')
 await page.getByRole('button',{name:'Звітність',exact:true}).click()
 await expect(page.getByRole('button',{name:'Зберегти PDF',exact:true})).toBeEnabled()
 for(const width of [1440,1200,1040]){
  await page.setViewportSize({width,height:940})
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  await expect(page.locator('.reporting-screen')).toContainText(reportInstitutionForTest)
 }
 if(process.env.HROMADA_REPORT_SCREENSHOT)await page.screenshot({path:process.env.HROMADA_REPORT_SCREENSHOT+'.report.png',fullPage:true})
 const path=join(root,'real-app.pdf');await page.pdf({path,preferCSSPageSize:true,printBackground:true})
 const {spawnSync}=await import('node:child_process'),python=join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe')
 const check=spawnSync(python,['-c',"from pypdf import PdfReader;import sys;r=PdfReader(sys.argv[1]);assert len(r.pages)==1;t=r.pages[0].extract_text();assert 'Робочий простір' not in t and 'Налаштування' not in t and 'Загальний підсумок' in t",path],{encoding:'utf8'})
 assert.equal(check.status,0,check.stdout+check.stderr)
})

test('Screen reports: uniform program blocks, all zero rows and one overall total in every mode',async t=>{
 const page=await pageFor(t)
 for(const mode of ['Місяць','Квартал','Рік','Від початку року']){
  await page.getByRole('tab',{name:mode,exact:true}).click()
  const blocks=page.locator('.screen-report-program')
  await expect(blocks).toHaveCount(catalogs.programs.length)
  await expect(page.locator('.screen-report-total')).toHaveCount(1)
  await expect(page.locator('.screen-report-program tfoot')).toHaveCount(0)
  assert.deepEqual(await blocks.locator('.aid-report-program th').allTextContents(),catalogs.programs.map(p=>p.officialName))
  await expect(blocks.locator('tbody tr:not(.aid-report-program)')).toHaveCount(catalogs.aidTypes.length)
  await expect(page.locator('.reporting-page [class*="program-tone-"]')).toHaveCount(0)
  const colors=await blocks.locator('.aid-report-program th').evaluateAll(elements=>elements.map(el=>getComputedStyle(el).backgroundColor))
  assert(colors.every(color=>color===colors[0]))
  for(const width of [1440,1040,720,480,360]){
   await page.setViewportSize({width,height:1000})
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'screen report overflow '+width)
  }
 }
 await page.getByRole('button',{name:'dictionaries',exact:true}).click()
 await page.getByRole('tab',{name:'Планові показники',exact:true}).click()
 await expect(page.locator('.planning-program')).toHaveCount(catalogs.programs.length)
 await expect(page.locator('.planning-program[class*="program-tone-"]')).toHaveCount(0)
 const colors=await page.locator('.planning-program > header').evaluateAll(elements=>elements.map(el=>getComputedStyle(el).backgroundColor))
 assert(colors.every(color=>color===colors[0]))
})

test('Program colours are restricted to the programs/aid catalog and stay stable there',async t=>{
 const page=await pageFor(t)
 await expect(page.locator('.screen-report-program')).toHaveCount(catalogs.programs.length)
 await expect(page.locator('.reporting-page [class*="program-tone-"]')).toHaveCount(0)
 await page.getByRole('button',{name:'dictionaries',exact:true}).click()
 await page.getByRole('tab',{name:'Планові показники',exact:true}).click()
 await expect(page.locator('.planning-program')).toHaveCount(catalogs.programs.length)
 await expect(page.locator('.planning-panel [class*="program-tone-"]')).toHaveCount(0)
 await page.getByRole('tab',{name:'Програми та допомоги',exact:true}).click()
 const read=()=>page.locator('.program-catalog-block').evaluateAll(elements=>elements.map(el=>({tone:Array.from(el.classList).find(name=>name.startsWith('program-tone-')),values:['--program-accent','--program-tint','--program-border','--program-text','--program-indicator'].map(token=>getComputedStyle(el).getPropertyValue(token).trim())})))
 const reference=await read(),known={
  'program-tone-social':['#397e8a','#eef7f9','#c4dfe3','#285d68','#397e8a'],
  'program-tone-veterans':['#437551','#f0f7f2','#ccdfd1','#305c3c','#437551'],
 }
 for(const row of reference)assert.deepEqual(row.values,known[row.tone])
 await page.evaluate(()=>{
  window.__catalogs.programs.reverse()
  window.__catalogs.programs[0].shortName='Змінена назва програми'
  window.__catalogs.programs.push({id:'new-program-colour-test',shortName:'Нова програма',officialName:'Нова програма',isActive:true})
  window.dispatchEvent(new Event('hromada:catalogs-changed'))
 })
 await expect(page.locator('.program-catalog-block')).toHaveCount(reference.length+1)
 const after=await read()
 assert.deepEqual(after.slice(0,-1),reference.toReversed())
 assert.equal(after.at(-1).tone,'program-tone-neutral')
 assert.deepEqual(after.at(-1).values,['#68746e','#f5f7f6','#dfe5e1','#4e5c54','#68746e'])
})

test('Print final: long official names, large and negative amounts never wrap or overlap on one clean A4 in all modes',async t=>{
 const page=await pageFor(t),paths=[]
 await page.evaluate(()=>{
  Object.assign(window.__summary.rows[0],{plannedRecipientCount:20,plannedAmountMinor:10000000,paidCount:25,paidAmountMinor:20000000})
  Object.assign(window.__summary.rows[1],{plannedRecipientCount:10,plannedAmountMinor:500000,paidCount:10,paidAmountMinor:500000})
  window.dispatchEvent(new Event('hromada:catalogs-changed'))
 })
 const screenBefore=await page.locator('.reporting-screen').textContent()
 for(const [index,label] of ['Місяць','Квартал','Рік','Від початку року'].entries()){
  await page.getByRole('tab',{name:label,exact:true}).click()
  await expect(page.getByRole('button',{name:'Зберегти PDF',exact:true})).toBeEnabled()
  await expect(page.locator('.reporting-fit-warning')).toHaveCount(0)
  const read=()=>page.locator('.report-paper').evaluate(paper=>({
   width:paper.scrollWidth,height:paper.getBoundingClientRect().height,font:paper.style.fontSize,
   values:[...paper.querySelectorAll('.report-number-value')].map(span=>{const s=span.getBoundingClientRect(),cell=span.parentElement.getBoundingClientRect();return{text:span.textContent,space:getComputedStyle(span).whiteSpace,left:s.left-cell.left,right:cell.right-s.right,height:s.height,line:parseFloat(getComputedStyle(span).lineHeight)}}),
   programs:[...paper.querySelectorAll('.aid-report-program')].map(row=>{const style=getComputedStyle(row.firstElementChild);return{tone:[...row.classList].find(c=>c.startsWith('program-tone-')),background:style.backgroundColor,text:style.color}})
  }))
  const screen=await read()
  assert(screen.width<=696 && screen.height<=269*96/25.4)
  for(const value of screen.values){assert.equal(value.space,'nowrap');assert(value.left>=1&&value.right>=1,'numeric cell cannot overlap neighbours');assert(value.height<=value.line+1,'single line money')}
  if(index===3){assert(screen.values.some(v=>v.text==='-100\u00a0000,00\u00a0грн'));assert(screen.values.some(v=>v.text==='5\u00a0000,00\u00a0грн'))}
  for(const program of screen.programs){assert.equal(program.tone,undefined);assert.equal(program.background,'rgb(243, 245, 244)')}
  await page.emulateMedia({media:'print'})
  assert.deepEqual(await read(),screen,'print and preview geometry agree')
  const backgrounds=await page.evaluate(()=>['html','body','#root','.report-print-stage','.report-paper'].map(selector=>getComputedStyle(document.querySelector(selector)).backgroundColor))
  assert.equal(backgrounds[0],'rgb(255, 255, 255)');assert(backgrounds.slice(1).every(bg=>bg==='rgba(0, 0, 0, 0)'))
  const path=join(root,`large-report-${index}.pdf`);await page.pdf({path,preferCSSPageSize:true,printBackground:true});paths.push(path)
  if(process.env.HROMADA_REPORT_PRINT_OUTPUT_DIR)await (await import('node:fs/promises')).copyFile(path,join(process.env.HROMADA_REPORT_PRINT_OUTPUT_DIR,`large-report-${index}.pdf`))
  await page.emulateMedia({media:'screen'})
 }
 const {spawnSync}=await import('node:child_process'),python=join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe')
 const check=spawnSync(python,['-c',`import sys,json,pdfplumber,pypdfium2 as pdf
from pypdf import PdfReader
names=json.loads(sys.argv[1])
for path in sys.argv[2:]:
 r=PdfReader(path);assert len(r.pages)==1,(path,len(r.pages))
 assert abs(float(r.pages[0].mediabox.width)-595.28)<2 and abs(float(r.pages[0].mediabox.height)-841.89)<2
 text=''.join(r.pages[0].extract_text().split());assert all(''.join(name.split()) in text for name in names)
 assert '200000,00грн' in text and '5000,00грн' in text
 if path.endswith('3.pdf'):assert '-100000,00грн' in text
 with pdfplumber.open(path) as document:
  page=document.pages[0];words=page.extract_words();chars=[c for c in page.chars if c['text'].strip()]
  assert min(c['x0'] for c in chars)>=12*72/25.4 and max(c['x1'] for c in chars)<=page.width-12*72/25.4
  assert min(c['top'] for c in chars)>=12*72/25.4 and max(c['bottom'] for c in chars)<=page.height-12*72/25.4
  for i,word in enumerate(words):
   if word['text']=='грн':assert i>0 and abs(word['top']-words[i-1]['top'])<1,(path,'wrapped currency',word)
  colors=[rect['non_stroking_color'] for rect in page.rects]
  for expected in [(243/255,245/255,244/255)]:assert any(isinstance(c,tuple) and len(c)==3 and all(abs(a-b)<.005 for a,b in zip(c,expected)) for c in colors),(path,'missing program fill',colors)
 d=pdf.PdfDocument(path);image=d[0].render(scale=1).to_pil().convert('RGB')
 for x,y in [(5,5),(image.width//2,20),(5,image.height//2),(image.width-5,image.height//2),(image.width//2,image.height-10)]:assert image.getpixel((x,y))==(255,255,255),(path,'nonwhite paper',x,y,image.getpixel((x,y)))
print('4 large-value PDFs: one A4, complete names, unbroken currency, uniform program fills and white page')`,JSON.stringify([...summary.programs.map(p=>p.officialName),...summary.rows.map(r=>r.officialName)]),...paths],{encoding:'utf8'})
 assert.equal(check.status,0,check.stdout+check.stderr);console.log(check.stdout)
 await page.getByRole('tab',{name:'Місяць',exact:true}).click()
 assert.equal(await page.locator('.reporting-screen').textContent(),screenBefore,'screen reporting UI is unchanged by print fitting')
})

test('Manual catalog order survives new zero types, reorder and database reopen in all screen reports and PDFs',async t=>{
 let db=openAppDatabase(join(root,'manual-report-order'))
 t.after(()=>{try{db.close()}catch{}})
 registerRecordsIpc(db)
 const call=(channel,input)=>handlers.get(channel)({},input)
 const list=()=>call('catalogs:list',true)
 let page=await pageFor(t)
 const pdfs=[]
 const periods=[{kind:'month',value:1},{kind:'quarter',value:1},{kind:'annual'},{kind:'year-to-date',endDate:'2027-12-31'}]
 const labels=['Місяць','Квартал','Рік','Від початку року']
 const verify=async stage=>{
  const catalog=list(),expectedTypes=catalog.aidTypes.map(type=>type.id)
  const summaries=periods.map(period=>reportSummary(db,2027,period))
  for(const summary of summaries){
   assert.deepEqual(summary.programs.map(program=>program.id),catalog.programs.map(program=>program.id))
   assert.deepEqual(summary.rows.map(row=>row.aidTypeId),expectedTypes)
   assert(summary.rows.every(row=>row.paidCount===0&&row.paidAmountMinor===0),'zero rows are retained in their positions')
  }
  await page.evaluate(summaries=>{
   window.__orderedSummaries=summaries
   window.hromadaAid.reports.summary=async(_year,period)=>structuredClone(window.__orderedSummaries[period.kind==='month'?0:period.kind==='quarter'?1:period.kind==='annual'?2:3])
   window.dispatchEvent(new Event('hromada:catalogs-changed'))
  },summaries)
  const order=catalog.programs.flatMap(program=>[program.officialName,...catalog.aidTypes.filter(type=>type.programId===program.id).map(type=>type.officialName)])
  for(const [index,label] of labels.entries()){
   await page.getByRole('tab',{name:label,exact:true}).click()
   await expect(page.getByRole('button',{name:'Зберегти PDF',exact:true})).toBeEnabled()
   await expect(page.locator('.reporting-fit-warning')).toHaveCount(0)
   await expect(page.locator('.reporting-screen tbody tr > th')).toHaveCount(order.length)
   assert.deepEqual(await page.locator('.reporting-screen tbody tr > th').allTextContents(),order,'screen follows catalog '+stage+' '+label)
   assert.deepEqual(await page.locator('.report-paper tbody tr > th').allTextContents(),order,'print follows screen '+stage+' '+label)
   const path=join(root,`order-${stage}-${index}.pdf`);await page.pdf({path,preferCSSPageSize:true,printBackground:true});pdfs.push({path,order})
  }
  return catalog
 }
 const initial=await verify('initial'),target=initial.programs[0].id
 assert.equal(call('catalogs:save',{kind:'aidType',programId:target,shortName:'А нова нульова допомога',officialName:'А нова нульова допомога для перевірки ручного порядку'}).ok,true)
 const appended=list(),group=appended.aidTypes.filter(type=>type.programId===target)
 assert.equal(group.at(-1).shortName,'А нова нульова допомога')
 const programOrder=appended.programs.map(program=>program.id).reverse()
 assert.equal(call('catalogs:reorder',{kind:'program',ids:programOrder}).ok,true)
 const typeOrder=group.map(type=>type.id).reverse()
 assert.equal(call('catalogs:reorder',{kind:'aidType',programId:target,ids:typeOrder}).ok,true)
 assert.deepEqual(list().aidTypes.filter(type=>type.programId!==target),appended.aidTypes.filter(type=>type.programId!==target),'other program types unchanged')
 const reordered=await verify('reordered')
 assert.notDeepEqual(reordered.programs.map(program=>program.id),initial.programs.map(program=>program.id))
 assert.deepEqual(reordered.aidTypes.filter(type=>type.programId===target).map(type=>type.id),typeOrder)
 db.close();db=openAppDatabase(join(root,'manual-report-order'));registerRecordsIpc(db)
 page=await pageFor(t)
 const reopened=await verify('reopened')
 assert.deepEqual(reopened.programs,reordered.programs)
 assert.deepEqual(reopened.aidTypes,reordered.aidTypes)
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
 const {spawnSync}=await import('node:child_process'),python=join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe')
 const manifest=join(root,'pdf-manual-order.json');await (await import('node:fs/promises')).writeFile(manifest,JSON.stringify(pdfs),'utf8')
 const check=spawnSync(python,['-c',`from pypdf import PdfReader
import sys,json
for item in json.load(open(sys.argv[1],encoding='utf-8')):
 r=PdfReader(item['path']);assert len(r.pages)==1,item['path']
 text=''.join(r.pages[0].extract_text().split());cursor=0
 for name in item['order']:
  token=''.join(name.split());position=text.find(token,cursor);assert position>=cursor,(item['path'],name,cursor);cursor=position+len(token)
 assert 'Загальнийпідсумок' in text and '0,00грн' in text
print('12 one-page PDFs match exact manual catalog order before/after reorder and database reopening')`,manifest],{encoding:'utf8'})
 assert.equal(check.status,0,check.stdout+check.stderr);console.log(check.stdout)
})

test('PDF export receives only the selected report kind regardless of accounting year, period or current date',async t=>{
 const page=await pageFor(t)
 await page.clock.setFixedTime(new Date(2032,0,2,12))
 const modes=[['Місяць','month'],['Квартал','quarter'],['Рік','annual'],['Від початку року','cumulative']]
 for(const year of [2027,2026]){
  await page.getByRole('combobox',{name:/Звітний рік:/}).click()
  await page.getByRole('option',{name:String(year),exact:true}).click()
  for(const [label,kind] of modes){
   await page.getByRole('tab',{name:label,exact:true}).click()
   if(kind==='month'){
    await page.getByRole('combobox',{name:'Місяць',exact:true}).click()
    await page.getByRole('option',{name:'Жовтень',exact:true}).click()
   }else if(kind==='quarter'){
    await page.getByRole('combobox',{name:'Квартал',exact:true}).click()
    await page.getByRole('option',{name:'4 квартал',exact:true}).click()
   }else if(kind==='cumulative'){
    const date=page.getByPlaceholder('ДД.ММ.РРРР');await date.fill(`15.06.${year}`);await date.blur()
   }
   const button=page.getByRole('button',{name:'Зберегти PDF',exact:true});await expect(button).toBeEnabled();await button.click()
   await expect.poll(()=>page.evaluate(()=>window.__pdf.at(-1))).toBe(kind)
   assert.equal(await page.evaluate(()=>window.__reports.at(-1).year),year)
  }
 }
 assert.deepEqual(await page.evaluate(()=>window.__pdf),['month','quarter','annual','cumulative','month','quarter','annual','cumulative'])
})
