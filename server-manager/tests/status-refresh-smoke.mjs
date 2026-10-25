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
function snapshot() {
  const checkedAt = new Date().toISOString()
  return {
    checkedAt, installation: { status: 'installed', message: 'Сервер установлено.' }, service: { status: 'running', message: 'HromadaAIDApi працює.' }, api: { status: apiAvailable ? 'available' : 'unavailable', message: apiAvailable ? 'API відповів коректно.' : 'Сервер не відповів у межах тайм-ауту.', contractVersion: 1 },
    configuration: { programDirectory: 'D:\\HromadaAID', dataDirectory: 'E:\\HromadaAID\\Серверні дані', backupDirectory: 'E:\\HromadaAID\\Резервні копії', databasePath: 'E:\\HromadaAID\\Серверні дані\\Database\\hromada-aid.sqlite', apiAddress: 'http://127.0.0.1:4310', host: '127.0.0.1', port: 4310, transport: 'HTTP', serverVersion: '0.1.0', serviceName: 'HromadaAIDApi', serviceAccount: 'LocalService', startMode: 'Automatic', logDirectory: 'E:\\HromadaAID\\Серверні дані\\Logs' },
    discovery: { source: 'windows_service', confidence: 'confirmed', message: 'Шляхи підтверджено метаданими служби та конфігурацією.' }, updateReadiness: { ready: true, reason: 'Інсталяцію підтверджено.' },
    checks: ['service', 'configuration', 'package', 'api'].map(id => ({ id, title: id === 'api' ? 'Доступність API' : id === 'service' ? 'Служба Windows' : id === 'package' ? 'Серверний пакет' : 'Конфігурація', status: id === 'api' && !apiAvailable ? 'failed' : 'passed', checkedAt, message: id === 'api' && !apiAvailable ? 'API недоступний.' : 'Перевірку завершено.', details: id === 'api' ? 'HEALTH_CHECK' : 'VERIFIED_METADATA' })),
  }
}
app.on('browser-window-created', (_event, window) => {
  for (const channel of ['manager:inspect-environment', 'manager:select-server-update-package', 'manager:apply-server-update']) ipcMain.removeHandler(channel)
  ipcMain.handle('manager:inspect-environment', async () => { calls++; if (holdFollowup) await new Promise(resolve => { releaseFollowup = resolve }); await new Promise(resolve => setTimeout(resolve, 350)); if (failInspection) throw new Error('Synthetic inspection failure'); return snapshot() })
  ipcMain.handle('manager:select-server-update-package', () => ({ preview: { id: 'synthetic-preview', sourceName: 'HromadaAID-Server.zip', currentVersion: '0.1.0', newVersion: '0.1.0', apiContract: 'hromadaaid-rest v1', currentSchema: 28, sqliteRange: { minimum: 1, maximum: 28 }, sameVersion: true, authenticity: 'unsigned' } }))
  ipcMain.handle('manager:apply-server-update', () => { holdFollowup = true; return { operationId: 'synthetic-update', success: true, rolledBack: false, manualRecoveryRequired: false, message: 'Сервер оновлено. Служба працює, API доступний.' } })
  window.webContents.once('did-finish-load', async () => {
    const evaluate = code => window.webContents.executeJavaScript(`(async()=>{const pause=ms=>new Promise(r=>setTimeout(r,ms));const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);${code}})()`)
    try {
      await evaluate("await pause(600);document.querySelectorAll('nav button')[3].click();await pause(80);button('Оновити сервер').click();await pause(120);button('Встановити оновлення').click();for(let i=0;i<40&&!button('Перевірити стан');i++)await pause(40);if(!button('Перевірити стан')?.disabled)throw Error('Refresh must stay locked until the update follow-up inspection finishes');")
      for (let attempt = 0; attempt < 40 && !releaseFollowup; attempt++) await new Promise(resolve => setTimeout(resolve, 20))
      assert.equal(typeof releaseFollowup, 'function')
      holdFollowup = false; releaseFollowup()
      await evaluate('await pause(500);')
      const before = calls
      apiAvailable = false
      assert.equal(await evaluate("button('Перевірити стан').click();await pause(60);const checking=button('Перевірка…');if(!checking?.disabled||checking.getAttribute('aria-busy')!=='true')throw Error('Refresh does not show locked loading state');checking.click();return true;"), true)
      assert.equal(calls, before + 1, 'A repeated click cannot issue concurrent inspection')
      assert.match(await evaluate("await pause(450);return document.querySelector('.sm-local-notice').textContent"), /API недоступний/)
      assert.equal(await evaluate("return button('Перевірити стан').disabled"), false)
      apiAvailable = true
      assert.match(await evaluate("button('Перевірити стан').click();await pause(500);return document.querySelector('.sm-local-notice').textContent"), /Служба працює, API доступний/)
      failInspection = true
      assert.match(await evaluate("button('Перевірити стан').click();await pause(500);return document.querySelector('.sm-local-notice[role=alert]').textContent"), /Не вдалося запустити перевірку/)
      failInspection = false
      await evaluate("button('Перевірити стан').click();await pause(500);button('Закрити результат').click();")
      window.restore()
      const pages = ['overview', 'configuration', 'diagnostics', 'updates']
      for (const [index, name] of pages.entries()) {
        window.setBounds({ width: 1440, height: 960 })
        await evaluate(`document.querySelectorAll('nav button')[${index}].click();await pause(100);if(document.documentElement.scrollWidth>innerWidth+1)throw Error('Horizontal overflow: ${name}');`)
        writeFileSync(join(output, `${name}-1440.png`), (await window.webContents.capturePage()).toPNG())
      }
      window.setBounds({ width: 900, height: 780 }); window.webContents.setZoomFactor(1.5)
      await evaluate("document.querySelectorAll('nav button')[1].click();await pause(180);if(document.documentElement.scrollWidth>innerWidth+1)throw Error('Overflow at 150% zoom');")
      writeFileSync(join(output, 'configuration-150-percent.png'), (await window.webContents.capturePage()).toPNG())
      console.log('Stage 7 renderer regression passed: post-update refresh, single-flight/loading, unavailable API, success, IPC error, responsive pages and 150% zoom. Screenshots: ' + output)
    } catch (error) { console.error(error); process.exitCode = 1 }
    finally { clearTimeout(timeout); window.destroy(); app.exit(process.exitCode || 0) }
  })
})
app.on('will-quit', () => { try { rmSync(profile, { recursive: true, force: true }) } catch { /* Synthetic Chromium cache may still be locked. */ } })
await import('../../dist-server-manager/main/main.js')
