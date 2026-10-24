import { app, BrowserWindow, dialog, screen, session } from 'electron'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// An independent process and profile; no client main, preload, IPC or server imports.
app.setName('HromadaAID Server Manager')
app.setPath('userData', join(app.getPath('appData'), 'HromadaAID-Server-Manager'))
if (process.platform === 'win32') app.setAppUserModelId('local.hromadaaid.server-manager')
const development = !app.isPackaged && process.argv.includes('--manager-dev')
const page = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '../renderer/index.html')).href
const devOrigin = 'http://127.0.0.1:5176'
let window: BrowserWindow | null = null

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
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'persist:server-manager' },
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
  app.on('second-instance', () => { window?.restore(); window?.focus() })
  app.whenReady().then(async () => {
    const isolatedSession = session.fromPartition('persist:server-manager')
    isolatedSession.setPermissionCheckHandler(() => false)
    isolatedSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    // Only this renderer's local files, or its dedicated Vite origin, can load.
    // There is deliberately no route to Fastify or any external address.
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
