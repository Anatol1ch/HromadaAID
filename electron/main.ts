import { cleanupGeneratedReports, registerReportExportIpc } from './report-export-ipc.js'
import { app, BrowserWindow, dialog, screen } from 'electron'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DatabaseIntegrityError, DatabaseSchemaError, openAppDatabase } from './database.js'
import { registerBankIpc } from './bank-ipc.js'
import { registerRecipientIpc } from './recipient-ipc.js'
import { registerRecordsIpc } from './records-ipc.js'
import { registerDeletionIpc } from './deletion-ipc.js'
import { cleanupGeneratedStatements, registerStatementsIpc } from './statements-ipc.js'
import { configureIpcSecurity, isTrustedAppUrl } from './ipc-security.js'

// Match the future Windows package/shortcut identity without changing userData.
if (process.platform === 'win32') app.setAppUserModelId('local.hromadaaid')

const isDev = !app.isPackaged
const devServerUrl = 'http://127.0.0.1:5175/'
const currentDirectory = dirname(fileURLToPath(import.meta.url))
const iconDirectory = app.isPackaged ? join(process.resourcesPath, 'assets') : join(currentDirectory, 'assets')
let closeDatabase: (() => void) | undefined
let mainWindow: BrowserWindow | null = null
const appPageUrl = isDev ? devServerUrl : pathToFileURL(join(currentDirectory, '../../dist/index.html')).href
configureIpcSecurity(() => mainWindow, appPageUrl)

// Dev-only isolated profile support for end-to-end checks. Packaged users always use Electron's standard userData path.
const testDataDirectory = process.env.HROMADA_AID_TEST_DATA_DIR
if (isDev && testDataDirectory) app.setPath('userData', resolve(testDataDirectory))

// Electron scopes its singleton to userData, so select the profile before taking the lock.
const hasSingleInstanceLock = app.requestSingleInstanceLock()

function createWindow() {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
      return
    }
    // Electron work areas and window bounds are in DIP, including Windows scaling.
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
    const width = Math.min(1440, area.width), height = Math.min(940, area.height)
    const window = new BrowserWindow({
      width,
      height,
      x: area.x + Math.floor((area.width - width) / 2),
      y: area.y + Math.floor((area.height - height) / 2),
      minWidth: Math.min(800, area.width),
      minHeight: Math.min(480, area.height),
      backgroundColor: '#f5f6f8',
      title: 'HromadaAid — Огляд',
      icon: join(iconDirectory, process.platform === 'win32' ? 'hromadaaid.ico' : 'hromadaaid.png'),
      // Keep the native surface hidden until Chromium has a frame to show. This
      // prevents a small window from flashing before the normal maximized state.
      show: false,
      webPreferences: {
        preload: join(currentDirectory, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        plugins: true, // Chromium's built-in PDF viewer displays the actual Excel export in the preview iframe.
      },
    })
    mainWindow = window
    window.webContents.on('will-navigate', (event, url) => {
      if (!isTrustedAppUrl(url)) event.preventDefault()
    })
    window.webContents.on('will-redirect', (event, url, _isInPlace, isMainFrame) => {
      if (isMainFrame && !isTrustedAppUrl(url)) event.preventDefault()
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    // Leave PDF subframe navigation and Vite's resource/WebSocket requests alone.
    // Printing is the only web permission needed by the document preview.
    window.webContents.session.setPermissionCheckHandler((contents, permission) =>
      permission === 'web-printing' && contents === window.webContents &&
      !window.isDestroyed() && isTrustedAppUrl(contents.getURL()))
    window.webContents.session.setPermissionRequestHandler((contents, permission, callback) => {
      callback(permission === 'web-printing' && contents === window.webContents &&
        !window.isDestroyed() && isTrustedAppUrl(contents.getURL()))
    })
    window.on('closed', () => { if (mainWindow === window) mainWindow = null })
    window.once('ready-to-show', () => {
      if (window.isDestroyed()) return
      window.maximize()
      window.show()
    })
    window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
      if (isMainFrame) console.error(`[HromadaAid] did-fail-load: ${errorCode} ${errorDescription}; URL: ${validatedUrl}`)
    })

    if (isDev) console.log(`[HromadaAid] Electron dev mode: ${devServerUrl}`)
    const loading = isDev ? window.loadURL(devServerUrl) : window.loadFile(join(currentDirectory, '../../dist/index.html'))
    void loading.catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[HromadaAid] ${isDev ? 'loadURL' : 'loadFile'}: ${message}`)
      if (window.isDestroyed()) return
      window.maximize()
      window.show()
      dialog.showErrorBox('HromadaAid — помилка завантаження', isDev
        ? `Не вдалося завантажити ${devServerUrl}\nПеревірте, чи працює Vite.\n${message}`
        : `Не вдалося завантажити інтерфейс застосунку.\n${message}`)
    })
  } catch (error) {
    console.error('[HromadaAid] Критична помилка створення вікна:', error)
    dialog.showErrorBox('HromadaAid', 'Не вдалося створити головне вікно. Подробиці в терміналі запуску.')
    app.quit()
  }
}

if (!hasSingleInstanceLock) {
  // Do not register a ready callback or open SQLite in the secondary instance.
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) createWindow()
    // During startup, the normal ready handler will create the only window.
  })

  app.whenReady().then(() => {
    try {
      const database = openAppDatabase(app.getPath('userData'))
      closeDatabase = () => database.close()
      registerBankIpc(database)
      registerRecipientIpc(database)
      registerRecordsIpc(database)
      registerReportExportIpc()
      registerDeletionIpc(database)
      registerStatementsIpc(database)
    } catch (error) {
      dialog.showErrorBox('HromadaAid', error instanceof DatabaseSchemaError || error instanceof DatabaseIntegrityError
        ? error.message
        : 'Не вдалося відкрити локальне сховище. Перевірте доступ до папки даних користувача та перезапустіть застосунок.')
      app.quit()
      return
    }

    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  }).catch((error: unknown) => {
    console.error('[HromadaAid] Критична помилка запуску Electron:', error)
    dialog.showErrorBox('HromadaAid', 'Не вдалося завершити запуск Electron. Подробиці в терміналі запуску.')
    app.quit()
  })

  let shutdownStarted = false
  let shutdownComplete = false
  app.on('before-quit', (event) => {
    if (shutdownComplete) return
    event.preventDefault()
    if (shutdownStarted) return
    shutdownStarted = true
    void cleanupGeneratedReports().then(() => cleanupGeneratedStatements()).catch(() => {
      console.warn('[HromadaAid] Частину тимчасових документів буде перевірено під час наступного запуску.')
    }).finally(() => {
      try { closeDatabase?.() } catch { console.warn('[HromadaAid] Не вдалося підтвердити закриття сховища.') }
      shutdownComplete = true
      app.quit()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
