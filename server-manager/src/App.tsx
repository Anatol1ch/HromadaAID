import { Fragment, useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Activity, ArrowRight, ChevronRight, CircleAlert, CircleCheck, Clock3, Cog, Download, FileText, Folder, HardDrive, House, Info, LoaderCircle, Package, Play, RefreshCw, RotateCw, Server, Settings2, ShieldCheck, Square, Wifi } from 'lucide-react'
import Alert from '../../src/components/Alert'
import { DEMO_CHECKED_AT, demoPaths, scenarioIds, scenarios, sections, type ScenarioId, type Section } from './demo'
import type { InspectionDiagnostic, InspectionSnapshot } from '../electron/inspection-types'
import type { ServiceControlOperation } from '../electron/service-control'
import type { ServerUpdatePreview, ServerUpdateProgress, ServerUpdateResult } from '../electron/server-update-contract'
import type { ReleaseUpdateState, ServerReleaseState } from '../electron/server-update-contract'
import InstallWizard from './InstallWizard'
import ServerAddresses from './ServerAddresses'
import { apiDisplay, diagnosticLevel, initialSetupAction, inspectionFeedback, installationDisplay, notCheckedState, serviceDisplay, type PresentationTone } from './inspection-presentation'
import managerIcon from '../../assets/hromadaaid-server-manager.svg'
import BackupManagement from './BackupManagement'
import UpdateManagement from './UpdateManagement'
import { ReleaseUpdateDetails, ReleaseUpdateProgress } from '../../src/components/ReleaseUpdateDetails'
import RecoveryManagement from './RecoveryManagement'
import { IconButton, Modal, StatusBadge as Status, Toast } from './ManagerUI'

const navIcons = { overview: House, configuration: Settings2, diagnostics: Activity, backups: HardDrive, updates: Download }
const headings = {
  overview: ['Стан сервера', 'Поточний стан служби Windows, доступність API та основна інформація.'],
  configuration: ['Конфігурація', 'Каталоги та параметри серверного середовища.'],
  diagnostics: ['Діагностика', 'Результати перевірки та безпечні технічні відомості.'],
  backups: ['Резервне копіювання', 'Створення, перевірка та відновлення резервних копій сервера.'],
  updates: ['Оновлення сервера', 'Версії, сумісність і кероване оновлення серверного пакета.'],
} as const

function Panel({ title, icon, children, action, example = false }: { title: string; icon: ReactNode; children: ReactNode; action?: ReactNode; example?: boolean }) {
  return <section className="dashboard-panel sm-panel">
    <header className="sm-panel-header"><h2>{icon}<span>{title}{example && <small> (приклад)</small>}</span></h2>{action}</header>
    {children}
  </section>
}


function discoverySourceLabel(source: string): string {
  return source === 'windows_service' ? 'Windows Service і WinSW' : source === 'installer_registry' ? 'метадані інсталятора в HKLM' : source === 'standard_locations' ? 'стандартні каталоги Windows' : source === 'none' ? 'джерело відсутнє' : 'не визначено'
}
function discoveryConfidenceLabel(confidence: string): string {
  return confidence === 'confirmed' ? 'підтверджено' : confidence === 'corroborated' ? 'підтверджено компонентами' : confidence === 'stale' ? 'застарілі метадані' : confidence === 'untrusted' ? 'недовірені метадані' : 'перевірка недоступна'
}

type DemoEvent = { id: string; time: string; title: string; detail: string; level: string; code: string; diagnostics?: InspectionDiagnostic[] }
function EventTable({ events, compact = false, caption = 'Демонстраційні діагностичні події' }: { events: DemoEvent[]; compact?: boolean; caption?: string }) {
  const tableId = useId()
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  return <div className="sm-table-wrap"><table className="sm-events">
    <caption className="visually-hidden">{caption}</caption>
    <thead><tr><th scope="col">Час</th><th scope="col">Рівень</th><th scope="col">Подія</th><th scope="col">Деталі</th></tr></thead>
    <tbody>{events.map((event, index) => {
      const key = `${event.id}-${index}`
      const isExpanded = expanded.has(key)
      const detailId = `${tableId}-details-${index}`
      const toggleId = `${tableId}-toggle-${index}`
      return <Fragment key={key}>
        <tr key={`${key}-row`}>
          <td><time>{event.time}</time></td>
          <td><Status tone={event.level === 'success' || event.level === 'warning' || event.level === 'error' ? event.level : 'info'}>{event.level === 'error' ? 'Помилка' : event.level === 'success' ? 'Успіх' : event.level === 'warning' ? 'Увага' : 'Інформація'}</Status></td>
          <td>{event.title}</td>
          <td><span className="sm-event-message" title={event.detail}>{event.detail}</span>{!compact && <IconButton label={isExpanded ? 'Сховати технічні подробиці' : 'Технічні подробиці'} id={toggleId} aria-expanded={isExpanded} aria-controls={detailId} onClick={() => setExpanded(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next })}><ChevronRight size={16} className={isExpanded ? 'sm-chevron-open' : undefined}/></IconButton>}</td>
        </tr>
        {!compact && <tr hidden={!isExpanded} key={`${key}-details`} className="sm-event-details-row"><td colSpan={4}><dl id={detailId} aria-labelledby={toggleId} className="sm-event-details"><div><dt>Повідомлення</dt><dd>{event.detail}</dd></div><div><dt>Код</dt><dd>{event.code}</dd></div><div><dt>Ідентифікатор</dt><dd>{event.id}</dd></div>{event.diagnostics?.map((item, diagnosticIndex) => <Fragment key={diagnosticIndex}><div><dt>Операція</dt><dd>{item.operation}</dd></div><div><dt>Об’єкт</dt><dd>{item.target}</dd></div><div><dt>Системний код</dt><dd>{item.code}</dd></div><div><dt>Пояснення</dt><dd>{item.message}</dd></div></Fragment>)}</dl></td></tr>}
      </Fragment>
    })}{events.length === 0 && <tr><td colSpan={4} className="sm-empty">Результатів перевірки ще немає.</td></tr>}</tbody>
  </table></div>
}

function RealContent({ section, inspection, checking, serviceOperation, controlService, refresh, filter, setFilter, startInstall, updatePreview, updateBusy, updateProgress, updateResult, lastUpdateResult, updateError, updateErrorDetails, chooseUpdate, cancelUpdate, applyUpdate, backupBusy, managerRelease, serverRelease, checkingReleases, checkReleases, downloadManager, installManager, downloadServer }: { section: Section; inspection: InspectionSnapshot | null; checking: boolean; serviceOperation: ServiceControlOperation | null; controlService: (operation: ServiceControlOperation) => void; refresh: () => void; filter: 'all' | 'issues'; setFilter: (value: 'all' | 'issues') => void; startInstall: () => void; updatePreview: ServerUpdatePreview | null; updateBusy: boolean; updateProgress: ServerUpdateProgress | null; updateResult: ServerUpdateResult | null; lastUpdateResult: ServerUpdateResult | null; updateError: string; updateErrorDetails: string; chooseUpdate: () => void; cancelUpdate: () => void; applyUpdate: () => void; backupBusy: boolean; managerRelease: ReleaseUpdateState | null; serverRelease: ServerReleaseState | null; checkingReleases: boolean; checkReleases: () => void; downloadManager: () => void; installManager: () => void; downloadServer: () => void }) {
  const snapshot = inspection
  const pending = notCheckedState(checking)
  const install = snapshot ? installationDisplay(snapshot.installation.status) : pending
  const service = snapshot ? serviceDisplay(snapshot.service.status) : pending
  const api = snapshot ? apiDisplay(snapshot.api.status) : pending
  const checks = snapshot?.checks ?? []
  const events: DemoEvent[] = checks.map(item => ({
    id: item.id,
    time: new Date(item.checkedAt).toLocaleString('uk-UA'),
    title: item.title,
    detail: item.message,
    level: diagnosticLevel(item, snapshot?.installation.status ?? null),
    code: item.details ?? item.status,
    diagnostics: item.diagnostics,
  }))
  const notInstalled = snapshot?.installation.status === 'not_installed'
  const initialSetupLabel = initialSetupAction(snapshot)
  const reasonFor = (checkId: string) => snapshot?.checks.find(item => item.id === checkId)?.message ?? 'Причину не надано окремою перевіркою.'
  const value = (item: string | null | undefined, checkId = 'configuration') => item ?? <span className="sm-unavailable-value"><span>Не визначено</span>{snapshot && !notInstalled && <details><summary>Причина</summary><span>{reasonFor(checkId)}</span></details>}</span>
  const config = snapshot?.configuration
  const fullyReady = snapshot?.installation.status === 'installed' && snapshot.service.status === 'running' && snapshot.api.status === 'available'
  const directoryRows = [
    ['Каталог програми', config?.programDirectory ?? null, 'service'],
    ['Каталог серверних даних', config?.dataDirectory ?? null, 'configuration'],
    ['Каталог резервних копій', config?.backupDirectory ?? null, 'configuration'],
  ] as const
  const settings = [
    ['Порт', config?.port === null || config?.port === undefined ? null : String(config.port), 'configuration'],
    ['Транспорт', config?.transport ?? null, 'configuration'], ['Файл SQLite', config?.databasePath ?? null, 'configuration'], ['Журнали WinSW', config?.logDirectory ?? null, 'service'],
    ['Обліковий запис служби', config?.serviceAccount ?? null, 'service'], ['Тип запуску', config?.startMode ?? null, 'service'],
  ] as const
  const overall = serviceOperation ? { label: serviceOperation === 'start' ? 'Запускається' : serviceOperation === 'stop' ? 'Зупиняється' : 'Перезапускається', tone: 'warning' }
    : !snapshot ? pending
      : fullyReady ? { label: 'Працює', tone: 'success' }
        : snapshot.installation.status !== 'installed' ? installationDisplay(snapshot.installation.status)
        : snapshot.service.status === 'running' ? { label: 'API недоступний', tone: 'error' }
          : snapshot.service.status === 'stopped' ? { label: 'Зупинено', tone: 'warning' }
            : installationDisplay(snapshot.installation.status)
  const statusHeading = !snapshot ? (checking ? 'Перевіряється середовище Windows…' : 'Стан сервера ще не перевірено')
    : serviceOperation === 'start' ? 'Запускається'
      : serviceOperation === 'stop' ? 'Зупиняється'
        : serviceOperation === 'restart' ? 'Перезапускається'
          : fullyReady ? 'Сервер працює'
            : snapshot.installation.status !== 'installed' ? snapshot.installation.message
            : snapshot.service.status === 'running' ? 'Служба працює, але API недоступний'
              : snapshot.service.status === 'stopped' ? 'Сервер зупинено'
                : snapshot.installation.message
  const statusExplanation = !snapshot
    ? 'Натисніть «Перевірити зараз», щоб отримати актуальні відомості про службу, конфігурацію та доступність API.'
    : serviceOperation ? 'Очікуємо підтвердження від Windows Service Control Manager, після чого перевіримо health endpoint.'
      : snapshot.installation.status !== 'installed' ? snapshot.api.message
        : snapshot.service.status === 'running' && snapshot.api.status !== 'available' ? `${snapshot.service.message} ${snapshot.api.message}`
        : snapshot.service.status === 'running' && snapshot.api.status === 'available' ? 'Сервер готовий до підключення користувачів HromadaAID.' : snapshot.service.status === 'stopped' ? 'Запустіть сервер, щоб користувачі могли підключитися до HromadaAID.' : snapshot.installation.message
  const serviceCanControl = snapshot?.installation.status === 'installed' && (snapshot.service.status === 'running' || snapshot.service.status === 'stopped')
  const serviceState = serviceOperation === 'start' ? { label: 'Запускається', tone: 'warning' }
    : serviceOperation === 'stop' ? { label: 'Зупиняється', tone: 'warning' }
      : serviceOperation === 'restart' ? { label: 'Перезапускається', tone: 'warning' }
        : service


  if (section === 'overview') return <>
    {initialSetupLabel && <section className="dashboard-panel sm-setup-callout"><span className="sm-card-icon"><Server size={27}/></span><div><h2>{snapshot?.installation.status === 'ready_to_configure' ? 'Сервер готовий до налаштування' : 'Налаштуйте сервер HromadaAID'}</h2><p>Завершіть початкове налаштування, щоб користувачі могли підключитися.</p></div><button className="primary-button" type="button" onClick={startInstall} disabled={checking || updateBusy || backupBusy || Boolean(serviceOperation)}><Settings2 size={17}/>{initialSetupLabel}</button></section>}
    <section className="sm-health-summary" aria-label="Стан серверних компонентів">
      {!initialSetupLabel && <div className={`sm-scenario-notice sm-scenario-${overall.tone}`}><h2 id="real-state-title">{statusHeading}</h2><p>{statusExplanation}</p></div>}
      <div className="sm-state-grid">
        <div className="sm-state-card"><span className="sm-card-icon">{serviceOperation ? <LoaderCircle className="sm-service-spinner" size={25} aria-hidden="true"/> : <Cog size={25} aria-hidden="true"/>}</span><div className="sm-state-content"><h3>Служба Windows</h3><Status tone={serviceState.tone} plain>{serviceState.label}</Status><p aria-live="polite">{serviceOperation ? 'Очікується штатний перехід стану через Windows.' : snapshot?.service.message ?? 'Очікується перевірка диспетчера служб.'}</p></div></div>
        <div className="sm-state-card"><span className="sm-card-icon"><Wifi size={25} aria-hidden="true"/></span><div className="sm-state-content"><h3>Доступність API</h3><Status tone={api.tone} plain>{api.label}</Status><p>{snapshot?.configuration.apiAddress ?? 'Адресу не визначено'}</p>{snapshot?.api.status !== 'available' && <p>{snapshot?.api.message ?? 'Health-check ще не виконувався.'}</p>}</div></div>
        <div className="sm-state-card"><span className="sm-card-icon"><Package size={25} aria-hidden="true"/></span><div className="sm-state-content"><h3>Серверний пакет</h3><strong>{config?.serverVersion ?? 'Не визначено'}</strong><p>{snapshot?.installation.status === 'installed' ? 'Версія встановленого серверного компонента.' : 'Фактичну версію пакета не підтверджено.'}</p></div></div>
      </div>
      {serviceCanControl && <div className="sm-service-toolbar"><div><strong>Керування сервером</strong><p>Під час зупинки чи перезапуску підключення користувачів тимчасово перериваються.</p></div><div className="sm-service-actions" aria-label="Керування сервером">{snapshot.service.status === 'stopped' ? <button className="primary-button" type="button" disabled={Boolean(serviceOperation) || checking || updateBusy || backupBusy || Boolean(updatePreview)} onClick={() => controlService('start')}><Play size={15} aria-hidden="true"/>Запустити сервер</button> : <><button className="secondary-button" type="button" disabled={Boolean(serviceOperation) || checking || updateBusy || backupBusy || Boolean(updatePreview)} onClick={() => controlService('stop')}><Square size={14} aria-hidden="true"/>Зупинити сервер</button><button className="secondary-button" type="button" disabled={Boolean(serviceOperation) || checking || updateBusy || backupBusy || Boolean(updatePreview)} onClick={() => controlService('restart')}><RotateCw size={15} aria-hidden="true"/>Перезапустити</button></>}</div></div>}
      <div className="sm-health-footer"><span><Clock3 size={16} aria-hidden="true"/>Остання перевірка: {snapshot ? new Date(snapshot.checkedAt).toLocaleString('uk-UA') : 'Не виконувалась'}</span><Status tone={overall.tone}>{install.label}</Status></div>
    </section>
    <ServerAddresses addresses={snapshot?.networkAddresses}/>
    <details className="dashboard-panel sm-disclosure"><summary>Технічні відомості та останні перевірки</summary><dl className="sm-details sm-summary-rows">{([['Адреса API', config?.apiAddress ?? null], ['API Contract', snapshot?.api.contractVersion?.toString() ?? null], ...directoryRows.map(([label, path]) => [label, path] as const)] as const).map(([label, item]) => <div key={label}><dt>{label}</dt><dd>{item ?? 'Не визначено'}</dd></div>)}</dl><EventTable events={events} caption="Останні результати перевірки серверного середовища"/></details>

  </>

  if (section === 'configuration') return <>
    {(notInstalled || !snapshot) && <Alert variant="info">{notInstalled ? 'Конфігурацію сервера не знайдено. Параметри стануть доступними після встановлення та налаштування серверної служби.' : 'Конфігурацію сервера ще не перевірено. Запустіть перевірку, щоб отримати фактичні параметри.'}</Alert>}
    <details className="sm-discovery-summary"><summary>Джерело параметрів</summary><span>Джерело: {discoverySourceLabel(snapshot?.discovery.source ?? 'unknown')}</span><span>Достовірність: {discoveryConfidenceLabel(snapshot?.discovery.confidence ?? 'unavailable')}</span><p>{snapshot?.discovery.message ?? 'Джерело інсталяції ще не перевірено.'}</p></details>
    <Panel title="Виявлені каталоги" icon={<Folder size={21} aria-hidden="true"/>} action={<span className="sm-readonly-label">Лише читання</span>}><dl className="sm-directory-list">{directoryRows.map(([label, path, owner]) => <div key={label}><span className="sm-card-icon"><Folder size={21} aria-hidden="true"/></span><div><dt>{label}</dt></div><dd>{value(path, owner)}</dd></div>)}</dl></Panel>
    <Panel title="Параметри сервера" icon={<Settings2 size={21} aria-hidden="true"/>} action={<span className="sm-readonly-label">Лише читання</span>}><dl className="sm-details sm-setting-rows">{settings.map(([label, item, owner]) => <div key={label}><dt>{label}</dt><dd>{value(item, owner)}</dd></div>)}</dl></Panel>
  </>

  if (section === 'diagnostics') return <>
    <Panel title="Остання перевірка середовища" icon={<Activity size={21} aria-hidden="true"/>} action={<Status tone={overall.tone}>{install.label}</Status>}>
      <p className="sm-operation-message"><Info size={19} aria-hidden="true"/>{snapshot?.installation.message ?? 'Очікується запуск перевірки.'}</p>
      <dl className="sm-details sm-operation-grid"><div><dt>Час</dt><dd>{snapshot ? new Date(snapshot.checkedAt).toLocaleString('uk-UA') : 'Не перевірено'}</dd></div><div><dt>Служба</dt><dd>{snapshot?.configuration.serviceName ?? 'HromadaAIDApi'}</dd></div><div><dt>Обліковий запис</dt><dd>{value(config?.serviceAccount, 'service')}</dd></div><div><dt>Версія сервера</dt><dd>{value(config?.serverVersion, 'package')}</dd></div></dl>
      <div className="sm-future-action"><button className="primary-button" type="button" onClick={refresh} disabled={checking || updateBusy || backupBusy || Boolean(serviceOperation)} aria-busy={checking}><RefreshCw size={16} aria-hidden="true"/>{checking ? 'Перевірка…' : 'Запустити перевірку'}</button><span>Лише читання; системні налаштування не змінюються.</span></div>
    </Panel>
    <Panel title="Структуровані результати" icon={<Clock3 size={21} aria-hidden="true"/>} action={<label className="sm-filter">Показати<select value={filter} onChange={event => setFilter(event.target.value as 'all' | 'issues')}><option value="all">Усі перевірки</option><option value="issues">Проблеми й застереження</option></select></label>}><EventTable events={events.filter(event => filter === 'all' || event.level === 'error' || event.level === 'warning')} caption="Структуровані результати перевірок Windows та API"/></Panel>
  </>

  return <UpdateManagement inspection={inspection} preview={updatePreview} busy={updateBusy} progress={updateProgress} result={updateResult} lastResult={lastUpdateResult} error={updateError} errorDetails={updateErrorDetails} disabled={checking || backupBusy || Boolean(serviceOperation)} choose={chooseUpdate} cancel={cancelUpdate} apply={applyUpdate} refresh={refresh} managerUpdate={managerRelease} serverUpdate={serverRelease} checkingReleases={checkingReleases} checkReleases={checkReleases} downloadManager={downloadManager} installManager={installManager} downloadServer={downloadServer}/>

}

export default function App() {
  const [section, setSection] = useState<Section>('overview')
  const [mode, setMode] = useState<'real' | 'demo'>('real')
  const [scenarioId, setScenarioId] = useState<ScenarioId>('running')
  const [checkedAt, setCheckedAt] = useState(DEMO_CHECKED_AT)
  const [inspection, setInspection] = useState<InspectionSnapshot | null>(null)
  const [checking, setChecking] = useState(false)
  const [serviceOperation, setServiceOperation] = useState<ServiceControlOperation | null>(null)
  const [serviceConfirmation, setServiceConfirmation] = useState<'stop' | 'restart' | null>(null)
  const [updatePreview, setUpdatePreview] = useState<ServerUpdatePreview | null>(null)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [backupBusy, setBackupBusy] = useState(false)
  const [updateProgress, setUpdateProgress] = useState<ServerUpdateProgress | null>(null)
  const [updateResult, setUpdateResult] = useState<ServerUpdateResult | null>(null)
  const [lastUpdateResult, setLastUpdateResult] = useState<ServerUpdateResult | null>(null)
  const [updateError, setUpdateError] = useState('')
  const [updateErrorDetails, setUpdateErrorDetails] = useState('')
  const [managerRelease, setManagerRelease] = useState<ReleaseUpdateState | null>(null)
  const [serverRelease, setServerRelease] = useState<ServerReleaseState | null>(null)
  const [checkingReleases, setCheckingReleases] = useState(false)
  const [emergencyMode, setEmergencyMode] = useState(false)
  const [managerConfirm, setManagerConfirm] = useState(false)
  const [filter, setFilter] = useState<'all' | 'issues'>('all')
  const [notice, setNotice] = useState('')
  const [noticeTone, setNoticeTone] = useState<PresentationTone>('info')
  const [installWizard, setInstallWizard] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const inspectionInFlight = useRef(false)
  const serviceOperationInFlight = useRef(false)
  const updateOperationInFlight = useRef(false)
  const backupOperationInFlight = useRef(false)
  const notifiedServerRelease = useRef('')
  const previousSection = useRef(section)
  const scenario = scenarios[scenarioId]
  const operation = scenario.operation
  const isDevelopment = import.meta.env.DEV
  const acceptInspection = useCallback((result: InspectionSnapshot) => {
    setInspection(result)
    setNotice('')
  }, [])
  const inspectReal = useCallback(async (manual = false) => {
    if (inspectionInFlight.current || serviceOperationInFlight.current || updateOperationInFlight.current || backupOperationInFlight.current) return
    inspectionInFlight.current = true
    setChecking(true)
    if (manual) { setNotice('Перевіряємо службу та доступність API…'); setNoticeTone('info') }
    try {
      const result = await window.hromadaManager.inspectEnvironment()
      acceptInspection(result)
      if (manual) { const feedback = inspectionFeedback(result); setNotice(feedback.message); setNoticeTone(feedback.tone) }
    } catch {
      setInspection(null)
      setNoticeTone('error')
      setNotice('Не вдалося запустити перевірку Server Manager. Перезапустіть програму та повторіть спробу.')
    } finally { inspectionInFlight.current = false; setChecking(false) }
  }, [acceptInspection])
  const controlService = useCallback(async (operation: ServiceControlOperation) => {
    if (serviceOperationInFlight.current || updateOperationInFlight.current || backupOperationInFlight.current || updatePreview) return
    serviceOperationInFlight.current = true
    setServiceOperation(operation)
    setNotice('')
    setNoticeTone('info')
    try {
      const result = await window.hromadaManager.controlService(operation)
      acceptInspection(result.inspection)
      setNoticeTone(result.success ? 'success' : 'error')
      setNotice(result.message)
    } catch {
      setNoticeTone('error')
      setNotice('Не вдалося завершити дію зі службою. Перевірте стан сервера та права адміністратора, потім повторіть перевірку.')
    } finally {
      serviceOperationInFlight.current = false
      setServiceOperation(null)
    }
  }, [updatePreview, acceptInspection])
  const chooseUpdate = useCallback(async () => {
    if (updateOperationInFlight.current || serviceOperationInFlight.current || backupOperationInFlight.current) return
    updateOperationInFlight.current = true
    setUpdateBusy(true)
    setUpdateError(''); setUpdateErrorDetails(''); setUpdateResult(null); setUpdateProgress({ operationId: 'package-validation', stage: 'package', message: 'Перевірка ZIP-файлу, структури та сумісності.' })
    try {
      const result = await window.hromadaManager.selectServerUpdatePackage()
      if (result.preview) { setUpdatePreview(result.preview); setSection('updates') }
      else if (result.error) { setUpdateError(result.error); setUpdateErrorDetails(result.details ?? ''); setSection('updates') }
      else setUpdateProgress(null)
    } catch { setUpdateError('Не вдалося відкрити або перевірити ZIP-пакет. Повторіть дію та перегляньте діагностику.') }
    finally { updateOperationInFlight.current = false; setUpdateBusy(false) }
  }, [])
  const cancelUpdate = useCallback(() => {
    if (updateOperationInFlight.current) return
    const id = updatePreview?.id
    if (id && !updateOperationInFlight.current) void window.hromadaManager.cancelServerUpdatePreview(id)
    setUpdatePreview(null); setUpdateResult(null); setUpdateError(''); setUpdateErrorDetails(''); setUpdateProgress(null)
  }, [updatePreview])
  const applyUpdate = useCallback(async () => {
    if (!updatePreview || updateOperationInFlight.current || serviceOperationInFlight.current || backupOperationInFlight.current) return
    updateOperationInFlight.current = true
    setUpdateBusy(true); setUpdateError(''); setUpdateResult(null); setUpdateProgress({ operationId: 'applying-update', stage: 'compatibility', message: 'Повторна перевірка перед оновленням.' })
    try {
      const result = await window.hromadaManager.applyServerUpdate(updatePreview.id)
      setUpdateResult(result); setLastUpdateResult(result)
      setUpdatePreview(null)
      if (!result.success) setUpdateError('')
      try { acceptInspection(await window.hromadaManager.inspectEnvironment()) } catch { setNotice('Не вдалося оновити діагностику після операції. Повторіть перевірку стану.'); setNoticeTone('error') }
    } catch {
      setUpdateError('Операцію оновлення перервано. Не видаляйте службові файли транзакції; запустіть перевірку стану сервера.')
    } finally { updateOperationInFlight.current = false; setUpdateBusy(false) }
  }, [updatePreview, acceptInspection])
  const checkReleases = useCallback(async () => {
    if (checkingReleases) return
    setCheckingReleases(true)
    const previousCheckAt = managerRelease?.checkedAt
    try {
      const result = await window.hromadaManager.checkReleaseUpdates()
      const checkDidNotComplete = result.manager.checkedAt === previousCheckAt && !result.manager.error
      setManagerRelease(checkDidNotComplete
        ? { ...result.manager, status: 'error', error: 'Не вдалося перевірити нову версію. Раніше знайдене оновлення збережено.' }
        : result.manager)
      setServerRelease(result.server)
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'Не вдалося перевірити GitHub Releases.'
      setManagerRelease(current => current ? { ...current, status: 'error', error: message } : { installedVersion: __MANAGER_VERSION__, status: 'error', error: message, confirmed: false })
      setNotice(message); setNoticeTone('error')
    }
    finally { setCheckingReleases(false) }
  }, [checkingReleases, managerRelease?.checkedAt])
  const downloadManager = useCallback(async () => {
    try { await window.hromadaManager.downloadManagerUpdate(); setManagerRelease((await window.hromadaManager.releaseUpdateState()).manager) }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Не вдалося завантажити Setup.'); setNoticeTone('error'); const state = await window.hromadaManager.releaseUpdateState(); setManagerRelease(state.manager) }
  }, [])
  const installManager = useCallback(async () => { try { await window.hromadaManager.installManagerUpdate() } catch (error) { setNotice(error instanceof Error ? error.message : 'Не вдалося запустити NSIS Setup.'); setNoticeTone('error') } }, [])
  const downloadServer = useCallback(async () => {
    setUpdateBusy(true); setUpdateError(''); setUpdateProgress({ operationId: 'release-download', stage: 'package', message: 'Завантаження серверного ZIP із перевіркою SHA-256.' })
    try { const result = await window.hromadaManager.downloadServerRelease(); setUpdatePreview(result.preview); setSection('updates'); setServerRelease((await window.hromadaManager.releaseUpdateState()).server) }
    catch (error) { setUpdateError(error instanceof Error ? error.message : 'Не вдалося завантажити або перевірити серверний ZIP.'); setServerRelease((await window.hromadaManager.releaseUpdateState()).server) }
    finally { setUpdateBusy(false); setUpdateProgress(null) }
  }, [])
  useEffect(() => {
    void window.hromadaManager.releaseUpdateState().then(value => { setManagerRelease(value.manager); setServerRelease(value.server) }).catch(() => {})
    return window.hromadaManager.onReleaseUpdateState(value => { setManagerRelease(value.manager); setServerRelease(value.server) })
  }, [])
  useEffect(() => {
    const version = serverRelease?.availableVersion
    if (serverRelease?.status === 'available' && version && notifiedServerRelease.current !== version) {
      notifiedServerRelease.current = version
      setNotice(`Для API Server доступне обов’язкове оновлення ${version}. Спершу завершіть оновлення Server Manager, якщо воно очікується.`)
      setNoticeTone('warning')
    }
  }, [serverRelease?.availableVersion, serverRelease?.status])
  useEffect(() => window.hromadaManager.onServerUpdateProgress(value => setUpdateProgress(value)), [])
  useEffect(() => {
    if (mode !== 'real' || installWizard) return
    void inspectReal()
    const timer = window.setInterval(() => {
      if (!serviceOperationInFlight.current && !updateOperationInFlight.current && !backupOperationInFlight.current && !updatePreview) void inspectReal()
    }, 15_000)
    return () => window.clearInterval(timer)
  }, [mode, installWizard, inspectReal, updatePreview])
  useEffect(() => {
    if (previousSection.current !== section) heading.current?.focus()
    previousSection.current = section
  }, [section])

  const events: DemoEvent[] = [
    { id: operation.operationId, time: checkedAt, title: operation.status === 'failed' ? 'Демонстраційна перевірка не завершена' : 'Демонстраційна перевірка завершена', detail: operation.status === 'failed' ? operation.message : 'Системні ресурси не опитувались.', level: operation.status === 'failed' ? 'error' : 'success', code: operation.errorCode ?? 'DEMO_OK' },
    { id: 'demo-package-001', time: DEMO_CHECKED_AT, title: 'Серверний пакет відповідає маніфесту', detail: 'Версія 0.1.0 (тестова).', level: 'info', code: 'DEMO_PACKAGE_VALID' },
    { id: 'demo-transport-001', time: DEMO_CHECKED_AT, title: 'Параметри перевірені', detail: 'HTTP на фіксованому порту 4310; loopback, LAN і Tailscale.', level: 'info', code: 'DEMO_HTTP' },
  ]
  const version = scenario.installed ? '0.1.0 · тестова' : 'Не визначена'
  const serviceTone = scenario.service === 'Працює' ? 'success' : scenario.service === 'Зупинена' ? 'warning' : 'info'
  const apiTone = scenario.api === 'Доступний' ? 'success' : scenario.api === 'Недоступний' ? 'error' : 'info'
  const inspect = () => {
    setCheckedAt(new Date().toLocaleString('uk-UA'))
    setNoticeTone('info')
    setNotice('Демонстраційний результат оновлено локально. Запитів до служби чи API не виконано.')
  }
  const onBackupBusyChange = useCallback((busy: boolean) => { backupOperationInFlight.current = busy; setBackupBusy(busy) }, [])
  const viewButton = (target: Section, label = 'Переглянути') => <button className="sm-view-button" type="button" onClick={() => setSection(target)}>{label}<ArrowRight size={16} aria-hidden="true"/></button>
  const scenarioPicker = isDevelopment && mode === 'demo' && <div className="sm-scenario"><label htmlFor="demo-scenario">Демонстраційний стан</label><select id="demo-scenario" value={scenarioId} onChange={event => { setScenarioId(event.target.value as ScenarioId); setCheckedAt(DEMO_CHECKED_AT); setNotice('') }}>{scenarioIds.map(id => <option key={id} value={id}>{scenarios[id].label}</option>)}</select></div>

  return <div className="sm-app">
    <a className="sm-skip" href="#manager-content">Перейти до вмісту</a>
    <aside className="sm-sidebar">
      <div className="sm-brand"><span className="sm-brand-mark"><img src={managerIcon} alt="" width="42" height="42"/></span><div><strong>Hromada<span>AID</span></strong><small>Server Manager</small></div></div>
      <nav aria-label="Розділи Server Manager">{sections.map(item => { const Icon = navIcons[item.id]; return <button key={item.id} type="button" disabled={emergencyMode ? item.id !== 'diagnostics' : Boolean(managerRelease?.confirmed) && item.id !== 'updates' && item.id !== 'diagnostics'} aria-current={section === item.id ? 'page' : undefined} onClick={() => setSection(item.id)}><Icon size={19} aria-hidden="true"/>{item.label}</button> })}</nav>
      <div className="sm-sidebar-footer"><ShieldCheck size={20} aria-hidden="true"/><div><strong>{mode === 'real' ? 'Адміністрування сервера' : 'Демонстраційні дані'}</strong><span>{mode === 'real' ? 'Керовані системні операції' : 'Стан можна перемикати'}</span></div></div>
    </aside>
    <div className="sm-workspace">
      <header className="sm-topbar"><div><strong>HromadaAID Server Manager</strong><span>Керування серверною службою та технічна діагностика</span></div><div className="sm-topbar-meta"><span className="sm-version">Версія {__MANAGER_VERSION__}</span>{mode === 'demo' && <Status tone="info">Демонстраційний режим</Status>}{isDevelopment && <button className="sm-mode-toggle" type="button" disabled={installWizard || updateBusy || backupBusy || Boolean(serviceOperation)} onClick={() => { setMode(current => current === 'real' ? 'demo' : 'real'); setNotice('') }}>{mode === 'real' ? 'Показати демо' : 'Повернути реальний стан'}</button>}</div></header>
      <main id="manager-content" className="sm-main" tabIndex={-1}>
        {mode === 'demo' ? <div className="sm-demo-banner"><Info size={17} aria-hidden="true"/><span><strong>Демонстраційний режим.</strong> Усі стани, шляхи й події тестові. Системні операції недоступні.</span></div> : null}
        <div className="sm-page-heading"><div><h1 ref={heading} tabIndex={-1}>{headings[section][0]}</h1><p>{headings[section][1]}</p></div><div className="sm-heading-controls">{scenarioPicker}{section === 'overview' && (mode === 'demo' ? <button className="secondary-button" type="button" onClick={inspect}><RefreshCw size={16} aria-hidden="true"/>Демоперевірка</button> : <button className="secondary-button" type="button" onClick={() => void inspectReal(true)} disabled={installWizard || checking || updateBusy || backupBusy || Boolean(serviceOperation)} aria-busy={checking}><RefreshCw size={16} aria-hidden="true"/>{checking ? 'Перевірка…' : 'Перевірити зараз'}</button>)}</div></div>
        {!installWizard && notice && <Toast message={notice} tone={noticeTone} onDismiss={() => setNotice('')}/>}
        {mode === 'real' && <RecoveryManagement inspection={inspection} section={section} externalBusy={installWizard || updateBusy || backupBusy || Boolean(serviceOperation) || Boolean(updatePreview)} onBusyChange={onBackupBusyChange} onInspection={acceptInspection}/>}

        {mode === 'real' && !emergencyMode && <div hidden={section !== 'backups'}><BackupManagement inspection={inspection} onBusyChange={onBackupBusyChange} onInspection={acceptInspection} externalBusy={installWizard || updateBusy || Boolean(serviceOperation) || Boolean(updatePreview)}/></div>}
        {!emergencyMode && installWizard && <InstallWizard onClose={() => setInstallWizard(false)} onInstalled={() => { setInstallWizard(false); setSection('overview'); void inspectReal() }} initial={inspection?.installation.status === 'partial_installation' || inspection?.installation.status === 'ready_to_configure' ? inspection.configuration : undefined}/>}
        {!emergencyMode && serviceConfirmation && <Modal title={serviceConfirmation === 'stop' ? 'Зупинити сервер?' : 'Перезапустити сервер?'} icon={<CircleAlert size={21}/>} onClose={() => setServiceConfirmation(null)} footer={<><button type="button" className="secondary-button" onClick={() => setServiceConfirmation(null)}>Скасувати</button><button type="button" className="danger-button" onClick={() => { const action = serviceConfirmation; setServiceConfirmation(null); void controlService(action) }}>{serviceConfirmation === 'stop' ? 'Зупинити' : 'Перезапустити'}</button></>}><p>Підключені користувачі тимчасово втратять доступ до HromadaAID.</p></Modal>}
        {emergencyMode && <div className="sm-emergency-gate"><Alert variant="warning">Доступні лише аварійні recovery-операції. Інші функції заблоковані до обов’язкового оновлення Server Manager.</Alert><button className="secondary-button" type="button" onClick={() => { setEmergencyMode(false); setSection('updates') }}>Повернутися до оновлення</button></div>}
        {mode === 'real' && !emergencyMode ? section !== 'backups' && <RealContent section={section} inspection={inspection} checking={checking} serviceOperation={serviceOperation} controlService={operation => operation === 'start' ? void controlService(operation) : setServiceConfirmation(operation)} refresh={() => void inspectReal(true)} filter={filter} setFilter={setFilter} startInstall={() => setInstallWizard(true)} updatePreview={updatePreview} updateBusy={updateBusy} updateProgress={updateProgress} updateResult={updateResult} lastUpdateResult={lastUpdateResult} updateError={updateError} updateErrorDetails={updateErrorDetails} chooseUpdate={() => void chooseUpdate()} cancelUpdate={cancelUpdate} applyUpdate={() => void applyUpdate()} backupBusy={backupBusy} managerRelease={managerRelease} serverRelease={serverRelease} checkingReleases={checkingReleases} checkReleases={() => void checkReleases()} downloadManager={() => void downloadManager()} installManager={() => void installManager()} downloadServer={() => void downloadServer()}/> : <>
        {section === 'overview' && <>
          <section className="sm-health-summary" aria-labelledby="server-state-title">
            <div className={scenarioId === 'running' ? 'visually-hidden' : `sm-scenario-notice sm-scenario-${scenario.tone}`}><h2 id="server-state-title">{scenario.title}</h2><p>{scenario.message}</p></div>
            <div className="sm-state-grid">
              <div className="sm-state-card"><span className="sm-card-icon"><Cog size={25} aria-hidden="true"/></span><div className="sm-state-content"><h3>Windows Service</h3><Status tone={serviceTone} plain>{scenario.service}</Status><p>HromadaAIDApi · приклад</p></div><button className="sm-icon-button" type="button" title="Переглянути діагностику служби" aria-label="Переглянути діагностику служби" onClick={() => setSection('diagnostics')}><ChevronRight size={18} aria-hidden="true"/></button></div>
              <div className="sm-state-card"><span className="sm-card-icon"><Wifi size={25} aria-hidden="true"/></span><div className="sm-state-content"><h3>API</h3><Status tone={apiTone} plain>{scenario.api}</Status><p>Демонстраційна доступність API</p></div><button className="sm-icon-button" type="button" title="Переглянути діагностику API" aria-label="Переглянути діагностику API" onClick={() => setSection('diagnostics')}><ChevronRight size={18} aria-hidden="true"/></button></div>
              <div className="sm-state-card"><span className="sm-card-icon"><Package size={25} aria-hidden="true"/></span><div className="sm-state-content"><h3>Серверний пакет</h3><strong>{version}</strong><p>Windows · x64</p></div><button className="sm-icon-button" type="button" title="Переглянути відомості про пакет" aria-label="Переглянути відомості про пакет" onClick={() => setSection('updates')}><FileText size={17} aria-hidden="true"/></button></div>
            </div>
            <div className="sm-health-footer"><span><Clock3 size={16} aria-hidden="true"/>Остання демоперевірка: {checkedAt}</span><Status tone={scenario.tone}>Тестовий стан</Status></div>
          </section>
          <div className="sm-two-columns">
            <Panel title="Конфігурація" icon={<Settings2 size={21} aria-hidden="true"/>} example action={viewButton('configuration')}><dl className="sm-details sm-summary-rows"><div><dt>Адреса API</dt><dd>http://127.0.0.1:4310</dd></div><div><dt>Каталог програми</dt><dd>{demoPaths.program}</dd></div><div><dt>Серверні дані</dt><dd>{demoPaths.data}</dd></div><div><dt>Резервні копії</dt><dd>{demoPaths.backups}</dd></div></dl></Panel>
            <Panel title="Оновлення" icon={<Download size={21} aria-hidden="true"/>} example action={viewButton('updates')}><p className="sm-card-lead">Доступна нова версія сервера</p><dl className="sm-details sm-summary-rows"><div><dt>Встановлена версія</dt><dd>{version}</dd></div><div><dt>Доступна версія</dt><dd>0.1.1</dd></div></dl><p className="sm-card-note">Приклад. Перевірка релізів і завантаження ще не підключені.</p></Panel>
          </div>
          <Panel title="Останні діагностичні події" icon={<Activity size={21} aria-hidden="true"/>} action={<button className="sm-link" type="button" onClick={() => setSection('diagnostics')}>Усі події<ArrowRight size={16} aria-hidden="true"/></button>}><EventTable events={events} compact/></Panel>
          {!scenario.installed && <div className="sm-future-action"><button className="primary-button" type="button" disabled>Встановити сервер</button><span>Майстер і Installation Engine будуть підключені на наступних етапах.</span></div>}
        </>}

        {section === 'configuration' && <>
          <Panel title="Каталоги" icon={<Folder size={21} aria-hidden="true"/>} example><dl className="sm-directory-list">{([['Каталог програми', demoPaths.program, 'Виконувані файли та ресурси сервера.'], ['Каталог даних', demoPaths.data, 'SQLite, конфігурація, журнали й захищені службові файли.'], ['Каталог резервних копій', demoPaths.backups, 'Незалежний каталог архівів .hraid.']] as const).map(([label, path, hint]) => <div key={label}><span className="sm-card-icon"><Folder size={21} aria-hidden="true"/></span><div><dt>{label}</dt><small>{hint}</small></div><dd>{path}</dd></div>)}</dl></Panel>
          <Panel title="Параметри сервера" icon={<Settings2 size={21} aria-hidden="true"/>} example><dl className="sm-details sm-setting-rows"><div><dt><ShieldCheck size={17} aria-hidden="true"/>Транспорт</dt><dd>HTTP · IPv4, порт 4310</dd></div><div><dt><Cog size={17} aria-hidden="true"/>Назва служби</dt><dd>HromadaAIDApi</dd></div><div><dt><ShieldCheck size={17} aria-hidden="true"/>Обліковий запис</dt><dd>LocalService</dd></div></dl></Panel>
          <Alert variant="info">Показано тестові параметри. Редагування недоступне. API використовує HTTP на порту 4310; мережевий доступ залежить від Windows Firewall і маршрутизації. Зміна каталогу не переміщуватиме дані автоматично.</Alert>
          <div className="sm-future-action"><button type="button" className="secondary-button" disabled>Змінити конфігурацію</button><span>Значення не зчитуються з комп’ютера й не зберігаються.</span></div>
        </>}

        {section === 'diagnostics' && <>
          <Panel title="Остання демонстраційна операція" icon={<Activity size={21} aria-hidden="true"/>} action={<Status tone={operation.status === 'failed' ? 'error' : 'success'}>{operation.status === 'failed' ? 'Помилка' : 'Завершено'}</Status>}>
            <p className={`sm-operation-message${operation.status === 'failed' ? ' is-error' : ''}`}>{operation.status === 'failed' ? <CircleAlert size={19} aria-hidden="true"/> : <CircleCheck size={19} aria-hidden="true"/>}{operation.message}</p>
            <dl className="sm-details sm-operation-grid"><div><dt>Ідентифікатор</dt><dd>{operation.operationId}</dd></div><div><dt>Етап / статус</dt><dd>{operation.stage} / {operation.status}</dd></div><div><dt>Код помилки</dt><dd>{operation.errorCode ?? 'Немає'}</dd></div><div><dt>Підвищення прав</dt><dd>{operation.requiresElevation ? 'Буде потрібне для реальної операції' : 'Не потрібне'}</dd></div><div className="sm-operation-retry"><dt>Повторення</dt><dd>{operation.retry.reason}</dd></div></dl>
          </Panel>
          <Panel title="Тестовий журнал подій" icon={<Clock3 size={21} aria-hidden="true"/>} action={<label className="sm-filter">Показати<select value={filter} onChange={event => setFilter(event.target.value as 'all' | 'issues')}><option value="all">Усі події</option><option value="issues">Лише помилки</option></select></label>}><EventTable events={events.filter(event => filter === 'all' || event.level === 'error')}/></Panel>
          <p className="sm-muted">Експорт реальної діагностики ще не підключено. Паролі, токени та ключі не входять до контракту операції.</p>
        </>}

        {section === 'updates' && <>
          <Panel title="Серверний пакет" icon={<Package size={21} aria-hidden="true"/>} example>
            <div className="sm-update-versions"><div><span>Встановлена версія</span><strong>{version}</strong></div><span className="sm-update-arrow"><ArrowRight size={23} aria-hidden="true"/></span><div><span>Доступна версія (приклад)</span><strong>0.1.1</strong></div></div>
            <dl className="sm-details sm-summary-rows"><div><dt>API-контракт · приклад</dt><dd>hromadaaid-rest v1</dd></div><div><dt>Схема SQLite · приклад</dt><dd>Підтримувані версії 1–28</dd></div></dl>
            <div className="sm-future-action"><button className="primary-button" type="button" disabled><RefreshCw size={16} aria-hidden="true"/>Перевірити оновлення</button><span>Доступно після підключення системи оновлень.</span></div>
          </Panel>
          <Alert variant="warning">Приклад майбутнього оновлення. Перевірка релізів, завантаження та встановлення не виконуються.</Alert>
          <Panel title="Як працюватиме оновлення" icon={<ShieldCheck size={21} aria-hidden="true"/>}><ol className="sm-update-steps"><li><span>1</span><div><strong>Перевірка пакета та сумісності</strong><p>Перевірка підпису й підтримуваної схеми SQLite.</p></div></li><li><span>2</span><div><strong>Підтвердження адміністратора</strong><p>Застосування після явного підтвердження.</p></div></li><li><span>3</span><div><strong>Контрольоване оновлення файлів</strong><p>Зупинення служби та заміна серверного пакета.</p></div></li><li><span>4</span><div><strong>Перевірка працездатності</strong><p>Запуск служби та перевірка доступності API.</p></div></li></ol><p className="sm-muted">Дані, ключі й резервні копії зберігаються незалежно від виконуваних файлів. Суми SHA-256 самі по собі не підтверджують походження пакета. Оновлення клієнта керується в самому клієнті.</p></Panel>
        </>}
        </>}
        {mode === 'real' && managerRelease?.confirmed && !emergencyMode && <Modal title={managerConfirm ? 'Закрити Server Manager?' : 'Обов’язкове оновлення Server Manager'} icon={managerConfirm ? <CircleAlert size={21}/> : <Download size={21}/>} dismissible={false} onClose={() => {}} className="sm-release-update-modal" busy={managerRelease.status === 'downloading' || managerRelease.status === 'verifying' || managerRelease.status === 'installing' || managerRelease.status === 'restarting'} footer={<>
          <button className="secondary-button" type="button" onClick={() => { setEmergencyMode(true); setSection('diagnostics') }}>Аварійне відновлення</button>
          {(managerRelease.status === 'available' || managerRelease.status === 'error') && <button className="primary-button" type="button" onClick={() => void downloadManager()}>Оновити зараз</button>}
          {managerRelease.status === 'ready' && !managerConfirm && <button className="primary-button" type="button" onClick={() => setManagerConfirm(true)}>Оновити зараз</button>}
          {managerRelease.status === 'ready' && managerConfirm && <><button className="secondary-button" type="button" onClick={() => setManagerConfirm(false)}>Повернутися</button><button className="primary-button" type="button" onClick={() => { setManagerConfirm(false); void installManager() }}>Закрити й оновити</button></>}
        </>}>
          {managerConfirm ? <p>Перед продовженням збережіть незавершені зміни. Server Manager закриється, універсальний Setup оновить лише Manager, а потім повторно запустить програму.</p> : <ReleaseUpdateDetails currentVersion={managerRelease.installedVersion} targetVersion={managerRelease.availableVersion ?? '—'} notes={managerRelease.notes}/>}
          {(managerRelease.status === 'downloading' || managerRelease.status === 'verifying') && <ReleaseUpdateProgress label={managerRelease.status === 'verifying' ? 'Перевірка завантаженого файла' : 'Завантаження Setup'} receivedBytes={managerRelease.receivedBytes} totalBytes={managerRelease.totalBytes} indeterminate={managerRelease.status === 'verifying'}/>}
          {(managerRelease.status === 'installing' || managerRelease.status === 'restarting') && <ReleaseUpdateProgress label={managerRelease.status === 'installing' ? 'Підготовка до запуску Setup' : 'Закриття Manager і запуск Windows Setup'} indeterminate/>}
          {managerRelease.error && <Alert variant="warning">{managerRelease.error} Повторіть спробу.</Alert>}
        </Modal>}
      </main>
    </div>
  </div>
}
