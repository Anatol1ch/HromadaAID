import { cleanupGeneratedReports, registerReportExportIpc } from './report-export-ipc.js'
import { app, BrowserWindow, dialog, screen, safeStorage, shell } from 'electron'
import { RemoteBackupClient } from './backup-client.js'
import { BackupInstallationIdentity } from './backup-storage.js'
import { isBackupInstallation, isBackupInstallationList, isRestorePreview, isServerBackupList } from '../shared/backup-contract.js'
import { RemoteAuthSession, localAuthState } from './auth-session.js'
import type { AuthActionResult, ClientAuthState } from '../shared/auth-contract.js'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DatabaseIntegrityError, DatabaseSchemaError, openAppDatabase } from './database.js'
import { registerBankIpc } from './bank-ipc.js'
import { registerRecipientIpc } from './recipient-ipc.js'
import { registerRecordsIpc } from './records-ipc.js'
import { registerDeletionIpc } from './deletion-ipc.js'
import { cleanupGeneratedStatements, registerStatementsIpc } from './statements-ipc.js'
import { configureIpcSecurity, isTrustedAppUrl, registerRemoteIpcBlockers, trustedIpcMain } from './ipc-security.js'
import { ElectronRuntimeConfigError, readElectronRuntimeConfig, readSavedConnectionConfig, validateServerBaseUrl, type ElectronRuntimeConfig } from './runtime-config.js'
import { HttpClient, HttpClientError } from './http-client.js'
import { checkServerAddress, saveServerAddress, switchRemoteServer, type ServerConnectionState } from './connection-config.js'
import type { AnnualAidPlan, AnnualPlanEntry, AssignmentListResult, AssignmentRecord, BankDetail, BankRecord, CatalogList, DashboardData, DecisionRecord, DecisionSummary, ProgramApproval, RecipientRecord, RecipientSummary, ReportPeriod, ReportSourceRow, ReportSummary } from './api-contract.js'
import { isAnnualAidPlanList, isAnnualPlanEntryList, isAssignmentChangeResult, isAssignmentListResult, isAssignmentRecordList, isAssignmentSaveResult, isBankDetailList, isBankRecordList, isBankSaveResult, isCatalogList, isCatalogOrderResult, isCatalogSaveResult, isDashboardData, isDecisionSaveResult, isDecisionSummaryList, isNullableBankRecord, isNullableDecisionRecord, isNullableRecipientRecord, isProgramApprovalList, isProgramApprovalSaveResult, isRecipientSaveResult, isRecipientSummaryList, isReportSourceRowList, isReportSummary, isStatementListResult } from '../shared/api-contract.js'

// Match the future Windows package/shortcut identity without changing userData.
if (process.platform === 'win32') app.setAppUserModelId('local.hromadaaid')

const isDev = !app.isPackaged
const devServerUrl = 'http://127.0.0.1:5175/'
const currentDirectory = dirname(fileURLToPath(import.meta.url))
const iconDirectory = app.isPackaged ? join(process.resourcesPath, 'assets') : join(currentDirectory, 'assets')
let closeDatabase: (() => void) | undefined
let mainWindow: BrowserWindow | null = null
let runtimeConfig: ElectronRuntimeConfig | undefined
let remoteAuth: RemoteAuthSession | undefined
let remoteHttp: HttpClient | undefined
let remoteBackup: RemoteBackupClient | undefined
let connectionStatus: ServerConnectionState['status'] = 'unknown'
let connectionMessage: string | undefined
let connectionFailureReason: ServerConnectionState['failureReason']
let savedApiUrl: string | null = null
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

  app.whenReady().then(async () => {
    try {
      const userDataPath = app.getPath('userData')
      const savedConnection = readSavedConnectionConfig(userDataPath)
      savedApiUrl = savedConnection.config?.apiUrl ?? null
      runtimeConfig = readElectronRuntimeConfig(process.env, savedConnection, app.isPackaged)
      trustedIpcMain.handle('app:get-version', async () => app.getVersion())
      let savingConnection = false
      const publishAuthState = (state: ClientAuthState) => {
        remoteBackup?.authChanged(state)
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('auth:state', state)
      }
      trustedIpcMain.handle('backups:get-state', async () => remoteBackup?.currentState ?? { status: 'local' })
      trustedIpcMain.handle('backups:refresh', async () => { remoteBackup?.wake(); return remoteBackup?.currentState ?? { status: 'local' } })
      trustedIpcMain.handle('backups:open-folder', async () => {
        if (remoteAuth?.currentState.status !== 'authenticated' || !remoteBackup?.archiveDirectory) return { ok: false, message: 'Папка копій поки недоступна.' }
        const error = await shell.openPath(remoteBackup.archiveDirectory)
        return error ? { ok: false, message: 'Не вдалося відкрити папку резервних копій.' } : { ok: true }
      })
      const backupAdminHttp = () => {
        const state = remoteAuth?.currentState
        if (!remoteHttp || state?.status !== 'authenticated' || !state.user?.permissions.includes('backups.manage')) throw new Error('Керування комп’ютерами доступне лише адміністратору у віддаленому режимі.')
        return remoteHttp
      }
      trustedIpcMain.handle('backups:list-computers', async () => backupAdminHttp().getJson('/api/backup-clients', isBackupInstallationList))
      const archiveId = (id: unknown) => { if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw new Error('Некоректний ідентифікатор архіву.'); return id }
      const longRequest = { timeoutMs: 300_000 }
      trustedIpcMain.handle('backups:list-server', async () => backupAdminHttp().getJson('/api/backups/server', isServerBackupList, longRequest))
      trustedIpcMain.handle('backups:create-server', async () => backupAdminHttp().postJson('/api/backups/server', {}, isServerBackupList, longRequest))
      trustedIpcMain.handle('backups:prepare-server-restore', async (_event, id: unknown) => backupAdminHttp().postJson(`/api/backups/server/${archiveId(id)}/prepare`, {}, isRestorePreview, longRequest))
      trustedIpcMain.handle('backups:prepare-file-restore', async () => {
        const http = backupAdminHttp()
        const result = await dialog.showOpenDialog({ title: 'Виберіть резервний архів HromadaAID', filters: [{ name: 'Резервний архів', extensions: ['hraid'] }], properties: ['openFile'] })
        if (result.canceled || !result.filePaths[0]) return null
        return http.uploadBackup(result.filePaths[0], isRestorePreview)
      })
      trustedIpcMain.handle('backups:confirm-restore', async (_event, id: unknown, confirmationToken: unknown) => {
        if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id) || typeof confirmationToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(confirmationToken)) throw new Error('Некоректне підтвердження.')
        return backupAdminHttp().postJson('/api/backups/restore/confirm', { id, confirmationToken }, undefined, longRequest)
      })
      trustedIpcMain.handle('backups:download-server', async (_event, id: unknown) => {
        const http = backupAdminHttp()
        const list = await http.getJson('/api/backups/server', isServerBackupList, longRequest)
        const item = list.archives.find(item => item.id === archiveId(id))
        if (!item) throw new Error('Архів не знайдено.')
        const result = await dialog.showSaveDialog({ title: 'Зберегти резервний архів', defaultPath: item.fileName, filters: [{ name: 'Резервний архів', extensions: ['hraid'] }] })
        if (result.canceled || !result.filePath) return { ok: false, message: 'Збереження скасовано.' }
        if (!result.filePath.toLowerCase().endsWith('.hraid')) throw new Error('Оберіть окремий файл із розширенням .hraid.')
        await http.downloadBackup(`/api/backups/server/${item.id}/download`, result.filePath, item, {}, new AbortController().signal)
        return { ok: true }
      })
      trustedIpcMain.handle('backups:set-allowed', async (_event, id: unknown, allowed: unknown, expectedUpdatedAt: unknown) => {
        if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id) || typeof allowed !== 'boolean' || typeof expectedUpdatedAt !== 'string') throw new Error('Некоректні дані дозволу.')
        return backupAdminHttp().putJson(`/api/backup-clients/${id}`, { allowed, expectedUpdatedAt }, isBackupInstallation)
      })
      const connectionLocked = () => Boolean(process.env.HROMADAAID_API_URL?.trim()) || process.env.HROMADAAID_MODE?.trim() === 'local'
      const connectionState = (): ServerConnectionState => ({
        mode: runtimeConfig?.mode ?? 'local',
        apiUrl: runtimeConfig?.mode === 'remote' ? (runtimeConfig.source === 'invalid' ? null : runtimeConfig.apiUrl?.origin ?? savedApiUrl) : savedApiUrl,
        active: runtimeConfig?.mode === 'remote' && Boolean(runtimeConfig.apiUrl),
        source: savedApiUrl && runtimeConfig?.source === 'none' ? 'saved' : runtimeConfig?.source ?? 'none',
        editable: !connectionLocked(),
        ...(runtimeConfig?.lockedReason ? { lockedReason: runtimeConfig.lockedReason } : {}),
        status: connectionStatus,
        ...(connectionFailureReason ? { failureReason: connectionFailureReason } : {}),
        ...(connectionMessage || runtimeConfig?.configurationError ? { message: connectionMessage ?? runtimeConfig?.configurationError } : {}),
      })
      const publishConnectionState = () => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('connection:state', connectionState())
      }
      const publishReachability = (status: ServerConnectionState['status'], failureReason?: ServerConnectionState['failureReason']) => {
        connectionStatus = status
        connectionFailureReason = failureReason ?? (status === 'maintenance' ? 'maintenance' : undefined)
        connectionMessage = status === 'maintenance' ? 'Сервер тимчасово виконує технічне обслуговування.' : status === 'unavailable' ? failureReason === 'timeout' ? 'Сервер не відповів у встановлений час.' : failureReason === 'http' ? 'Сервер відповів помилкою під час перевірки доступності.' : 'Не вдалося зв’язатися із сервером.' : undefined
        publishConnectionState()
      }
      trustedIpcMain.handle('connection:get-state', async () => connectionState())
      trustedIpcMain.handle('connection:check', async (_event, value: unknown) => {
        let normalized: URL
        try { normalized = validateServerBaseUrl(value) }
        catch (error) { return { ok: false, status: 'unavailable', failureReason: 'incompatible', message: error instanceof Error ? error.message : 'Некоректна адреса сервера.' } }
        const activeUrl = runtimeConfig?.mode === 'remote' ? runtimeConfig.apiUrl?.origin : undefined
        if (activeUrl === normalized.origin || (runtimeConfig?.mode === 'local' && savedApiUrl === normalized.origin)) {
          connectionStatus = 'checking'
          connectionFailureReason = undefined
          connectionMessage = 'Перевірка підключення…'
          publishConnectionState()
        }
        const result = await checkServerAddress(normalized.origin)
        const currentUrl = runtimeConfig?.mode === 'remote' ? runtimeConfig.apiUrl?.origin : savedApiUrl ?? undefined
        if (currentUrl === result.apiUrl) {
          connectionStatus = result.status
          connectionFailureReason = result.ok ? undefined : result.failureReason
          connectionMessage = result.message
          publishConnectionState()
          if (result.ok) remoteBackup?.wake()
        }
        return result
      })
      trustedIpcMain.handle('connection:save', async (_event, value: unknown) => {
        const current = connectionState()
        if (savingConnection) return { ok: false, state: current, message: 'Зачекайте завершення поточної зміни адреси.' }
        savingConnection = true
        try {
        if (!current.editable) return { ok: false, state: current, message: current.lockedReason ?? 'Адресу зафіксовано змінними середовища.' }
        let normalized: URL
        try { normalized = validateServerBaseUrl(value) }
        catch (error) { return { ok: false, state: current, message: error instanceof Error ? error.message : 'Некоректна адреса сервера.' } }
        if (runtimeConfig?.mode === 'local') {
          const checked = await checkServerAddress(normalized.origin)
          if (!checked.ok) return { ok: false, state: current, message: checked.message }
          try { await saveServerAddress(userDataPath, normalized.origin) }
          catch { return { ok: false, state: current, message: 'Не вдалося безпечно зберегти адресу сервера.' } }
          savedApiUrl = normalized.origin
          connectionStatus = 'available'
          connectionFailureReason = undefined
          connectionMessage = 'Адресу збережено. Перезапустіть застосунок, щоб перейти до remote mode.'
          const state = connectionState()
          publishConnectionState()
          return { ok: true, state, message: connectionMessage }
        }

        if (!remoteHttp || !remoteAuth) return { ok: false, state: current, message: 'Не вдалося підготувати віддалене підключення.' }
        const switched = await switchRemoteServer(userDataPath, normalized.origin, remoteHttp, remoteAuth, (url) => {
          runtimeConfig = { mode: 'remote', apiUrl: url, source: 'saved' }
          savedApiUrl = url.origin
          connectionStatus = 'available'
          connectionFailureReason = undefined
          connectionMessage = 'Сервер доступний.'
        })
        if (!switched.ok) return { ok: false, state: connectionState(), message: switched.message }
        publishConnectionState()
        return { ok: true, state: connectionState(), ...(switched.message ? { message: switched.message } : {}) }
        } finally { savingConnection = false }
      })
      if (runtimeConfig.mode === 'local') {
        const localState = localAuthState()
        trustedIpcMain.handle('auth:get-state', async () => localState)
        trustedIpcMain.handle('auth:login', async (): Promise<AuthActionResult> => ({ ok: false, state: localState, message: 'Вхід не потрібен у локальному режимі.' }))
        trustedIpcMain.handle('auth:logout', async (): Promise<AuthActionResult> => ({ ok: true, state: localState }))
        trustedIpcMain.handle('auth:change-password', async (): Promise<AuthActionResult> => ({ ok: false, state: localState, message: 'Зміна пароля доступна у віддаленому режимі.' }))
        trustedIpcMain.handle('users:list', async () => { throw new Error('Керування користувачами доступне лише у віддаленому режимі.') })
        trustedIpcMain.handle('users:get', async () => { throw new Error('Керування користувачами доступне лише у віддаленому режимі.') })
        trustedIpcMain.handle('users:create', async () => { throw new Error('Керування користувачами доступне лише у віддаленому режимі.') })
        trustedIpcMain.handle('users:update', async () => { throw new Error('Керування користувачами доступне лише у віддаленому режимі.') })
        trustedIpcMain.handle('users:set-status', async () => { throw new Error('Керування користувачами доступне лише у віддаленому режимі.') })
        trustedIpcMain.handle('users:reset-password', async () => { throw new Error('Керування користувачами доступне лише у віддаленому режимі.') })
        trustedIpcMain.handle('users:remove', async () => { throw new Error('Керування користувачами доступне лише у віддаленому режимі.') })
        const database = openAppDatabase(app.getPath('userData'))
        closeDatabase = () => database.close()
        registerBankIpc(database)
        registerRecipientIpc(database)
        registerRecordsIpc(database)
        registerReportExportIpc()
        registerDeletionIpc(database)
        registerStatementsIpc(database)
      } else {
        let session: RemoteAuthSession | undefined
        const http = new HttpClient(runtimeConfig.apiUrl ?? new URL('http://127.0.0.1:1'), 5_000, {
          getAccessToken: () => session?.accessToken,
          onUnauthorized: (token) => { void session?.expired(token) },
          onConnectionStatus: publishReachability,
        })
        remoteHttp = http
        session = new RemoteAuthSession(userDataPath, http, publishAuthState)
        remoteAuth = session
        remoteBackup = new RemoteBackupClient(http, new BackupInstallationIdentity(join(userDataPath, 'backup-identity'), {
          available: () => process.platform === 'win32' && safeStorage.isEncryptionAvailable(),
          encrypt: value => safeStorage.encryptString(value),
          decrypt: value => safeStorage.decryptString(value),
        }), join(userDataPath, 'client-backups'))
        await session.initialize()
        if (runtimeConfig.configurationError || !runtimeConfig.apiUrl) {
          connectionStatus = 'unavailable'
          connectionFailureReason = runtimeConfig.configurationError ? 'incompatible' : 'network'
          connectionMessage = runtimeConfig.configurationError ?? 'Налаштуйте адресу сервера, щоб увійти.'
          session.setUnavailable(connectionMessage)
        } else {
          void checkServerAddress(runtimeConfig.apiUrl.origin).then((result) => {
            if (runtimeConfig?.mode !== 'remote' || runtimeConfig.apiUrl?.origin !== result.apiUrl) return
            connectionStatus = result.status
            connectionFailureReason = result.ok ? undefined : result.failureReason
            connectionMessage = result.message
            publishConnectionState()
            if (!result.ok && session?.currentState.status !== 'authenticated' && session?.currentState.status !== 'password-change-required') session?.setUnavailable(result.message)
          })
        }
        trustedIpcMain.handle('auth:get-state', async () => session.currentState)
        trustedIpcMain.handle('auth:validate-session', async (): Promise<AuthActionResult> => session.validateSession())
        trustedIpcMain.handle('auth:login', async (_event, username: unknown, password: unknown): Promise<AuthActionResult> => {
          if (savingConnection) return { ok: false, state: session.currentState, message: 'Зачекайте завершення зміни адреси сервера.' }
          if (!runtimeConfig?.apiUrl) return { ok: false, state: session.currentState, message: runtimeConfig?.configurationError ?? 'Налаштуйте адресу сервера перед входом.' }
          return session.login(typeof username === 'string' ? username : '', typeof password === 'string' ? password : '')
        })
        trustedIpcMain.handle('auth:logout', async (): Promise<AuthActionResult> => session.logout())
        trustedIpcMain.handle('auth:change-password', async (_event, currentPassword: unknown, newPassword: unknown): Promise<AuthActionResult> =>
          session.changePassword(typeof currentPassword === 'string' ? currentPassword : '', typeof newPassword === 'string' ? newPassword : ''))
        trustedIpcMain.handle('users:list', async () => http.getJson('/api/users'))
        trustedIpcMain.handle('users:get', async (_event, id: unknown) => typeof id === 'string' ? http.getJson(`/api/users/${encodeURIComponent(id)}`) : null)
        trustedIpcMain.handle('users:create', async (_event, input: unknown) => http.postJson('/api/users', { input }))
        trustedIpcMain.handle('users:update', async (_event, id: unknown, input: unknown, expectedUpdatedAt: unknown) => typeof id === 'string' ? http.putJson(`/api/users/${encodeURIComponent(id)}`, { input, expectedUpdatedAt }) : { ok: false, reason: 'not-found', message: 'Користувача не знайдено.' })
        trustedIpcMain.handle('users:set-status', async (_event, id: unknown, status: unknown, expectedUpdatedAt: unknown) => typeof id === 'string' ? http.postJson(`/api/users/${encodeURIComponent(id)}/status`, { status, expectedUpdatedAt }) : { ok: false, reason: 'not-found', message: 'Користувача не знайдено.' })
        trustedIpcMain.handle('users:reset-password', async (_event, id: unknown, newPassword: unknown, expectedUpdatedAt: unknown) => typeof id === 'string' ? http.postJson(`/api/users/${encodeURIComponent(id)}/reset-password`, { newPassword, expectedUpdatedAt }) : { ok: false, reason: 'not-found', message: 'Користувача не знайдено.' })
        trustedIpcMain.handle('users:remove', async (_event, id: unknown, expectedUpdatedAt: unknown) => typeof id === 'string' ? http.deleteJson(`/api/users/${encodeURIComponent(id)}`, { expectedUpdatedAt }) : { ok: false, reason: 'not-found', message: 'Користувача не знайдено.' })
        // PDF snapshots and their release are per-window Electron resources; they never access SQLite.
        registerReportExportIpc()
        registerStatementsIpc(undefined, { readRows: async (ids, year) => http.postJson('/api/statements/snapshot', { ids, year: Number(year) }), readBankRows: async (ids, year) => http.postJson('/api/statements/bank-snapshot', { ids, year }) })
        registerRemoteIpcBlockers(['catalogs:list', 'catalogs:save', 'catalogs:reorder', 'recipients:list', 'recipients:get', 'recipients:save', 'recipients:assignment-history', 'banks:list', 'banks:get', 'banks:details', 'banks:save', 'banks:remove', 'decisions:list', 'decisions:get', 'decisions:save', 'decisions:add-assignments', 'assignments:list', 'assignments:save', 'assignments:change-statuses', 'program-approvals:list', 'program-approvals:save', 'dashboard:get', 'reports:get', 'reports:summary', 'reports:annual-plan-list', 'reports:plan-list', 'reports:annual-plan-save', 'reports:plan-save', 'reports:plan-remove', 'reports:generate', 'reports:save-pdf', 'reports:save-excel', 'reports:release', 'statements:list', 'statements:generate', 'statements:generate-bank', 'statements:save', 'statements:save-pdf', 'deletion:preview', 'deletion:execute'])
        trustedIpcMain.handle('catalogs:list', async (_event, includeInactiveValue: unknown): Promise<CatalogList> =>
          http.getJson(includeInactiveValue === true ? '/api/catalogs?includeInactive=true' : '/api/catalogs', isCatalogList))
        trustedIpcMain.handle('catalogs:save', async (_event, input: unknown) => http.postJson('/api/catalogs/save', { input }, isCatalogSaveResult))
        trustedIpcMain.handle('catalogs:reorder', async (_event, input: unknown) => http.postJson('/api/catalogs/reorder', { input }, isCatalogOrderResult))
        trustedIpcMain.handle('recipients:list', async (): Promise<RecipientSummary[]> =>
          http.getJson('/api/recipients', isRecipientSummaryList))
        trustedIpcMain.handle('recipients:get', async (_event, id: unknown): Promise<RecipientRecord | null> => {
          if (typeof id !== 'string' || !id) return null
          return http.getJson(`/api/recipients/${encodeURIComponent(id)}`, isNullableRecipientRecord)
        })
        trustedIpcMain.handle('recipients:assignment-history', async (_event, id: unknown): Promise<AssignmentRecord[]> => {
          if (typeof id !== 'string' || !id) return []
          return http.getJson(`/api/recipients/${encodeURIComponent(id)}/assignment-history`, isAssignmentRecordList)
        })
        trustedIpcMain.handle('recipients:save', async (_event, input: unknown, id: unknown, confirmSameName: unknown, expectedUpdatedAt: unknown) => {
          try {
            if (typeof id === 'string' && id) return await http.putJson(`/api/recipients/${encodeURIComponent(id)}`, { input, confirmSameName: confirmSameName === true, expectedUpdatedAt }, isRecipientSaveResult)
            return await http.postJson('/api/recipients', { input }, isRecipientSaveResult)
          } catch (error) {
            if (error instanceof HttpClientError && (error.status === 400 || error.status === 409)) return { ok: false as const, reason: error.status === 409 ? 'conflict' as const : 'validation' as const, matches: [], message: error.message }
            throw error
          }
        })
        trustedIpcMain.handle('banks:list', async (_event, query: unknown): Promise<BankRecord[]> => {
          if (query !== undefined && typeof query !== 'string') throw new Error('Некоректний пошуковий запит.')
          const path = typeof query === 'string' && query ? `/api/banks?query=${encodeURIComponent(query)}` : '/api/banks'
          return http.getJson(path, isBankRecordList)
        })
        trustedIpcMain.handle('banks:get', async (_event, id: unknown): Promise<BankRecord | null> => {
          if (typeof id !== 'string' || !id) return null
          return http.getJson(`/api/banks/${encodeURIComponent(id)}`, isNullableBankRecord)
        })
        trustedIpcMain.handle('banks:details', async (_event, id: unknown): Promise<BankDetail[]> => {
          if (typeof id !== 'string' || !id) return []
          return http.getJson(`/api/banks/${encodeURIComponent(id)}/details`, isBankDetailList)
        })
        trustedIpcMain.handle('banks:remove', async (_event, id: unknown, expectedUpdatedAt: unknown) => { if(typeof id!=='string'||!id) return {ok:false,message:'Оберіть банк для видалення.'}; return http.deleteJson(`/api/banks/${encodeURIComponent(id)}`, { expectedUpdatedAt }) })
        trustedIpcMain.handle('banks:save', async (_event, input: unknown, id: unknown, expectedUpdatedAt: unknown) => {
          try {
            if (typeof id === 'string' && id) return await http.putJson(`/api/banks/${encodeURIComponent(id)}`, { input, expectedUpdatedAt }, isBankSaveResult)
            return await http.postJson('/api/banks', { input }, isBankSaveResult)
          } catch (error) {
            if (error instanceof HttpClientError && (error.status === 400 || error.status === 409)) return { ok: false as const, reason: error.status === 409 ? 'conflict' as const : 'validation' as const, message: error.message }
            throw error
          }
        })
        trustedIpcMain.handle('decisions:list', async (): Promise<DecisionSummary[]> =>
          http.getJson('/api/decisions', isDecisionSummaryList))
        trustedIpcMain.handle('decisions:get', async (_event, id: unknown): Promise<DecisionRecord | null> => {
          if (typeof id !== 'string' || !id) return null
          return http.getJson(`/api/decisions/${encodeURIComponent(id)}`, isNullableDecisionRecord)
        })
        trustedIpcMain.handle('decisions:save', async (_event, input: unknown, id: unknown, expectedUpdatedAt: unknown) => {
          if (typeof id === 'string' && id) return http.putJson(`/api/decisions/${encodeURIComponent(id)}`, { input, expectedUpdatedAt }, isDecisionSaveResult)
          return http.postJson('/api/decisions', { input }, isDecisionSaveResult)
        })
        trustedIpcMain.handle('decisions:add-assignments', async (_event, decisionId: unknown, assignments: unknown, requestId: unknown) => {
          if (typeof decisionId !== 'string' || !decisionId) throw new Error('Не вибрано рішення.')
          return http.postJson(`/api/decisions/${encodeURIComponent(decisionId)}/assignments`, { assignments, requestId }, isAssignmentSaveResult)
        })
        trustedIpcMain.handle('assignments:list', async (_event, yearValue: unknown): Promise<AssignmentListResult> => {
          const path = yearValue === undefined ? '/api/assignments' : `/api/assignments?year=${encodeURIComponent(String(yearValue))}`
          return http.getJson(path, isAssignmentListResult)
        })
        trustedIpcMain.handle('assignments:change-statuses', async (_event, input: unknown, requestId: unknown) => http.postJson('/api/assignments/change-statuses', { input, requestId }))
        trustedIpcMain.handle('assignments:save', async (_event, input: unknown, id: unknown, expectedUpdatedAt: unknown, requestId: unknown) => { if (typeof id === 'string' && id) return http.putJson(`/api/assignments/${encodeURIComponent(id)}`, { input, expectedUpdatedAt }, isAssignmentChangeResult); return http.postJson('/api/assignments', { input, requestId }, isAssignmentChangeResult) })
        trustedIpcMain.handle('program-approvals:list', async (): Promise<ProgramApproval[]> =>
          http.getJson('/api/program-approvals', isProgramApprovalList))
        trustedIpcMain.handle('program-approvals:save', async (_event, input: unknown, id: unknown, expectedUpdatedAt: unknown) => {
          if (typeof id === 'string' && id) return http.putJson(`/api/program-approvals/${encodeURIComponent(id)}`, { input, expectedUpdatedAt }, isProgramApprovalSaveResult)
          return http.postJson('/api/program-approvals', { input }, isProgramApprovalSaveResult)
        })
        trustedIpcMain.handle('dashboard:get', async (_event, yearValue: unknown): Promise<DashboardData> => {
          const path = yearValue === undefined ? '/api/dashboard' : `/api/dashboard?year=${encodeURIComponent(String(yearValue))}`
          return http.getJson(path, isDashboardData)
        })
        trustedIpcMain.handle('reports:get', async (_event, sheetValue: unknown): Promise<ReportSourceRow[]> => {
          if (typeof sheetValue !== 'string') return []
          return http.getJson(`/api/reports/source-rows?sheet=${encodeURIComponent(sheetValue)}`, isReportSourceRowList)
        })
        trustedIpcMain.handle('reports:summary', async (_event, yearValue: unknown, periodValue: unknown): Promise<ReportSummary> => {
          const year = encodeURIComponent(String(yearValue))
          const period = encodeURIComponent(String(JSON.stringify(periodValue)))
          return http.getJson(`/api/reports/summary?year=${year}&period=${period}`, isReportSummary)
        })
        trustedIpcMain.handle('reports:annual-plan-list', async (_event, yearValue: unknown): Promise<AnnualAidPlan[]> => {
          const path = yearValue === undefined ? '/api/reports/annual-plans' : `/api/reports/annual-plans?year=${encodeURIComponent(String(yearValue))}`
          return http.getJson(path, isAnnualAidPlanList)
        })
        trustedIpcMain.handle('reports:plan-list', async (_event, yearValue: unknown): Promise<AnnualPlanEntry[]> => {
          const path = yearValue === undefined ? '/api/reports/plan-entries' : `/api/reports/plan-entries?year=${encodeURIComponent(String(yearValue))}`
          return http.getJson(path, isAnnualPlanEntryList)
        })
        trustedIpcMain.handle('reports:annual-plan-save', async (_event, input: unknown, expectedUpdatedAt: unknown) => http.postJson('/api/reports/annual-plans', { input, expectedUpdatedAt }))
        trustedIpcMain.handle('reports:plan-save', async (_event, input: unknown, id: unknown) => http.postJson('/api/reports/plan-entries', { input, id }))
        trustedIpcMain.handle('reports:plan-remove', async (_event, id: unknown) => { if(typeof id!=='string'||!id) return {ok:false,message:'Плановий рядок не знайдено.'}; return http.deleteJson(`/api/reports/plan-entries/${encodeURIComponent(id)}`) })
        trustedIpcMain.handle('deletion:preview', async (_event, entity: unknown, id: unknown) => { if(typeof entity!=='string'||typeof id!=='string'||!id) return null; return http.getJson(`/api/deletion/${encodeURIComponent(entity)}/${encodeURIComponent(id)}`) })
        trustedIpcMain.handle('deletion:execute', async (_event, entity: unknown, id: unknown, confirmationToken: unknown) => { if(typeof entity!=='string'||typeof id!=='string'||!id) return {ok:false,message:'Запис не знайдено.'}; return http.postJson(`/api/deletion/${encodeURIComponent(entity)}/${encodeURIComponent(id)}`, { confirmationToken }) })
        trustedIpcMain.handle('statements:list', async (_event, yearValue: unknown): Promise<AssignmentListResult> => {
          const path = yearValue === undefined ? '/api/statements' : `/api/statements?year=${encodeURIComponent(String(yearValue))}`
          return http.getJson(path, isStatementListResult)
        })
      }
    } catch (error) {
      dialog.showErrorBox('HromadaAid', error instanceof ElectronRuntimeConfigError || error instanceof DatabaseSchemaError || error instanceof DatabaseIntegrityError
        ? error.message
        : 'Не вдалося підготувати режим роботи застосунку. Перевірте конфігурацію та перезапустіть застосунок.')
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
    const cleanup = runtimeConfig?.mode === 'local'
      ? cleanupGeneratedReports().then(() => cleanupGeneratedStatements())
      : Promise.all([remoteBackup?.stop(), remoteAuth?.close()]).then(() => undefined)
    void cleanup.catch(() => {
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
