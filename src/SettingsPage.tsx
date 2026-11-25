import { Activity, AtSign, ChevronRight, CircleAlert, CircleCheck, Clock, Clock3, Code2, Copy, Download, ExternalLink, Github, History, Info, Landmark, LockKeyhole, Minus, Monitor, Network, PanelLeft, Pencil, Plus, RefreshCw, RotateCcw, Server, SlidersHorizontal, UserRound, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { AuthenticatedUser } from '../shared/auth-contract'
import type { ClientUpdateState, ServerConnectionCheckResult, ServerConnectionSaveResult, ServerConnectionState } from '../shared/api-contract'
import { HROMADAAID_API_CONTRACT_VERSION } from '../shared/api-compatibility'
import { MAX_CLIENT_ZOOM_FACTOR, MIN_CLIENT_ZOOM_FACTOR } from '../shared/client-zoom'
import { USER_ROLE_LABELS } from '../shared/authorization'
import { formatConnectionDiagnostics, sanitizeConnectionDiagnosticText, type SafeConnectionDiagnostics } from '../shared/connection-diagnostics'
import hromadaAidLogo from '../assets/hromadaaid.svg'
import ChangePasswordForm from './components/ChangePasswordForm'
import Modal from './components/Modal'
import ServerConnectionDialog from './components/ServerConnectionDialog'
import ReleaseHistoryModal from './components/ReleaseHistoryModal'
import { notifySystemToast } from './components/SystemToastHost'

type ConnectionActions = { getState: () => Promise<ServerConnectionState>; check: (apiUrl: string) => Promise<ServerConnectionCheckResult>; save: (apiUrl: string) => Promise<ServerConnectionSaveResult> }
type Section = 'general' | 'account' | 'connection' | 'updates' | 'about'
const categories: { id: Section; label: string; icon: LucideIcon }[] = [
  { id: 'general', label: 'Загальні', icon: SlidersHorizontal },
  { id: 'account', label: 'Обліковий запис', icon: UserRound },
  { id: 'connection', label: 'Підключення', icon: Network },
  { id: 'updates', label: 'Оновлення', icon: Download },
  { id: 'about', label: 'Про програму', icon: Info },
]
const zoomValue = (factor: number) => `${(factor * 100).toFixed(1).replace(/\.0$/, '')}%`
const DEV_UPDATES_UNAVAILABLE = 'Перевірка оновлень недоступна в режимі розробки.'

export default function SettingsPage({ user, onChangePassword, connectionActions, compactSidebar, onCompactSidebarChange, initialSection = 'general' }: {
  user: AuthenticatedUser
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<{ ok: boolean; message?: string }>
  connectionActions: ConnectionActions
  compactSidebar: boolean
  onCompactSidebarChange: (compact: boolean) => void
  initialSection?: 'general' | 'account'
}) {
  const [section, setSection] = useState<Section>(initialSection)
  const [passwordModalOpen, setPasswordModalOpen] = useState(false)
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [connectionModalOpen, setConnectionModalOpen] = useState(false)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const [connection, setConnection] = useState<ServerConnectionState | null>(null)
  const [connectionMessage, setConnectionMessage] = useState('')
  const [connectionBusy, setConnectionBusy] = useState(false)
  const [connectionCheckedAt, setConnectionCheckedAt] = useState<string | undefined>()
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [clientUpdate, setClientUpdate] = useState<ClientUpdateState | null>(null)
  const [updateCheckBusy, setUpdateCheckBusy] = useState(false)
  const [releaseHistoryOpen, setReleaseHistoryOpen] = useState(false)
  const [zoomFactor, setZoomFactor] = useState<number | null>(null)
  const [copyBusy, setCopyBusy] = useState(false)
  const updateState = clientUpdate
  const updateCheckInProgress = updateCheckBusy
  const displayName = [user.firstName?.trim(), user.lastName?.trim()].filter(Boolean).join(' ') || user.displayName?.trim() || user.username
  const roleLabels = user.roles.map(role => USER_ROLE_LABELS[role])
  const initials = displayName.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toLocaleUpperCase('uk-UA')
  const diagnosticStatus = connection?.status ?? 'unknown'
  const diagnosticError = !connectionBusy && connection?.status === 'unavailable' ? connectionMessage || connection.message : undefined
  const diagnostics: SafeConnectionDiagnostics = useMemo(() => ({
    clientVersion: appVersion ?? '',
    apiUrl: connection?.apiUrl ?? null,
    apiAvailability: diagnosticStatus,
    compatibility: connection?.apiContractVersion === HROMADAAID_API_CONTRACT_VERSION ? 'compatible' : connection?.apiContractVersion !== undefined && connection.apiContractVersion !== HROMADAAID_API_CONTRACT_VERSION || connection?.failureReason === 'incompatible' ? 'incompatible' : 'unknown',
    clientContractVersion: HROMADAAID_API_CONTRACT_VERSION,
    ...(connection?.apiContractVersion !== undefined ? { serverContractVersion: connection.apiContractVersion } : {}),
    addressEditable: connection ? connection.editable : null,
    ...(connection?.lockedReason ? { addressLockReason: connection.lockedReason } : {}),
    ...(diagnosticError ? { lastError: diagnosticError } : {}),
    ...(connectionCheckedAt ? { checkedAt: connectionCheckedAt } : {}),
  }), [appVersion, connection, diagnosticError, connectionCheckedAt, diagnosticStatus])

  useEffect(() => {
    let active = true
    void window.hromadaAid.appInfo.getVersion().then(version => { if (active) setAppVersion(version) }).catch(() => { if (active) setAppVersion(null) })
    void connectionActions.getState().then(value => { if (active) setConnection(value) }).catch(() => { if (active) setConnectionMessage('Не вдалося прочитати стан підключення.') })
    const unsubscribeConnection = window.hromadaAid.connection.onStateChange(value => { if (active) setConnection(value) })
    void window.hromadaAid.clientUpdates.getState().then(value => { if (active) setClientUpdate(value) }).catch(() => {})
    const unsubscribeUpdate = window.hromadaAid.clientUpdates.onStateChange(value => { if (active) setClientUpdate(value) })
    void window.hromadaAid.windowSettings.getZoomFactor().then(value => { if (active) setZoomFactor(value) }).catch(() => { if (active) setZoomFactor(1) })
    const unsubscribeZoom = window.hromadaAid.windowSettings.onZoomChange(value => { if (active) setZoomFactor(value) })
    return () => { active = false; unsubscribeConnection(); unsubscribeUpdate(); unsubscribeZoom() }
  }, [])
  useEffect(() => { setSection(initialSection) }, [initialSection])

  const checkCurrentConnection = async () => {
    if (connectionBusy || !connection?.apiUrl) return
    setConnectionBusy(true); setConnectionMessage('Перевірка підключення…')
    try {
      const result = await connectionActions.check(connection.apiUrl)
      setConnectionMessage(result.message)
      setConnectionCheckedAt(new Date().toISOString())
      setConnection(await connectionActions.getState())
    } catch {
      setConnectionMessage('Не вдалося підключитися до сервера.')
      setConnectionCheckedAt(new Date().toISOString())
    } finally { setConnectionBusy(false) }
  }

  const adjustZoom = async (action: 'decrease' | 'increase' | 'reset') => {
    try { setZoomFactor(await window.hromadaAid.windowSettings.adjustZoom(action)) }
    catch { notifySystemToast('error', 'Не вдалося змінити масштаб', 'Застосунок не зміг застосувати вибрану дію.') }
  }
  const toggleCompactSidebar = (enabled: boolean) => onCompactSidebarChange(enabled)
  const checkClientUpdate = async () => {
    if (updateCheckBusy || clientUpdate?.status === 'checking' || clientUpdate?.confirmed) return
    setUpdateCheckBusy(true)
    try { setClientUpdate(await window.hromadaAid.clientUpdates.check()) }
    catch { setClientUpdate(current => current ? { ...current, status: 'error', error: 'Не вдалося перевірити оновлення.', checkedAt: new Date().toISOString() } : current) }
    finally { setUpdateCheckBusy(false) }
  }
  const copyDiagnostics = async () => {
    if (copyBusy) return
    setCopyBusy(true)
    try {
      await navigator.clipboard.writeText(formatConnectionDiagnostics(diagnostics))
      notifySystemToast('success', 'Діагностику скопійовано', 'Можна вставити її у звернення до підтримки.')
    } catch { notifySystemToast('error', 'Не вдалося скопіювати діагностику', 'Перевірте дозвіл на доступ до буфера обміну.') }
    finally { setCopyBusy(false) }
  }

  const updateSummary = () => {
    const state = updateState?.status
    if (updateCheckInProgress || state === 'checking') return { title: 'Виконується перевірка оновлень', detail: 'Перевіряємо доступність нової версії.', tone: 'checking' }
    if (state === 'waiting-for-server') return {
      title: 'Очікується оновлення сервера',
      detail: updateState?.updateDeferralReason === 'server-contract' && updateState.canContinue
        ? 'Нова версія програми стане доступною після оновлення сервера. Ви можете продовжувати роботу.'
        : updateState?.updateDeferralReason === 'server-unavailable'
          ? 'Не вдалося перевірити сумісність із сервером. Оновлення відкладено до підтвердження його доступності.'
          : 'Сумісність нової версії із сервером поки не підтверджена. Оновлення відкладено.', tone: 'waiting'
    }
    if (state === 'available' || state === 'downloading' || state === 'verifying' || state === 'ready' || state === 'preparing' || state === 'installing' || state === 'restarting') return { title: 'Доступне оновлення', detail: updateState?.targetVersion ? `Доступна версія ${updateState.targetVersion}.` : 'Доступна нова версія HromadaAID.', tone: 'available' }
    if (state === 'up-to-date') return { title: 'Ви використовуєте актуальну версію', detail: 'За останньою успішною перевіркою новіша версія відсутня.', tone: 'success' }
    if (state === 'error' && updateState?.error === DEV_UPDATES_UNAVAILABLE) return { title: 'Перевірка оновлень недоступна в режимі розробки', detail: 'Перевірка стабільних випусків доступна у встановленій версії.', tone: 'neutral' }
    if (state === 'error') return { title: 'Не вдалося перевірити оновлення', detail: updateState?.error || 'Спробуйте перевірити пізніше.', tone: 'error' }
    return { title: 'Оновлення ще не перевірялися', detail: 'Перевірте наявність останньої стабільної версії.', tone: 'neutral' }
  }
  const updateInfo = updateSummary()
  const compatibleConnection = connection?.status === 'available' && connection.apiContractVersion === HROMADAAID_API_CONTRACT_VERSION
  const incompatibleConnection = connection?.failureReason === 'incompatible' || connection?.apiContractVersion !== undefined && connection.apiContractVersion !== HROMADAAID_API_CONTRACT_VERSION
  const connectionDescription = compatibleConnection ? 'Сервер доступний.'
    : incompatibleConnection && connection?.apiContractVersion !== undefined ? `Контракт сервера v${connection.apiContractVersion} несумісний із цією версією програми.`
    : incompatibleConnection ? connection?.message || 'Сумісність сервера не підтверджена.'
    : connection?.status === 'available' ? 'Сервер відповів, але сумісність ще не підтверджена.'
    : connection?.status === 'checking' || connectionBusy ? 'Виконується перевірка доступності API.'
      : connection?.status === 'maintenance' ? 'API повідомив про технічне обслуговування.'
        : connection?.status === 'unavailable' ? connectionMessage || connection?.message || 'Не вдалося підтвердити доступність API.'
          : 'Доступність API ще не підтверджена.'
  const connectionLabel = compatibleConnection ? 'З’єднання встановлено'
    : incompatibleConnection ? 'Несумісна версія сервера'
    : connection?.status === 'available' ? 'Сумісність не підтверджена'
    : connection?.status === 'checking' || connectionBusy ? 'Перевіряється'
      : connection?.status === 'maintenance' ? 'Технічне обслуговування'
        : connection?.status === 'unavailable' ? connection?.failureReason === 'incompatible' ? 'Несумісна версія сервера' : 'Сервер недоступний'
          : 'Стан не визначено'
  const connectionTone = compatibleConnection ? 'compatible'
    : incompatibleConnection ? 'incompatible'
      : connection?.status === 'available' ? 'unconfirmed'
        : connection?.status ?? 'unknown'

  return <div className="settings-redesign">
    <div className="settings-layout">
      <nav className="settings-sidebar-nav" aria-label="Категорії налаштувань">
        {categories.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={`settings-nav-item${section === id ? ' is-active' : ''}`} aria-current={section === id ? 'page' : undefined} onPointerDown={event => { event.currentTarget.dataset.pointerFocus = 'true' }} onKeyDown={event => { delete event.currentTarget.dataset.pointerFocus }} onBlur={event => { delete event.currentTarget.dataset.pointerFocus }} onClick={() => setSection(id)}><Icon size={18} aria-hidden="true"/><span>{label}</span></button>)}
        <div className="settings-nav-product"><img src={hromadaAidLogo} alt=""/><span>HromadaAID</span>{appVersion && <small>{appVersion}</small>}</div>
      </nav>
      <section className="settings-category" aria-live="polite">
        {section === 'general' && <>
          <CategoryHeading title="Загальні" subtitle="Персональні параметри застосунку."/>
          <section className="settings-section-block" aria-labelledby="settings-interface-heading"><h3 id="settings-interface-heading">Інтерфейс та відображення</h3><div className="settings-group">
            <div className="settings-preference-row">
              <span className="settings-row-icon"><Monitor size={18}/></span><span className="settings-row-copy"><strong>Масштаб інтерфейсу</strong><small>Розмір тексту та елементів програми</small></span>
              <div className="settings-zoom-controls" aria-label="Керування масштабом інтерфейсу">
                <button type="button" className="secondary-button" aria-label="Зменшити масштаб" title="Зменшити масштаб" disabled={zoomFactor === null || zoomFactor <= MIN_CLIENT_ZOOM_FACTOR + 0.0001} onClick={() => void adjustZoom('decrease')}><Minus size={16} aria-hidden="true"/></button>
                <output className="settings-zoom-value" aria-live="polite">{zoomFactor === null ? '—' : zoomValue(zoomFactor)}</output>
                <button type="button" className="secondary-button" aria-label="Збільшити масштаб" title="Збільшити масштаб" disabled={zoomFactor === null || zoomFactor >= MAX_CLIENT_ZOOM_FACTOR - 0.0001} onClick={() => void adjustZoom('increase')}><Plus size={16} aria-hidden="true"/></button>
                <button type="button" className="secondary-button settings-zoom-reset" aria-label="Відновити стандартний масштаб" title="Відновити стандартний масштаб" disabled={zoomFactor === null || Math.abs(zoomFactor - 1) < 0.0001} onClick={() => void adjustZoom('reset')}><RotateCcw size={16} aria-hidden="true"/></button>
              </div>
            </div>
            <div className="settings-preference-row">
              <span className="settings-row-icon"><PanelLeft size={18}/></span><span className="settings-row-copy"><strong>Компактне бічне меню</strong><small>Показувати лише іконки навігації</small></span>
              <button type="button" role="switch" aria-checked={compactSidebar} aria-label="Компактне бічне меню" className={`settings-switch${compactSidebar ? ' is-on' : ''}`} onClick={() => toggleCompactSidebar(!compactSidebar)}><span/></button>
            </div>
          </div></section>
          <p className="settings-local-note"><Info size={15} aria-hidden="true"/>Ці параметри застосовуються лише на цьому комп’ютері.</p>
        </>}

        {section === 'account' && <>
          <CategoryHeading title="Обліковий запис" subtitle="Ваш профіль та безпека облікового запису."/>
          <section className="settings-profile-card" aria-label="Профіль користувача">
            <div className="settings-profile-top"><span className="settings-profile-avatar" aria-hidden="true">{initials}</span><div className="settings-profile-identity"><strong>{displayName}</strong><div className="settings-profile-role-list">{roleLabels.map((role, index) => <span className="settings-role-chip" key={`${user.roles[index]}-${role}`}>{role}</span>)}</div></div></div>
          <div className="settings-profile-login"><AtSign size={16} aria-hidden="true"/><span>Логін</span><strong>{user.username}</strong></div>
          </section>
          <section className="settings-section-block" aria-labelledby="settings-security-heading"><h3 id="settings-security-heading">Безпека</h3><div className="settings-group"><button type="button" className="settings-action-row" onClick={() => setPasswordModalOpen(true)}><span className="settings-row-icon"><LockKeyhole size={18}/></span><span className="settings-row-copy"><strong>Змінити пароль</strong><small>Оновити пароль облікового запису</small></span><ChevronRight size={18} className="settings-row-chevron" aria-hidden="true"/></button></div></section>
          <p className="settings-local-note"><Info size={15} aria-hidden="true"/>Для зміни особистих даних або прав доступу зверніться до адміністратора.</p>
          {passwordModalOpen && <Modal title="Зміна пароля" description="Після успішної зміни потрібно увійти повторно." headerIcon={<LockKeyhole size={21} aria-hidden="true"/>} onClose={() => setPasswordModalOpen(false)} busy={passwordBusy} size="compact" className="change-password-modal"><ChangePasswordForm onChangePassword={onChangePassword} onBusyChange={setPasswordBusy} onCancel={() => setPasswordModalOpen(false)}/></Modal>}
        </>}

        {section === 'connection' && <>
          <CategoryHeading title="Підключення" subtitle="Керування підключенням до сервера."/>
          <section className="settings-connection-card">
            <div className="settings-connection-state"><span className={`settings-state-icon state-${connectionTone}`}>{connectionTone === 'compatible' ? <CircleCheck size={21}/> : connectionTone === 'unavailable' || connectionTone === 'incompatible' ? <CircleAlert size={21}/> : connection?.status === 'checking' || connectionBusy ? <span className="settings-spinner" aria-hidden="true"/> : <Server size={21}/>}</span><div className="settings-state-copy"><strong>{connectionLabel}</strong><span>{connectionDescription}</span></div><span className={`settings-status-dot state-${connectionTone}`} aria-hidden="true"/></div>
            <div className="settings-connection-address"><span>Адреса сервера</span><strong>{connection?.apiUrl ?? 'Не налаштовано'}</strong></div>
            {connection?.lockedReason && <p className="settings-inline-note"><Info size={15} aria-hidden="true"/>{connection.lockedReason}</p>}
            <div className="settings-connection-actions"><button type="button" className="primary-button" disabled={connectionBusy || !connection?.apiUrl} onClick={() => void checkCurrentConnection()}>{connectionBusy ? <span className="settings-spinner" aria-hidden="true"/> : <RefreshCw size={16} aria-hidden="true"/>}{connectionBusy ? 'Перевіряємо…' : 'Перевірити з’єднання'}</button><button type="button" className="secondary-button" disabled={!connection?.editable} onClick={() => setConnectionModalOpen(true)}><Pencil size={16} aria-hidden="true"/>Змінити адресу</button></div>
          </section>
          <div className="settings-group settings-diagnostic-entry"><button type="button" className="settings-action-row" onClick={() => setDiagnosticsOpen(true)}><span className="settings-row-icon"><Activity size={18}/></span><span className="settings-row-copy"><strong>Діагностика підключення</strong><small>Детальна технічна інформація</small></span><ChevronRight size={18} className="settings-row-chevron" aria-hidden="true"/></button></div>
          {connectionModalOpen && <ServerConnectionDialog onClose={() => setConnectionModalOpen(false)} {...connectionActions} onSaved={state => { setConnection(state); setConnectionMessage(''); notifySystemToast('success', 'Налаштування збережено', 'Адресу сервера оновлено.') }}/>}
          {diagnosticsOpen && <Modal title="Діагностика підключення" description="Відомості, доступні на цьому комп’ютері." headerIcon={<Activity size={20} aria-hidden="true"/>} onClose={() => setDiagnosticsOpen(false)} size="compact" className="settings-diagnostics-modal" footer={<><button type="button" className="secondary-button" disabled={copyBusy} onClick={() => void copyDiagnostics()}><Copy size={16} aria-hidden="true"/>{copyBusy ? 'Копіюємо…' : 'Копіювати діагностику'}</button><button type="button" className="primary-button" onClick={() => setDiagnosticsOpen(false)}>Закрити</button></>}>
            <div className="settings-diagnostics-summary"><span className={`settings-status-dot state-${connection?.status ?? 'unknown'}`} aria-hidden="true"/><strong>{connectionLabel}</strong><p>{connectionDescription}</p></div>
            <dl className="settings-diagnostics-list">
              <DiagnosticItem label="Версія Client" value={appVersion}/>
              <DiagnosticItem label="Адреса сервера" value={connection?.apiUrl}/>
              <DiagnosticItem label="Доступність API" value={connection ? connectionLabel : undefined}/>
              <DiagnosticItem label="Контракт, потрібний Client" value={`v${HROMADAAID_API_CONTRACT_VERSION}`}/>
              {connection?.apiContractVersion !== undefined && <DiagnosticItem label="Версія API-контракту сервера" value={`v${connection.apiContractVersion}`}/>}
              <DiagnosticItem label="Сумісність" value={diagnostics.compatibility === 'compatible' ? 'Сумісний' : diagnostics.compatibility === 'incompatible' ? 'Несумісний' : undefined}/>
              <DiagnosticItem label="Зміну адреси дозволено" value={connection ? connection.editable ? 'Так' : 'Ні' : undefined}/>
              {connection?.lockedReason && <DiagnosticItem label="Причина обмеження" value={sanitizeConnectionDiagnosticText(connection.lockedReason)}/>}
              {diagnosticError && <DiagnosticItem label="Остання відома помилка" value={sanitizeConnectionDiagnosticText(diagnosticError)}/>}
              {connectionCheckedAt && <DiagnosticItem label="Остання перевірка" value={new Date(connectionCheckedAt).toLocaleString('uk-UA')}/>}
            </dl>
          </Modal>}
        </>}

        {section === 'updates' && <>
          <CategoryHeading title="Оновлення" subtitle="Перевірка та історія оновлень."/>
          <section className={`settings-update-card tone-${updateInfo.tone}`}>
            <div className="settings-update-summary"><span className="settings-update-state-icon">{updateInfo.tone === 'success' ? <CircleCheck size={21}/> : updateInfo.tone === 'error' ? <CircleAlert size={21}/> : updateInfo.tone === 'checking' ? <span className="settings-spinner"/> : updateInfo.tone === 'waiting' ? <Clock size={21}/> : <Download size={21}/>}</span><div><strong>{updateInfo.title}</strong><p>{updateInfo.detail}</p><span className="settings-update-version">HromadaAID {appVersion ?? '—'}</span></div></div>
            <div className="settings-update-footer">{updateState?.checkedAt ? <span className="settings-update-checked"><Clock3 size={14} aria-hidden="true"/>Остання перевірка: {new Date(updateState.checkedAt).toLocaleString('uk-UA')}</span> : <span className="settings-update-checked">Перевірку ще не виконано</span>}
              <button type="button" className="primary-button settings-update-check" disabled={updateCheckBusy || updateState?.status === 'checking' || updateState?.confirmed} onClick={() => void checkClientUpdate()}>{updateCheckInProgress || updateState?.status === 'checking' ? <span className="settings-spinner" aria-hidden="true"/> : <RefreshCw size={16} aria-hidden="true"/>}{updateCheckInProgress || updateState?.status === 'checking' ? 'Перевірка…' : 'Перевірити оновлення'}</button>
            </div>
          </section>
          <div className="settings-group settings-history-entry"><button type="button" className="settings-action-row" onClick={() => setReleaseHistoryOpen(true)}><span className="settings-row-icon"><History size={18}/></span><span className="settings-row-copy"><strong>Історія оновлень</strong><small>Що нового в попередніх версіях</small></span><ChevronRight size={18} className="settings-row-chevron" aria-hidden="true"/></button></div>
          {releaseHistoryOpen && <ReleaseHistoryModal currentVersion={appVersion ?? ''} onClose={() => setReleaseHistoryOpen(false)}/>}
        </>}

        {section === 'about' && <>
          <section className="settings-about-composition" aria-label="Про HromadaAID">
            <div className="settings-about-hero">
              <img src={hromadaAidLogo} alt="Логотип HromadaAID" width="76" height="76"/>
              <h3>HromadaAID</h3>
              <p>Система обліку матеріальної допомоги</p>
              {appVersion && <span className="settings-about-version">Версія {appVersion}</span>}
            </div>
            <p className="settings-about-purpose">Програмне забезпечення для автоматизації обліку, призначення та супроводу виплат матеріальної допомоги в органах місцевого самоврядування</p>
            <div className="settings-about-divider"/>
            <div className="settings-about-credits">
              <div className="settings-about-info-row"><span className="settings-about-info-icon"><Code2 size={18} aria-hidden="true"/></span><div className="settings-about-info-copy"><span>Розробник</span><strong>Анатолій Мироненко</strong></div></div>
              <div className="settings-about-info-row"><span className="settings-about-info-icon"><Landmark size={18} aria-hidden="true"/></span><div className="settings-about-info-copy"><span>Створено для потреб</span><strong>Вишнівської селищної територіальної громади</strong><small>Кам’янський район, Дніпропетровська область</small></div></div>
            </div>
            <div className="settings-about-divider"/>
            <button type="button" className="secondary-button settings-github-link" onClick={() => void window.hromadaAid.appInfo.openExternal('https://github.com/Anatol1ch/HromadaAID')}><Github size={16} aria-hidden="true"/>Репозиторій на GitHub<ExternalLink size={14} aria-hidden="true"/></button>
          </section>
        </>}
      </section>
    </div>
  </div>
}

function CategoryHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return <header className="settings-category-heading"><h2>{title}</h2><p>{subtitle}</p></header>
}

function DiagnosticItem({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return <div><dt>{label}</dt><dd>{value}</dd></div>
}
