import { createOperationCloseGuard } from './operation-close-guard.js'
import { app, BrowserWindow, dialog, ipcMain, screen, session } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { lstat, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { monitorChild, terminateProcessTree } from './managed-child.js'
import { createExclusiveOperation } from './exclusive-operation.js'
import { spawn } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { Readable, Transform } from 'node:stream'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { inspectEnvironment } from './inspection-engine.js'
import { createInspectionRequestHandler } from './inspection-ipc.js'
import { createWindowsInspectionAdapters } from './windows-inspection.js'
import type { InspectionSnapshot } from './inspection-types.js'
import type { InstallDirectoryKind, ServerInstallRequest, ServerInstallUpdate } from './installation-contract.js'
import { runServerInstallation } from './installation-engine.js'
import { createWindowsInstallationAdapters } from './windows-installation.js'
import { markInitialSetupReadiness } from './initial-setup.js'
import { createServiceControlRequestHandler, runServiceControl, type ServiceControlOperation } from './service-control.js'
import { controlWindowsService } from './windows-service-control.js'
import { prepareServerUpdate, applyServerUpdate, type PreparedServerUpdate } from './server-update.js'
import { buildInstallerInvocation, createWindowsServerUpdateAdapters } from './windows-server-update.js'
import { isServerBackupList, type ServerBackupList } from './backup-contract.js'
import type { RecoveryKind, RecoveryStatus } from './recovery-contract.js'
import { parseInstallerDiagnostic } from './server-install-diagnostic.js'
import { assertRecoveryApiPermission, assertWindowsRecoveryAdministrator } from './recovery-authorization.js'

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
let updatePreparationInProgress = false
let activeUpdateId: string | null = null
let preparedServerUpdate: PreparedServerUpdate | null = null
let recoveryPrompt: { operationId: string; key: string; savedPath: string | null; resolve: (saved: boolean) => void } | null = null
let backupOperationInProgress = false
let recoveryInspectionInProgress = false
let backupSession: { origin: string; token: string; user: { username: string; displayName: string | null } } | null = null
const importedArchives = new Map<string, string>()
const runBackupOperation = createExclusiveOperation(
  () => Boolean(recoveryInspectionInProgress || backupOperationInProgress || activeInstallId || activeUpdateId || serviceOperationInProgress || updatePreparationInProgress || preparedServerUpdate),
  value => { backupOperationInProgress = value },
)

function requireBackupSession(): NonNullable<typeof backupSession> {
  if (!backupSession) throw new Error('Увійдіть до сервера обліковим записом із правом керувати резервними копіями.')
  return backupSession
}
function isManagerLoginResult(value: unknown): value is { token: string; user: { username: string; displayName: string | null; permissions: string[]; mustChangePassword: boolean } } {
  if (!value || typeof value !== 'object') return false
  const result = value as Record<string, unknown>, user = result.user as Record<string, unknown> | undefined
  return typeof result.token === 'string' && !!user && typeof user.username === 'string' && (typeof user.displayName === 'string' || user.displayName === null) && Array.isArray(user.permissions) && user.permissions.every(item => typeof item === 'string') && typeof user.mustChangePassword === 'boolean'
}
async function backupRequest(path: string, method = 'GET', body?: unknown): Promise<Response> {
  const current = requireBackupSession()
  const response = await fetch(new URL(path, current.origin), { method, redirect: 'error', headers: { accept: 'application/json', authorization: `Bearer ${current.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(300_000) })
  if (!response.ok) {
    const detail = await response.clone().json().catch(() => null) as { message?: unknown } | null
    throw new Error(typeof detail?.message === 'string' ? detail.message : `Сервер відповів помилкою HTTP ${response.status}.`)
  }
  return response
}
async function getBackupList(): Promise<ServerBackupList> {
  const value: unknown = await (await backupRequest('/api/backups/server')).json()
  if (!isServerBackupList(value)) throw new Error('Сервер повернув непідтримуваний перелік архівів.')
  return value
}
async function runRestoreCli(args: string[], input?: string, cwd = dirname(dirname(args[1]))): Promise<{ stdout: string; stderr: string; code: number }> {
  const child = spawn(args[0], args.slice(1), { cwd, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'], env: { SystemRoot: process.env.SystemRoot, ProgramData: process.env.ProgramData, TEMP: process.env.TEMP } })
  const result = monitorChild(child, { timeoutMs: 5 * 60_000, terminateTree: () => terminateProcessTree(child), onTimeout: unconfirmed => {
    const message = unconfirmed ? 'Завершення допоміжного процесу не підтверджено. Нові системні операції заблоковано; не закривайте Server Manager.' : 'Час очікування вичерпано. Очікуємо підтвердження завершення процесу.'
    window?.webContents.send('manager:recovery-progress', { message })
    window?.webContents.send('manager:backup-progress', { stage: 'timeout', message })
  } })
  child.stdin.on('error', () => { /* EPIPE after termination contains no secret material. */ })
  if (input) child.stdin.end(input, 'utf8'); else child.stdin.end()
  try { return await result } catch (error) {
    if ((error as { code?: string }).code === 'RECOVERY_CHILD_TIMEOUT') {
      const snapshot = await inspectEnvironment(createWindowsInspectionAdapters())
      const database = snapshot.configuration.databasePath
      const pending = database && (await pathExists(`${database}.restore-journal.json`) || await pathExists(`${database}.maintenance.json`))
      throw new Error(`Час очікування вичерпано; процес завершено. Стан служби: ${snapshot.service.status}. ${pending ? 'Є незавершене відновлення; скористайтеся дією «Продовжити відновлення».' : 'Повторного restore не виконувалося. Перевірте стан сервера.'}`)
    }
    throw error
  }
}
async function pathExists(path: string): Promise<boolean> {
  try { await lstat(path); return true } catch (error) { if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return false; throw error }
}
async function restorePaths(snapshot: InspectionSnapshot, recovery = false): Promise<{ root: string; node: string; cli: string; database: string; backups: string; api: string }> {
  const c = snapshot.configuration
  if (process.platform !== 'win32' || (!recovery && snapshot.installation.status !== 'installed') || !['confirmed', 'corroborated'].includes(snapshot.discovery.confidence) || !c.programDirectory || !c.databasePath || !c.backupDirectory || !c.apiAddress) throw new Error('Не вдалося підтвердити встановлені каталоги сервера.')
  const root = join(c.programDirectory, 'Server'), node = join(root, 'runtime', 'node.exe'), cli = join(root, 'app', 'dist', 'server', 'src', 'backup-restore-cli.js')
  for (const path of [root, node, cli]) { const info = await lstat(path); if (info.isSymbolicLink()) throw new Error('Шлях до серверного інструмента містить символічне посилання.') }
  return { root, node, cli, database: c.databasePath, backups: c.backupDirectory, api: c.apiAddress }
}
async function verifyArchive(snapshot: InspectionSnapshot, archive: string, recoveryKey?: string): Promise<{ createdAt: string | null; size: number }> {
  if (!archive.toLowerCase().endsWith('.hraid') || !Number.isSafeInteger((await stat(archive)).size) || (await stat(archive)).size > 2 * 1024 * 1024 * 1024) throw new Error('Оберіть доступний архів .hraid розміром до 2 ГіБ.')
  const paths = await restorePaths(snapshot)
  const args = [paths.node, paths.cli, '--database', paths.database, '--backup-dir', paths.backups, '--archive', archive, '--verify-only', ...(recoveryKey ? ['--recovery-key'] : [])]
  const result = await runRestoreCli(args, recoveryKey ? `${recoveryKey.trim()}\n` : undefined)
  if (result.code !== 0) throw new Error(result.stderr.trim() || 'Архів не пройшов перевірку ключа, формату або цілісності SQLite.')
  const parsed = JSON.parse(result.stdout.trim()) as { valid?: unknown; createdAt?: unknown; archiveSize?: unknown }
  if (parsed.valid !== true || !(parsed.createdAt === null || typeof parsed.createdAt === 'string') || typeof parsed.archiveSize !== 'number') throw new Error('Локальний verifier повернув некоректний результат.')
  return { createdAt: parsed.createdAt, size: parsed.archiveSize }
}

async function recoveryStatus(): Promise<RecoveryStatus> {
  const snapshot = await inspectEnvironment(createWindowsInspectionAdapters()), c = snapshot.configuration
  const result: RecoveryStatus = { update: { pending: false, canRecover: false, reason: '' }, restore: { pending: false, canReturn: false, reason: '' } }
  if (!c.programDirectory || !c.dataDirectory || !c.databasePath || !c.backupDirectory) return result
  const journal = await pathExists(join(c.dataDirectory, '.hromadaaid-update-state.json'))
  const previous = await pathExists(join(c.programDirectory, 'Server.previous')), failed = await pathExists(join(c.programDirectory, 'Server.failed'))
  const staged = snapshot.installation.status !== 'ready_to_configure' && await pathExists(join(c.programDirectory, 'Server.next'))
  result.update = { pending: journal || previous || failed || staged, canRecover: journal, reason: journal ? 'Виявлено незавершене оновлення. Перед змінами пакети й сумісність бази буде перевірено повторно.' : previous || failed || staged ? 'Службові каталоги є, але журнал відсутній. Автоматичне recovery заборонено; файли збережено.' : '' }
  if (journal) {
    try {
      const record = JSON.parse(await readFile(join(c.dataDirectory, '.hromadaaid-update-state.json'), 'utf8')) as { formatVersion?: unknown; hadPreviousPackage?: unknown }
      if (record?.formatVersion === 1 && record.hadPreviousPackage === false && !previous) result.update = { pending: false, canRecover: false, reason: '' } // Existing first-setup recovery owns this journal.
      else if (record?.formatVersion !== 1 || record.hadPreviousPackage !== true) result.update = { pending: true, canRecover: false, reason: 'Формат журналу не підтверджує транзакцію оновлення. Файли збережено для ручної перевірки.' }
    } catch { result.update = { pending: true, canRecover: false, reason: 'Журнал оновлення пошкоджено або недоступний. Файли збережено для ручної перевірки.' } }
  }
  result.restore.pending = await pathExists(`${c.databasePath}.restore-journal.json`) || await pathExists(`${c.databasePath}.maintenance.json`)
  if (result.restore.pending) { result.restore.reason = result.update.pending ? 'Одночасно знайдено транзакції пакета й SQLite. Автоматичні дії заблоковано; потрібна ручна перевірка. Файли збережено.' : 'Продовжіть уже підтверджене відновлення без повторного вибору архіву.'; return result }
  if (snapshot.api.status !== 'available' && await pathExists(`${c.databasePath}.restore-completed.json`)) {
    let receipt: { acknowledged?: unknown }
    try { receipt = JSON.parse(await readFile(`${c.databasePath}.restore-completed.json`, 'utf8')) as { acknowledged?: unknown } }
    catch { result.restore.reason = 'Запис завершення restore пошкоджено або недоступний. Повернення бази заблоковано; копії збережено для ручної перевірки.'; return result }
    if (!receipt || typeof receipt !== 'object') { result.restore.reason = 'Запис завершення restore некоректний. Повернення бази заборонене; копії збережено.'; return result }
    if (receipt.acknowledged === true) return result
    if (snapshot.service.status !== 'stopped') { result.restore.reason = 'Повернення бази заблоковано, доки не підтверджено зупинку Windows Service. Зупиніть службу в розділі «Огляд» і повторіть перевірку.'; return result }
    const paths = await restorePaths(snapshot, true)
    const status = await runRestoreCli([paths.node, paths.cli, '--database', paths.database, '--backup-dir', paths.backups, '--recovery-status'])
    if (status.code !== 0) { result.restore.reason = 'Не вдалося підтвердити безпечне повернення бази.'; return result }
    const value: unknown = JSON.parse(status.stdout.trim())
    if (!value || typeof value !== 'object' || typeof (value as { pending?: unknown }).pending !== 'boolean' || typeof (value as { canReturn?: unknown }).canReturn !== 'boolean' || typeof (value as { reason?: unknown }).reason !== 'string') throw new Error('Непідтримуваний результат перевірки recovery.')
    result.restore = value as RecoveryStatus['restore']
  }
  return result
}

async function authorizeLocalRecovery(snapshot: InspectionSnapshot, databaseOperation: boolean): Promise<void> {
  const executable = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const script = '$p=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent());if(-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){exit 5}'
  const check = await runRestoreCli([executable, '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], undefined, dirname(executable))
  assertWindowsRecoveryAdministrator(check.code === 0)
  if (databaseOperation && snapshot.api.status === 'available') {
    assertRecoveryApiPermission(await (await backupRequest('/auth/me')).json())
  }
}

async function startAndConfirmRestoredServer(paths: Awaited<ReturnType<typeof restorePaths>>, send: (stage: string, message: string) => void): Promise<void> {
  // The restore engine revokes SQLite sessions before completing. Keep the
  // separate in-memory Manager session and its already-mounted UI consistent.
  backupSession = null
  window?.webContents.send('manager:backup-progress', { stage: 'session-cleared', message: 'Після відновлення потрібен повторний вхід.' })
  send('start', 'Запуск Windows Service після відновлення.')
  const started = await controlWindowsService('start')
  if (!started.success) throw new Error(`Базу даних відновлено й перевірено, але запуск Windows Service не підтверджено: ${started.message} Попередню базу та страхову копію збережено.`)
  send('health', 'Перевірка доступності API після відновлення.')
  let healthy = false
  for (let attempt = 0; attempt < 15; attempt++) {
    try { const response = await fetch(new URL('/health', paths.api), { redirect: 'error', signal: AbortSignal.timeout(2_000) }); if (response.ok) { healthy = true; break } } catch { /* bounded read-only health retry */ }
    await new Promise(resolve => setTimeout(resolve, 1_000))
  }
  if (!healthy) {
    const stopped = await controlWindowsService('stop')
    throw new Error(`Базу відновлено, але готовність API не підтверджено. ${stopped.success ? 'Службу зупинено; можна перевірити можливість повернення попередньої бази.' : 'Зупинку служби не підтверджено; повернення бази заблоковано.'} Попередню базу та страхову копію збережено.`)
  }
  const acknowledged = await runRestoreCli([paths.node, paths.cli, '--database', paths.database, '--backup-dir', paths.backups, '--acknowledge', '--manager-confirmed'])
  if (acknowledged.code !== 0) throw new Error('API працює, але позначку завершення restore не підтверджено. Перевірте діагностику; повторне відновлення не запускалося.')
}

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
    updateReadiness: { ready: false, reason: 'Стан інсталяції не вдалося перевірити.' },
    checks: [{ id: 'installation', title: 'Перевірка середовища', status: 'unknown', checkedAt, message, details: 'INSPECTION_FAILED' }],
  }
}

function updateAdapters() {
  return createWindowsServerUpdateAdapters({ installerScriptPath: app.isPackaged ? join(process.resourcesPath, 'server-payload', 'installer', 'install-server-service.ps1') : join(dirname(fileURLToPath(import.meta.url)), '../../packaging/install-server-service.ps1') })
}

async function inspectWithUpdateReadiness(): Promise<InspectionSnapshot> {
  const snapshot = await inspectEnvironment(createWindowsInspectionAdapters())
  const configuration = snapshot.configuration
  await markInitialSetupReadiness(snapshot, request => createWindowsInstallationAdapters().canResume!(request))
  let updateReadiness: NonNullable<InspectionSnapshot['updateReadiness']> = { ready: false, reason: 'Оновлення доступне лише для підтвердженої встановленої служби.' }
  if (snapshot.installation.status === 'installed' && ['running', 'stopped'].includes(snapshot.service.status) && ['confirmed', 'corroborated'].includes(snapshot.discovery.confidence) && configuration.programDirectory && configuration.dataDirectory) {
    const conflicts = [join(configuration.programDirectory, 'Server.next'), join(configuration.programDirectory, 'Server.previous'), join(configuration.programDirectory, 'Server.failed'), join(configuration.dataDirectory, '.hromadaaid-update-state.json')]
    try {
      const existing = []
      for (const path of conflicts) {
        try { await lstat(path); existing.push(path.split(/[\\/]/).pop() ?? 'службовий файл') }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && (error as NodeJS.ErrnoException).code !== 'ENOTDIR') throw error }
      }
      updateReadiness = existing.length
        ? { ready: false, reason: `Виявлено службові файли (${existing.join(', ')}). Перевірте діагностику перед повторною спробою.` }
        : { ready: true, reason: 'Повну інсталяцію підтверджено; незавершених транзакцій не знайдено.' }
    } catch {
      updateReadiness = { ready: false, reason: 'Не вдалося перевірити службові файли транзакції; оновлення заблоковано.' }
    }
  }
  return { ...snapshot, updateReadiness }
}

async function openWindow() {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const width = Math.min(1180, area.width), height = Math.min(780, area.height)
  window = new BrowserWindow({
    title: 'HromadaAID Server Manager',
    icon: app.isPackaged ? join(process.resourcesPath, 'assets', 'hromadaaid-server-manager.ico') : join(dirname(fileURLToPath(import.meta.url)), '../../assets/hromadaaid-server-manager.ico'),
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
  window.on('close', createOperationCloseGuard(
    () => Boolean(activeInstallId || activeUpdateId || backupOperationInProgress || recoveryInspectionInProgress),
    () => dialog.showMessageBox(window!, { type: 'warning', title: activeInstallId ? 'Налаштування сервера триває' : backupOperationInProgress ? 'Операція з резервною копією триває' : 'Оновлення сервера триває', message: recoveryPrompt ? 'Збережіть аварійний ключ і підтвердьте його збереження у майстрі. Потім дочекайтеся завершення налаштування.' : 'Дочекайтеся завершення операції. Закриття зараз може перервати контрольовану дію.', buttons: ['Зрозуміло'], defaultId: 0, noLink: true }),
  ))
  window.on('closed', () => { window = null })
  if (development) await window.loadURL(devOrigin)
  else await window.loadFile(fileURLToPath(page))
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  const inspectRequest = createInspectionRequestHandler(inspectWithUpdateReadiness, isTrustedRenderer, failedInspection)
  ipcMain.handle('manager:inspect-environment', event => inspectRequest(event))
  ipcMain.handle('manager:recovery-status', async event => {
    if (!isTrustedRenderer(event)) throw new Error('UNTRUSTED_RENDERER')
    if (recoveryInspectionInProgress || backupOperationInProgress || activeInstallId || activeUpdateId || serviceOperationInProgress || updatePreparationInProgress) throw new Error('Зачекайте завершення поточної операції.')
    recoveryInspectionInProgress = true
    try { return await recoveryStatus() } finally { recoveryInspectionInProgress = false }
  })
  ipcMain.handle('manager:recover-operation', async (event, input: unknown) => {
    if (!isTrustedRenderer(event) || !input || typeof input !== 'object') throw new Error('UNTRUSTED_RENDERER')
    const { kind, confirmed } = input as { kind?: RecoveryKind; confirmed?: unknown }
    if (confirmed !== true || !kind || !['update', 'resume-restore', 'return-database'].includes(kind)) throw new Error('Підтвердьте обрану операцію відновлення.')
    return runBackupOperation(async () => {
      const progress = (message: string) => { if (window && !window.isDestroyed()) window.webContents.send('manager:recovery-progress', { message }) }
      const snapshot = await inspectEnvironment(createWindowsInspectionAdapters())
      await authorizeLocalRecovery(snapshot, kind !== 'update')
      const status = await recoveryStatus()
      const c = snapshot.configuration
      if (kind === 'update') {
        if (!status.update.canRecover || status.restore.pending || !c.programDirectory || !c.dataDirectory || !c.backupDirectory || !['confirmed', 'corroborated'].includes(snapshot.discovery.confidence)) throw new Error(status.restore.pending ? 'Одночасні транзакції пакета й SQLite потребують ручної перевірки. Файли збережено.' : status.update.reason || 'Транзакцію оновлення не підтверджено.')
        const script = app.isPackaged ? join(process.resourcesPath, 'server-payload', 'installer', 'install-server-service.ps1') : join(dirname(fileURLToPath(import.meta.url)), '../../packaging/install-server-service.ps1')
        const invocation = buildInstallerInvocation(script, { programDirectory: c.programDirectory, dataDirectory: c.dataDirectory, backupDirectory: c.backupDirectory })
        progress('Перевірка журналу, пакетів і сумісності SQLite; відновлення служби та перевірка API.')
        const result = await runRestoreCli([invocation.executable, ...invocation.args, '-RecoverUpdate'], undefined, invocation.cwd)
        if (result.code !== 0) {
          const diagnostic = parseInstallerDiagnostic(`${result.stdout}\n${result.stderr}`)
          throw new Error('Відновлення серверного пакета не завершено. Артефакти збережено. ' + (diagnostic ? `Етап ${diagnostic.stage}: ${diagnostic.message}` : (result.stderr || result.stdout).slice(-2500)))
        }
        const rolledBack = /^HROMADAAID_RECOVERY_OUTCOME\|rolled-back\r?$/m.test(result.stdout)
        if (!rolledBack && !/^HROMADAAID_RECOVERY_OUTCOME\|finalized\r?$/m.test(result.stdout)) throw new Error('Результат recovery пакета не підтверджено.')
        const final = await inspectWithUpdateReadiness()
        if (final.installation.status !== 'installed' || final.service.status !== 'running' || final.api.status !== 'available' || !final.updateReadiness?.ready) throw new Error('Файлову операцію виконано, але службу, API або завершення транзакції не підтверджено. Перевірте діагностику.')
        return { success: true, message: rolledBack ? 'Попередній серверний пакет повернуто. Служба працює, API доступний.' : 'Активований пакет перевірено. Оновлення завершено, API доступний.' }
      }
      if (status.update.pending) throw new Error('Спочатку потрібна перевірка незавершеної транзакції серверного пакета; SQLite не змінено.')
      if (kind === 'resume-restore' ? !status.restore.pending : !status.restore.canReturn) throw new Error(status.restore.reason || 'Безпечну дію відновлення не підтверджено.')
      const paths = await restorePaths(snapshot, true)
      progress('Штатна зупинка Windows Service перед офлайн-відновленням.')
      const stopped = await controlWindowsService('stop')
      if (!stopped.success) throw new Error('Зупинку служби не підтверджено. Базу не змінено. ' + stopped.message)
      progress(kind === 'resume-restore' ? 'Продовження наявного restore journal та перевірка SQLite.' : 'Повторна перевірка незмінності даних і повернення попередньої бази зі страховою копією.')
      const result = await runRestoreCli([paths.node, paths.cli, '--database', paths.database, '--backup-dir', paths.backups, kind === 'resume-restore' ? '--resume' : '--return-previous', '--manager-confirmed'])
      if (result.code !== 0) throw new Error('Офлайн-відновлення не завершено. Службу залишено зупиненою; копії та журнал збережено. ' + (result.stderr || result.stdout).slice(-2500))
      await startAndConfirmRestoredServer(paths, (_stage, message) => progress(message))
      return { success: true, message: kind === 'resume-restore' ? 'Незавершене відновлення завершено. SQLite перевірено, API доступний.' : 'Попередню базу повернуто й перевірено. API доступний; усім користувачам потрібно ввійти повторно.' }
    })
  })
  ipcMain.handle('manager:backup-login', async (event, input: unknown) => {
    if (!isTrustedRenderer(event) || !input || typeof input !== 'object') throw new Error('UNTRUSTED_RENDERER')
    const { username, password } = input as Record<string, unknown>
    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password || password.length > 256) throw new Error('Вкажіть логін і пароль адміністратора.')
    const snapshot = await inspectEnvironment(createWindowsInspectionAdapters())
    const origin = snapshot.configuration.apiAddress
    if (!origin) throw new Error('Спочатку завершіть налаштування сервера та перевірте його адресу API.')
    const response = await fetch(new URL('/auth/login', origin), { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ username, password }), signal: AbortSignal.timeout(15_000) })
    const result: unknown = await response.json().catch(() => null)
    if (!response.ok || !isManagerLoginResult(result)) throw new Error(response.status === 401 ? 'Неправильний логін або пароль.' : (result as { message?: string } | null)?.message || 'Не вдалося увійти до сервера.')
    if (!result.user.permissions.includes('backups.manage') || result.user.mustChangePassword) throw new Error(result.user.mustChangePassword ? 'Спочатку змініть пароль у HromadaAID Client, потім увійдіть повторно.' : 'Обліковий запис не має права керувати резервними копіями.')
    backupSession = { origin, token: result.token, user: { username: result.user.username, displayName: result.user.displayName } }
    return backupSession.user
  })
  ipcMain.handle('manager:backup-logout', async event => { if (!isTrustedRenderer(event)) throw new Error('UNTRUSTED_RENDERER'); try { if (backupSession) await backupRequest('/auth/logout', 'POST', {}) } finally { backupSession = null }; return true })
  ipcMain.handle('manager:backup-session', event => { if (!isTrustedRenderer(event)) throw new Error('UNTRUSTED_RENDERER'); return backupSession?.user ?? null })
  ipcMain.handle('manager:backup-list', async event => { if (!isTrustedRenderer(event)) throw new Error('UNTRUSTED_RENDERER'); requireBackupSession(); return getBackupList() })
  ipcMain.handle('manager:backup-create', async event => {
    if (!isTrustedRenderer(event)) throw new Error('UNTRUSTED_RENDERER')
    return runBackupOperation(async () => { await backupRequest('/api/backups/server', 'POST', {}); return await getBackupList() })
  })
  ipcMain.handle('manager:backup-export', async (event, id: unknown) => {
    if (!isTrustedRenderer(event) || typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw new Error('UNTRUSTED_RENDERER')
    const item = (await getBackupList()).archives.find(archive => archive.id === id)
    if (!item) throw new Error('Архів більше недоступний. Оновіть перелік.')
    const selected = await dialog.showSaveDialog(window!, { title: 'Експортувати резервний архів', defaultPath: item.fileName, filters: [{ name: 'Резервний архів HromadaAID', extensions: ['hraid'] }] })
    if (selected.canceled || !selected.filePath) return { canceled: true }
    if (!selected.filePath.toLowerCase().endsWith('.hraid')) throw new Error('Файл експорту має мати розширення .hraid.')
    const response = await backupRequest(`/api/backups/server/${id}/download`)
    if (!response.body) throw new Error('Сервер не передав архів.')
    const partial = `${selected.filePath}.${randomUUID()}.partial`, hash = createHash('sha256')
    try {
      await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), new Transform({ transform(chunk, _encoding, callback) { hash.update(chunk); callback(null, chunk) } }), createWriteStream(partial, { flags: 'wx' }), { signal: AbortSignal.timeout(300_000) })
      if (hash.digest('hex') !== item.sha256 || (await stat(partial)).size !== item.size) throw new Error('Перевірка цілісності експортованого архіву не пройшла.')
      await rename(partial, selected.filePath)
      return { canceled: false, message: 'Резервний архів експортовано.' }
    } catch (error) { await rm(partial, { force: true }).catch(() => undefined); throw error }
  })
  ipcMain.handle('manager:backup-import', async (event, recoveryKey: unknown) => {
    if (!isTrustedRenderer(event) || (recoveryKey !== undefined && (typeof recoveryKey !== 'string' || recoveryKey.length > 512))) throw new Error('UNTRUSTED_RENDERER')
    return runBackupOperation(async () => {
    const picked = await dialog.showOpenDialog(window!, { title: 'Імпортувати архів .hraid', properties: ['openFile'], filters: [{ name: 'Резервний архів HromadaAID', extensions: ['hraid'] }] })
    if (picked.canceled || !picked.filePaths[0]) return null
    const snapshot = await inspectEnvironment(createWindowsInspectionAdapters())
    const verified = await verifyArchive(snapshot, picked.filePaths[0], recoveryKey as string | undefined)
    const id = randomUUID(); importedArchives.set(id, picked.filePaths[0])
    return { id, fileName: picked.filePaths[0].split(/[\\/]/).pop(), ...verified }
    })
  })
  ipcMain.handle('manager:backup-verify', async (event, id: unknown, recoveryKey: unknown) => {
    if (!isTrustedRenderer(event) || typeof id !== 'string' || (recoveryKey !== undefined && typeof recoveryKey !== 'string')) throw new Error('UNTRUSTED_RENDERER')
    return runBackupOperation(async () => {
    const snapshot = await inspectEnvironment(createWindowsInspectionAdapters())
    const imported = importedArchives.get(id)
    if (!imported) requireBackupSession()
    let archive = imported
    if (!archive && /^[a-f0-9]{64}$/.test(id)) {
      const item = (await getBackupList()).archives.find(entry => entry.id === id)
      if (!item || !snapshot.configuration.backupDirectory) throw new Error('Архів не знайдено. Оновіть перелік.')
      archive = join(snapshot.configuration.backupDirectory, item.fileName)
    }
    if (!archive) throw new Error('Виберіть архів для перевірки.')
    return verifyArchive(snapshot, archive, recoveryKey as string | undefined)
    })
  })
  ipcMain.handle('manager:backup-open-folder', async event => {
    if (!isTrustedRenderer(event)) throw new Error('UNTRUSTED_RENDERER')
    const snapshot = await inspectEnvironment(createWindowsInspectionAdapters()), path = snapshot.configuration.backupDirectory
    if (!path) throw new Error('Каталог резервних копій не визначено.')
    const { shell } = await import('electron')
    const error = await shell.openPath(path)
    if (error) throw new Error('Не вдалося відкрити каталог резервних копій.')
    return true
  })
  ipcMain.handle('manager:backup-restore', async (event, request: unknown) => {
    if (!isTrustedRenderer(event) || !request || typeof request !== 'object') throw new Error('UNTRUSTED_RENDERER')
    const value = request as Record<string, unknown>
    if (value.confirmed !== true || typeof value.id !== 'string' || (value.recoveryKey !== undefined && typeof value.recoveryKey !== 'string')) throw new Error('Потрібне явне підтвердження відновлення.')
    const archiveId = value.id
    return runBackupOperation(async () => {
      const sendStage = (stage: string, message: string) => { if (window && !window.isDestroyed() && isTrustedRenderer(event)) window.webContents.send('manager:backup-progress', { stage, message }) }
      const snapshot = await inspectEnvironment(createWindowsInspectionAdapters()), paths = await restorePaths(snapshot)
      const pending = await recoveryStatus()
      if (pending.restore.pending || pending.update.pending) throw new Error('Спочатку завершіть незавершену системну транзакцію. Нове відновлення не починалося.')
      const imported = importedArchives.get(archiveId)
      if (!imported) requireBackupSession()
      let archive = imported
      if (!archive && /^[a-f0-9]{64}$/.test(archiveId)) {
        const item = (await getBackupList()).archives.find(entry => entry.id === archiveId)
        if (!item || !snapshot.configuration.backupDirectory) throw new Error('Архів не знайдено на сервері. Оновіть перелік.')
        archive = join(snapshot.configuration.backupDirectory, item.fileName)
      }
      if (!archive) throw new Error('Виберіть і перевірте архів перед відновленням.')
      sendStage('verify', 'Перевірка архіву та сумісності SQLite.')
      await verifyArchive(snapshot, archive, value.recoveryKey as string | undefined)
      sendStage('confirm', 'Підготовка відновлення та страхової копії.')
      sendStage('stop', 'Штатна зупинка Windows Service.')
      const stopped = await controlWindowsService('stop')
      if (!stopped.success) throw new Error(`Не вдалося безпечно зупинити службу: ${stopped.message}`)
      sendStage('restore', 'Відновлення перевіреної бази через серверний SQLite restore engine.')
      const args = [paths.node, paths.cli, '--database', paths.database, '--backup-dir', paths.backups, '--archive', archive, '--manager-confirmed', ...(value.recoveryKey ? ['--recovery-key'] : [])]
      const restored = await runRestoreCli(args, value.recoveryKey ? `${String(value.recoveryKey).trim()}\n` : undefined)
      if (restored.code !== 0) throw new Error(`Відновлення не завершилося. Службу залишено зупиненою для безпеки. ${restored.stderr.trim() || restored.stdout.trim()}`)
      await startAndConfirmRestoredServer(paths, sendStage)
      if (imported) importedArchives.delete(archiveId)
      sendStage('complete', 'Відновлення завершено; API відповідає.')
      return { success: true, message: 'Базу даних відновлено, перевірено та запущено.' }
    })
  })
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
    () => recoveryInspectionInProgress || activeInstallId !== null || serviceOperationInProgress || updatePreparationInProgress || activeUpdateId !== null || preparedServerUpdate !== null || backupOperationInProgress,
    randomUUID,
    failedInspection,
  )
  ipcMain.handle('manager:control-service', (event, operation: unknown) => serviceControlRequest(event, operation))
  ipcMain.handle('manager:select-server-update-package', async event => {
    if (!isTrustedRenderer(event)) throw new Error('UNTRUSTED_RENDERER')
    if (recoveryInspectionInProgress || activeInstallId || serviceOperationInProgress || updatePreparationInProgress || activeUpdateId || backupOperationInProgress) return { preview: null, code: 'OPERATION_BUSY', error: 'Зараз виконується інша системна операція.' }
    const selection = await dialog.showOpenDialog(window!, { title: 'Виберіть ZIP-пакет HromadaAID Server', properties: ['openFile'], filters: [{ name: 'ZIP-пакет сервера', extensions: ['zip'] }] })
    if (selection.canceled || !selection.filePaths[0]) return { preview: null }
    if (recoveryInspectionInProgress || activeInstallId || serviceOperationInProgress || updatePreparationInProgress || activeUpdateId || backupOperationInProgress) return { preview: null, code: 'OPERATION_BUSY', error: 'Зараз виконується інша системна операція.' }
    updatePreparationInProgress = true
    try {
      const adapters = updateAdapters()
      const prepared = await prepareServerUpdate(selection.filePaths[0], adapters)
      if (preparedServerUpdate) await adapters.cleanup(preparedServerUpdate.cleanupRoot)
      preparedServerUpdate = prepared
      return { preview: prepared.preview }
    } catch (error) {
      const failure = error as Error & { code?: string }
      const message = failure.code === 'ZIP_EXTRACTION_FAILED'
        ? 'Не вдалося перевірити або безпечно розпакувати ZIP-пакет. Перевірте архів і повторіть спробу.'
        : failure.message || 'Не вдалося перевірити пакет сервера.'
      return { preview: null, code: failure.code ?? 'UPDATE_VALIDATION_FAILED', error: message, details: (error as Error & { details?: string }).details }
    } finally { updatePreparationInProgress = false }
  })
  ipcMain.handle('manager:cancel-server-update-preview', async (event, previewId: unknown) => {
    if (!isTrustedRenderer(event) || typeof previewId !== 'string' || preparedServerUpdate?.preview.id !== previewId || activeUpdateId) return false
    const current = preparedServerUpdate
    preparedServerUpdate = null
    await updateAdapters().cleanup(current.cleanupRoot).catch(() => undefined)
    return true
  })
  ipcMain.handle('manager:apply-server-update', async (event, previewId: unknown) => {
    if (!isTrustedRenderer(event)) throw new Error('UNTRUSTED_RENDERER')
    if (typeof previewId !== 'string' || !preparedServerUpdate || preparedServerUpdate.preview.id !== previewId) return { operationId: randomUUID(), success: false, rolledBack: false, manualRecoveryRequired: false, message: 'Перевірений пакет уже недоступний. Виберіть ZIP повторно.' }
    if (recoveryInspectionInProgress || activeInstallId || serviceOperationInProgress || updatePreparationInProgress || activeUpdateId || backupOperationInProgress) return { operationId: randomUUID(), success: false, rolledBack: false, manualRecoveryRequired: false, message: 'Зараз виконується інша системна операція.' }
    const prepared = preparedServerUpdate
    const operationId = randomUUID()
    activeUpdateId = operationId
    const send = (update: import('./server-update.js').ServerUpdateProgress) => { if (window && !window.isDestroyed() && isTrustedRenderer(event)) window.webContents.send('manager:server-update-progress', update) }
    try {
      return await applyServerUpdate(prepared, updateAdapters(), operationId, send)
    } finally {
      preparedServerUpdate = null
      activeUpdateId = null
    }
  })
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
    if (recoveryInspectionInProgress || activeInstallId || serviceOperationInProgress || updatePreparationInProgress || activeUpdateId || preparedServerUpdate || backupOperationInProgress) throw new Error('INSTALLATION_ALREADY_RUNNING')
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
  app.on('window-all-closed', () => {
    if (preparedServerUpdate) { void updateAdapters().cleanup(preparedServerUpdate.cleanupRoot); preparedServerUpdate = null }
    app.quit()
  })
}
