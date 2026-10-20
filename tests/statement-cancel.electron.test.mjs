import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { openAppDatabase } from '../electron/database.ts'

test('Actual Electron: statement cancel reuses red outline, centered X, standard spacing and equal action heights',{skip:process.env.HROMADA_TEST_ELECTRON_CANCEL!=='1',timeout:60000},async t=>{
 const root=mkdtempSync(join(tmpdir(),'hromada-cancel-ui-'))
 let electron,server
 t.after(async()=>{await electron?.close();await server?.close();assert.equal(dirname(resolve(root)),resolve(tmpdir()));rmSync(root,{recursive:true,force:true})})
 const db=openAppDatabase(root),year=new Date().getFullYear()
 try {
  db.prepare('INSERT INTO recipients(id,last_name,first_name,patronymic,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('synthetic-recipient','Вигаданий','Тестовий','Отримувач','2026-01-01','2026-01-01')
  db.prepare('INSERT INTO decisions(id,decision_number,decision_date,title,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('synthetic-decision','ТЕСТ',year+'-01-02','','2026-01-01','2026-01-01')
  db.prepare('INSERT INTO assignments(id,recipient_id,decision_id,aid_type_id,amount_minor,status,created_at) VALUES(?,?,?,?,?,?,?)').run('synthetic-assignment','synthetic-recipient','synthetic-decision','aid-social-treatment',100000,'Призначено','2026-01-03T10:00:00.000Z')
 } finally {db.close()}
 const {createServer}=await import('vite')
 server=await createServer({server:{host:'127.0.0.1',port:5175,strictPort:true,open:false},clearScreen:false});await server.listen()
 const runtime=join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')
 const {_electron}=await import(pathToFileURL(runtime).href)
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>key.toUpperCase()!=='ELECTRON_RUN_AS_NODE'))
 electron=await _electron.launch({executablePath:resolve('node_modules/electron/dist/electron.exe'),args:[resolve('.')],cwd:resolve('.'),env:{...env,HROMADA_AID_TEST_DATA_DIR:root}})
 const page=await electron.firstWindow()
 assert.equal(resolve(await electron.evaluate(({app})=>app.getPath('userData'))),resolve(root))
 await page.locator('.nav-list').getByRole('button',{name:'Формування відомостей',exact:true}).click()
 await page.getByRole('checkbox',{name:'Вибрати всі видимі записи',exact:true}).check()
 await page.getByRole('button',{name:'Сформувати персональні відомості',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'Параметри формування',exact:true})
 const cancel=dialog.getByRole('button',{name:'Скасувати',exact:true})
 await cancel.waitFor();await page.mouse.move(0,0)
 const actual=await cancel.evaluate(button=>{
  const style=getComputedStyle(button),icon=button.querySelector('svg'),a=button.getBoundingClientRect(),b=icon.getBoundingClientRect(),primary=button.parentElement.querySelector('[type="submit"]').getBoundingClientRect()
  return {class:button.className,color:style.color,border:style.borderTopColor,gap:style.gap,paddingTop:style.paddingTop,paddingLeft:style.paddingLeft,height:a.height,primaryHeight:primary.height,iconCentered:Math.abs((a.top+a.bottom)-(b.top+b.bottom))<2}
 })
 assert.equal(actual.class,'secondary-button assignment-cancel-button')
 assert.equal(actual.color,'rgb(163, 78, 70)');assert.equal(actual.border,'rgb(216, 170, 165)')
 assert.equal(actual.gap,'7px');assert.equal(actual.paddingTop,'10px');assert.equal(actual.paddingLeft,'15px')
 assert.equal(actual.height,44);assert.equal(actual.primaryHeight,44);assert.equal(actual.iconCentered,true)
 await cancel.focus()
 if(process.env.HROMADA_CANCEL_SCREENSHOT)await page.screenshot({path:process.env.HROMADA_CANCEL_SCREENSHOT})
 await cancel.click();assert.equal(await dialog.count(),0,'unchanged form closes normally')
 await page.getByRole('button',{name:'Сформувати персональні відомості',exact:true}).click()
 await dialog.getByLabel('Номер відомості *',{exact:true}).fill('04')
 await dialog.getByRole('button',{name:'Скасувати',exact:true}).click()
 await page.getByRole('button',{name:'Продовжити редагування',exact:true}).click()
 assert.equal(await dialog.getByLabel('Номер відомості *',{exact:true}).inputValue(),'04')
 console.log('Real Electron cancel styling and unsaved-changes behavior verified on synthetic SQLite.')
})
