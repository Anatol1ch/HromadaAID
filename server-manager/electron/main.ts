import { app, BrowserWindow, dialog, ipcMain, screen, session } from 'electron'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { inspectEnvironment } from './inspection-engine.js'
import { createInspectionRequestHandler } from './inspection-ipc.js'
import { createWindowsInspectionAdapters } from './windows-inspection.js'
import type { InspectionSnapshot } from './inspection-types.js'
import type { InstallDirectoryKind, ServerInstallRequest, ServerInstallUpdate } from './installation-contract.js'
import { runServerInstallation } from './installation-engine.js'
import { createWindowsInstallationAdapters } from './windows-installation.js'
import { createServiceControlRequestHandler, runServiceControl, type ServiceControlOperation } from './service-control.js'
import { controlWindowsService } from './windows-service-control.js'

// An independent process and profile; only a narrow read-only inspection bridge is exposed.
app.setName('HromadaAID Server Manager')
app.setPath('userData', join(app.getPath('appData'), 'HromadaAID-Server-Manager'))
if (process.platform === 'win32') app.setAppUserModelId('local.hromadaaid.server-manager')
const development = !app.isPackaged && process.argv.includes('--manager-dev')
const page = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '../renderer/index.html')).href
const devOrigin = 'http://127.0.0.1:5176'
let window: BrowserWindow | null = null
let activeInstallId: string | null = null
let serviceOperationInProgress = false
let recoveryPrompt: { operationId: string; key: string; savedPath: string | null; resolve: (saved: boolean) => void } | null = null

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
    discovery: { source: 'unknown', confidence: 'unavailable', message: 'Джерело інсталяції не вдалося перевірити.' },
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
  // Keep a normal, centered restore size while opening maximized on the work area
  // of the display nearest the cursor. Maximized windows retain the taskbar.
  window.maximize()
  window.setMenuBarVisibility(false)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== (development ? `${devOrigin}/` : page)) event.preventDefault()
  })
  window.webContents.on('will-redirect', event => event.preventDefault())
  // The window stays hidden until Chromium has painted the maximized layout,
  // avoiding a visible small-window-to-maximized transition.
  window.once('ready-to-show', () => window?.show())
  window.on('closed', () => { window = null })
  if (development) await window.loadURL(devOrigin)
  else await window.loadFile(fileURLToPath(page))
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  const inspectRequest = createInspectionRequestHandler(() => inspectEnvironment(createWindowsInspectionAdapters()), isTrustedRenderer, failedInspection)
  ipcMain.handle('manager:inspect-environment', event => inspectRequest(event))
  const serviceControlRequest = createServiceControlRequestHandler(
    async (operation: ServiceControlOperation, operationId) => {
      serviceOperationInProgress = true
      try {
        return await runServiceControl(operation, operationId, {
          platform: process.platform,
          control: controlWindowsService,
          inspect: () => inspectEnvironment(createWindowsInspectionAdapters()),
          failedInspection,
        })
      } finally { serviceOperationInProgress = false }
    },
    isTrustedRenderer,
    () => activeInstallId !== null || serviceOperationInProgress,
    randomUUID,
    failedInspection,
  )
  ipcMain.handle('manager:control-service', (event, operation: unknown) => serviceControlRequest(event, operation))
  ipcMain.handle('manager:select-install-directory', async (event, kind: InstallDirectoryKind) => {
    if (!isTrustedRenderer(event) || !['program', 'data', 'backups'].includes(kind)) throw new Error('UNTRUSTED_RENDERER')
    const labels: Record<InstallDirectoryKind, string> = { program: 'Каталог програми сервера', data: 'Каталог серверних даних', backups: 'Каталог резервних копій' }
    const result = await dialog.showOpenDialog(window!, { title: labels[kind], properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  ipcMain.handle('manager:get-install-defaults', event => {
    if (!isTrustedRenderer(event)) throw new Error('UNTRUSTED_RENDERER')
    const programRoot = process.env.ProgramFiles || `${process.env.SystemDrive || 'C:'}\\Program Files`
    const dataRoot = process.env.ProgramData || `${process.env.SystemDrive || 'C:'}\\ProgramData`
    return {
      programDirectory: join(programRoot, 'HromadaAID'),
      dataDirectory: join(dataRoot, 'HromadaAID', 'Data'),
      backupDirectory: join(dataRoot, 'HromadaAID', 'Backups'),
    }
  })
  ipcMain.handle('manager:install-server', async (event, input: unknown) => {
    if (!isTrustedRenderer(event)) throw new Error('UNTRUSTED_RENDERER')
    if (activeInstallId || serviceOperationInProgress) throw new Error('INSTALLATION_ALREADY_RUNNING')
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('INSTALL_OPTIONS_INVALID')
    const request = input as ServerInstallRequest
    if (Object.keys(request).some(key => !['programDirectory', 'dataDirectory', 'backupDirectory', 'host', 'port', 'administrator'].includes(key)) ||
      !['programDirectory', 'dataDirectory', 'backupDirectory'].every(key => typeof (request as unknown as Record<string, unknown>)[key] === 'string') ||
      !request.administrator || typeof request.administrator !== 'object' ||
      !['displayName', 'username', 'password', 'confirmation'].every(key => typeof (request.administrator as unknown as Record<string, unknown>)[key] === 'string') ||
      request.administrator.password !== request.administrator.confirmation || request.administrator.password.length < 8 || request.administrator.password.length > 256 ||
      !request.administrator.displayName.trim() || request.administrator.displayName.trim().length > 150 ||
      request.administrator.username.trim().length < 3 || request.administrator.username.trim().length > 80) throw new Error('Перевірте ім’я, логін і пароль адміністратора.')
    const operationId = randomUUID()
    activeInstallId = operationId
    const send = (update: ServerInstallUpdate) => { if (window && !window.isDestroyed() && isTrustedRenderer(event)) window.webContents.send('manager:installation-update', update) }
    try {
      await runServerInstallation(request, createWindowsInstallationAdapters(), operationId, send, async key => {
        if (!window || window.isDestroyed()) return false
        return await new Promise<boolean>(resolveKey => {
          recoveryPrompt = { operationId, key, savedPath: null, resolve: resolveKey }
          window!.webContents.send('manager:recovery-key-required', { operationId, key })
        }).finally(() => {
          if (recoveryPrompt?.operationId === operationId) { recoveryPrompt.key = ''; recoveryPrompt = null }
        })
      })
      return { operationId, success: true }
    } catch (error) {
      return { operationId, success: false, message: error instanceof Error ? error.message : 'Встановлення не завершено.' }
    } finally {
      request.administrator.password = ''
      request.administrator.confirmation = ''
      if (recoveryPrompt?.operationId === operationId) { recoveryPrompt.key = ''; recoveryPrompt.resolve(false); recoveryPrompt = null }
      activeInstallId = null
    }
  })
  ipcMain.handle('manager:save-recovery-key', async event => {
    if (!isTrustedRenderer(event) || !recoveryPrompt || recoveryPrompt.operationId !== activeInstallId) return { saved: false }
    const result = await dialog.showSaveDialog(window!, { title: 'Зберегти аварійний ключ', defaultPath: 'HromadaAID-аварійний-ключ.txt', buttonLabel: 'Зберегти ключ', filters: [{ name: 'Текстовий файл', extensions: ['txt'] }] })
    if (result.canceled || !result.filePath) return { saved: false }
    try {
      await writeFile(result.filePath, `${recoveryPrompt.key}\r\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
      recoveryPrompt.savedPath = result.filePath
      return { saved: true, path: result.filePath }
    } catch (error) {
      return { saved: false, message: (error as NodeJS.ErrnoException).code === 'EEXIST' ? 'Файл уже існує. Виберіть інше ім’я, щоб не перезаписати його.' : 'Не вдалося зберегти ключ. Виберіть безпечне доступне місце.' }
    }
  })
  ipcMain.handle('manager:confirm-recovery-key-saved', event => {
    if (!isTrustedRenderer(event) || !recoveryPrompt || recoveryPrompt.operationId !== activeInstallId || !recoveryPrompt.savedPath) return false
    recoveryPrompt.resolve(true)
    return true
  })
  ipcMain.handle('manager:cancel-recovery-key', event => {
    if (!isTrustedRenderer(event) || !recoveryPrompt || recoveryPrompt.operationId !== activeInstallId) return false
    recoveryPrompt.resolve(false)
    return true
  })
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
