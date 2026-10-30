import { cleanupGeneratedReports, registerReportExportIpc } from './report-export-ipc.js'
import { app, BrowserWindow, dialog, screen, shell } from 'electron'
import { RemoteAuthSession } from './auth-session.js'
import { readLastLogin, saveLastLoginAfterSuccessfulLogin } from './client-preferences.js'
import type { AuthActionResult, ClientAuthState } from '../shared/auth-contract.js'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { cleanupGeneratedStatements, registerStatementsIpc } from './statements-ipc.js'
import { createClientUpdateService } from './client-update-service.js'
import { configureIpcSecurity, isTrustedAppUrl, trustedIpcMain } from './ipc-security.js'
import { ElectronRuntimeConfigError, enforceTlsCertificateValidation, readElectronRuntimeConfig, readSavedConnectionConfig, validateServerBaseUrl, type ElectronRuntimeConfig } from './runtime-config.js'
import { HttpClient, HttpClientError } from './http-client.js'
import { checkServerAddress, switchRemoteServer, type ServerConnectionState } from './connection-config.js'
import type { AnnualAidPlan, AnnualPlanEntry, AssignmentListResult, AssignmentRecord, BankDetail, BankRecord, CatalogList, DashboardData, DecisionRecord, DecisionSummary, ProgramApproval, RecipientRecord, RecipientSummary, ReportPeriod, ReportSourceRow, ReportSummary } from './api-contract.js'
import { isAnnualAidPlanList, isAnnualPlanEntryList, isAssignmentChangeResult, isAssignmentListResult, isAssignmentRecordList, isAssignmentSaveResult, isBankDetailList, isBankRecordList, isBankSaveResult, isCatalogList, isCatalogOrderResult, isCatalogSaveResult, isDashboardData, isDecisionSaveResult, isDecisionSummaryList, isNullableBankRecord, isNullableDecisionRecord, isNullableRecipientRecord, isProgramApprovalList, isProgramApprovalSaveResult, isRecipientSaveResult, isRecipientSummaryList, isReportSourceRowList, isReportSummary, isStatementListResult } from '../shared/api-contract.js'

// Match the Windows package/shortcut identity without changing userData.
if (process.platform === 'win32') app.setAppUserModelId('local.hromadaaid')

const isDev = !app.isPackaged
enforceTlsCertificateValidation()
const devServerUrl = 'http://127.0.0.1:5175/'
const currentDirectory = dirname(fileURLToPath(import.meta.url))
const iconDirectory = app.isPackaged ? join(process.resourcesPath, 'assets') : join(currentDirectory, 'assets')
let mainWindow: BrowserWindow | null = null
let runtimeConfig: ElectronRuntimeConfig | undefined
let remoteAuth: RemoteAuthSession | undefined
let remoteHttp: HttpClient | undefined
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
      title: 'HromadaAID — Огляд',
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
      dialog.showErrorBox('HromadaAID — помилка завантаження', isDev
        ? `Не вдалося завантажити ${devServerUrl}\nПеревірте, чи працює Vite.\n${message}`
        : `Не вдалося завантажити інтерфейс застосунку.\n${message}`)
    })
  } catch (error) {
    console.error('[HromadaAid] Критична помилка створення вікна:', error)
    dialog.showErrorBox('HromadaAID', 'Не вдалося створити головне вікно. Подробиці в терміналі запуску.')
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
      const clientUpdates = createClientUpdateService({
        currentVersion: app.getVersion(), resourcesPath: process.resourcesPath, userDataPath,
        executablePath: app.getPath('exe'), processId: process.pid,
        publish: state => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('client-update:state', state) },
      })
      await clientUpdates.restore()
      trustedIpcMain.handle('client-update:get-state', () => clientUpdates.getState())
      trustedIpcMain.handle('client-update:check', () => clientUpdates.check())
      trustedIpcMain.handle('client-update:download', () => clientUpdates.download())
      trustedIpcMain.handle('client-update:install', async () => {
        const result = await clientUpdates.install()
        if (result.ok) setTimeout(() => { clientUpdates.markRestarting(); app.quit() }, 300)
        return result
      })
      setTimeout(() => { void clientUpdates.check() }, 0)
      const updateCheckInterval = setInterval(() => { void clientUpdates.check() }, 3 * 60 * 60 * 1000)
      updateCheckInterval.unref()
      const savedConnection = readSavedConnectionConfig(userDataPath, join(process.resourcesPath, 'server-connection.json'))
      savedApiUrl = savedConnection.config?.apiUrl ?? null
      runtimeConfig = readElectronRuntimeConfig(process.env, savedConnection)
      trustedIpcMain.handle('app:get-version', async () => app.getVersion())
      trustedIpcMain.handle('app:open-external', async (_event, value: unknown): Promise<boolean> => {
        if (typeof value !== 'string' || value.length > 300) return false
        const safe = /^(?:tel:\+380\d{9}|mailto:(?:tech\.vishnsrada@ukr\.net|myronenko\.anatoliu@gmail\.com)|https:\/\/t\.me\/antlmrnnk)$/i.test(value)
        if (!safe) return false
        try { await shell.openExternal(value); return true } catch { return false }
      })
      let savingConnection = false
      const publishAuthState = (state: ClientAuthState) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('auth:state', state)
      }
      const connectionLocked = () => Boolean(process.env.HROMADAAID_API_URL?.trim())
      const connectionState = (): ServerConnectionState => ({
        apiUrl: runtimeConfig?.source === 'invalid' && runtimeConfig.lockedReason ? null : runtimeConfig?.apiUrl?.origin ?? savedApiUrl,
        active: Boolean(runtimeConfig?.apiUrl),
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
        const activeUrl = runtimeConfig?.apiUrl?.origin
        if (activeUrl === normalized.origin) {
          connectionStatus = 'checking'
          connectionFailureReason = undefined
          connectionMessage = 'Перевірка підключення…'
          publishConnectionState()
        }
        const result = await checkServerAddress(normalized.origin)
        const currentUrl = runtimeConfig?.apiUrl?.origin
        if (currentUrl === result.apiUrl) {
          connectionStatus = result.status
          connectionFailureReason = result.ok ? undefined : result.failureReason
          connectionMessage = result.message
          publishConnectionState()
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
        if (!remoteHttp || !remoteAuth) return { ok: false, state: current, message: 'Не вдалося підготувати віддалене підключення.' }
        const switched = await switchRemoteServer(userDataPath, normalized.origin, remoteHttp, remoteAuth, (url) => {
          runtimeConfig = { apiUrl: url, source: 'saved' }
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
      let session: RemoteAuthSession | undefined
      const http = new HttpClient(runtimeConfig.apiUrl, 5_000, {
        getAccessToken: () => session?.accessToken,
        onUnauthorized: (token) => { void session?.expired(token) },
        onConnectionStatus: publishReachability,
      })
      remoteHttp = http
      session = new RemoteAuthSession(userDataPath, http, publishAuthState)
      remoteAuth = session
      await session.initialize()
      if (runtimeConfig.configurationError || !runtimeConfig.apiUrl) {
        connectionStatus = 'unavailable'
        connectionFailureReason = runtimeConfig.configurationError ? 'incompatible' : 'network'
        connectionMessage = runtimeConfig.configurationError ?? 'Налаштуйте адресу сервера, щоб увійти.'
        session.setUnavailable(connectionMessage)
      } else {
        void checkServerAddress(runtimeConfig.apiUrl.origin).then((result) => {
          if (runtimeConfig?.apiUrl?.origin !== result.apiUrl) return
          connectionStatus = result.status
          connectionFailureReason = result.ok ? undefined : result.failureReason
          connectionMessage = result.message
          publishConnectionState()
          if (!result.ok && session?.currentState.status !== 'authenticated' && session?.currentState.status !== 'password-change-required') session?.setUnavailable(result.message)
        })
      }
      trustedIpcMain.handle('auth:get-state', async () => session.currentState)
      trustedIpcMain.handle('auth:get-last-login', async () => readLastLogin(userDataPath))
      trustedIpcMain.handle('auth:validate-session', async (): Promise<AuthActionResult> => session.validateSession())
      trustedIpcMain.handle('auth:login', async (_event, username: unknown, password: unknown): Promise<AuthActionResult> => {
        if (savingConnection) return { ok: false, state: session.currentState, message: 'Зачекайте завершення зміни адреси сервера.' }
        if (!runtimeConfig?.apiUrl) return { ok: false, state: session.currentState, message: runtimeConfig?.configurationError ?? 'Налаштуйте адресу сервера перед входом.' }
        const result = await session.login(typeof username === 'string' ? username : '', typeof password === 'string' ? password : '')
        await saveLastLoginAfterSuccessfulLogin(userDataPath, result).catch(() => console.warn('[HromadaAid] Не вдалося зберегти локальне налаштування останнього логіна.'))
        return result
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
      registerStatementsIpc({ readRows: async (ids, year) => http.postJson('/api/statements/snapshot', { ids, year: Number(year) }), readBankRows: async (ids, year) => http.postJson('/api/statements/bank-snapshot', { ids, year }) })
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
      trustedIpcMain.handle('statements:list', async (_event, yearValue: unknown) => {
        const path = yearValue === undefined ? '/api/statements' : `/api/statements?year=${encodeURIComponent(String(yearValue))}`
        return http.getJson(path, isStatementListResult)
      })
    } catch (error) {
      dialog.showErrorBox('HromadaAID', error instanceof ElectronRuntimeConfigError
        ? error.message
        : 'Не вдалося підготувати підключення застосунку. Перевірте конфігурацію та перезапустіть застосунок.')
      app.quit()
      return
    }

    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  }).catch((error: unknown) => {
    console.error('[HromadaAid] Критична помилка запуску Electron:', error)
    dialog.showErrorBox('HromadaAID', 'Не вдалося завершити запуск Electron. Подробиці в терміналі запуску.')
    app.quit()
  })

  let shutdownStarted = false
  let shutdownComplete = false
  app.on('before-quit', (event) => {
    if (shutdownComplete) return
    event.preventDefault()
    if (shutdownStarted) return
    shutdownStarted = true
    const cleanup = Promise.all([remoteAuth?.close(), cleanupGeneratedReports(), cleanupGeneratedStatements()])
    void cleanup.catch(() => {
      console.warn('[HromadaAid] Частину тимчасових документів буде перевірено під час наступного запуску.')
    }).finally(() => {
      shutdownComplete = true
      app.quit()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
