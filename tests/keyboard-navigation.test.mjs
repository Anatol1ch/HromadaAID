import { after, before, test as nodeTest } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

// Use an available test runtime; never install a browser or dependency automatically.
const runtime = process.env.HROMADA_PLAYWRIGHT_MODULE
  ?? join(process.env.USERPROFILE ?? '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const require = createRequire(import.meta.url)
const { chromium } = require(runtime)
const { expect } = require(join(runtime, 'test.js'))
const test = (name, body) => nodeTest(name, { timeout: 20000 }, body)
let server, browser, cache, origin
before(async () => {
  cache = await mkdtemp(join(tmpdir(), 'hromada-keyboard-test-'))
  server = await createServer({ configFile: false, plugins: [react(), { name: 'keyboard-fixture', configureServer(vite) {
    vite.middlewares.use('/__keyboard_test__', async (_request, response, next) => {
      try {
        response.setHeader('Content-Type', 'text/html; charset=utf-8')
        response.end(await vite.transformIndexHtml('/__keyboard_test__', '<!doctype html><html lang="uk"><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/tests/keyboard-fixture.tsx"></script></body></html>'))
      } catch (error) { next(error) }
    })
  } }], cacheDir: cache,
    server: { host: '127.0.0.1', port: 0, hmr: false, open: false }, clearScreen: false })
  await server.listen()
  origin = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ channel: process.env.HROMADA_BROWSER_CHANNEL ?? 'msedge', headless: true })
})
after(async () => {
  await browser?.close()
  await server?.close()
  if (cache && resolve(cache).startsWith(resolve(tmpdir()) + '\\hromada-keyboard-test-')) await rm(cache, { recursive: true, force: true })
})

async function pageFor(t, view) {
  const page = await browser.newPage({ viewport: {width: 1440, height: 1000} })
  page.setDefaultTimeout(5000)
  await page.clock.setFixedTime(new Date(2026,9,18,12))
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  t.after(async () => { await page.close(); assert.deepEqual(errors, [], 'renderer errors') })
  await page.addInitScript(() => {
    window.__calls = []
    window.__reads = []
    window.__reject = false
    const bank = { id:'bank1', name:'Тестовий банк', recipientCount:0, details:[{id:'detail1',mfo:'001122',edrpou:'00112233',recipientCount:0}] }
    const program = {id:'p1',code:'TEST',shortName:'Тестова програма',officialName:'Тестова програма',isActive:true,assignmentCount:0}
    const aid = {id:'t1',code:'TEST_AID',shortName:'Тестова допомога',officialName:'Тестова допомога',programId:'p1',isActive:true,assignmentCount:0}
    const person = {id:'r1',fullName:'Тестова Особа Приклад',rnokpp:'0011223344',isVpo:false,sex:'Жінка'}
    const decision = {id:'d1',decisionNumber:'101',decisionDate:'2027-01-02',title:'',assignmentCount:0,assignedTotalMinor:0}
    const record = async (kind, input, result) => {
      window.__calls.push({kind,input})
      await new Promise(done => setTimeout(done, 120))
      if (window.__reject) throw Error('Synthetic failure')
      return result
    }
    window.hromadaAid = {
      banks: { list:async()=>[bank], get:async()=>bank, save:async input=>record('bank',input,{ok:true,bank:{...bank,...input}}) },
      recipients: { list:async()=>[person], save:async input=>record('recipient',input,{ok:true,recipient:{...person,...input}}) },
      decisions: {list:async()=>[{...decision,id:'d2026',decisionDate:'2026-01-02'},decision],get:async()=>({...decision,assignments:[]}),save:async input=>record('decision',input,{ok:true,decision:{...decision,...input}}),addAssignments:async(id,input)=>record('addAssignments',input,{ok:true,decisionId:id})},
      catalogs:{list:async()=>({programs:[program],aidTypes:[aid]}),save:async input=>record('catalog',input,{ok:true})},
      assignments:{list:async year=>{window.__reads.push({kind:'assignments',year});return {assignments:[]}}, save:async input=>record('assignment',input,{ok:true,assignment:{id:'a1',...input}}),changeStatuses:async input=>record('batch',input,{ok:true,changedCount:2,unchangedCount:0})},
      reports:{annualPlanList:async()=>[],annualPlanSave:async input=>record('annualPlan',input,{ok:true}),savePdf:async input=>record('reportPdf',input,{ok:true}),summary:async(year,period)=>{window.__reads.push({kind:'reports',year,period});return {periodLabel:'Тестовий період',rows:[]}}},
      statements:{list:async year=>{window.__reads.push({kind:'statements',year});return {assignments:[]}}},
      dashboard:{get:async year=>{window.__reads.push({kind:'dashboard',year});return {year,assignmentCount:0,paidCount:0,paidTotalMinor:0,totalMinor:0,monthlyAmountMinor:Array(12).fill(0),programExecution:[],aidTypeDistribution:[],demo:false}}},
    }
  })
  await page.goto(origin + '/__keyboard_test__')
  await page.getByRole('button', {name:view,exact:true}).focus()
  await page.keyboard.press('Enter')
  return page
}
async function type(page, value) { await page.keyboard.type(value) }
async function enter(page) { await page.keyboard.press('Enter') }
async function select(page, label, search, arrows = 0) {
  const trigger = page.getByRole('combobox', {name:label,exact:true})
  await expect(trigger).toBeFocused()
  await enter(page)
  if (search) await type(page, search)
  for (let n=0;n<arrows;n++) await page.keyboard.press('ArrowDown')
  await enter(page)
  await expect(trigger).toHaveAttribute('aria-expanded','false')
  await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))))
}
async function call(page, kind) {
  await expect.poll(()=>page.evaluate(k=>window.__calls.filter(c=>c.kind===k).length,kind)).toBe(1)
  return page.evaluate(k=>window.__calls.find(c=>c.kind===k).input,kind)
}

test('Enter mode is opt-in; Tab, mouse, textarea, Space and native buttons keep their behavior', async t => {
  const page = await pageFor(t,'controls')
  const first=page.getByRole('textbox',{name:'Перше',exact:true})
  await expect(first).toBeFocused()
  await expect(page.locator('[data-keyboard-active]')).toHaveCount(0)
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button',{name:'Швидке додавання'})).toBeFocused()
  await expect(page.locator('[data-keyboard-active]')).toHaveCount(0)
  await page.keyboard.press('Shift+Tab'); await type(page,'текст'); await enter(page)
  await expect(page.getByRole('combobox',{name:'Список',exact:true})).toBeFocused()
  await expect(page.locator('[data-keyboard-active]')).toHaveCount(1)
  await select(page,'Список',null,1)
  const next=page.getByRole('textbox',{name:'Наступне',exact:true})
  await expect(next).toBeFocused()
  assert.equal(await next.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(242, 250, 245)')
  await next.click()
  await expect(page.locator('[data-keyboard-active]')).toHaveCount(0)
  await enter(page)
  const note=page.getByRole('textbox',{name:'Примітка',exact:true})
  await expect(note).toBeFocused(); await type(page,'один'); await enter(page); await type(page,'два')
  await expect(note).toHaveValue('один\nдва')
  await page.keyboard.press('Tab')
  await expect(page.getByPlaceholder('ДД.ММ.РРРР')).toBeFocused()
  await enter(page)
  const checkbox=page.getByRole('checkbox',{name:'Ознака'})
  await expect(checkbox).toBeFocused(); await page.keyboard.press('Space'); await expect(checkbox).toBeChecked()
  await enter(page)
  await expect(page.getByRole('button',{name:'Зберегти керування',exact:true})).toBeFocused()
  await expect(page.getByLabel('Збережено')).toHaveText('0')
  await page.keyboard.press('Control+Enter'); await expect(page.getByLabel('Збережено')).toHaveText('1')
})

test('Nested modal: independent focus and highlighting, Tab trap, Ctrl+Enter only saves child, opener restored', async t => {
  const page=await pageFor(t,'controls')
  await type(page,'parent'); await enter(page)
  await page.keyboard.press('Shift+Tab'); await enter(page)
  await expect(page.getByRole('textbox',{name:'Вкладене поле',exact:true})).toBeFocused()
  await expect(page.locator('[data-keyboard-active]')).toHaveCount(0)
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('button',{name:'Закрити вікно'}).last()).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('button',{name:'Зберегти вкладене'})).toBeFocused()
  await page.keyboard.press('Control+Enter')
  await expect(page.getByRole('button',{name:'Швидке додавання'})).toBeFocused()
  await expect(page.getByLabel('Збережено')).toHaveText('0')
  await expect(page.getByRole('textbox',{name:'Перше',exact:true})).toHaveValue('parent')
})

test('DatePicker arrow/date selection and Escape preserve parent dialog; Ctrl+Enter from popup saves owner form', async t => {
  const page=await pageFor(t,'controls')
  await type(page,'a'); await enter(page); await select(page,'Список',null)
  await enter(page); await page.keyboard.press('Tab')
  const date=page.getByPlaceholder('ДД.ММ.РРРР')
  await expect(date).toBeFocused(); await page.keyboard.press('ArrowDown')
  await expect(page.locator('[data-date="2027-01-02"]')).toBeFocused()
  await page.keyboard.press('ArrowRight'); await enter(page)
  await expect(date).toHaveValue('03.01.2027'); await expect(date).toBeFocused()
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog',{name:'Керування'})).toBeVisible(); await expect(date).toBeFocused()
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Control+Enter')
  await expect(page.getByLabel('Збережено')).toHaveText('1')
})

test('Bank form: custom validation, dynamic fields, keyboard save, duplicate prevention and retry after failure', async t => {
  const page=await pageFor(t,'bank')
  const name=page.locator('[data-bank-field="name"] input')
  await expect(name).toBeFocused(); await page.keyboard.press('Control+Enter'); await expect(name).toBeFocused()
  await expect(page.locator('[role="alert"]')).toBeVisible()
  await type(page,'Вигаданий банк'); await enter(page); await type(page,'001122'); await enter(page); await type(page,'00112233')
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await enter(page)
  await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Shift+Tab')
  await expect(page.locator('[data-bank-field="details.1.mfo"] input')).toBeFocused()
  await type(page,'003344'); await enter(page); await type(page,'00334455')
  await page.evaluate(()=>{window.__reject=true})
  await page.keyboard.press('Control+Enter')
  await expect(page.getByRole('alert')).toContainText('Не вдалося зберегти банк')
  await expect(name).toHaveValue('Вигаданий банк')
  await expect(page.getByRole('button',{name:'Створити банк',exact:true})).toBeEnabled()
  await page.evaluate(()=>{window.__reject=false;window.__calls=[]})
  await page.keyboard.down('Control'); await page.keyboard.down('Enter'); await page.keyboard.down('Enter'); await page.keyboard.up('Enter'); await page.keyboard.up('Control')
  const input=await call(page,'bank'); assert.equal(input.details.length,2);assert.equal(input.details[1].mfo,'003344')
  await expect(page.getByLabel('Збережено')).toHaveText('1')
})

test('Recipient keyboard-only: all fields, searchable bank, nested address, Enter skips plus, Ctrl+Enter preserves mapping', async t => {
  const page=await pageFor(t,'recipient')
  for(const [key,value] of [['lastName','Тестова'],['firstName','Особа'],['patronymic','Приклад'],['passport','ТЕ123456'],['rnokpp','0011223344']]) {
    await expect(page.locator(`input[name="${key}"]`)).toBeFocused();await type(page,value);await enter(page)
  }
  await select(page,'Стать',null,1);await select(page,'Внутрішньо переміщена особа',null,1)
  const registration=page.getByRole('button',{name:'Додати: Адреса реєстрації',exact:true})
  await expect(registration).toBeFocused(); await enter(page)
  await select(page,'Шаблони Вишнівської громади','Вишневе')
  await expect(page.locator('input[name="postalCode"]')).toBeFocused()
  for(let n=0;n<3;n++)await enter(page)
  await select(page,'Тип населеного пункту',null)
  await enter(page);await select(page,'Тип вулиці','вулиця')
  await type(page,'Тестова');await enter(page);await type(page,'12А');await enter(page);await enter(page)
  await page.keyboard.press('Control+Enter')
  await expect(page.getByRole('button',{name:'Змінити: Адреса реєстрації',exact:true})).toBeFocused()
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab')
  // Optional residence actions remain in normal Tab order; focus contacts using their labels.
  while(!(await page.locator('input[name="phone"]').evaluate(el=>el===document.activeElement))) await page.keyboard.press('Tab')
  await enter(page);await enter(page)
  await expect(page.locator('input[name="bankAccount"]')).toBeFocused();await type(page,'UA890000000000000000000000000');await enter(page)
  await select(page,'Найменування банку','Тестовий')
  await expect(page.getByRole('button',{name:'Створити картку',exact:true})).toBeFocused()
  await page.keyboard.press('Control+Enter')
  const input=await call(page,'recipient')
  assert.equal(input.bankDetailsId,'detail1');assert.equal(input.passport,'ТЕ123456');assert.equal(input.rnokpp,'0011223344')
  assert.equal(input.phone,'')
  assert.equal(input.registeredAddressParts.building,'12А');assert.equal(input.isVpo,true);assert.equal(input.sex,'Жінка')
})

test('Decision and batch forms: manual date, conditional paid date, native validation and save', async t => {
  const page=await pageFor(t,'decision')
  await type(page,'101');await enter(page);await type(page,'02.01.2027');await enter(page);await type(page,'Тест');await page.keyboard.press('Control+Enter')
  assert.equal((await call(page,'decision')).decisionDate,'2027-01-02')
  await expect(page.getByLabel('Збережено')).toHaveText('1')
  await page.getByRole('button',{name:'batch',exact:true}).focus();await enter(page)
  await select(page,'Новий статус',null,4)
  const date=page.getByPlaceholder('ДД.ММ.РРРР');await expect(date).toBeFocused()
  await page.keyboard.press('Control+Enter');await expect(date).toBeFocused()
  await type(page,'03.01.2028');await page.keyboard.press('Control+Enter')
  await expect(date).toHaveAttribute('aria-invalid','true')
  assert.equal(await page.evaluate(()=>window.__calls.filter(c=>c.kind==='batch').length),0)
  await page.keyboard.press('Control+A');await type(page,'03.01.2027');await page.keyboard.press('Control+Enter')
  const input=await call(page,'batch');assert.equal(input.status,'Виплачено');assert.equal(input.paidOn,'2027-01-03')
})

test('Registry filters and assignment: searchable recipient, dropdowns, status date and keyboard save', async t => {
  const page=await pageFor(t,'assignments')
  await page.getByRole('button',{name:'Фільтри',exact:true}).focus();await enter(page)
  await page.getByPlaceholder('Пошук за ПІБ отримувача').focus();await enter(page)
  await select(page,'Фільтр: програма',null,1)
  await expect(page.getByRole('combobox',{name:'Фільтр: вид допомоги',exact:true})).toBeFocused()
  await page.getByRole('button',{name:'Додати призначення',exact:true}).focus();await enter(page)
  await select(page,'Отримувач','Тестова');await select(page,'Рішення виконкому',null)
  await select(page,'Програма',null);await select(page,'Вид допомоги',null)
  await type(page,'abc');await enter(page);await page.keyboard.press('Control+Enter')
  await expect(page.getByPlaceholder('Наприклад, 5000')).toBeFocused()
  await page.keyboard.press('Control+A');await type(page,'1250,50');await enter(page)
  await select(page,'Статус',null,3)
  await expect(page.getByPlaceholder('ДД.ММ.РРРР')).toBeFocused()
  await type(page,'03.01.2027')
  await page.keyboard.press('Control+Enter')
  const input=await call(page,'assignment');assert.equal(input.amountMinor,125050);assert.equal(input.recipientId,'r1');assert.equal(input.status,'Виплачено')
})

test('Catalogs: textarea newline, checkbox Space, Ctrl+Enter no duplicates; reports dropdowns and year picker', async t => {
  const page=await pageFor(t,'dictionaries')
  await page.getByRole('tab',{name:'Програми та допомоги',exact:true}).focus();await enter(page)
  await page.getByRole('button',{name:'Додати програму',exact:true}).focus();await enter(page)
  await expect(page.getByRole('textbox',{name:'Коротка назва *',exact:true})).toBeFocused()
  await type(page,'Тест');await enter(page);await type(page,'Повна');await enter(page);await type(page,'назва')
  await page.keyboard.press('Tab');await type(page,'22');await enter(page);await type(page,'02.01.2027');await enter(page)
  await expect(page.getByRole('checkbox')).toBeFocused();await page.keyboard.press('Space')
  await page.keyboard.press('Control+Enter');await page.keyboard.press('Control+Enter')
  assert.equal((await call(page,'catalog')).officialName,'Повна\nназва')
  await page.getByRole('button',{name:'reports',exact:true}).focus();await enter(page)
  await page.getByRole('combobox',{name:'Місяць',exact:true}).focus();await select(page,'Місяць',null,1)
  await page.clock.setFixedTime(new Date(2027,0,2))
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
  const year=page.getByRole('combobox',{name:'Звітний рік: 2027',exact:true});await year.focus();await enter(page)
  await expect(page.getByRole('option',{name:'2027',exact:true})).toBeFocused()
  await page.keyboard.press('ArrowDown');await enter(page)
  await expect(page.getByRole('combobox',{name:'Звітний рік: 2028',exact:true})).toBeFocused()
  await expect(page.getByRole('combobox',{name:'Звітний рік: 2028',exact:true})).toHaveAttribute('aria-expanded','false')
  await enter(page)
  await expect(page.getByRole('option',{name:'2028',exact:true})).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('tab',{name:'Місяць',exact:true})).toBeFocused()
})

test('Confirmations: Ctrl+Enter cannot delete; Escape cancels only confirmation and restores draft focus', async t => {
  const page=await pageFor(t,'danger')
  await expect(page.getByRole('button',{name:'Скасувати',exact:true})).toBeFocused()
  await page.keyboard.press('Control+Enter');await expect(page.getByLabel('Збережено')).toHaveText('0')
  await page.keyboard.press('Escape');await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await page.getByRole('button',{name:'bank',exact:true}).focus();await enter(page);await type(page,'draft')
  await page.keyboard.press('Escape');await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.keyboard.press('Escape');await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(page.locator('[data-bank-field="name"] input')).toBeFocused()
  await expect(page.locator('[data-bank-field="name"] input')).toHaveValue('draft')
})

test('Select Escape/Tab/Shift+Tab close only popup; Ctrl+Enter cannot bypass first required field', async t => {
  const page=await pageFor(t,'controls')
  await enter(page)
  const combo=page.getByRole('combobox',{name:'Список',exact:true})
  await enter(page);await page.keyboard.press('Escape')
  await expect(combo).toBeFocused();await expect(page.getByRole('dialog',{name:'Керування'})).toBeVisible()
  await enter(page);await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('button',{name:'Швидке додавання',exact:true})).toBeFocused()
  await page.keyboard.press('Tab');await enter(page);await page.keyboard.press('Tab')
  await expect(page.getByRole('textbox',{name:'Наступне',exact:true})).toBeFocused()
  await page.keyboard.press('Shift+Tab');await enter(page);await page.keyboard.press('Control+Enter')
  await expect(page.getByRole('textbox',{name:'Перше',exact:true})).toBeFocused()
  await expect(page.getByLabel('Збережено')).toHaveText('0')
})

test('Aid type and decision catalogs use same keyboard behavior and existing submit handlers', async t => {
  const page=await pageFor(t,'dictionaries')
  await page.getByRole('tab',{name:'Програми та допомоги',exact:true}).focus();await enter(page)
  await page.getByRole('button',{name:'Додати вид допомоги',exact:true}).first().focus();await enter(page)
  await select(page,'Програма',null)
  await type(page,'Коротка');await enter(page);await type(page,'Повна назва');await page.keyboard.press('Tab')
  await type(page,'Напрям');await enter(page);await type(page,'Джерело');await page.keyboard.press('Control+Enter')
  assert.equal((await call(page,'catalog')).kind,'aidType')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('tab',{name:'Рішення виконкому',exact:true}).focus();await enter(page)
  await page.getByRole('button',{name:'Додати рішення',exact:true}).focus();await enter(page)
  await expect(page.getByPlaceholder('Наприклад, 184')).toBeFocused()
  await expect(page.getByRole('dialog')).not.toHaveAttribute('aria-busy','true')
  await type(page,'102');await enter(page);await type(page,'02.01.2027');await enter(page);await type(page,'Примітка')
  await page.keyboard.press('Control+Enter')
  assert.equal((await call(page,'decision')).decisionNumber,'102')
})

test('Decision registry editor and nested assignment builder are keyboard accessible', async t => {
  const page=await pageFor(t,'decisionRegistry')
  await page.getByRole('button',{name:'Додати рішення',exact:true}).focus();await enter(page)
  await expect(page.getByPlaceholder('Наприклад, 184')).toBeFocused()
  await type(page,'103');await enter(page)
  await page.keyboard.press('Control+A');await type(page,'02.01.2027');await enter(page);await type(page,'Рішення')
  await expect(page.getByPlaceholder('Наприклад, 184')).toHaveValue('103')
  await expect(page.getByPlaceholder('ДД.ММ.РРРР')).toHaveValue('02.01.2027')
  await page.keyboard.press('Control+Enter');assert.equal((await call(page,'decision')).decisionNumber,'103')
  await expect(page.getByRole('button',{name:'Додати призначення',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Додати призначення',exact:true}).focus();await enter(page)
  await select(page,'Отримувач','Тестова')
  await select(page,'Програма',null);await select(page,'Вид допомоги',null)
  await type(page,'-1');await enter(page);await page.keyboard.press('Control+Enter')
  await expect(page.getByPlaceholder('Наприклад, 5000')).toBeFocused()
  await page.keyboard.press('Control+A');await type(page,'100');await enter(page);await select(page,'Статус',null)
  await page.keyboard.press('Control+Enter')
  const input=await call(page,'addAssignments');assert.equal(input.length,1);assert.equal(input[0].amountMinor,10000)
})

test('Editing existing recipient preserves saved fields and bank choice through keyboard submission', async t => {
  const page=await pageFor(t,'recipientEdit')
  const lastName=page.locator('input[name="lastName"]')
  await expect(lastName).toBeFocused();await expect(lastName).toHaveValue('Тестова')
  await page.keyboard.press('Control+A');await type(page,'Оновлена');await enter(page)
  await expect(page.locator('input[name="firstName"]')).toBeFocused()
  await expect(page.getByRole('combobox',{name:'Найменування банку',exact:true})).toContainText('Тестовий банк')
  await page.keyboard.press('Control+Enter')
  const input=await call(page,'recipient')
  assert.equal(input.lastName,'Оновлена');assert.equal(input.firstName,'Особа');assert.equal(input.bankDetailsId,'detail1')
  assert.equal(input.bankAccount,'UA890000000000000000000000000');assert.equal(input.registeredAddressParts.building,'12А')
})

test('Manual address: conditional custom street type participates in Enter order and Ctrl+Enter save', async t => {
  const page=await pageFor(t,'address')
  await select(page,'Шаблони Вишнівської громади','Інший населений пункт')
  for(const [key,value] of [['postalCode','12345'],['region','Тестова'],['district','Тестовий']]) {
    await expect(page.locator(`input[name="${key}"]`)).toBeFocused();await type(page,value);await enter(page)
  }
  await select(page,'Тип населеного пункту',null)
  await type(page,'Тестове');await enter(page);await select(page,'Тип вулиці','Інше')
  await expect(page.locator('input[name="customStreetType"]')).toBeFocused()
  await type(page,'Алея');await enter(page);await type(page,'Тестова');await enter(page);await type(page,'15/2');await enter(page)
  await page.keyboard.press('Control+Enter')
  await expect(page.getByLabel('Збережено')).toHaveText('1')
})

// Feed the same ClipboardEvent/data used by Chromium to the real React paste handler.
async function paste(field, text) {
  await field.evaluate((element, value) => {
    const clipboard = new DataTransfer();clipboard.setData('text/plain',value)
    element.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:clipboard}))
  },text)
}
test('Passport mask limits both formats while supporting paste, deletion, selection and caret editing', async t => {
  const page=await pageFor(t,'recipientEdit')
  const passport=page.locator('input[name="passport"]')
  await passport.focus();await page.keyboard.press('Control+A');await type(page,'ае12345678')
  await expect(passport).toHaveValue('АЕ123456')
  await passport.evaluate(el=>el.setSelectionRange(4,5));await type(page,'9')
  await expect(passport).toHaveValue('АЕ129456')
  assert.equal(await passport.evaluate(el=>el.selectionStart),5)
  await page.keyboard.press('Backspace');await type(page,'3');await expect(passport).toHaveValue('АЕ123456')
  await passport.evaluate(el=>el.setSelectionRange(2,2));await page.keyboard.press('Delete');await type(page,'1')
  await expect(passport).toHaveValue('АЕ123456')
  await page.keyboard.press('Control+A');await paste(passport,'аєї 123456789')
  await expect(passport).toHaveValue('АЄ123456')
  await page.keyboard.press('Control+A');await type(page,'1234567890а')
  await expect(passport).toHaveValue('123456789')
  await page.keyboard.press('Control+A');await paste(passport,'001122334455')
  await expect(passport).toHaveValue('001122334')
  await enter(page);await expect(page.locator('input[name="rnokpp"]')).toBeFocused()
  await expect(passport).toHaveAttribute('aria-invalid','false')
})
test('Formatted recipient fields: uppercase passport, numeric RNOKPP, blur-only email errors and canonical save', async t => {
  const page=await pageFor(t,'recipientEdit')
  const passport=page.locator('input[name="passport"]'),tax=page.locator('input[name="rnokpp"]'),email=page.locator('input[name="email"]')
  await passport.focus();await page.keyboard.press('Control+A');await type(page,'ав123456!')
  await expect(passport).toHaveValue('АВ123456');await enter(page);await expect(tax).toBeFocused()
  await page.keyboard.press('Control+A');await type(page,'00112233x44')
  await expect(tax).toHaveValue('0011223344')
  await email.focus();await type(page,'wrong@@example.org');await expect(email).toHaveAttribute('aria-invalid','false')
  await page.keyboard.press('Tab');await expect(email).toHaveAttribute('aria-invalid','true')
  await email.fill('fictional+tag@sub.example.invalid');await expect(email).toHaveAttribute('aria-invalid','false')
  await page.keyboard.press('Control+Enter')
  const input=await call(page,'recipient');assert.equal(input.passport,'АВ123456');assert.equal(input.rnokpp,'0011223344');assert.equal(input.email,'fictional+tag@sub.example.invalid')
})
test('Phone mask: prefix, caret, separators, selection, pasted formats, incomplete blur and empty optional value', async t => {
  const page=await pageFor(t,'recipientEdit')
  const phone=page.locator('input[name="phone"]')
  await phone.focus();await expect(phone).toHaveValue('+380');await type(page,'501234567')
  await expect(phone).toHaveValue('+380 50 123 45 67')
  await phone.evaluate(el=>el.setSelectionRange(8,8));await page.keyboard.press('Backspace')
  await expect(phone).toHaveValue('+380 51 234 56 7')
  assert.equal(await phone.evaluate(el=>el.selectionStart),6)
  await type(page,'0');await expect(phone).toHaveValue('+380 50 123 45 67')
  await phone.evaluate(el=>el.setSelectionRange(7,7));await page.keyboard.press('Delete');await type(page,'1')
  await expect(phone).toHaveValue('+380 50 123 45 67')
  await page.keyboard.press('Control+A');await type(page,'123456789');await expect(phone).toHaveValue('+380 12 345 67 89')
  await page.keyboard.press('Control+A');await page.keyboard.press('Backspace');await expect(phone).toHaveValue('+380')
  await paste(phone,'0501234567');await expect(phone).toHaveValue('+380 50 123 45 67')
  await paste(phone,'+48123456789');await expect(phone).toHaveValue('+380 50 123 45 67')
  await paste(phone,'+380 50');await expect(phone).toHaveAttribute('aria-invalid','false')
  await page.keyboard.press('Tab');await expect(phone).toHaveAttribute('aria-invalid','true')
  await phone.focus();await paste(phone,'+380 (67) 123-45-67');await expect(phone).toHaveAttribute('aria-invalid','false')
  await phone.evaluate(el=>{
    el.setSelectionRange(5,7)
    el.dispatchEvent(new ClipboardEvent('cut',{bubbles:true,cancelable:true,clipboardData:new DataTransfer()}))
  })
  await expect(phone).toHaveValue('+380 12 345 67')
  await paste(phone,'67');await expect(phone).toHaveValue('+380 67 123 45 67')
  await page.keyboard.press('Control+Enter')
  assert.equal((await call(page,'recipient')).phone,'+380671234567')
})
test('IBAN mask: paste, protected prefix, insertion/deletion, format error and checksum-free save', async t => {
  const page=await pageFor(t,'recipientEdit')
  const iban=page.locator('input[name="bankAccount"]')
  await iban.focus();await paste(iban,'ua 62 000000 0000000000000000001')
  await expect(iban).toHaveValue('UA 62 000000 0000000000000000001')
  await iban.evaluate(el=>el.setSelectionRange(0,2));await page.keyboard.press('Delete')
  await expect(iban).toHaveValue('UA 62 000000 0000000000000000001')
  await iban.evaluate(el=>el.setSelectionRange(3,3));await page.keyboard.press('Delete');await type(page,'6')
  await expect(iban).toHaveValue('UA 62 000000 0000000000000000001')
  await page.keyboard.press('Control+A');await page.keyboard.press('Backspace');await expect(iban).toHaveValue('UA')
  await paste(iban,'UA62000000000000000000000001');await expect(iban).toHaveAttribute('aria-invalid','false')
  await enter(page);await expect(iban).toHaveAttribute('aria-invalid','true')
  await iban.focus();await paste(iban,'UA000000000000000000000000001');await expect(iban).toHaveAttribute('aria-invalid','false')
  await page.keyboard.press('Control+Enter')
  assert.equal((await call(page,'recipient')).bankAccount,'UA000000000000000000000000001')
})

test('Calendar month Select: 12 Ukrainian months, arrows/Enter, nested Escape, Tab, year and date selection', async t => {
  const page=await pageFor(t,'controls')
  const input=page.getByPlaceholder('ДД.ММ.РРРР')
  await input.focus();await page.keyboard.press('ArrowDown')
  const month=page.getByRole('combobox',{name:'Місяць',exact:true})
  await month.focus();await enter(page)
  const list=page.getByRole('listbox',{name:'Місяць',exact:true})
  await expect(list).toBeVisible()
  assert.deepEqual(await list.getByRole('option').allTextContents(),['Січень','Лютий','Березень','Квітень','Травень','Червень','Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'])
  assert.equal(await list.evaluate(el=>!!el.closest('.calendar-popover')),true)
  await page.keyboard.press('ArrowDown');await enter(page)
  await expect(month).toContainText('Лютий');await expect(month).toBeFocused()
  await expect(page.getByRole('grid',{name:'Лютий 2027',exact:true})).toBeVisible()
  await expect(input).toHaveValue('02.01.2027')
  await enter(page);await page.keyboard.press('Escape')
  await expect(list).toHaveCount(0);await expect(month).toBeFocused()
  await expect(page.getByRole('dialog',{name:'Календар вибору дати',exact:true})).toBeVisible()
  await enter(page);await page.keyboard.press('Tab')
  const year=page.getByRole('button',{name:'Вибрати рік, зараз 2027',exact:true})
  await expect(year).toBeFocused()
  await page.keyboard.press('Escape');await expect(input).toBeFocused()
  await expect(page.getByRole('dialog',{name:'Керування',exact:true})).toBeVisible()
  await page.keyboard.press('ArrowDown');await year.focus();await enter(page)
  await page.keyboard.press('ArrowRight');await enter(page)
  await month.focus();await enter(page);await page.keyboard.press('End');await enter(page)
  await expect(month).toContainText('Грудень')
  await page.locator('[data-date="2028-12-02"]').focus();await enter(page)
  await expect(input).toHaveValue('02.12.2028')
})

test('Month popup stays inside viewport and above clipping containers on desktop and narrow windows', async t => {
  const page=await pageFor(t,'controls')
  for(const viewport of [{width:1440,height:900},{width:600,height:480},{width:360,height:420}]) {
    await page.setViewportSize(viewport)
    const input=page.getByPlaceholder('ДД.ММ.РРРР')
    await input.focus();await page.keyboard.press('ArrowDown')
    const month=page.getByRole('combobox',{name:'Місяць',exact:true})
    await month.focus();await enter(page)
    const panel=page.locator('.calendar-popover .app-select-popup')
    await expect(panel).toBeVisible()
    await expect.poll(()=>panel.evaluate(el=>{
      const box=el.getBoundingClientRect()
      return el.matches(':popover-open') && box.left>=9 && box.top>=9 && box.right<=innerWidth-9 && box.bottom<=innerHeight-9
    })).toBe(true)
    assert.equal(await panel.evaluate(el=>{
      const box=el.getBoundingClientRect()
      return el.contains(document.elementFromPoint(box.left+15,box.top+15))
    }),true)
    await page.getByRole('option',{name:'Березень',exact:true}).click()
    await expect(month).toContainText('Березень')
    await expect(page.getByRole('dialog',{name:'Календар вибору дати',exact:true})).toBeVisible()
    await page.keyboard.press('Escape')
  }
})

test('Accounting year grows automatically and never resets the selected year when the calendar year changes',async t=>{
  const page=await pageFor(t,'controls')
  await page.keyboard.press('Escape')
  const year=page.getByRole('combobox',{name:'Звітний рік: 2027',exact:true})
  await year.click()
  assert.deepEqual(await page.getByRole('listbox',{name:'Оберіть рік'}).getByRole('option').allTextContents(),['2026','2027'])
  await page.keyboard.press('Escape')
  await expect(year).toHaveAttribute('aria-expanded','false')
  await page.clock.setFixedTime(new Date(2027,0,1,12))
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
  await year.click()
  assert.deepEqual(await page.getByRole('listbox',{name:'Оберіть рік'}).getByRole('option').allTextContents(),['2026','2027','2028'])
  await expect(year).toHaveAttribute('aria-label','Звітний рік: 2027')
})

test('Real App defaults to 2026, persists selected 2027 and supplies it to every year-dependent page',async t=>{
  const page=await pageFor(t,'app')
  const shell=page.locator('.app-shell')
  await expect(shell.getByRole('combobox',{name:'Звітний рік: 2026',exact:true})).toBeVisible()
  await shell.getByRole('combobox',{name:'Звітний рік: 2026',exact:true}).click()
  await shell.getByRole('option',{name:'2027',exact:true}).click()
  for(const [section,kind] of [['Реєстр допомог','assignments'],['Огляд','dashboard'],['Звітність','reports'],['Формування відомостей','statements']]) {
    await shell.locator('.nav-list').getByRole('button',{name:section,exact:true}).click()
    await expect.poll(()=>page.evaluate(k=>window.__reads.some(row=>row.kind===k&&row.year===2027),kind)).toBe(true)
  }
  await page.reload()
  await page.getByRole('button',{name:'app',exact:true}).click()
  await expect(shell.getByRole('combobox',{name:'Звітний рік: 2027',exact:true})).toBeVisible()
  await shell.getByRole('combobox',{name:'Звітний рік: 2027',exact:true}).click()
  await shell.getByRole('option',{name:'2026',exact:true}).click()
  await shell.locator('.nav-list').getByRole('button',{name:'Реєстр допомог',exact:true}).click()
  await expect.poll(()=>page.evaluate(()=>window.__reads.some(row=>row.kind==='assignments'&&row.year===2026))).toBe(true)
})

test('Assignment form accepts 2026, uses its decision and blocks payment in another year',async t=>{
  const page=await pageFor(t,'assignments')
  await page.getByRole('combobox',{name:'Звітний рік: 2027',exact:true}).click()
  await page.getByRole('option',{name:'2026',exact:true}).click()
  await page.getByRole('button',{name:'Додати призначення',exact:true}).click()
  await select(page,'Отримувач','Тестова');await select(page,'Рішення виконкому',null)
  await select(page,'Програма',null);await select(page,'Вид допомоги',null)
  await type(page,'100');await enter(page);await select(page,'Статус',null,3)
  const date=page.getByPlaceholder('ДД.ММ.РРРР')
  await expect(date).toBeFocused();await page.keyboard.press('Control+A');await type(page,'01.01.2027');await page.keyboard.press('Control+Enter')
  await expect(date).toHaveAttribute('aria-invalid','true')
  assert.equal(await page.evaluate(()=>window.__calls.filter(row=>row.kind==='assignment').length),0)
  await page.keyboard.press('Control+A');await type(page,'31.12.2026');await page.keyboard.press('Control+Enter')
  const input=await call(page,'assignment');assert.equal(input.decisionId,'d2026');assert.equal(input.paidOn,'2026-12-31')
})

test('Decision registry filters by working year and creates a decision for 2026',async t=>{
  const page=await pageFor(t,'decisionRegistry')
  await expect(page.locator('.decision-table')).toContainText('02.01.2027')
  await page.getByRole('combobox',{name:'Звітний рік: 2027',exact:true}).click()
  await page.getByRole('option',{name:'2026',exact:true}).click()
  await expect(page.locator('.decision-table')).toContainText('02.01.2026')
  await expect(page.locator('.decision-table')).not.toContainText('02.01.2027')
  await page.getByRole('button',{name:'Додати рішення',exact:true}).click()
  await type(page,'106');await enter(page)
  await page.keyboard.press('Control+A');await type(page,'02.01.2026');await page.keyboard.press('Control+Enter')
  assert.equal((await call(page,'decision')).decisionDate,'2026-01-02')
})


test('Sidebar order and empty aid register preserve headings and integrated zero totals', async t => {
  const page = await pageFor(t, 'app')
  const shell = page.locator('.app-shell')
  assert.deepEqual(await shell.locator('.nav-list button').allTextContents(), ['Головна', 'Огляд', 'Реєстр допомог', 'Формування відомостей', 'Звітність', 'Довідники'])
  await shell.locator('.nav-list').getByRole('button', {name:'Реєстр допомог', exact:true}).click()
  const table = shell.locator('.aid-table')
  await expect(table.locator('thead th')).toHaveCount(11)
  await expect(table.locator('.aid-empty-state')).toContainText('За 2026 рік призначень немає')
  await expect(table.locator('.aid-empty-state')).toContainText('Створіть перше призначення, щоб розпочати облік')
  await expect(table.locator('tbody td')).toHaveAttribute('colspan', '11')
  await expect(table.locator('tfoot')).toContainText('Всього: 0')
  await expect(table.locator('tfoot')).toContainText(/Сума призначень:.*0,00/)
  await expect(shell.locator('.aid-empty-summary')).toHaveCount(0)
  // Search in a genuinely empty year must not imply hidden existing records.
  await shell.locator('.registry-search input').fill('вигаданий пошук')
  await expect(table.locator('.aid-empty-state')).toContainText('За 2026 рік призначень немає')
  for (const width of [1600, 1280, 900]) {
    await page.setViewportSize({width, height:900})
    const geometry = await table.evaluate(el => {
      const th = el.querySelectorAll('thead th')[7].getBoundingClientRect()
      const total = el.querySelector('tfoot .assignment-amount').getBoundingClientRect()
      const wrap = el.parentElement.getBoundingClientRect()
      return {right:Math.abs(th.right-total.right), height:el.querySelector('tbody').getBoundingClientRect().height, tableWidth:el.getBoundingClientRect().width, scrollWidth:el.parentElement.scrollWidth, wrapRight:wrap.right, viewport:innerWidth}
    })
    assert.ok(geometry.right < 1, 'total stays aligned with amount column')
    assert.ok(geometry.height < 200, 'empty body is compact')
    assert.ok(geometry.scrollWidth <= Math.ceil(geometry.tableWidth) + 1, 'empty state adds no table overflow')
    assert.ok(geometry.wrapRight <= geometry.viewport + 1, 'table wrapper stays within viewport')
  }
})

test('Aid register distinguishes filtered results from an empty year and preserves populated rows', async t => {
  const page = await pageFor(t, 'reports')
  await page.evaluate(() => {
    window.hromadaAid.assignments.list = async () => ({assignments:[{
      id:'synthetic-assignment',createdAt:'2027-01-03T10:00:00.001Z',recipientId:'r1',recipientName:'Вигадана Тестова Особа',recipientIsDemo:false,recipientSex:'Жінка',recipientIsVpo:false,
      decisionId:'d1',decisionNumber:'101',decisionDate:'2027-01-02',programId:'p1',programName:'Програма підтримки ветеранів',aidTypeId:'t1',aidTypeName:'Тестова матеріальна допомога',amountMinor:125050,status:'Призначено',paidOn:null,
    }]})
  })
  await page.getByRole('button', {name:'assignments',exact:true}).click()
  const table = page.locator('.aid-table')
  await expect(table.locator('tbody tr')).toHaveCount(1)
  await expect(table.locator('tbody')).toContainText('Вигадана Тестова Особа')
  await expect(table.locator('tbody td')).toHaveCount(11)
  await expect(table.locator('tfoot')).toContainText('Призначено: 1')
  await expect(table.locator('tfoot .assignment-amount')).toContainText(/1\s250,50/)
  const search = page.locator('.registry-search input')
  await search.fill('немає збігів')
  await expect(table.locator('.aid-empty-state')).toContainText('За заданими параметрами нічого не знайдено')
  await expect(table.locator('.aid-empty-state')).toContainText('Очистіть пошук або фільтри')
  await expect(table.locator('.aid-empty-state')).not.toContainText('Створіть перше')
  await expect(table.locator('tfoot')).toContainText('Всього: 0')
  await page.getByRole('button', {name:'Очистити пошук і всі фільтри',exact:true}).click()
  await expect(table.locator('tbody')).toContainText('Вигадана Тестова Особа')
  await expect(table.locator('.aid-empty-state')).toHaveCount(0)
  await page.getByRole('button', {name:'Фільтри',exact:true}).click()
  await page.getByRole('combobox', {name:'Фільтр: статус',exact:true}).click()
  await page.getByRole('option', {name:'Виплачено',exact:true}).click()
  await expect(table.locator('.aid-empty-state')).toContainText('За заданими параметрами нічого не знайдено')
  await expect(table.locator('thead th')).toHaveCount(11)
  await page.getByRole('button', {name:'Очистити пошук і всі фільтри',exact:true}).click()
  await expect(table.locator('tbody')).toContainText('Вигадана Тестова Особа')
})
async function formationPage(t, count) {
  const page = await pageFor(t, 'app')
  await page.evaluate(count => {
    window.hromadaAid.statements.list = async () => ({assignments:Array.from({length:count}, (_,i)=>({id:'s'+i,aidTypeId:'synthetic-aid',recipientName:i===0?'Вигадана Тестова Особа':'Синтетичний Отримувач '+i,decisionNumber:String(i+1),decisionDate:'2026-01-02',aidTypeName:'Одноразова матеріальна допомога на лікування',status:i%2?'Передано до казначейства':'Призначено',amountMinor:100000+i*100}))})
    window.hromadaAid.statements.generate = async (kind,ids,year,parameters) => {
      window.__calls.push({kind,ids,year,parameters})
      await new Promise(done=>setTimeout(done,600))
      return {ok:false,message:'Синтетична перевірка виклику генератора'}
    }
    window.hromadaAid.statements.generateBank = async (ids,year) => {
      window.__calls.push({kind:'bank',ids,year})
      await new Promise(done=>setTimeout(done,600))
      return {ok:false,message:'Синтетична перевірка виклику генератора'}
    }
  },count)
  await page.locator('.app-shell .nav-list').getByRole('button',{name:'Формування відомостей',exact:true}).click()
  await expect(page.locator('.formation-panel .recipient-option')).toHaveCount(count)
  return page
}

async function completeStatementParameters(page, number = 'Тест-01') {
  const dialog=page.getByRole('dialog',{name:'Параметри формування',exact:true})
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Номер відомості *',{exact:true}).fill(number)
  await dialog.getByLabel(/Дата (виплати|проведення|формування) \*/).fill('29.02.2028')
  if(await dialog.getByLabel('Початок періоду *',{exact:true}).count()) {
    await dialog.getByLabel('Початок періоду *',{exact:true}).fill('01.01.2025')
    await dialog.getByLabel('Кінець періоду *',{exact:true}).fill('31.12.2025')
  }
  await dialog.getByRole('button',{name:'Сформувати документи',exact:true}).evaluate(button=>{button.click();button.click()})
}
async function closeStatementParameters(page) {
  await page.getByRole('dialog',{name:'Параметри формування',exact:true}).getByRole('button',{name:'Закрити вікно',exact:true}).click()
  await page.getByRole('button',{name:'Закрити без збереження',exact:true}).last().click()
}

test('Statement formation: compact empty states, equal disabled actions and responsive layout',async t=>{
  const page=await formationPage(t,0)
  const panel=page.locator('.formation-panel')
  await expect(panel.locator('.formation-empty')).toContainText('За 2026 рік немає доступних призначень')
  await panel.getByRole('searchbox',{name:'Пошук призначень за ПІБ'}).fill('пошук')
  await expect(panel.locator('.formation-empty')).toContainText('За 2026 рік немає доступних призначень')
  for(const button of await panel.locator('.statement-actions button').all()) await expect(button).toBeDisabled()
  await expect(panel.getByRole('checkbox',{name:'Вибрати всі видимі записи'})).toBeDisabled()
  for(const width of [1600,1280,900,600,360]) {
    await page.setViewportSize({width,height:1000})
    const geometry=await panel.evaluate(el=>({client:el.clientWidth,scroll:el.scrollWidth,empty:el.querySelector('.formation-empty').getBoundingClientRect().height,buttons:[...el.querySelectorAll('.statement-actions button')].map(b=>({height:b.getBoundingClientRect().height,client:b.clientWidth,scroll:b.scrollWidth}))}))
    assert.ok(geometry.scroll<=geometry.client+1,'no horizontal overflow within panel')
    assert.ok(geometry.empty<220,'compact empty state')
    assert.ok(geometry.buttons.every(b=>Math.abs(b.height-geometry.buttons[0].height)<1),'equal button heights')
    assert.ok(geometry.buttons.every(b=>b.scroll<=b.client+1),'button labels fit')
  }
})

test('Statement formation: selection, keyboard, search and all three generator routes preserve IDs and year',async t=>{
  const page=await formationPage(t,3)
  const panel=page.locator('.formation-panel')
  const boxes=panel.locator('.recipient-option input')
  await boxes.first().focus();await page.keyboard.press('Space')
  await expect(panel.locator('.recipient-option.selected')).toHaveCount(1)
  await expect(panel.locator('.formation-selection-info > div:first-child strong')).toHaveText('1')
  const selectAll=panel.getByRole('checkbox',{name:'Вибрати всі видимі записи',exact:true})
  await expect(selectAll).toHaveAttribute('aria-checked','mixed')
  assert.equal(await selectAll.evaluate(el=>el.indeterminate),true)
  const checkboxStyles=await panel.locator('.custom-checkbox').evaluateAll(boxes=>boxes.map(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,radius:getComputedStyle(el).borderRadius})))
  assert.ok(checkboxStyles.every(box=>JSON.stringify(box)===JSON.stringify(checkboxStyles[0])),'header and row checkbox shapes match')

  const geometry=await panel.evaluate(el=>({checkbox:el.querySelector('.selection-all input').getBoundingClientRect().left,rowCheckbox:el.querySelector('.custom-checkbox').getBoundingClientRect().left,rowHeight:el.querySelector('.recipient-option').getBoundingClientRect().height,toolbar:el.querySelector('.selection-toolbar').getBoundingClientRect(),counters:el.querySelector('.formation-counters').getBoundingClientRect(),buttons:[...el.querySelectorAll('.statement-actions button')].map(b=>({width:b.getBoundingClientRect().width,top:b.getBoundingClientRect().top}))}))
  assert.ok(Math.abs(geometry.checkbox-geometry.rowCheckbox)<=1,'select-all aligns with row checkboxes')
  assert.ok(geometry.rowHeight<=79,'rows are roughly 20–25% denser than former 96px rows')
  assert.ok(geometry.counters.right<=geometry.toolbar.right+1,'counters stay within toolbar')
  assert.ok(geometry.buttons.every(b=>Math.abs(b.width-geometry.buttons[0].width)<1&&b.top===geometry.buttons[0].top),'three equal-width buttons share one row')
  await expect(panel.locator('.formation-panel-heading .formation-counters')).toHaveCount(0)
  await expect(panel.locator('.list-total')).toHaveCount(0)
  const styles=await panel.locator('.statement-actions button').evaluateAll(bs=>bs.map(b=>({height:b.getBoundingClientRect().height,bg:getComputedStyle(b).backgroundColor})))
  assert.ok(styles.every(s=>s.height===styles[0].height&&s.bg===styles[0].bg))
  if(process.env.HROMADA_UI_SCREENSHOT) await page.screenshot({path:process.env.HROMADA_UI_SCREENSHOT,fullPage:true})
  const search=panel.getByRole('searchbox',{name:'Пошук призначень за ПІБ'})
  await search.fill('немає збігів')
  await expect(panel.locator('.formation-empty')).toContainText('За заданими параметрами нічого не знайдено')
  await expect(panel.locator('.formation-counters > span:first-child strong')).toHaveText('0')
  await expect(panel.locator('.formation-selection-info > div:first-child strong')).toHaveText('1')
  await search.fill('')
  await panel.getByRole('checkbox',{name:'Вибрати всі видимі записи'}).check()
  await expect(panel.locator('.recipient-option.selected')).toHaveCount(3)
  await expect(selectAll).toHaveAttribute('aria-checked','true')
  assert.equal(await selectAll.evaluate(el=>el.indeterminate),false)
  await selectAll.focus();await page.keyboard.press('Space')
  await expect(selectAll).toHaveAttribute('aria-checked','false')
  await expect(panel.locator('.recipient-option.selected')).toHaveCount(0)
  await page.keyboard.press('Space')
  await expect(panel.locator('.recipient-option.selected')).toHaveCount(3)
  await expect(panel.locator('.formation-selection-info > div:last-child strong')).toHaveText(/3\s003,00/)
  const originalNames=await panel.locator('.statement-actions button').allTextContents()
  for(const [index,kind] of ['personal','summary','bank'].entries()) {
    await panel.locator('.statement-actions button').nth(index).click()
    if(kind!=='bank') await completeStatementParameters(page)
    await expect(panel.locator('.statement-actions')).toHaveAttribute('aria-busy','true')
    for(const button of await panel.locator('.statement-actions button').all()) await expect(button).toBeDisabled()
    await expect(panel.locator('.statement-actions .formation-spinner')).toHaveCount(1)
    await expect(panel.locator('.statement-actions button').nth(index)).toHaveText('Формуємо…')
    for(let other=0;other<3;other++) if(other!==index) await expect(panel.locator('.statement-actions button').nth(other)).toHaveText(originalNames[other])
    await expect(panel.locator('.statement-actions')).toHaveAttribute('aria-busy','false')
    assert.deepEqual(await panel.locator('.statement-actions button').allTextContents(),originalNames)
    await expect(page.getByRole('alert')).toContainText('Синтетична перевірка')
    const actual=await page.evaluate(kind=>window.__calls.filter(c=>c.kind===kind),kind)
    assert.equal(actual.length,1)
    assert.deepEqual(actual[0].ids,['s0','s1','s2']);assert.equal(actual[0].year,2026)
    if(kind!=='bank') { assert.equal(actual[0].parameters[0].documentNumber,'Тест-01');await closeStatementParameters(page) }
  }
  await page.evaluate(()=>{window.hromadaAid.statements.generateBank=async()=>({ok:true,document:{id:'test-bank',fileName:'synthetic.xlsx',recordCount:3,totalMinor:300300}})})
  await panel.locator('.statement-actions button').nth(2).click()
  await expect(page.getByRole('dialog',{name:'ПриватБанк',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Закрити вікно',exact:true}).click()
  await expect(panel.locator('.statement-actions')).toHaveAttribute('aria-busy','false')
  for(const button of await panel.locator('.statement-actions button').all()) await expect(button).toBeEnabled()
  await page.evaluate(()=>{window.hromadaAid.statements.generate=async()=>{throw Error('Synthetic rejected IPC')}})
  await panel.locator('.statement-actions button').nth(1).click()
  await completeStatementParameters(page)
  await expect(page.getByRole('alert')).toContainText('Не вдалося отримати результат')
  await closeStatementParameters(page)
  await expect(panel.locator('.statement-actions .formation-spinner')).toHaveCount(0)
  for(const button of await panel.locator('.statement-actions button').all()) await expect(button).toBeEnabled()
  await panel.getByRole('button',{name:'Скасувати вибір',exact:true}).click()
  await expect(panel.locator('.recipient-option.selected')).toHaveCount(0)
  for(const button of await panel.locator('.statement-actions button').all()) await expect(button).toBeDisabled()
})

test('Statement formation: large list scrolls internally and filtered select-all keeps hidden selection',async t=>{
  const page=await formationPage(t,200)
  const panel=page.locator('.formation-panel')
  const list=panel.locator('.assignment-statement-list')
  assert.ok(await list.evaluate(el=>el.scrollHeight>el.clientHeight&&el.clientHeight<=560))
  await panel.locator('.recipient-option input').last().focus();await page.keyboard.press('Space')
  await expect(panel.locator('.formation-selection-info > div:first-child strong')).toHaveText('1')
  const search=panel.getByRole('searchbox',{name:'Пошук призначень за ПІБ'})
  await search.fill('Вигадана')
  await expect(panel.getByRole('checkbox',{name:'Вибрати всі видимі записи'})).toHaveAttribute('aria-checked','false')
  await panel.getByRole('checkbox',{name:'Вибрати всі видимі записи'}).check()
  await expect(panel.locator('.formation-selection-info > div:first-child strong')).toHaveText('2')
  await panel.getByRole('checkbox',{name:'Вибрати всі видимі записи'}).uncheck()
  await expect(panel.locator('.formation-selection-info > div:first-child strong')).toHaveText('1')
  await search.fill('')
  await expect(panel.locator('.recipient-option.selected')).toHaveCount(1)
  for(const width of [1280,900,600,360]) {
    await page.setViewportSize({width,height:1000})
    assert.ok(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'no list or action overflow')
  }
})
test('Statement formation: horizontal rows, full-width footer, long names and large amounts stay readable',async t=>{
  const page=await formationPage(t,3)
  const panel=page.locator('.formation-panel')
  const search=panel.getByRole('searchbox',{name:'Пошук призначень за ПІБ'})
  await page.evaluate(()=>{
    window.hromadaAid.statements.list=async()=>({assignments:[
      {id:'wide0',recipientName:'Тестова Особа',decisionNumber:'1',decisionDate:'2026-01-02',status:'Призначено',aidTypeName:'Допомога',amountMinor:100000},
      {id:'wide1',recipientName:'Дуже-Довге-Прізвище Синтетичний Отримувач З Довгим По Батькові',decisionNumber:'12345',decisionDate:'2026-01-02',status:'Передано до казначейства',aidTypeName:'Одноразова матеріальна допомога на лікування та інші потреби з дуже довгою офіційною назвою',amountMinor:1234567890},
      {id:'wide2',recipientName:'Інша Тестова Особа',decisionNumber:'17',decisionDate:'2026-01-02',status:'В роботі',aidTypeName:'Тестова допомога на лікування',amountMinor:250000},
    ]});window.dispatchEvent(new Event('focus'))
  })
  await expect(panel.locator('.formation-recipient-name').first()).toHaveText('Тестова Особа')
  assert.deepEqual(await panel.locator('.recipient-option').first().evaluate(row=>[...row.children].map(el=>el.classList[0])),['formation-checkbox','formation-recipient-name','formation-decision','formation-aid-name','formation-row-status','recipient-option-total'])
  await panel.getByRole('checkbox',{name:'Вибрати всі видимі записи'}).check()
  await expect(panel.locator('.formation-selection-info > div:first-child strong')).toHaveText('3')
  await expect(panel.locator('.formation-selection-info > div:last-child strong')).toHaveText(/12\s349\s178,90/)
  for(const width of [1600,1440,1280,900,600,360]) {
    await page.setViewportSize({width,height:1000})
    const geometry=await panel.evaluate(el=>{
      const rect=selector=>{const r=el.querySelector(selector).getBoundingClientRect();return {left:r.left,right:r.right,width:r.width}}
      return {list:rect('.assignment-statement-list'),summary:rect('.formation-selection-info'),actions:rect('.statement-actions'),client:el.clientWidth,scroll:el.scrollWidth,
        rows:[...el.querySelectorAll('.recipient-option')].map(row=>({height:row.getBoundingClientRect().height,client:row.clientWidth,scroll:row.scrollWidth,amount:row.querySelector('.recipient-option-total').getBoundingClientRect().width,amountScroll:row.querySelector('.recipient-option-total').scrollWidth,columns:['.custom-checkbox','.formation-recipient-name','.formation-decision','.formation-row-status','.formation-aid-name','.recipient-option-total'].map(selector=>{const r=row.querySelector(selector).getBoundingClientRect();return {left:r.left,right:r.right,width:r.width}})})),
        buttons:[...el.querySelectorAll('.statement-actions button')].map(b=>b.getBoundingClientRect().width)}
    })
    for(const block of [geometry.summary,geometry.actions]) {
      assert.ok(Math.abs(block.left-geometry.list.left)<1&&Math.abs(block.right-geometry.list.right)<1,'footer aligns exactly to list edges')
    }
    assert.ok(geometry.scroll<=geometry.client+1,'panel has no added horizontal overflow at '+width)
    assert.ok(geometry.rows.every(row=>row.scroll<=row.client+1),'long content does not overflow rows at '+width)
    assert.ok(geometry.rows.every(row=>row.amountScroll<=Math.ceil(row.amount)+1),'amounts remain fully visible')
    for(let column=0;column<5;column++) assert.ok(geometry.rows.every(row=>Math.abs(row.columns[column].left-geometry.rows[0].columns[column].left)<1),'column '+column+' aligns across short and long records at '+width)
    assert.ok(geometry.rows.every(row=>Math.abs(row.columns[5].right-geometry.rows[0].columns[5].right)<1),'amounts share a fixed right edge')
    if(width>=1440) {
      assert.ok(geometry.rows[0].columns[4].width>geometry.rows[0].columns[1].width,'aid type gets most flexible space')
      assert.ok(geometry.rows[0].height>=52&&geometry.rows[0].height<=60,'standard row is 52–60px')
      assert.ok(geometry.buttons.every(w=>Math.abs(w-geometry.buttons[0])<1),'equal button columns')
    }
  }
  await page.setViewportSize({width:1440,height:1000})
  const aid=panel.locator('.formation-aid-name').nth(1)
  assert.ok(await aid.evaluate(el=>el.scrollWidth>el.clientWidth),'long aid name uses ellipsis')
  await expect(aid).toHaveAttribute('title',/дуже довгою офіційною назвою/)
  if(process.env.HROMADA_UI_SCREENSHOT) await page.screenshot({path:process.env.HROMADA_UI_SCREENSHOT,fullPage:true})
})
test('Statement parameters: blank drafts, per-document validation, copy dates without numbers and independent pages',async t=>{
  const page=await formationPage(t,14)
  await page.evaluate(()=>{
    window.hromadaAid.statements.list=async()=>({assignments:Array.from({length:14},(_,i)=>({id:'s'+i,aidTypeId:i===13?'aid-b':'aid-a',aidTypeName:i===13?'Другий вид допомоги':'Перший вид допомоги',recipientName:'Синтетичний Отримувач '+i,decisionNumber:'1',decisionDate:'2026-01-02',status:'Призначено',amountMinor:100000}))});window.dispatchEvent(new Event('focus'))
  })
  const panel=page.locator('.formation-panel')
  await expect(panel.locator('.recipient-option')).toHaveCount(14)
  await panel.getByRole('checkbox',{name:'Вибрати всі видимі записи'}).check()
  await panel.getByRole('button',{name:'Сформувати персональні відомості',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'Параметри формування',exact:true})
  const cards=dialog.locator('.statement-parameter-card')
  await expect(cards).toHaveCount(3)
  const cancel=dialog.getByRole('button',{name:'Скасувати',exact:true})
  await expect(cancel.locator('svg')).toHaveCount(1)
  assert.equal(await cancel.getAttribute('class'),'secondary-button assignment-cancel-button')
  assert.deepEqual(await cancel.evaluate(el=>{const s=getComputedStyle(el);return {color:s.color,border:s.borderTopColor,height:s.height}}),{color:'rgb(86, 106, 126)',border:'rgb(220, 227, 232)',height:'44px'})

  assert.ok((await dialog.locator('input').evaluateAll(inputs=>inputs.map(input=>input.value))).every(value=>value===''),'no inferred number or dates')
  assert.equal(await page.evaluate(()=>window.__calls.length),0,'opening parameters does not generate')
  await dialog.getByRole('button',{name:'Сформувати документи',exact:true}).click()
  await expect(dialog.locator('.recipient-field-error')).toHaveCount(12)
  await expect(cards.nth(0).getByLabel('Номер відомості *',{exact:true})).toBeFocused()
  for(let i=0;i<3;i++) {
    await cards.nth(i).getByLabel('Номер відомості *',{exact:true}).fill('Номер-'+i)
    await cards.nth(i).getByLabel('Дата виплати *',{exact:true}).fill('29.02.2028')
    await cards.nth(i).getByLabel('Початок періоду *',{exact:true}).fill('01.01.2025')
    await cards.nth(i).getByLabel('Кінець періоду *',{exact:true}).fill('31.12.2025')
  }
  await cards.nth(0).getByLabel('Кінець періоду *',{exact:true}).fill('31.12.2024')
  await dialog.getByRole('button',{name:'Сформувати документи',exact:true}).click()
  await expect(cards.nth(0).getByRole('alert')).toContainText('Кінець періоду')
  assert.equal(await page.evaluate(()=>window.__calls.length),0)
  await cards.nth(0).getByLabel('Кінець періоду *',{exact:true}).fill('31.12.2025')
  await cards.nth(0).getByRole('button',{name:'Застосувати дати та період до всіх',exact:true}).click()
  for(let i=0;i<3;i++) await expect(cards.nth(i).getByLabel('Номер відомості *',{exact:true})).toHaveValue('Номер-'+i)
  await cards.nth(1).getByLabel('Дата виплати *',{exact:true}).fill('05.01.2029')
  await cards.nth(1).getByLabel('Початок періоду *',{exact:true}).fill('01.01.2029')
  await cards.nth(1).getByLabel('Кінець періоду *',{exact:true}).fill('05.01.2029')
  await dialog.getByRole('button',{name:'Сформувати документи',exact:true}).click()
  await expect(dialog.getByRole('alert')).toContainText('Синтетична перевірка')
  const call=await page.evaluate(()=>window.__calls[0])
  assert.deepEqual(call.parameters.map(p=>[p.aidTypeId,p.partIndex,p.documentNumber,p.documentDate]),[['aid-a',0,'Номер-0','2028-02-29'],['aid-a',1,'Номер-1','2029-01-05'],['aid-b',0,'Номер-2','2028-02-29']])
  await expect(cards.nth(1).getByLabel('Дата виплати *',{exact:true})).toHaveValue('05.01.2029')
  await cards.nth(2).getByRole('button',{name:/Другий вид допомоги/}).click()
  await expect(cards.nth(2).getByLabel('Номер відомості *',{exact:true})).toBeHidden()
  await cards.nth(2).getByRole('button',{name:/Другий вид допомоги/}).click()
  await expect(cards.nth(2).getByLabel('Номер відомості *',{exact:true})).toHaveValue('Номер-2')
  for(const width of [1280,600,360]) {
    await page.setViewportSize({width,height:850})
    assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'parameter modal has no horizontal overflow')
  }
  if(process.env.HROMADA_PARAMETERS_SCREENSHOT) await page.screenshot({path:process.env.HROMADA_PARAMETERS_SCREENSHOT,fullPage:true})
})

test('Statement results: modern document switcher, PDF frame and existing export handlers remain usable',async t=>{
  const page=await formationPage(t,2)
  await page.evaluate(()=>{
    window.hromadaAid.statements.generate=async(kind,ids,year,parameters)=>{
      window.__calls.push({kind,ids,year,parameters})
      return {ok:true,documents:[0,1].map(i=>({id:'document-'+i,documentNumber:'TEST-'+i,documentDate:'2028-02-29',fileName:'technical_very_long_generated_file_'+i+'.pdf',aidTypeName:'Тестовий вид допомоги '+i,recordCount:1,totalMinor:100000,pdfBase64:btoa('%PDF-1.4\n%%EOF')}))}
    }
    window.hromadaAid.statements.save=async id=>{window.__calls.push({kind:'save-xlsx',id});return {ok:true}}
    window.hromadaAid.statements.savePdf=async id=>{window.__calls.push({kind:'save-pdf',id});return {ok:true}}
  })
  const panel=page.locator('.formation-panel')
  await panel.getByRole('checkbox',{name:'Вибрати всі видимі записи'}).check()
  await panel.getByRole('button',{name:'Сформувати зведені відомості',exact:true}).click()
  await completeStatementParameters(page,'Зведена-1')
  const dialog=page.getByRole('dialog',{name:'Зведені відомості',exact:true})
  await expect(dialog).toBeVisible()
  await expect(page.getByRole('dialog',{name:'Параметри формування',exact:true})).toHaveCount(0)
  await dialog.locator('.statement-document-list button').nth(1).click()
  await expect(dialog.locator('.statement-document-list button').nth(1)).toHaveAttribute('aria-pressed','true')
  await expect(dialog.locator('iframe')).toHaveCount(1)
  await expect(dialog.locator('.statement-integrity-note')).toHaveCount(0)
  await expect(dialog.locator('.statement-preview-toolbar > strong')).toHaveText('Тестовий вид допомоги 1 · № TEST-1')
  await dialog.getByRole('button',{name:'Зберегти Excel',exact:true}).click()
  await dialog.getByRole('button',{name:'Зберегти PDF',exact:true}).click()
  const calls=await page.evaluate(()=>window.__calls.filter(c=>c.kind.startsWith('save-')))
  assert.deepEqual(calls,[{kind:'save-xlsx',id:'document-1'},{kind:'save-pdf',id:'document-1'}])
  for(const width of [1280,600,360]) {
    await page.setViewportSize({width,height:850})
    assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'result modal has no horizontal overflow')
  }
  await dialog.getByRole('button',{name:'Закрити вікно',exact:true}).click()
  await expect(panel.locator('.recipient-option.selected')).toHaveCount(2)
})
test('Bank generation runs immediately without metadata dialog and preserves result/export access',async t=>{
 const page=await formationPage(t,1)
 await page.evaluate(()=>{
  window.hromadaAid.statements.generateBank=async(...args)=>{window.__calls.push({kind:'bank',args});return {ok:true,document:{id:'bank-naming',fileName:'(2026-10-18) – ВІДОМІСТЬ ДЛЯ ПРИВАТБАНКУ.xlsx',recordCount:1,totalMinor:100000}}}
  window.hromadaAid.statements.save=async id=>{window.__calls.push({kind:'save-bank',id});return {ok:true}}
 })
 const panel=page.locator('.formation-panel')
 await panel.getByRole('checkbox',{name:'Вибрати всі видимі записи'}).check()
 await panel.getByRole('button',{name:'Сформувати відомість для ПриватБанку',exact:true}).click()
 await expect(page.getByRole('dialog',{name:'Параметри формування',exact:true})).toHaveCount(0)
 const result=page.getByRole('dialog',{name:'ПриватБанк',exact:true})
 await expect(result).toBeVisible()
 assert.deepEqual(await page.evaluate(()=>window.__calls[0]),{kind:'bank',args:[['s0'],2026]})
 await result.getByRole('button',{name:'Зберегти Excel',exact:true}).click()
 assert.deepEqual(await page.evaluate(()=>window.__calls[1]),{kind:'save-bank',id:'bank-naming'})
})

async function catalogPage(t) {
  const page = await pageFor(t,'dictionaries')
  await page.evaluate(() => {
    const base = {isActive:true,approvalId:null,approvalNumber:null,approvalDate:null,approvalTitle:null,assignmentCount:0}
    const programs = [{...base,id:'program-social',shortName:'Програма соціального захисту',officialName:'Повна назва соціальної програми'}, {...base,id:'program-veterans',shortName:'Програма підтримки ветеранів',officialName:'Повна назва програми ветеранів'}, {...base,id:'future',shortName:'Майбутня програма',officialName:'Повна назва майбутньої програми'}]
    const aidTypes = Array.from({length:12},(_,n)=>({id:'aid-'+n,code:'TEST_'+n,programId:n===11?'program-veterans':'program-social',shortName:n===0?'Довга назва допомоги для перевірки природного перенесення тексту без обрізання':'Допомога '+n,officialName:'Повна офіційна назва '+n+' — '+ 'Розгорнуте пояснення призначення матеріальної допомоги. '.repeat(10),direction:'Напрям',fundingSource:'Джерело',isActive:n!==10,assignmentCount:n===0?5:0}))
    window.__catalog = {programs,aidTypes}
    window.hromadaAid.catalogs.list=async()=>structuredClone(window.__catalog)
    window.hromadaAid.catalogs.save=async input=>{
      window.__calls.push({kind:'catalog',input})
      if(window.__reject)return {ok:false,message:'Тестова помилка збереження'}
      const list=input.kind==='program'?programs:aidTypes
      const previous=list.find(item=>item.id===input.id)
      if(previous)Object.assign(previous,input)
      else list.push({...base,...input,id:'new-'+list.length,code:'NEW'})
      return {ok:true}
    }
    window.hromadaAid.deletion={preview:async(entity,id)=>({entity,id,name:'Тестовий запис',dependencies:[{label:'Пов’язані призначення',count:5}]}),execute:async(entity,id)=>{window.__calls.push({kind:'delete',input:{entity,id}});return {ok:false,message:'Тестова відмова видалення'}}}
  })
  await page.getByRole('button',{name:'reports',exact:true}).click()
  await page.getByRole('button',{name:'dictionaries',exact:true}).click()
  await page.getByRole('tab',{name:'Програми та допомоги',exact:true}).click()
  await expect(page.locator('.program-catalog-block')).toHaveCount(3)
  return page
}

test('Catalog redesign: five keyboard tabs, grouped aids, independent collapse, inactive and future programs',async t=>{
 const page=await catalogPage(t)
 await expect(page.getByRole('tablist',{name:'Підрозділи довідників'}).getByRole('tab')).toHaveCount(5)
 await expect(page.locator('.program-tone-social .program-aid-list li')).toHaveCount(11)
 await expect(page.locator('.program-tone-veterans .program-aid-list li')).toHaveCount(1)
 await expect(page.locator('.program-tone-neutral')).toContainText('У програмі поки немає видів допомоги.')
 await expect(page.locator('.program-tone-social')).toContainText('Неактивний')
 const collapse=page.getByRole('button',{name:'Згорнути види допомоги: Програма соціального захисту',exact:true})
 await collapse.click();await expect(page.locator('.program-tone-social .program-aid-list')).toBeHidden()
 await expect(page.locator('.program-tone-social').getByRole('button',{name:'Додати вид допомоги',exact:true})).toHaveCount(0)
 await expect(page.locator('.program-tone-veterans .program-aid-list')).toBeVisible()
 await page.getByRole('button',{name:'Розгорнути види допомоги: Програма соціального захисту',exact:true}).click()
 await expect(page.locator('.program-tone-social').getByRole('button',{name:'Додати вид допомоги',exact:true})).toBeVisible()
 const tab=page.getByRole('tab',{name:'Отримувачі',exact:true});await tab.focus()
 await page.keyboard.press('ArrowRight');await expect(page.getByRole('tab',{name:'Рішення виконкому',exact:true})).toHaveAttribute('aria-selected','true')
 await page.keyboard.press('ArrowRight');await expect(page.getByRole('tab',{name:'Банки',exact:true})).toHaveAttribute('aria-selected','true')
 await page.keyboard.press('Home');await expect(page.getByRole('tab',{name:'Отримувачі',exact:true})).toHaveAttribute('aria-selected','true')
})

test('Dictionary navigation 52: two equal-height 60/40 groups, all tabs and contained horizontal scrolling',async t=>{
 const page=await pageFor(t,'app')
 await page.locator('.nav-list').getByRole('button',{name:'Довідники',exact:true}).click()
 const nav=page.getByRole('tablist',{name:'Підрозділи довідників'}),tabs=nav.getByRole('tab'),groups=nav.locator('.dictionary-navigation-group')
 assert.deepEqual(await tabs.allTextContents(),['Отримувачі','Рішення виконкому','Банки','Програми та допомоги','Планові показники'])
 await expect(groups).toHaveCount(2)
 await expect(groups.first().getByRole('tab')).toHaveCount(3);await expect(groups.last().getByRole('tab')).toHaveCount(2)
 await tabs.first().focus()
 for(let index=0;index<5;index++){
  if(index)await page.keyboard.press('ArrowRight')
  await expect(tabs.nth(index)).toBeFocused();await expect(tabs.nth(index)).toHaveAttribute('aria-selected','true')
  await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby',await tabs.nth(index).getAttribute('id'))
 }
 await expect(page.getByRole('heading',{name:'Планові показники',exact:true})).toBeVisible()
 await page.keyboard.press('Home');await expect(tabs.first()).toBeFocused()
 await page.keyboard.press('End');await expect(tabs.last()).toBeFocused()
 for(const width of [1440,1280,1040,760,480,360]){
  await page.setViewportSize({width,height:1000})
  const rectangles=await groups.evaluateAll(elements=>elements.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}))
  assert(Math.abs(rectangles[0].height-rectangles[1].height)<1&&Math.abs(rectangles[0].y-rectangles[1].y)<1,'equal-height horizontal containers '+width)
  assert(Math.abs(rectangles[0].width/rectangles[1].width-1.5)<.01,'60/40 proportions')
  const items=await tabs.evaluateAll(elements=>elements.map(el=>{const r=el.getBoundingClientRect();return {height:r.height,y:r.y,overflow:el.scrollWidth>el.clientWidth,nowrap:getComputedStyle(el).whiteSpace}}))
  assert(items.every(item=>item.height===items[0].height&&item.y===items[0].y&&!item.overflow&&item.nowrap==='nowrap'),'tabs never wrap or clip '+width)
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no page overflow '+width)
  const container=page.locator('.dictionary-navigation')
  if(width===1440){assert(await container.evaluate(el=>el.scrollWidth<=el.clientWidth+1));const b=await container.boundingBox(),h=await page.locator('.planning-panel').boundingBox();assert(Math.abs(b.x-h.x)<1&&Math.abs(b.width-h.width)<1,'content edges align')}
  if(width===360){assert(await container.evaluate(el=>el.scrollWidth>el.clientWidth));await tabs.first().focus();await page.keyboard.press('End');await expect(tabs.last()).toBeInViewport();await page.keyboard.press('Home');await expect(tabs.first()).toBeInViewport()}
 }
 if(process.env.HROMADA_DICTIONARY_SCREENSHOT){await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:process.env.HROMADA_DICTIONARY_SCREENSHOT,fullPage:true})}
})

test('Catalog redesign: details preserve full names; edit confirmation and deletion remain explicit',async t=>{
 const page=await catalogPage(t)
 const row=page.locator('.program-tone-social li').first()
 await row.locator('.program-aid-open').click()
 const detail=page.getByRole('dialog',{name:'Вид допомоги',exact:true})
 await expect(detail.locator('dd').nth(1)).toHaveText(await page.evaluate(()=>window.__catalog.aidTypes[0].officialName))
 await expect(detail).toContainText('5')
 await detail.getByRole('button',{name:'Редагувати',exact:true}).click()
 const edit=page.getByRole('dialog',{name:'Редагувати вид допомоги',exact:true})
 await expect(edit.getByRole('combobox',{name:'Програма',exact:true})).toBeVisible()
 await edit.getByLabel('Коротка назва *',{exact:true}).fill('Змінена коротка назва')
 await edit.getByRole('button',{name:'Зберегти',exact:true}).click()
 await expect(page.getByRole('alertdialog',{name:'Зберегти зміни довідника?',exact:true})).toBeVisible()
 assert.equal(await page.evaluate(()=>window.__calls.length),0)
 await page.getByRole('button',{name:'Зберегти зміни',exact:true}).click()
 await expect(edit).toHaveCount(0)
 await expect(row).toContainText('Змінена коротка назва')
 await row.getByRole('button',{name:/Видалити вид допомоги/}).click()
 await expect(page.getByRole('alertdialog',{name:'Видалити вид допомоги?',exact:true})).toContainText('Пов’язані призначення: 5')
 assert.equal(await page.evaluate(()=>window.__calls.filter(c=>c.kind==='delete').length),0)
 await page.getByRole('button',{name:'Скасувати',exact:true}).click()
 assert.equal(await page.evaluate(()=>window.__calls.filter(c=>c.kind==='delete').length),0)
})

test('Catalog redesign: create/edit payloads, selected parent, errors retain draft; responsive without overflow',async t=>{
 const page=await catalogPage(t)
 await page.getByRole('button',{name:'Додати програму',exact:true}).click()
 let dialog=page.getByRole('dialog',{name:'Додати програму',exact:true})
 await dialog.getByLabel('Коротка назва *',{exact:true}).fill('Нова програма')
 await dialog.getByLabel('Повна офіційна назва *',{exact:true}).fill('Нова офіційна програма')
 await dialog.getByRole('button',{name:'Зберегти',exact:true}).click()
 await expect(dialog).toHaveCount(0)
 const program=page.locator('.program-catalog-block').filter({has:page.getByRole('heading',{name:'Нова програма',exact:true})})
 await program.getByRole('button',{name:/Редагувати програму/}).click()
 dialog=page.getByRole('dialog',{name:'Редагувати програму',exact:true})
 await dialog.getByLabel('Коротка назва *',{exact:true}).fill('Оновлена програма')
 await dialog.getByRole('button',{name:'Зберегти',exact:true}).click();await expect(dialog).toHaveCount(0)
 await page.locator('.program-tone-veterans').getByRole('button',{name:'Додати вид допомоги',exact:true}).click()
 dialog=page.getByRole('dialog',{name:'Додати вид допомоги',exact:true})
 await expect(dialog.getByRole('combobox',{name:'Програма',exact:true})).toContainText('Програма підтримки ветеранів')
 await dialog.getByLabel('Коротка назва *',{exact:true}).fill('Новий вид')
 await dialog.getByLabel('Повна офіційна назва *',{exact:true}).fill('Нова офіційна допомога')
 await page.evaluate(()=>window.__reject=true)
 await dialog.getByRole('button',{name:'Зберегти',exact:true}).click()
 await expect(dialog.getByRole('alert')).toContainText('Тестова помилка збереження')
 await expect(dialog.getByLabel('Коротка назва *',{exact:true})).toHaveValue('Новий вид')
 await page.evaluate(()=>window.__reject=false)
 await dialog.getByRole('button',{name:'Зберегти',exact:true}).click();await expect(dialog).toHaveCount(0)
 assert.equal(await page.evaluate(()=>window.__calls.at(-1).input.programId),'program-veterans')
 await expect(page.locator('.program-tone-veterans')).toContainText('Новий вид')
 if(process.env.HROMADA_CATALOG_SCREENSHOT)await page.screenshot({path:process.env.HROMADA_CATALOG_SCREENSHOT,fullPage:true})
 for(const width of [1440,1040,760,480]){
  await page.setViewportSize({width,height:1000})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no page overflow at '+width)
  for(const block of await page.locator('.program-catalog-block').all())assert.equal(await block.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'no catalog overflow at '+width)
 }
})

async function dictionaryTablesPage(t, app = false) {
 const page=await pageFor(t,'dictionaries')
 await page.evaluate(()=>{
  const person={id:'ui-person',fullName:'Вигаданий Тестовий Отримувач',lastName:'Вигаданий',firstName:'Тестовий',patronymic:'Отримувач',rnokpp:'0011223344',passport:'АВ123456',sex:'Жінка',isVpo:false,phone:'+380991234567',email:'',registeredAddress:'52151, Дніпропетровська область, Кам’янський район, с-ще Вишневе, вул. Надзвичайно довга назва вулиці, буд. 12А, кв. 10',address:'',registeredAddressParts:null,addressParts:null,bankDetailsId:'detail1',bankAccount:'UA000000000000000000000000000',updatedAt:'2026-10-18T12:00:00.000Z'}
  window.__people=[person,{...person,id:'ui-person-2',fullName:'Інша Особа Приклад',rnokpp:'9988776655',phone:'',isVpo:true}]
  window.hromadaAid.recipients.list=async()=>window.__people
  window.hromadaAid.recipients.get=async id=>window.__people.find(p=>p.id===id)
  window.hromadaAid.recipients.assignmentHistory=async()=>[]
  window.hromadaAid.decisions.list=async()=>[2026,2027].map(year=>({id:'ui-decision-'+year,decisionNumber:'101',decisionDate:year+'-01-02',title:'Тестове рішення',assignmentCount:3,assignedTotalMinor:123456}))
  window.__banks=[{id:'ui-bank',name:'Тестовий банк із довгим найменуванням',recipientCount:0,details:[{id:'detail1',mfo:'001122',edrpou:'00112233',recipientCount:0}]}]
  window.hromadaAid.banks.list=async query=>{
   window.__reads.push({kind:'bankSearch',query})
   return window.__banks.filter(b=>[b.name,...b.details.flatMap(d=>[d.mfo,d.edrpou])].join(' ').toLowerCase().includes((query||'').toLowerCase()))
  }
  window.hromadaAid.banks.get=async id=>window.__banks.find(b=>b.id===id)
  window.hromadaAid.banks.remove=async id=>{window.__calls.push({kind:'bankDelete',input:id});window.__banks=window.__banks.filter(b=>b.id!==id);return {ok:true}}
  window.hromadaAid.deletion={preview:async(entity,id)=>({entity,id,name:'Тестовий запис',dependencies:[{label:'Пов’язані призначення',count:3}]}),execute:async(entity,id)=>{window.__calls.push({kind:'delete',input:{entity,id}});return {ok:true}}}
 })
 if(app){await page.getByRole('button',{name:'app',exact:true}).click();await page.locator('.nav-list').getByRole('button',{name:'Довідники',exact:true}).click()}
 else {await page.getByRole('button',{name:'reports',exact:true}).click();await page.getByRole('button',{name:'dictionaries',exact:true}).click()}
 return page
}

test('Dictionary tables: recipients search by name and RNOKPP, card view/edit/create and explicit deletion',async t=>{
 const page=await dictionaryTablesPage(t)
 const table=page.getByRole('table',{name:'Отримувачі',exact:true})
 await expect(table.getByRole('columnheader')).toHaveCount(8)
 await expect(table.locator('tbody tr')).toHaveCount(2)
 await expect(table).toContainText('18.10.2026')
 const search=page.getByRole('searchbox',{name:'Пошук отримувачів за ПІБ або РНОКПП',exact:true})
 await search.fill('0011223344');await expect(table.locator('tbody tr')).toHaveCount(1)
 await expect(table).toContainText('Вигаданий Тестовий Отримувач')
 await search.fill('Інша');await expect(table).toContainText('Інша Особа Приклад')
 await search.fill('неіснуючий');await expect(table).toContainText('За заданими параметрами нічого не знайдено')
 await expect(table.getByRole('columnheader')).toHaveCount(8)
 await search.fill('')
 await table.getByRole('button',{name:'Відкрити картку: Вигаданий Тестовий Отримувач',exact:true}).click()
 await expect(page.getByRole('dialog',{name:'Картка отримувача',exact:true})).toContainText('0011223344')
 await page.keyboard.press('Escape')
 await table.getByRole('button',{name:'Редагувати картку: Вигаданий Тестовий Отримувач',exact:true}).click()
 await expect(page.getByRole('dialog')).toContainText('Зберегти зміни');await page.keyboard.press('Escape')
 await page.getByRole('button',{name:'Додати отримувача',exact:true}).click()
 await expect(page.getByRole('dialog')).toContainText('Створити картку');await page.keyboard.press('Escape')
 await table.getByRole('button',{name:'Видалити картку: Вигаданий Тестовий Отримувач',exact:true}).click()
 await expect(page.getByRole('alertdialog')).toContainText('Пов’язані призначення: 3')
 assert.equal(await page.evaluate(()=>window.__calls.length),0)
 await page.getByRole('button',{name:'Скасувати',exact:true}).click()
 assert.equal(await page.evaluate(()=>window.__calls.length),0)
})

test('Dictionary tables: decisions retain year/counts/edit/delete; banks search every code and protect used bank',async t=>{
 const page=await dictionaryTablesPage(t)
 await page.getByRole('tab',{name:'Рішення виконкому',exact:true}).click()
 const decisions=page.getByRole('table',{name:'Рішення виконкому',exact:true})
 await expect(decisions.getByRole('columnheader')).toHaveCount(4)
 await expect(decisions).toContainText('02.01.2027')
 await expect(decisions.getByRole('cell',{name:'3',exact:true})).toBeVisible()
 await decisions.getByRole('button',{name:'Редагувати рішення: № 101',exact:true}).click()
 await expect(page.getByRole('dialog')).toContainText('Зберегти');await page.keyboard.press('Escape')
 await decisions.getByRole('button',{name:'Видалити рішення: № 101',exact:true}).click()
 await expect(page.getByRole('alertdialog',{name:'Видалити рішення?',exact:true})).toContainText('Пов’язані призначення: 3')
 await page.getByRole('button',{name:'Скасувати',exact:true}).click()
 await page.getByRole('tab',{name:'Банки',exact:true}).click()
 const banks=page.getByRole('table',{name:'Банки',exact:true})
 for(const query of ['Тестовий','001122','00112233']){
  await page.getByRole('searchbox',{name:'Пошук банків за назвою, МФО або ЄДРПОУ',exact:true}).fill(query)
  await expect(banks).toContainText('Тестовий банк із довгим найменуванням')
 }
 await banks.getByRole('button',{name:/Редагувати банк:/}).click()
 await expect(page.getByRole('dialog').getByRole('textbox',{name:'Код МФО',exact:true})).toHaveValue('001122');await page.keyboard.press('Escape')
 await page.evaluate(()=>window.__banks[0].recipientCount=2)
 await banks.getByRole('button',{name:/Видалити банк:/}).click()
 await expect(page.getByRole('alert')).toContainText('Видалення заборонено')
 await expect(page.getByRole('alertdialog')).toHaveCount(0)
 await page.evaluate(()=>window.__banks[0].recipientCount=0)
 await banks.getByRole('button',{name:/Видалити банк:/}).click()
 await page.getByRole('button',{name:'Видалити',exact:true}).click()
 await expect(banks).toContainText('За цим запитом банків не знайдено.')
 assert.equal(await page.evaluate(()=>window.__calls.filter(c=>c.kind==='bankDelete').length),1)
})

test('Dictionary tables: semantic empty states and responsive actual App layout keep scrolling inside table',async t=>{
 const page=await dictionaryTablesPage(t,true)
 for(const width of [1440,1280,1040,760]){
  await page.setViewportSize({width,height:1000})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'page width '+width)
  const table=page.getByRole('table',{name:'Отримувачі',exact:true})
  assert.equal(await table.evaluate(el=>getComputedStyle(el).display),'table')
  assert.equal(await table.locator('thead').evaluate(el=>getComputedStyle(el).position),'static')
  if(width===1440)assert.equal(await page.locator('.dictionary-table-wrap').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'no standard-width overflow')
  for(const address of await table.locator('.dictionary-address').all()){
   assert.equal(await address.evaluate(el=>el.clientHeight<=parseFloat(getComputedStyle(el).lineHeight)*2+1),true)
   assert.equal(await address.evaluate(el=>getComputedStyle(el).whiteSpace),'normal')
   assert.equal(await address.getAttribute('title'),await address.textContent())
  }
  for(const label of ['Банки','Рішення виконкому']){
   await page.getByRole('tab',{name:label,exact:true}).click()
   await expect(page.getByRole('table',{name:label,exact:true})).toBeVisible()
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,label+' page width '+width)
   if(width===1440)assert.equal(await page.locator('.dictionary-table-wrap').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,label+' no standard overflow')
  }
  await page.getByRole('tab',{name:'Отримувачі',exact:true}).click()
 }
 await page.setViewportSize({width:1440,height:1000})
 if(process.env.HROMADA_DICTIONARY_SCREENSHOT)await page.screenshot({path:process.env.HROMADA_DICTIONARY_SCREENSHOT})
 await page.evaluate(()=>{window.__people=[];window.hromadaAid.decisions.list=async()=>[]})
 await page.getByRole('tab',{name:'Банки',exact:true}).click()
 await page.getByRole('tab',{name:'Отримувачі',exact:true}).click()
 await expect(page.getByRole('table',{name:'Отримувачі',exact:true})).toContainText('Отримувачів поки немає')
 await expect(page.getByRole('columnheader')).toHaveCount(8)
 // Reload the Dictionaries component to refresh the synthetic decisions list.
 await page.locator('.nav-list').getByRole('button',{name:'Головна',exact:true}).click()
 await page.locator('.nav-list').getByRole('button',{name:'Довідники',exact:true}).click()
 await page.getByRole('tab',{name:'Рішення виконкому',exact:true}).click()
 await expect(page.getByRole('table',{name:'Рішення виконкому',exact:true})).toContainText('За 2026 рік рішень поки немає')
 await expect(page.getByRole('columnheader')).toHaveCount(4)
})

async function orderedCatalogPage(t) {
 const page=await catalogPage(t)
 await page.evaluate(()=>{
  window.hromadaAid.catalogs.reorder=async input=>{
   window.__calls.push({kind:'reorder',input})
   if(window.__reject)return {ok:false,message:'Тестова помилка порядку'}
   const byId=new Map((input.kind==='program'?window.__catalog.programs:window.__catalog.aidTypes).map(item=>[item.id,item]))
   if(input.kind==='program')window.__catalog.programs=input.ids.map(id=>byId.get(id))
   else {
    let i=0
    window.__catalog.aidTypes=window.__catalog.aidTypes.map(type=>type.programId===input.programId?byId.get(input.ids[i++]):type)
   }
   await new Promise(done=>setTimeout(done,70))
   return {ok:true}
  }
 })
 return page
}

test('Catalog ordering UI: handle-only drag, keyboard reorder persists, independent scopes and rollback',async t=>{
 const page=await orderedCatalogPage(t)
 const names=()=>page.locator('.program-catalog-title h3').allTextContents()
 const original=await names()
 const handle=page.getByRole('button',{name:'Змінити порядок: Програма соціального захисту',exact:true})
 await expect(page.locator('.program-catalog-block').first()).not.toHaveAttribute('draggable','true')
 await handle.focus();await page.keyboard.press('Alt+ArrowDown')
 await expect(page.locator('.program-catalog-title h3').first()).toHaveText(original[1])
 await expect(page.getByRole('status',{name:'Порядок довідника',exact:true})).toContainText('Порядок збережено.')
 await expect(handle).toBeFocused()
 const sorted=await names()
 await page.getByRole('tab',{name:'Банки',exact:true}).click()
 await page.getByRole('tab',{name:'Програми та допомоги',exact:true}).click()
 assert.deepEqual(await names(),sorted)
 const social=page.locator('.program-tone-social')
 const old=await social.locator('.program-aid-open').allTextContents()
 const second=social.locator('.catalog-sort-handle').nth(2)
 await second.focus();await page.keyboard.press('Alt+ArrowUp')
 await expect(social.locator('.program-aid-open').first()).toHaveText(old[1])
 await expect(page.getByRole('status',{name:'Порядок довідника',exact:true})).toContainText('Порядок збережено.')
 await expect(page.locator('.program-tone-veterans .program-aid-open')).toHaveText('Допомога 11')
 assert.equal(await page.evaluate(()=>window.__calls.at(-1).input.programId),'program-social')
 await page.evaluate(()=>window.__reject=true)
 const before=await names()
 await page.getByRole('button',{name:'Змінити порядок: Майбутня програма',exact:true}).focus()
 await page.keyboard.press('Alt+ArrowUp')
 await expect(page.getByRole('alert')).toContainText('Тестова помилка порядку')
 assert.deepEqual(await names(),before)
})

test('Catalog ordering UI: native drag moves programs and same-program aid only',async t=>{
 const page=await orderedCatalogPage(t)
 await page.getByRole('button',{name:'Згорнути види допомоги: Програма соціального захисту',exact:true}).click()
 await page.getByRole('button',{name:'Змінити порядок: Програма соціального захисту',exact:true}).dragTo(page.locator('.program-tone-veterans .program-catalog-header'))
 await expect(page.locator('.program-catalog-title h3').first()).toHaveText('Програма підтримки ветеранів')
 await expect(page.getByRole('status',{name:'Порядок довідника',exact:true})).toContainText('Порядок збережено.')
 await page.getByRole('button',{name:'Розгорнути види допомоги: Програма соціального захисту',exact:true}).click()
 const list=page.locator('.program-tone-social .program-aid-list')
 const before=await list.locator('.program-aid-open').allTextContents()
 await list.locator('.catalog-sort-handle').nth(0).dragTo(list.locator('li').nth(1))
 await expect(list.locator('.program-aid-open').first()).toHaveText(before[1])
 await expect(page.getByRole('status',{name:'Порядок довідника',exact:true})).toContainText('Порядок збережено.')
 const calls=await page.evaluate(()=>window.__calls.filter(call=>call.kind==='reorder').length)
 await list.locator('.catalog-sort-handle').nth(0).dragTo(page.locator('.program-tone-veterans .program-aid-list li'))
 assert.equal(await page.evaluate(()=>window.__calls.filter(call=>call.kind==='reorder').length),calls)
 await expect(page.locator('.program-tone-veterans .program-aid-open')).toHaveText('Допомога 11')
})

test('Catalog live selectors: registry filters and open assignment draft update without remount or lost input',async t=>{
 const page=await pageFor(t,'assignments')
 await page.getByRole('button',{name:'Фільтри',exact:true}).click()
 await page.evaluate(()=>{
  window.__liveCatalog={programs:[{id:'new2',shortName:'Друга програма',isActive:true},{id:'p1',shortName:'Оновлена програма',isActive:true}],aidTypes:[{id:'newAid',programId:'new2',shortName:'Нова допомога',isActive:true},{id:'t1',programId:'p1',shortName:'Оновлена допомога',isActive:true}]}
  window.hromadaAid.catalogs.list=async()=>structuredClone(window.__liveCatalog)
  window.dispatchEvent(new Event('hromada:catalogs-changed'))
 })
 const programs=page.getByRole('combobox',{name:'Фільтр: програма',exact:true})
 await programs.click()
 assert.deepEqual(await page.getByRole('option').allTextContents(),['Усі програми','Друга програма','Оновлена програма'])
 await page.getByRole('option',{name:'Друга програма',exact:true}).click()
 await page.getByRole('combobox',{name:'Фільтр: вид допомоги',exact:true}).click()
 await expect(page.getByRole('option',{name:'Нова допомога',exact:true})).toBeVisible()
 await expect(page.getByRole('option',{name:'Оновлена допомога',exact:true})).toHaveCount(0)
 await page.keyboard.press('Escape')
 await page.getByRole('button',{name:'Додати призначення',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'Нове призначення',exact:true})
 await dialog.getByPlaceholder('Наприклад, 5000').fill('1234')
 await page.evaluate(async()=>{
  window.hromadaAid.catalogs.save=async input=>{window.__liveCatalog.programs.push({id:'last',shortName:input.shortName,isActive:true});return {ok:true}}
  const {catalogRepository}=await import('/src/services/catalogRepository.ts')
  await catalogRepository.save({kind:'program',shortName:'Третя програма',officialName:'Третя офіційна програма'})
 })
 await dialog.getByRole('combobox',{name:'Програма',exact:true}).click()
 await expect(page.getByRole('option',{name:'Третя програма',exact:true})).toBeVisible()
 await page.keyboard.press('Escape')
 await expect(dialog.getByPlaceholder('Наприклад, 5000')).toHaveValue('1234')
})

test('Catalog live selectors: decision builder re-reads catalogs on opening and updates dependent choices live',async t=>{
 const page=await pageFor(t,'decisionRegistry')
 await page.getByRole('button',{name:'Відкрити',exact:true}).click()
 await page.getByRole('button',{name:'Додати призначення',exact:true}).click()
 let dialog=page.getByRole('dialog',{name:'Додати призначення до рішення',exact:true})
 await expect(dialog.getByRole('combobox',{name:'Програма',exact:true})).toContainText('Тестова програма')
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0)
 await page.evaluate(()=>{
  window.__builderCatalog={programs:[{id:'fresh',shortName:'Нова програма після відкриття',isActive:true}],aidTypes:[{id:'fresh-aid',programId:'fresh',shortName:'Нова допомога після відкриття',isActive:true}]}
  window.hromadaAid.catalogs.list=async()=>structuredClone(window.__builderCatalog)
 })
 await page.getByRole('button',{name:'Додати призначення',exact:true}).click()
 dialog=page.getByRole('dialog',{name:'Додати призначення до рішення',exact:true})
 await expect(dialog.getByRole('combobox',{name:'Програма',exact:true})).toContainText('Нова програма після відкриття')
 await expect(dialog.getByRole('combobox',{name:'Вид допомоги',exact:true})).toContainText('Нова допомога після відкриття')
 await dialog.getByPlaceholder('Наприклад, 5000').fill('99')
 await page.evaluate(()=>{window.__builderCatalog.aidTypes[0].shortName='Перейменована допомога';window.dispatchEvent(new Event('hromada:catalogs-changed'))})
 await expect(dialog.getByRole('combobox',{name:'Вид допомоги',exact:true})).toContainText('Перейменована допомога')
 await expect(dialog.getByPlaceholder('Наприклад, 5000')).toHaveValue('99')
})

async function overviewPage(t, populated = true) {
 const page=await pageFor(t,'app')
 await page.evaluate(populated=>{
  const p=(id,name)=>({id,shortName:name,officialName:name,isActive:true,assignmentCount:0})
  window.__overviewCatalog={programs:[p('new','Довільна нова програма з довгою назвою'),p('social','Програма підтримки громади'),p('other','Ще одна програма')],aidTypes:[{id:'new-aid',programId:'new',shortName:'Новий вид допомоги без призначень',isActive:true},{id:'aid1',programId:'social',shortName:'Допомога на лікування із довгою назвою для перевірки перенесення тексту',isActive:true}]}
  window.__overview={assignmentCount:populated?3:0,paidCount:populated?2:0,totalMinor:populated?15000:0,paidTotalMinor:populated?5000:0,monthlyAmountMinor:[populated?15000:0,...Array(11).fill(0)],programExecution:[{programId:'social',programName:'Програма підтримки громади',plannedMinor:10000,amountMinor:populated?15000:0,paidMinor:populated?5000:0},{programId:'other',programName:'Ще одна програма',plannedMinor:0,amountMinor:0,paidMinor:0},{programId:'new',programName:'Довільна нова програма з довгою назвою',plannedMinor:null,amountMinor:0,paidMinor:0}],aidTypeDistribution:populated?[{aidTypeName:'Допомога на лікування із довгою назвою для перевірки перенесення тексту',amountMinor:15000,count:3}]:[],demo:false}
  window.hromadaAid.dashboard.get=async year=>{window.__reads.push({kind:'dashboard',year});return {year,...structuredClone(window.__overview)}}
  window.hromadaAid.catalogs.list=async()=>structuredClone(window.__overviewCatalog)
 },populated)
 await page.locator('.nav-list').getByRole('button',{name:'Огляд',exact:true}).click()
 await expect(page.locator('.overview-kpi')).toHaveCount(4)
 return page
}

test('Home redesign: all four quick actions, direct create form, selected year and home-only footer',async t=>{
 const page=await pageFor(t,'app'),shell=page.locator('.app-shell')
 await expect(shell.getByRole('heading',{name:'Вишнівська селищна територіальна громада',exact:true})).toBeVisible()
 await expect(shell.locator('.workspace-year')).toContainText('2026')
 await shell.getByRole('combobox',{name:'Звітний рік: 2026',exact:true}).click()
 await shell.getByRole('option',{name:'2027',exact:true}).click()
 await expect(shell.locator('.workspace-year')).toContainText('2027')
 await shell.getByRole('button',{name:'Створити призначення',exact:true}).click()
 await expect(page.getByRole('dialog',{name:'Нове призначення',exact:true})).toBeVisible()
 await page.getByRole('dialog').getByRole('button',{name:'Скасувати',exact:true}).click()
 await expect(page.getByRole('dialog')).toHaveCount(0)
 await expect(shell.getByRole('combobox',{name:'Звітний рік: 2027',exact:true})).toBeVisible()
 await shell.locator('.nav-list').getByRole('button',{name:'Головна',exact:true}).click()
 const cases=[['Відкрити реєстр призначень','Реєстр допомог'],['Сформувати відомості','Формування відомостей'],['Переглянути звітність','Звітність'],['Перейти до довідників','Довідники'],['Відкрити огляд','Огляд']]
 for(const [button,title] of cases){
  await shell.getByRole('button',{name:button,exact:true}).click()
  await expect(shell.getByRole('heading',{name:title,exact:true}).first()).toBeVisible()
  await expect(shell.locator('.page-footer')).toHaveCount(0)
  await shell.locator('.nav-list').getByRole('button',{name:'Головна',exact:true}).click()
 }
 await expect(shell.locator('.page-footer')).toContainText('© 2026')
 for(const width of [1440,1040,760,480]){
  await page.setViewportSize({width,height:1000})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'home overflow '+width)
 }
 if(process.env.HROMADA_HOME_SCREENSHOT){await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:process.env.HROMADA_HOME_SCREENSHOT})}
})

test('Overview redesign: existing metrics, manual program order, zero new types, monthly data and responsive amounts',async t=>{
 const page=await overviewPage(t)
 assert.deepEqual(await page.locator('.overview-kpi > strong').allTextContents(),['3','2','150,00 ₴','50,00 ₴'])
 assert.deepEqual(await page.locator('.overview-kpi > div > span').allTextContents(),['Призначено допомог','Фактично отримали','Призначено на суму','Фактично витрачено'])
 assert.deepEqual(await page.locator('.overview-program-name strong').allTextContents(),['Довільна нова програма з довгою назвою','Програма підтримки громади','Ще одна програма'])
 await expect(page.locator('.overview-program-row').first()).toContainText('Планові дані не налаштовано')
 await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow','50')
 await expect(page.locator('.overview-type-row').filter({hasText:'Новий вид допомоги без призначень'})).toContainText('0,00 ₴')
 await expect(page.locator('.overview-month-values')).toHaveCount(0)
 await expect(page.locator('.overview-month-column')).toHaveCount(12)
 await expect(page.locator('.overview-month-column').first()).toHaveAttribute('aria-label','Січень: 150,00 ₴')
 for(const width of [1440,1280,1040,760,480]){
  await page.setViewportSize({width,height:1000})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'overview overflow '+width)
  for(const panel of await page.locator('.overview-page .dashboard-panel').all())assert.equal(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'panel overflow '+width)
 }
 if(process.env.HROMADA_OVERVIEW_SCREENSHOT){await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:process.env.HROMADA_OVERVIEW_SCREENSHOT,fullPage:true})}
})

test('Overview redesign: empty, loading, failure/retry and catalog updates preserve year and refresh current data',async t=>{
 const page=await overviewPage(t,false),shell=page.locator('.app-shell')
 assert.deepEqual(await page.locator('.overview-kpi > strong').allTextContents(),['0','0','0,00 ₴','0,00 ₴'])
 await expect(page.locator('.overview-empty-banner')).toContainText('За 2026 рік')
 await expect(page.locator('.overview-month-chart')).toHaveCount(0)
 await page.evaluate(async()=>{
  window.__overview.assignmentCount=4;window.__overview.totalMinor=999999999999
  window.__overview.programExecution[0].programName='Перейменована програма'
  window.__overviewCatalog.programs[1].shortName='Перейменована програма'
  window.__overviewCatalog.programs.reverse()
  const {notifyCatalogsChanged}=await import('/src/services/catalogRepository.ts');notifyCatalogsChanged()
 })
 await expect(page.locator('.overview-kpi > strong').first()).toHaveText('4')
 await expect(page.locator('.overview-program-name strong').first()).toHaveText('Ще одна програма')
 await expect(page.locator('.overview-program-list')).toContainText('Перейменована програма')
 await shell.getByRole('combobox',{name:'Звітний рік: 2026',exact:true}).click()
 await shell.getByRole('option',{name:'2027',exact:true}).click()
 await expect(page.locator('.overview-heading .eyebrow')).toContainText('2027')
 await expect.poll(()=>page.evaluate(()=>window.__reads.some(read=>read.kind==='dashboard'&&read.year===2027))).toBe(true)
 await page.evaluate(()=>{window.hromadaAid.dashboard.get=async()=>{throw Error('synthetic')}})
 await page.getByRole('button',{name:'Оновити',exact:true}).click()
 await expect(page.getByRole('alert')).toContainText('Не вдалося завантажити показники')
 await page.evaluate(()=>{window.hromadaAid.dashboard.get=async year=>{await new Promise(done=>setTimeout(done,250));return {year,...structuredClone(window.__overview)}}})
 await page.getByRole('button',{name:'Повторити',exact:true}).click()
 await expect(page.getByRole('button',{name:'Оновлення…',exact:true})).toBeDisabled()
 await expect(page.locator('.overview-kpi')).toHaveCount(4)
 await expect(shell.getByRole('combobox',{name:'Звітний рік: 2027',exact:true})).toBeVisible()
 await page.setViewportSize({width:1040,height:800})
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'large money no overflow')
})

test('UI corrections 46: community identity, ordered program values, natural long aid list and month tooltips',async t=>{
 const page=await overviewPage(t)
 assert.deepEqual(await page.locator('.overview-program-row').first().locator('dt').allTextContents(),['Річний план','Призначено','Фактично витрачено'])
 await expect(page.locator('.overview-month-values')).toHaveCount(0)
 const months=['Січень','Лютий','Березень','Квітень','Травень','Червень','Липень','Серпень','Вересень','Жовтень','Листопад','Грудень']
 const columns=page.locator('.overview-month-column')
 for(let index=0;index<12;index++){
  await columns.nth(index).hover()
  const tooltip=page.getByRole('tooltip')
  await expect(tooltip).toBeVisible();await expect(tooltip).toContainText(months[index])
  await expect(tooltip).toContainText(index===0?'150,00 ₴':'0,00 ₴')
  const box=await tooltip.boundingBox();assert(box.x>=0 && box.x+box.width<=1440,'tooltip in viewport')
 }
 await columns.first().focus();await expect(page.getByRole('tooltip')).toContainText('Січень')
 await page.keyboard.press('Escape');await expect(page.getByRole('tooltip')).toHaveCount(0)
 await page.evaluate(()=>{
  window.__overviewCatalog.aidTypes.unshift(...Array.from({length:40},(_,index)=>({id:'extra-'+index,programId:'new',shortName:'Додатковий вид допомоги '+index,isActive:true})))
  window.dispatchEvent(new Event('hromada:catalogs-changed'))
 })
 await expect(page.locator('.overview-type-row')).toHaveCount(42)
 assert.deepEqual(await page.locator('.overview-type-row strong').allTextContents(),await page.evaluate(()=>window.__overviewCatalog.aidTypes.map(type=>type.shortName)))
 const list=page.locator('.overview-type-list')
 assert.equal(await list.evaluate(el=>getComputedStyle(el).maxHeight),'none')
 assert.equal(await list.evaluate(el=>el.scrollHeight<=el.clientHeight+1),true)
 const structure=await page.locator('.overview-types').boundingBox(),dynamics=await page.locator('.overview-dynamics').boundingBox()
 assert(structure.height>dynamics.height+500,'chart does not stretch with long list')
 for(const width of [1440,1040,760,480]){
  await page.setViewportSize({width,height:1000})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no overflow '+width)
 }
 await page.setViewportSize({width:1440,height:1000})
 await page.locator('.nav-list').getByRole('button',{name:'Головна',exact:true}).click()
 const identity=page.locator('.workspace-heading')
 await expect(identity).toContainText('Вишнівська селищна територіальна громада')
 await expect(identity).toContainText('HromadaAID')
 const coat=await identity.locator('img').boundingBox()
 assert(coat.width>=120 && coat.height>=150,'prominent coat of arms')
 assert.equal(await identity.locator('img').evaluate(el=>getComputedStyle(el).objectFit),'contain')
 await expect(page.getByRole('button',{name:'Створити призначення',exact:true})).toBeVisible()
})

test('UI corrections 47: uppercase balanced community name and full-width stacked analytics',async t=>{
 const page=await overviewPage(t)
 for(const width of [1920,1440,1280,1040,760,480]){
  await page.setViewportSize({width,height:1000})
  const parent=await page.locator('.overview-analysis-grid').boundingBox()
  const structure=await page.locator('.overview-types').boundingBox(),dynamics=await page.locator('.overview-dynamics').boundingBox()
  if(width>1100){
   assert(Math.abs(structure.y-dynamics.y)<1,'panels aligned at top')
   assert(structure.width/dynamics.width>1.45 && structure.width/dynamics.width<1.55,'60/40 split')
  }else{
   assert(Math.abs(structure.width-parent.width)<1 && Math.abs(dynamics.width-parent.width)<1,'stacked full width '+width)
   assert(dynamics.y>=structure.y+structure.height+17,'dynamics below structure '+width)
  }
  assert.equal(await page.locator('.overview-type-list').evaluate(el=>getComputedStyle(el).maxHeight),'none')
  assert.equal(await page.locator('.overview-month-bar-space').first().evaluate(el=>el.clientHeight),145)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'overview no overflow '+width)
 }
 await page.setViewportSize({width:1440,height:1000})
 await page.locator('.nav-list').getByRole('button',{name:'Головна',exact:true}).click()
 for(const width of [1920,1440,1280,1040,760,480,360]){
  await page.setViewportSize({width,height:1000})
  const title=page.locator('.workspace-heading h1')
  assert.equal(await title.evaluate(el=>getComputedStyle(el).textTransform),'uppercase')
  assert.equal(await title.evaluate(el=>el.innerText.replace(/\s+/g,' ').trim()),'ВИШНІВСЬКА СЕЛИЩНА ТЕРИТОРІАЛЬНА ГРОМАДА')
  assert.equal(await title.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'heading no overflow '+width)
  const lines=await title.evaluate(el=>el.getBoundingClientRect().height/parseFloat(getComputedStyle(el).lineHeight))
  if(width>=480)assert(lines<=2.1,'balanced maximum two lines '+width)
  if(width>=1440)assert(lines<=1.1,'single line on wide viewport '+width)
  assert.equal(await title.locator('span').last().textContent(),'територіальна громада')
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'home no overflow '+width)
 }
})

test('Home identity 49: tinted coat area, balanced text, unchanged actions and responsive widths',async t=>{
 const page=await pageFor(t,'app'),identity=page.locator('.workspace-heading')
 await expect(identity.locator('.eyebrow')).toHaveText('РОБОЧИЙ ПРОСТІР ГРОМАДИ')
 await expect(identity.locator('.subtitle')).toHaveText('Автоматизована система обліку матеріальних допомог')
 await expect(identity.locator('.workspace-system-name')).toHaveText('HromadaAID')
 const source=await identity.locator('img').getAttribute('src')
 for(const width of [1920,1440,1280,1040,760,480,360]){
  await page.setViewportSize({width,height:1000})
  const title=identity.locator('h1')
  assert.equal(await title.evaluate(el=>getComputedStyle(el).textTransform),'uppercase')
  assert(await title.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'title does not clip '+width)
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no page overflow '+width)
  assert.equal(await identity.locator('img').getAttribute('src'),source)
  if(width>=760){
   const area=await identity.locator('.workspace-coat-area').boundingBox(),copy=await identity.locator('.workspace-identity-copy').boundingBox(),coat=await identity.locator('img').boundingBox(),card=await identity.boundingBox()
   assert(copy.x>=area.x+area.width,'two distinct horizontal areas')
   assert(coat.x>area.x+15 && coat.x+coat.width<area.x+area.width-15,'coat has comfortable padding')
   assert(Math.abs(coat.y+coat.height/2-copy.y-copy.height/2)<2,'vertically centered composition')
   assert(card.height<=260,'moderate desktop height')
   assert.notEqual(await identity.locator('.workspace-coat-area').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)')
   assert.equal(await identity.evaluate(el=>getComputedStyle(el).borderTopWidth),'1px')
  }
  if(width>=1440)assert(await title.evaluate(el=>el.getBoundingClientRect().height/parseFloat(getComputedStyle(el).lineHeight)<1.1),'single line '+width)
  if([1440,1040,480].includes(width)&&process.env.HROMADA_HOME_SCREENSHOT)await page.screenshot({path:width===1440?process.env.HROMADA_HOME_SCREENSHOT:process.env.HROMADA_HOME_SCREENSHOT+'.'+width+'.png',fullPage:true})
 }
 await expect(page.getByRole('button',{name:'Створити призначення',exact:true})).toBeVisible()
 await expect(page.locator('.workspace-primary')).toContainText('Щоденна робота')
 await expect(page.locator('.page-footer')).toBeVisible()
})

test('Final UI: four equal home shortcuts, registry toolbar and aligned statement column headings',async t=>{
 const page=await pageFor(t,'app')
 const shortcuts=page.locator('.workspace-shortcuts > button')
 assert.deepEqual(await shortcuts.locator('strong').allTextContents(),['Відкрити реєстр призначень','Сформувати відомості','Переглянути звітність','Перейти до довідників'])
 const boxes=await shortcuts.evaluateAll(items=>items.map(el=>{const r=el.getBoundingClientRect();return {y:r.y,width:r.width,height:r.height}}))
 assert(boxes.every(box=>Math.abs(box.y-boxes[0].y)<1&&Math.abs(box.width-boxes[0].width)<1&&Math.abs(box.height-boxes[0].height)<1))
 await shortcuts.first().click()
 await expect(page.locator('.registry-heading button')).toHaveCount(0)
 assert.deepEqual(await page.locator('.aid-toolbar button').allTextContents(),['Фільтри','Очистити фільтри','Скинути сортування','Додати призначення'])
 await expect(page.locator('.aid-toolbar .primary-button')).toBeEnabled()
 const formation=await formationPage(t,3)
 assert.deepEqual(await formation.locator('.formation-list-heading > span').allTextContents(),['Вибір','Отримувач','Рішення виконкому','Вид допомоги','Статус','Сума'])
 await expect(formation.locator('.formation-counters > span')).toHaveCount(1)
 await expect(formation.locator('.formation-counters')).toContainText('Доступно')
 for(const width of [1440,1040,760,480,360]){
  await formation.setViewportSize({width,height:1000})
  const aligned=await formation.locator('.assignment-statement-list').evaluate(el=>{
   const headings=[...el.querySelector('.formation-list-heading').children],cells=[...el.querySelector('.recipient-option').children]
   return headings.every((heading,index)=>Math.abs(heading.getBoundingClientRect().right-cells[index].getBoundingClientRect().right)<1 || Math.abs(heading.getBoundingClientRect().left-cells[index].getBoundingClientRect().left)<1)
  })
  assert(aligned,'headings align with fields '+width)
  assert(await formation.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
 }
})

test('Overview uses one subdued palette for all programs after rename and reorder',async t=>{
 const page=await overviewPage(t)
 await page.evaluate(()=>{
  const ids={'new':'program-veterans','social':'program-social','other':'future-program'}
  for(const program of window.__overviewCatalog.programs)program.id=ids[program.id]
  for(const type of window.__overviewCatalog.aidTypes)type.programId=ids[type.programId]
  for(const row of window.__overview.programExecution)row.programId=ids[row.programId]
  window.dispatchEvent(new Event('hromada:catalogs-changed'))
 })
 await expect(page.locator('.overview-type-group')).toHaveCount(3)
 await expect(page.locator('.overview-page [class*="program-tone-"]')).toHaveCount(0)
 const read=selector=>page.locator(selector).evaluateAll(elements=>elements.map(el=>({color:getComputedStyle(el).color,background:getComputedStyle(el).backgroundColor,border:getComputedStyle(el).borderLeftColor})))
 for(const selector of ['.overview-program-name strong','.overview-type-group > header']){
  const styles=await read(selector);assert(styles.every(style=>JSON.stringify(style)===JSON.stringify(styles[0])))
 }
 await page.evaluate(()=>{
  window.__overviewCatalog.programs.reverse()
  window.__overviewCatalog.programs.find(p=>p.id==='program-social').shortName='Нова довільна назва'
  window.dispatchEvent(new Event('hromada:catalogs-changed'))
 })
 await expect(page.locator('.overview-type-group h3').filter({hasText:'Нова довільна назва'})).toHaveCount(1)
 await expect(page.locator('.overview-page [class*="program-tone-"]')).toHaveCount(0)
})


// Deferred synthetic IPC checks; no Electron profile or real SQLite is involved.
async function holdFormOperation(page, section, method) {
  await page.evaluate(({section,method}) => {
    const original = window.hromadaAid[section][method]
    window.__heldCalls = 0
    window.hromadaAid[section][method] = (...args) => {
      window.__heldCalls++
      return new Promise((resolve,reject) => {
        window.__finishOperation = outcome => outcome === 'error' ? reject(Error('Synthetic failure'))
          : outcome === 'invalid' ? resolve({ok:false,message:'Тестова помилка збереження'}) : resolve(original(...args))
      })
    }
  }, {section,method})
}
async function assertSavingLock(page, dialog) {
  await expect(dialog).toHaveAttribute('aria-busy','true')
  const controls = dialog.locator('input:not(.app-select-validity), textarea, button')
  for (const control of await controls.all()) await expect(control).toBeDisabled()
  await page.keyboard.press('Control+Enter')
  await page.keyboard.press('Escape')
  await dialog.locator('form').evaluate(form => {form.requestSubmit(); form.requestSubmit()})
  assert.equal(await page.evaluate(()=>window.__heldCalls),1,'synchronous guard prevents repeated IPC')
  await expect(dialog).toBeVisible()
}

test('Form states: decision locks fields and open calendar, retains rejected draft and retries successfully', async t => {
  const page = await pageFor(t,'decision')
  await holdFormOperation(page,'decisions','save')
  const dialog=page.getByRole('dialog',{name:'Нове рішення виконкому',exact:true})
  await dialog.getByPlaceholder('Наприклад, 184').fill('042')
  const date=dialog.getByPlaceholder('ДД.ММ.РРРР')
  await date.fill('02.01.2027')
  await date.press('ArrowDown')
  await expect(page.locator('.calendar-popover')).toBeVisible()
  await page.keyboard.press('Control+Enter')
  await assertSavingLock(page,dialog)
  await expect(page.locator('.calendar-popover')).toHaveCount(0)
  await page.evaluate(()=>window.__finishOperation('error'))
  await expect(dialog).not.toHaveAttribute('aria-busy','true')
  await expect(dialog.getByRole('alert')).toContainText('Не вдалося зберегти')
  await expect(date).toBeEnabled(); await expect(date).toHaveValue('02.01.2027')
  await expect(dialog.getByPlaceholder('Наприклад, 184')).toHaveValue('042')
  await dialog.getByRole('button',{name:'Зберегти рішення',exact:true}).click()
  await expect(dialog).toHaveAttribute('aria-busy','true')
  await page.evaluate(()=>window.__finishOperation('success'))
  await expect(dialog).toHaveCount(0)
  await expect(page.getByLabel('Збережено')).toHaveText('1')
})

test('Form states: assignment blocks amount, paid date, selectors and close; failed save remains editable', async t => {
  const page=await pageFor(t,'assignments')
  await holdFormOperation(page,'assignments','save')
  await page.getByRole('button',{name:'Додати призначення',exact:true}).click()
  await select(page,'Отримувач','Тестова'); await select(page,'Рішення виконкому',null)
  await select(page,'Програма',null); await select(page,'Вид допомоги',null)
  await type(page,'1234,56'); await enter(page); await select(page,'Статус',null,3)
  await type(page,'03.01.2027'); await page.keyboard.press('Control+Enter')
  const dialog=page.getByRole('dialog',{name:'Нове призначення',exact:true})
  await assertSavingLock(page,dialog)
  await page.evaluate(()=>window.__finishOperation('invalid'))
  await expect(dialog.getByRole('alert')).toContainText('Тестова помилка')
  await expect(dialog.getByPlaceholder('Наприклад, 5000')).toBeEnabled()
  await expect(dialog.getByPlaceholder('Наприклад, 5000')).toHaveValue('1234,56')
  await expect(dialog.getByPlaceholder('ДД.ММ.РРРР')).toHaveValue('03.01.2027')
  await dialog.getByRole('button',{name:'Скасувати',exact:true}).click()
  await expect(page.getByRole('alertdialog',{name:'Закрити без збереження?',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Продовжити редагування',exact:true}).click()
  await expect(dialog.getByPlaceholder('Наприклад, 5000')).toHaveValue('1234,56')
})

for (const mode of ['program','aid','decision','plan']) test('Form states: dictionary '+mode+' locks all controls and recovers after save error',async t=>{
  const page=await pageFor(t,'dictionaries')
  const section=mode==='decision'?'decisions':mode==='plan'?'reports':'catalogs'
  const method=mode==='plan'?'annualPlanSave':'save'
  await holdFormOperation(page,section,method)
  let dialog
  if(mode==='plan') {
    await page.getByRole('tab',{name:'Планові показники',exact:true}).click()
    await page.getByRole('button',{name:'Встановити план',exact:true}).click()
    dialog=page.getByRole('dialog',{name:'Встановити план',exact:true})
    await dialog.locator('[data-plan-field="count"]').fill('0')
    await dialog.locator('[data-plan-field="amount"]').fill('0')
  } else if(mode==='decision') {
    await page.getByRole('tab',{name:'Рішення виконкому',exact:true}).click()
    await page.getByRole('button',{name:'Додати рішення',exact:true}).click()
    dialog=page.getByRole('dialog',{name:'Додати рішення виконкому',exact:true})
    await dialog.getByPlaceholder('Наприклад, 184').fill('04')
    await dialog.getByPlaceholder('ДД.ММ.РРРР').fill('02.01.2027')
  } else {
    await page.getByRole('tab',{name:'Програми та допомоги',exact:true}).click()
    await page.getByRole('button',{name:mode==='program'?'Додати програму':'Додати вид допомоги',exact:true}).click()
    dialog=page.getByRole('dialog',{name:mode==='program'?'Додати програму':'Додати вид допомоги',exact:true})
    await dialog.getByLabel('Коротка назва *',{exact:true}).fill('Тестовий запис')
    await dialog.getByLabel('Повна офіційна назва *',{exact:true}).fill('Повна тестова назва')
    if(mode==='program') await dialog.getByPlaceholder('ДД.ММ.РРРР').fill('02.01.2027')
  }
  const before=await dialog.locator('input:not(.app-select-validity),textarea').evaluateAll(fields=>fields.map(f=>f.value))
  await dialog.locator('form').evaluate(form=>form.requestSubmit())
  await assertSavingLock(page,dialog)
  await page.evaluate(()=>window.__finishOperation('error'))
  await expect(dialog).not.toHaveAttribute('aria-busy','true')
  await expect(dialog.getByRole('alert')).toContainText('Не вдалося зберегти')
  assert.deepEqual(await dialog.locator('input:not(.app-select-validity),textarea').evaluateAll(fields=>fields.map(f=>f.value)),before)
  for(const control of await dialog.locator('input:not(.app-select-validity),textarea').all())await expect(control).toBeEnabled()
  await dialog.locator('form').evaluate(form=>form.requestSubmit())
  await expect(dialog).toHaveAttribute('aria-busy','true')
  await page.evaluate(()=>window.__finishOperation('success'))
  await expect(dialog).toHaveCount(0)
})

test('Form states: date errors are deferred until blur and linked to the input',async t=>{
  const page=await pageFor(t,'decision')
  const date=page.getByPlaceholder('ДД.ММ.РРРР')
  await date.fill('02.0')
  await expect(date).toHaveAttribute('aria-invalid','false')
  await date.press('Tab')
  await expect(date).toHaveAttribute('aria-invalid','true')
  const errorId=await date.getAttribute('aria-describedby')
  await expect(page.locator('[id="'+errorId+'"]')).toContainText('коректну дату')
  await date.fill('02.01.2027')
  await expect(date).toHaveAttribute('aria-invalid','false')
})

test('Form states: exports lock the result modal, switching and print; failure unlocks and retry succeeds',async t=>{
  const page=await formationPage(t,2)
  await page.evaluate(()=>{
    window.hromadaAid.statements.generate=async()=>({ok:true,documents:[0,1].map(i=>({id:'export-'+i,documentNumber:'04',documentDate:'2026-10-19',fileName:'synthetic.xlsx',aidTypeName:'Тест '+i,recordCount:1,totalMinor:100,pdfBase64:btoa('%PDF-1.4\n%%EOF')}))})
    window.hromadaAid.statements.save=async()=>({ok:true})
    window.hromadaAid.statements.savePdf=async()=>({ok:true})
  })
  const panel=page.locator('.formation-panel')
  await panel.getByRole('checkbox',{name:'Вибрати всі видимі записи'}).check()
  await panel.getByRole('button',{name:'Сформувати зведені відомості',exact:true}).click()
  await completeStatementParameters(page,'04')
  await holdFormOperation(page,'statements','save')
  const dialog=page.getByRole('dialog',{name:'Зведені відомості',exact:true})
  await dialog.getByRole('button',{name:'Зберегти Excel',exact:true}).evaluate(button=>{button.click();button.click()})
  await expect(dialog).toHaveAttribute('aria-busy','true')
  for(const button of await dialog.locator('button').all()) await expect(button).toBeDisabled()
  assert.equal(await page.evaluate(()=>window.__heldCalls),1)
  await page.keyboard.press('Escape');await expect(dialog).toBeVisible()
  await page.evaluate(()=>window.__finishOperation('error'))
  await expect(dialog.getByRole('alert')).toContainText('Не вдалося зберегти')
  await expect(dialog.getByRole('button',{name:'Зберегти PDF',exact:true})).toBeEnabled()
  await dialog.getByRole('button',{name:'Зберегти Excel',exact:true}).click()
  await page.evaluate(()=>window.__finishOperation('success'))
  await expect(dialog).not.toHaveAttribute('aria-busy','true')
  await dialog.getByRole('button',{name:'Зберегти PDF',exact:true}).click()
  await expect(dialog).not.toHaveAttribute('aria-busy','true')
  await expect(dialog.locator('.statement-document-list button').first()).toHaveAttribute('aria-pressed','true')
})


for(const view of ['bank','recipientEdit','batch']) test('Form states: '+view+' prevents repeated save and restores draft after error',async t=>{
  const page=await pageFor(t,view)
  const section=view==='bank'?'banks':view==='recipientEdit'?'recipients':'assignments'
  const method=view==='batch'?'changeStatuses':'save'
  await holdFormOperation(page,section,method)
  const dialog=page.getByRole('dialog').last()
  if(view==='bank') {
    await dialog.locator('[data-bank-field="name"] input').fill('Тестовий банк')
    await dialog.locator('[data-bank-field="details.0.mfo"] input').fill('001122')
    await dialog.locator('[data-bank-field="details.0.edrpou"] input').fill('00112233')
  } else if(view==='batch') {
    await select(page,'Новий статус',null,4)
    await dialog.getByPlaceholder('ДД.ММ.РРРР').fill('03.01.2027')
  } else await dialog.locator('[data-recipient-field="firstName"] input').fill('Змінена')
  const read=()=>dialog.locator('input:not(.app-select-validity)').evaluateAll(fields=>fields.map(f=>f.value))
  const before=await read()
  await dialog.locator('form').evaluate(form=>form.requestSubmit())
  await assertSavingLock(page,dialog)
  await page.evaluate(()=>window.__finishOperation('error'))
  await expect(dialog).not.toHaveAttribute('aria-busy','true')
  await expect(dialog.getByRole('alert')).toContainText('Не вдалося')
  assert.deepEqual(await read(),before)
  await dialog.locator('form').evaluate(form=>form.requestSubmit())
  await expect(dialog).toHaveAttribute('aria-busy','true')
  await page.evaluate(()=>window.__finishOperation('success'))
  await expect(dialog).toHaveCount(0)
})
