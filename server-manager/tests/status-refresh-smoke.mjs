// Actual renderer/preload, fixed mock IPC results; no SCM, filesystem inspection or server requests.
import { app, ipcMain } from 'electron'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const profile = mkdtempSync(join(tmpdir(), 'hromada-stage7-ui-'))
app.setPath('appData', profile)
app.disableHardwareAcceleration()
const output = resolve('release/server-manager-ui-review')
mkdirSync(output, { recursive: true })
const timeout = setTimeout(() => app.exit(1), 60000)
let apiAvailable = true, failInspection = false, calls = 0
let holdFollowup = false, releaseFollowup
let setupSnapshot = null
let installCalls = 0
function snapshot() {
  if (setupSnapshot) return setupSnapshot
  const checkedAt = new Date().toISOString()
  return {
    checkedAt, installation: { status: 'installed', message: 'Сервер установлено.' }, service: { status: 'running', message: 'HromadaAIDApi працює.' }, api: { status: apiAvailable ? 'available' : 'unavailable', message: apiAvailable ? 'API відповів коректно.' : 'Сервер не відповів у межах тайм-ауту.', contractVersion: 1 },
    configuration: { programDirectory: 'D:\\HromadaAID', dataDirectory: 'E:\\HromadaAID\\Серверні дані', backupDirectory: 'E:\\HromadaAID\\Резервні копії', databasePath: 'E:\\HromadaAID\\Серверні дані\\Database\\hromada-aid.sqlite', apiAddress: 'http://127.0.0.1:4310', host: '127.0.0.1', port: 4310, transport: 'HTTP', serverVersion: '0.1.0', serviceName: 'HromadaAIDApi', serviceAccount: 'LocalService', startMode: 'Automatic', logDirectory: 'E:\\HromadaAID\\Серверні дані\\Logs' },
    discovery: { source: 'windows_service', confidence: 'confirmed', message: 'Шляхи підтверджено метаданими служби та конфігурацією.' }, updateReadiness: { ready: true, reason: 'Інсталяцію підтверджено.' },
    checks: ['service', 'configuration', 'package', 'api'].map(id => ({ id, title: id === 'api' ? 'Доступність API' : id === 'service' ? 'Служба Windows' : id === 'package' ? 'Серверний пакет' : 'Конфігурація', status: id === 'api' && !apiAvailable ? 'failed' : 'passed', checkedAt, message: id === 'api' && !apiAvailable ? 'API недоступний.' : 'Перевірку завершено.', details: id === 'api' ? 'HEALTH_CHECK' : 'VERIFIED_METADATA' })),
  }
}
app.on('browser-window-created', (_event, window) => {
  for (const channel of ['manager:inspect-environment', 'manager:select-server-update-package', 'manager:apply-server-update', 'manager:install-server']) ipcMain.removeHandler(channel)
  ipcMain.handle('manager:inspect-environment', async () => { calls++; if (holdFollowup) await new Promise(resolve => { releaseFollowup = resolve }); await new Promise(resolve => setTimeout(resolve, 350)); if (failInspection) throw new Error('Synthetic inspection failure'); return snapshot() })
  ipcMain.handle('manager:select-server-update-package', () => ({ preview: { id: 'synthetic-preview', sourceName: 'HromadaAID-Server.zip', currentVersion: '0.1.0', newVersion: '0.1.0', apiContract: 'hromadaaid-rest v1', currentSchema: 28, sqliteRange: { minimum: 1, maximum: 28 }, sameVersion: true, authenticity: 'unsigned' } }))
  ipcMain.handle('manager:apply-server-update', () => { holdFollowup = true; return { operationId: 'synthetic-update', success: true, rolledBack: false, manualRecoveryRequired: false, message: 'Сервер оновлено. Служба працює, API доступний.' } })
  ipcMain.handle('manager:install-server', () => {
    installCalls++
    setupSnapshot = { ...snapshot(), installation: { status: 'unknown', message: 'Тимчасово недоступний SCM.' }, service: { status: 'unknown', message: 'SCM timeout.' }, api: { status: 'available', message: 'API доступний.', contractVersion: 1 }, configuration: { ...snapshot().configuration, serverVersion: '0.1.0', apiAddress: 'http://127.0.0.1:4310' } }
    window.webContents.send('manager:installation-update', { operationId: 'synthetic-install', stage: 'health', status: 'verification-required', message: 'Серверний сценарій завершено. Стан служби не підтверджено.' })
    return { operationId: 'synthetic-install', success: true }
  })
  window.webContents.once('did-finish-load', async () => {
    const evaluate = code => window.webContents.executeJavaScript(`(async()=>{const pause=ms=>new Promise(r=>setTimeout(r,ms));const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);${code}})()`)
    const capture = async name => {
      if (!process.argv.includes('--no-screenshots')) writeFileSync(join(output, name), (await window.webContents.capturePage()).toPNG())
    }
    let phase = 'post-update refresh'
    try {
      await evaluate("await pause(600);document.querySelectorAll('nav button')[3].click();await pause(80);button('Оновити сервер').click();await pause(120);button('Встановити оновлення').click();for(let i=0;i<40&&!button('Перевірити стан');i++)await pause(40);if(!button('Перевірити стан')?.disabled)throw Error('Refresh must stay locked until the update follow-up inspection finishes');")
      for (let attempt = 0; attempt < 40 && !releaseFollowup; attempt++) await new Promise(resolve => setTimeout(resolve, 20))
      assert.equal(typeof releaseFollowup, 'function')
      holdFollowup = false; releaseFollowup()
      await evaluate("for(let i=0;i<100&&(!button('Перевірити стан')||button('Перевірити стан').disabled);i++)await pause(40);")
      const before = calls
      apiAvailable = false
      holdFollowup = true; releaseFollowup = undefined
      assert.equal(await evaluate("button('Перевірити стан').click();await pause(60);const checking=button('Перевірка…');if(!checking?.disabled||checking.getAttribute('aria-busy')!=='true')throw Error('Refresh does not show locked loading state');checking.click();return true;"), true)
      assert.equal(calls, before + 1, 'A repeated click cannot issue concurrent inspection')
      assert.equal(typeof releaseFollowup, 'function')
      holdFollowup = false; releaseFollowup()
      assert.match(await evaluate("await pause(450);return document.querySelector('.sm-local-notice').textContent"), /API недоступний/)
      assert.equal(await evaluate("return button('Перевірити стан').disabled"), false)
      apiAvailable = true
      assert.match(await evaluate("button('Перевірити стан').click();await pause(500);return document.querySelector('.sm-local-notice').textContent"), /Служба працює, API доступний/)
      failInspection = true
      assert.match(await evaluate("button('Перевірити стан').click();await pause(500);return document.querySelector('.sm-local-notice[role=alert]').textContent"), /Не вдалося запустити перевірку/)
      failInspection = false
      await evaluate("button('Перевірити стан').click();await pause(500);button('Закрити результат').click();")
      phase = 'automatic inspection replaces stale success notice'
      setupSnapshot = { ...snapshot(), installation: { status: 'unknown', message: 'Тимчасово недоступний SCM.' }, service: { status: 'unknown', message: 'SCM timeout.' } }
      assert.match(await evaluate("for(let i=0;i<45&&!document.querySelector('.sm-local-notice[role=alert]')?.textContent.includes('Тимчасово недоступний SCM');i++)await pause(400);return document.querySelector('.sm-local-notice').textContent"), /Тимчасово недоступний SCM/)
      assert.equal(await evaluate("return document.querySelector('.sm-local-notice-success') === null"), true)
      await evaluate("document.querySelectorAll('nav button')[0].click();await pause(80)")
      assert.match(await evaluate("return document.querySelectorAll('.sm-state-card')[0].textContent"), /Невідомо/)
      assert.match(await evaluate("return document.querySelectorAll('.sm-state-card')[1].textContent"), /Доступний/)
      setupSnapshot = null
      await evaluate("document.querySelectorAll('nav button')[0].click();await pause(80);button('Перевірити зараз').click();await pause(500)")
      phase = 'responsive screenshots'
      window.restore()
      const pages = ['overview', 'configuration', 'diagnostics', 'updates']
      for (const [index, name] of pages.entries()) {
        window.setBounds({ width: 1440, height: 960 })
        await evaluate(`document.querySelectorAll('nav button')[${index}].click();await pause(100);if(document.documentElement.scrollWidth>innerWidth+1)throw Error('Horizontal overflow: ${name}');`)
        await capture(`${name}-1440.png`)
      }
      window.setBounds({ width: 900, height: 780 }); window.webContents.setZoomFactor(1.5)
      await evaluate("document.querySelectorAll('nav button')[1].click();await pause(180);if(document.documentElement.scrollWidth>innerWidth+1)throw Error('Overflow at 150% zoom');")
      await capture('configuration-150-percent.png')
      window.webContents.setZoomFactor(1)
      phase = 'open initial setup wizard'
      setupSnapshot = snapshot()
      setupSnapshot.installation = { status: 'ready_to_configure', message: 'Сервер готовий до початкового налаштування.' }
      setupSnapshot.service = { status: 'missing', message: 'Службу не зареєстровано.' }
      setupSnapshot.configuration = { ...setupSnapshot.configuration, programDirectory: 'C:\\Program Files\\HromadaAID', dataDirectory: 'C:\\ProgramData\\HromadaAID\\Data', backupDirectory: 'C:\\ProgramData\\HromadaAID\\Backups', databasePath: null, apiAddress: null, host: null, port: null, transport: null, serviceAccount: null, startMode: null, logDirectory: null }
      setupSnapshot.discovery = { source: 'standard_locations', confidence: 'corroborated', message: 'Підготовлений Server.next.' }
      setupSnapshot.updateReadiness = { ready: false, reason: 'Спочатку налаштуйте сервер.' }
      await evaluate("document.querySelectorAll('nav button')[0].click();await pause(100);if(!button('Перевірити зараз'))throw Error('Refresh absent: '+[...document.querySelectorAll('button')].map(b=>b.textContent.trim()).join('|'));button('Перевірити зараз').click();await pause(550);if(!button('Налаштувати сервер')||button('Налаштувати сервер').disabled)throw Error('Initial setup action unavailable');button('Налаштувати сервер').click();await pause(100);if(!document.querySelector('.sm-install-wizard'))throw Error('Existing wizard did not open');")
      assert.deepEqual(await evaluate("return [...document.querySelectorAll('.sm-install-path input')].map(input=>input.value)"), [setupSnapshot.configuration.programDirectory, setupSnapshot.configuration.dataDirectory, setupSnapshot.configuration.backupDirectory])
      phase = 'initial setup screenshot'
      await capture('initial-setup.png')
      phase = 'completed installation permits verification only'
      await evaluate("button('Далі').click();await pause(80);button('Далі').click();await pause(80);const values=['Синтетичний адміністратор','synthetic-admin','Synthetic passphrase','Synthetic passphrase'];const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;[...document.querySelectorAll('.sm-install-control input')].forEach((input,index)=>{setter.call(input,values[index]);input.dispatchEvent(new Event('input',{bubbles:true}))});await pause(80);button('Далі').click();await pause(80);button('Встановити сервер').click();await pause(150);if(!button('Повторити перевірку')||button('Встановити сервер'))throw Error('Completed install exposed initialization instead of diagnostics');")
      assert.equal(installCalls, 1)
      const beforeVerification = calls
      await evaluate("button('Повторити перевірку').click();await pause(500);if(!button('Повторити перевірку')||button('Встановити сервер'))throw Error('Failed read-only verification exposed install form');")
      assert.equal(calls, beforeVerification + 1)
      setupSnapshot = { ...setupSnapshot, installation: { status: 'installed', message: 'Встановлено.' }, service: { status: 'running', message: 'Служба працює.' } }
      await evaluate("button('Повторити перевірку').click();await pause(500);if(!document.querySelector('.sm-install-success'))throw Error('Successful read-only verification did not complete wizard');button('Перейти до огляду').click();await pause(500);")
      assert.equal(installCalls, 1, 'Read-only confirmation never repeats installation')
      phase = 'block unknown initial setup'
      setupSnapshot.installation = { status: 'unknown', message: 'Помилка перевірки файлової системи.' }
      await evaluate("button('Перевірити зараз').click();await pause(550);if(button('Налаштувати сервер')||document.querySelector('.sm-install-wizard'))throw Error('Unsafe initial setup is available');")
      console.log('Renderer regression passed: automatic snapshots replace stale success notices; unknown SCM and available API are shown independently; refresh/loading, IPC errors and responsive layout remain functional.')
      console.log('Initial setup regression passed: completed installation offers read-only confirmation, never repeats setup, and finishes only after verified Service/API/package state.')
      if (!process.argv.includes('--no-screenshots')) console.log('Screenshots: ' + output)
    } catch (error) { console.error(phase, error); process.exitCode = 1 }
    finally { clearTimeout(timeout); window.destroy(); app.exit(process.exitCode || 0) }
  })
})
app.on('will-quit', () => { try { rmSync(profile, { recursive: true, force: true }) } catch { /* Synthetic Chromium cache may still be locked. */ } })
await import('../../dist-server-manager/main/main.js')
