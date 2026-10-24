import { app, BrowserWindow, dialog, ipcMain, screen, session } from 'electron'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { inspectEnvironment } from './inspection-engine.js'
import { createInspectionRequestHandler } from './inspection-ipc.js'
import { createWindowsInspectionAdapters } from './windows-inspection.js'
import type { InspectionSnapshot } from './inspection-types.js'

// An independent process and profile; only a narrow read-only inspection bridge is exposed.
app.setName('HromadaAID Server Manager')
app.setPath('userData', join(app.getPath('appData'), 'HromadaAID-Server-Manager'))
if (process.platform === 'win32') app.setAppUserModelId('local.hromadaaid.server-manager')
const development = !app.isPackaged && process.argv.includes('--manager-dev')
const page = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '../renderer/index.html')).href
const devOrigin = 'http://127.0.0.1:5176'
let window: BrowserWindow | null = null

function isTrustedRenderer(event: Electron.IpcMainInvokeEvent): boolean {
  if (!window || event.sender !== window.webContents || !event.senderFrame) return false
  const senderUrl = event.senderFrame.url
  if (!development) return senderUrl === page
  try {
    const parsed = new URL(senderUrl)
    return parsed.origin === devOrigin && parsed.pathname === '/'
  } catch { return false }
}

function failedInspection(): InspectionSnapshot {
  const checkedAt = new Date().toISOString()
  const message = 'Перевірка середовища завершилася неочікуваною помилкою.'
  return {
    checkedAt,
    installation: { status: 'unknown', message },
    service: { status: 'unknown', message },
    api: { status: 'unknown', message: 'Health endpoint не перевірено через помилку діагностики.', contractVersion: null },
    configuration: { programDirectory: null, dataDirectory: null, backupDirectory: null, databasePath: null, apiAddress: null, host: null, port: null, transport: null, serverVersion: null, serviceName: 'HromadaAIDApi', serviceAccount: null, startMode: null, logDirectory: null },
    checks: [{ id: 'installation', title: 'Перевірка середовища', status: 'unknown', checkedAt, message, details: 'INSPECTION_FAILED' }],
  }
}

async function openWindow() {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const width = Math.min(1180, area.width), height = Math.min(780, area.height)
  window = new BrowserWindow({
    title: 'HromadaAID Server Manager',
    width, height,
    x: area.x + Math.floor((area.width - width) / 2),
    y: area.y + Math.floor((area.height - height) / 2),
    minWidth: Math.min(900, area.width), minHeight: Math.min(640, area.height),
    backgroundColor: '#f5f6f8', show: false,
    webPreferences: { preload: join(dirname(fileURLToPath(import.meta.url)), 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'persist:server-manager' },
  })
  window.setMenuBarVisibility(false)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== (development ? `${devOrigin}/` : page)) event.preventDefault()
  })
  window.webContents.on('will-redirect', event => event.preventDefault())
  window.once('ready-to-show', () => window?.show())
  window.on('closed', () => { window = null })
  if (development) await window.loadURL(devOrigin)
  else await window.loadFile(fileURLToPath(page))
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  const inspectRequest = createInspectionRequestHandler(() => inspectEnvironment(createWindowsInspectionAdapters()), isTrustedRenderer, failedInspection)
  ipcMain.handle('manager:inspect-environment', event => inspectRequest(event))
  app.on('second-instance', () => { window?.restore(); window?.focus() })
  app.whenReady().then(async () => {
    const isolatedSession = session.fromPartition('persist:server-manager')
    isolatedSession.setPermissionCheckHandler(() => false)
    isolatedSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    // Renderer networking stays blocked except for its dedicated development Vite origin.
    // The main process owns the separate, fixed read-only health probe.
    const rendererRoot = new URL('./', page).href
    isolatedSession.webRequest.onBeforeRequest((details, callback) => {
      const allowed = development
        ? details.url.startsWith(`${devOrigin}/`) || details.url.startsWith('ws://127.0.0.1:5176/')
        : details.url.startsWith(rendererRoot)
      callback({ cancel: !allowed })
    })
    await openWindow()
  }).catch(() => {
    dialog.showErrorBox('HromadaAID Server Manager', 'Не вдалося відкрити інтерфейс. Перевірте збірку Server Manager та повторіть запуск.')
    app.exit(1)
  })
  app.on('window-all-closed', () => app.quit())
}
