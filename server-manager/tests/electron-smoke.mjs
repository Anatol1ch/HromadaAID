// Functional checks of the actual isolated window. No system services or database access.
import { app } from 'electron'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const profile = mkdtempSync(join(tmpdir(), 'hromada-manager-shell-'))
app.setPath('appData', profile)
app.disableHardwareAcceleration()
const timeout = setTimeout(() => { console.error('Manager smoke timed out'); app.exit(1) }, 30_000)
let passed = false
app.on('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', async () => {
    try {
      console.log('Manager smoke: isolated renderer loaded.')
      const preferences = window.webContents.getLastWebPreferences()
      assert.equal(preferences.nodeIntegration, false)
      assert.equal(preferences.contextIsolation, true)
      assert.equal(preferences.sandbox, true)
      const result = await window.webContents.executeJavaScript(`(async () => {
        const check = (condition, message) => { if (!condition) throw new Error(message) }
        const pause = () => new Promise(resolve => setTimeout(resolve, 40))
        await pause()
        check(document.title === 'HromadaAID Server Manager', 'Window title')
        check(typeof window.require === 'undefined' && typeof window.hromadaAid === 'undefined', 'No Node or client bridge')
        const buttons = [...document.querySelectorAll('nav button')]
        check(buttons.length === 4, 'Four navigation items')
        const expectedHeadings = ['Огляд сервера', 'Конфігурація', 'Діагностика', 'Оновлення сервера']
        for (let i = 0; i < buttons.length; i++) {
          buttons[i].click(); await pause()
          check(buttons[i].getAttribute('aria-current') === 'page', 'Navigation current page')
          check(document.activeElement === document.querySelector('h1') || i === 0, 'Heading focus')
          check(document.querySelectorAll('main h1').length === 1, 'Single main heading')
          check(document.querySelector('h1').textContent === expectedHeadings[i], 'Section content changes')
        }
        buttons[0].click(); await pause()
        const picker = document.querySelector('#demo-scenario')
        check(document.querySelector('label[for="demo-scenario"]'), 'Scenario has label')
        const states = [...picker.options].map(option => option.value)
        const expectedStates = { missing: 'Почнімо з налаштування сервера', stopped: 'Сервер зупинений', running: 'Сервер працює', unavailable: 'API не відповідає', interrupted: 'Встановлення потребує уваги', configuration: 'Перевірте параметри сервера' }
        for (const state of states) {
          Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(picker, state)
          picker.dispatchEvent(new Event('change', { bubbles: true })); await pause()
          check(document.querySelector('#server-state-title').textContent === expectedStates[state], 'Scenario content changes')
          if (state === 'unavailable') check(document.querySelector('.sm-state-grid').textContent.includes('Працює') && document.querySelector('.sm-state-grid').textContent.includes('Недоступний'), 'Independent API state')
        }
        const refresh = [...document.querySelectorAll('button')].find(button => button.textContent === 'Демоперевірка')
        refresh.click(); await pause()
        check(document.querySelector('[role="status"]').textContent.includes('локально'), 'Local demo refresh')
        buttons[2].click(); await pause()
        const filter = document.querySelector('.sm-filter select')
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(filter, 'issues')
        filter.dispatchEvent(new Event('change', { bubbles: true })); await pause()
        check(document.querySelectorAll('.sm-events > li').length === 1, 'Diagnostics filter')
        check([...document.querySelectorAll('button')].every(button => button.textContent.trim() || button.getAttribute('aria-label')), 'Named buttons')
        let blocked = false
        try { await fetch('http://127.0.0.1:3000/health') } catch { blocked = true }
        check(blocked, 'API request blocked')
        buttons[0].click(); await pause()
        const currentPicker = document.querySelector('#demo-scenario')
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(currentPicker, 'running')
        currentPicker.dispatchEvent(new Event('change', { bubbles: true })); await pause()
        check(document.documentElement.scrollWidth <= window.innerWidth, 'No horizontal page overflow')
        return { navigation: 4, scenarios: states.length, apiBlocked: blocked }
      })()`)
      console.log(`Manager smoke: functional assertions passed: ${JSON.stringify(result)}`)
      const image = await window.webContents.capturePage()
      writeFileSync(resolve(fileURLToPath(new URL('../../dist-server-manager/preview.png', import.meta.url))), image.toPNG())
      console.log(`Manager Electron smoke passed: ${JSON.stringify(result)}; sandbox, navigation, focus, labels, filters and network isolation verified.`)
      passed = true
    } catch (error) { console.error(error); process.exitCode = 1 }
    finally { clearTimeout(timeout); window.destroy(); app.quit() }
  })
})
app.on('will-quit', () => {
  clearTimeout(timeout)
  // Only the synthetic profile created by this test; never the client profile.
  if (dirname(resolve(profile)) !== resolve(tmpdir()) || !basename(profile).startsWith('hromada-manager-shell-')) throw new Error('Unexpected smoke profile path')
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* Windows may still hold Chromium cache files. */ }
  if (!passed) process.exitCode = 1
})
await import('../../dist-server-manager/main/main.js')
