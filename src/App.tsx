import Alert from './components/Alert'
import DataState from './components/DataState'
import LoginScreen from './components/LoginScreen'
import WelcomeScreen from './components/WelcomeScreen'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { waitForStartupGate } from './lib/startup-timing'
import { initialAccountingYear, rememberAccountingYear } from './lib/accountingYear'
import { Activity, ChevronRight, CircleHelp, Code2, Plus, ArrowUpRight, CalendarDays, FileText, HandCoins, HeartHandshake, Home, LogOut, Settings, BookOpen, ChartNoAxesCombined, UsersRound, Lock, LockKeyhole, Phone, Mail, Send } from 'lucide-react'
import type { AuthenticatedUser, ClientAuthState } from '../shared/auth-contract'
import { allowedDictionarySections as dictionarySectionsForRoles, hasWorkspacePage, USER_ROLE_LABELS, type Permission, type WorkspacePage } from '../shared/authorization'
import StatementFormation from './StatementFormation'
import Dictionaries, { type DictionarySection } from './Dictionaries'
import AidRegistry from './AidRegistry'
import Dashboard from './Dashboard'
import Reports from './Reports'
import UsersAdmin from './UsersAdmin'
import TemporaryPasswordScreen from './components/TemporaryPasswordScreen'
import AccessDeniedToast from './components/AccessDeniedToast'
import ConnectionStateOverlay from './components/ConnectionStateOverlay'
import SettingsPage from './SettingsPage'
import communityCoat from '../reference/ГЕРБ.png'
import YearPicker from './components/YearPicker'
import { UnsavedChangesConfirmation } from './components/ConfirmDialog'
import { useOverviewData } from './components/useOverviewData'
import { useReportingYear } from './context/YearContext'
import { YearContext } from './context/YearContext'
import { notifyConnectionRestored } from './services/connectionRefresh'
import { decisionAssignmentTarget, type DecisionAssignmentTarget } from './lib/decision-assignment-navigation'
import Modal from './components/Modal'

const ACCESS_RESTRICTED_HINT = 'Доступ для вашої ролі обмежено'

const nav = [
  { label: 'Головна', page: 'home' as WorkspacePage, icon: Home, permission: 'dashboard.read' as Permission },
  { label: 'Огляд', page: 'overview' as WorkspacePage, icon: Activity, permission: 'dashboard.read' as Permission },
  { label: 'Реєстр допомог', page: 'assignments' as WorkspacePage, icon: HandCoins, permission: 'assignments.read' as Permission },
  { label: 'Формування відомостей', page: 'statements' as WorkspacePage, icon: FileText, permission: 'statements.generate' as Permission },
  { label: 'Звітність', page: 'reports' as WorkspacePage, icon: ChartNoAxesCombined, permission: 'reports.read' as Permission },
  { label: 'Довідники', page: 'dictionaries' as WorkspacePage, icon: BookOpen, permission: 'catalogs.read' as Permission },
  { label: 'Користувачі', page: 'users' as WorkspacePage, icon: UsersRound, permission: 'users.manage' as Permission },
]
function App() {
  const [auth, setAuth] = useState<ClientAuthState | null>(null)
  const [startupReady, setStartupReady] = useState(false)
  const [welcome, setWelcome] = useState<{ user: AuthenticatedUser; loading: boolean; error?: string } | null>(null)
  const [connection, setConnection] = useState<import('../shared/api-contract').ServerConnectionState | null>(null)
  const [connectionOverlayStatus, setConnectionOverlayStatus] = useState<'unavailable' | 'maintenance' | null>(null)
  const wasDisconnected = useRef(false)
  const recoveryInFlight = useRef(false)
  const welcomeAttempt = useRef(0)
  const authRef = useRef(auth)
  authRef.current = auth
  const connectionActions = useMemo(() => ({
    getState: () => window.hromadaAid.connection.getState(),
    check: (apiUrl: string) => window.hromadaAid.connection.check(apiUrl),
    save: (apiUrl: string) => window.hromadaAid.connection.save(apiUrl),
  }), [])
  useEffect(() => {
    let active = true
    let receivedEvent = false
    const unsubscribe = window.hromadaAid.auth.onStateChange((state) => {
      receivedEvent = true
      if (active) setAuth(state)
      if (state.status === 'unauthenticated' || state.status === 'unavailable') {
        welcomeAttempt.current += 1
        setWelcome(null)
      }
    })
    const unsubscribeConnection = window.hromadaAid.connection.onStateChange((connection) => {
      if (!active) return
      setConnection(connection)
      setAuth(current => {
        if (!current || current.status === 'authenticated' || current.status === 'password-change-required') return current
        if (connection.status === 'available' && current.status === 'unavailable') return { status: 'unauthenticated', user: null }
        if (connection.status === 'unavailable' || connection.status === 'maintenance') return { status: 'unavailable', user: null, message: connection.message ?? 'Сервер тимчасово недоступний.' }
        return current
      })
    })
    const startupAt = Date.now()
    void (async () => {
      try {
        const [state, initialConnection] = await waitForStartupGate(startupAt, 5_000, () => Promise.all([
          window.hromadaAid.auth.getState(),
          window.hromadaAid.connection.getState(),
        ]), Date.now, undefined, ([authState, connectionState]) => authState.status === 'unavailable' || connectionState.status === 'unavailable' || connectionState.status === 'maintenance')
        if (!active) return
        setConnection(initialConnection)
        if (!receivedEvent) {
          let initialState = state
          if (state.status === 'unavailable' || state.status === 'unauthenticated') {
            if (initialConnection.status === 'available') initialState = { status: 'unauthenticated', user: null }
            else if (initialConnection.status === 'unavailable' || initialConnection.status === 'maintenance') initialState = { status: 'unavailable', user: null, message: initialConnection.message ?? state.message }
          }
          setAuth(initialState)
        }
      } catch {
        if (active && !receivedEvent) setAuth({ status: 'unavailable', user: null, message: 'Не вдалося підготувати підключення до сервера. Спробуйте перевірити його ще раз.' })
      } finally {
        if (active) setStartupReady(true)
      }
    })()
    return () => { active = false; unsubscribe(); unsubscribeConnection() }
  }, [])
  const initializeWelcome = useCallback(async (user: AuthenticatedUser, startedAt: number) => {
    const attempt = ++welcomeAttempt.current
    setWelcome({ user, loading: true })
    let result: Awaited<ReturnType<typeof window.hromadaAid.auth.validateSession>>
    try {
      result = await waitForStartupGate(startedAt, 5_000, () => window.hromadaAid.auth.validateSession(), Date.now, undefined, value => !value.ok)
    } catch {
      if (attempt === welcomeAttempt.current) setWelcome({ user, loading: false, error: 'Не вдалося перевірити сеанс. Перевірте підключення та спробуйте ще раз.' })
      return
    }
    if (attempt !== welcomeAttempt.current) return
    setAuth(result.state)
    if (result.ok) {
      setWelcome(null)
    } else if (result.failureKind === 'session-expired' || result.state.status === 'unauthenticated' || result.state.status === 'unavailable') {
      setWelcome(null)
    } else {
      setWelcome({ user: result.state.status === 'authenticated' || result.state.status === 'password-change-required' ? result.state.user : user, loading: false, error: result.message ?? 'Не вдалося підготувати робоче середовище.' })
    }
  }, [])
  const onConnectionRestored = useCallback(async () => {
    if (recoveryInFlight.current || !wasDisconnected.current) return
    recoveryInFlight.current = true
    try {
      const current = authRef.current
      if (!current || current.status === 'unauthenticated' || current.status === 'unavailable') {
        setAuth({ status: 'unauthenticated', user: null })
        setConnectionOverlayStatus(null)
        return
      }
      const result = await window.hromadaAid.auth.validateSession()
      setAuth(result.state)
      if (result.ok || result.failureKind !== 'connection') {
        if (result.ok && welcome) { welcomeAttempt.current += 1; setWelcome(null) }
        if (result.ok || result.failureKind === 'permission' || result.failureKind === 'server') notifyConnectionRestored()
        setConnectionOverlayStatus(null)
      }
    } finally { recoveryInFlight.current = false; wasDisconnected.current = false }
  }, [welcome])
  useEffect(() => {
    const hasRemoteState = !!auth
    if (hasRemoteState && connection?.active && (connection.status === 'unavailable' || connection.status === 'maintenance')) {
      wasDisconnected.current = true
      setConnectionOverlayStatus(connection.status)
    }
    if (hasRemoteState && connection?.status === 'available' && wasDisconnected.current) void onConnectionRestored()
  }, [auth, connection?.status, onConnectionRestored])
  const login = async (username: string, password: string) => {
    const result = await window.hromadaAid.auth.login(username, password)
    setAuth(result.state)
    if (result.ok && (result.state.status === 'authenticated' || result.state.status === 'password-change-required')) void initializeWelcome(result.state.user, Date.now())
    return { ok: result.ok, message: 'message' in result ? result.message : undefined }
  }
  const changePassword = async (currentPassword: string, newPassword: string) => {
    const result = await window.hromadaAid.auth.changePassword(currentPassword, newPassword)
    setAuth(result.state)
    return { ok: result.ok, message: 'message' in result ? result.message : undefined }
  }
  if (!startupReady || !auth) return <StartupScreen/>
  if (welcome) return <><WelcomeScreen user={welcome.user} loading={welcome.loading} error={welcome.error} onRetry={() => void initializeWelcome(welcome.user, Date.now())} onSignOut={() => { void window.hromadaAid.auth.logout().then(result => { setAuth(result.state); setWelcome(null) }) }}/>{connectionOverlayStatus && connection?.apiUrl && <ConnectionStateOverlay status={connectionOverlayStatus} failureReason={connection.failureReason} apiUrl={connection.apiUrl} check={connectionActions.check} onRestored={onConnectionRestored}/>}</>
  if (auth.status === 'password-change-required') return <><TemporaryPasswordScreen state={auth} onChangePassword={changePassword}/>{connectionOverlayStatus && connection?.apiUrl && <ConnectionStateOverlay status={connectionOverlayStatus} failureReason={connection.failureReason} apiUrl={connection.apiUrl} check={connectionActions.check} onRestored={onConnectionRestored}/>}</>
  if (auth.status !== 'authenticated') return <><LoginScreen state={auth} onLogin={login} connectionActions={connectionActions}/>{connectionOverlayStatus && connection?.apiUrl && <ConnectionStateOverlay status={connectionOverlayStatus} failureReason={connection.failureReason} apiUrl={connection.apiUrl} check={connectionActions.check} onRestored={onConnectionRestored}/>}</>
  return <><Workspace key={auth.user.id} auth={auth} onChangePassword={changePassword} connectionActions={connectionActions}/>{connectionOverlayStatus && connection?.apiUrl && <ConnectionStateOverlay key="server-connection-overlay" status={connectionOverlayStatus} failureReason={connection.failureReason} apiUrl={connection.apiUrl} check={connectionActions.check} onRestored={onConnectionRestored}/>}</>
}

function Workspace({ auth, onChangePassword, connectionActions }: { auth: Extract<ClientAuthState, { status: 'authenticated' }>; onChangePassword: (currentPassword: string, newPassword: string) => Promise<{ ok: boolean; message?: string }>; connectionActions: { getState: () => Promise<import('../shared/api-contract').ServerConnectionState>; check: (apiUrl: string) => Promise<import('../shared/api-contract').ServerConnectionCheckResult>; save: (apiUrl: string) => Promise<import('../shared/api-contract').ServerConnectionSaveResult> } }) {
  const [activeNav, setActiveNav] = useState('Головна')
  const [createAssignment, setCreateAssignment] = useState(false)
  const [decisionContext, setDecisionContext] = useState<(DecisionAssignmentTarget & { label: string }) | null>(null)
  const [dictionarySection, setDictionarySection] = useState<DictionarySection | undefined>()
  const [notice, setNotice] = useState('')
  const [accessDeniedRevision, setAccessDeniedRevision] = useState(0)
  const [year, setYear] = useState(initialAccountingYear)
  const [logoutBusy, setLogoutBusy] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const permissions = useMemo(() => new Set(auth.user.permissions), [auth.user.permissions])
  const can = (permission: Permission) => permissions.has(permission)
  const visibleNav = nav.filter((item) => item.label !== 'Користувачі' || (can('users.manage')))
  const dictionarySections = useMemo(() => dictionarySectionsForRoles(auth.user.roles) as DictionarySection[], [auth.user.roles])
  const canOpenPage = (page: WorkspacePage, permission: Permission) => (page === 'dictionaries' ? dictionarySections.length > 0 : hasWorkspacePage(auth.user.roles, page) && can(permission))
  const showAccessDenied = useCallback(() => setAccessDeniedRevision((revision) => revision + 1), [])
  const closeAccessDenied = useCallback(() => setAccessDeniedRevision(0), [])
  useEffect(() => { rememberAccountingYear(year) }, [year])
  useEffect(() => { if (activeNav !== 'Налаштування' && !visibleNav.some((item) => item.label === activeNav && canOpenPage(item.page, item.permission))) setActiveNav('Головна') }, [activeNav, visibleNav, dictionarySections, permissions])
  const navigate = (label: string) => { const item = visibleNav.find((value) => value.label === label); if (!item) return; if (!canOpenPage(item.page, item.permission)) { showAccessDenied(); return }; setCreateAssignment(false); if (label !== 'Реєстр допомог') setDecisionContext(null); if (label !== 'Довідники') setDictionarySection(undefined); setActiveNav(label); setNotice(''); closeAccessDenied() }
  const navigateSettings = () => { setCreateAssignment(false); setActiveNav('Налаштування'); setNotice(''); closeAccessDenied() }
  const newAssignment = () => { if (!can('assignments.manage') || !canOpenPage('assignments', 'assignments.read')) return; setDecisionContext(null); setCreateAssignment(true); setActiveNav('Реєстр допомог'); setNotice('') }
  const viewDecisionAssignments = (decision: { id: string; decisionDate: string; decisionNumber: string }) => {
    const target = decisionAssignmentTarget(decision.id, decision.decisionDate, canOpenPage('assignments', 'assignments.read'))
    if (!target || !dictionarySections.includes('decisions')) { showAccessDenied(); return }
    setDictionarySection('decisions')
    setDecisionContext({ ...target, label: `Рішення № ${decision.decisionNumber} від ${new Date(`${decision.decisionDate}T00:00:00`).toLocaleDateString('uk-UA')}` })
    setYear(target.year); setCreateAssignment(false); setActiveNav('Реєстр допомог'); setNotice(''); closeAccessDenied()
  }
  const returnToDecision = () => {
    if (!decisionContext || !dictionarySections.includes('decisions') || !canOpenPage('dictionaries', 'catalogs.read')) { setDecisionContext(null); showAccessDenied(); return }
    setYear(decisionContext.year); setDictionarySection('decisions'); setDecisionContext(null); setActiveNav('Довідники'); setNotice(''); closeAccessDenied()
  }
  const logout = async () => {
    if (logoutBusy) return
    setLogoutBusy(true)
    try { const result = await window.hromadaAid.auth.logout(); if (!result.ok) setNotice(result.message ?? 'Локальну сесію видалено.') }
    finally { setLogoutBusy(false) }
  }
  const user = auth.user
  const displayName = user.displayName || user.username
  const roles = user.roles.map((role) => USER_ROLE_LABELS[role]).join(', ')
  return <YearContext.Provider value={{ year, setYear }}><div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><HeartHandshake size={22} strokeWidth={2.1}/></div><div className="brand-copy"><div className="brand-name">Hromada<span>Aid</span></div><div className="brand-caption">Автоматизована система обліку матеріальних допомог</div></div></div>
      <div className="nav-label">РОБОЧИЙ ПРОСТІР</div>
      <nav className="nav-list">{visibleNav.map(({ label, icon: Icon, permission }) => {
        const item = nav.find((entry) => entry.label === label)!
        const available = canOpenPage(item.page, permission)
        const hint = available ? label : ACCESS_RESTRICTED_HINT
        return <button key={label} type="button" aria-label={available ? label : `${label}. ${hint}`} title={hint}
          aria-current={available && activeNav === label ? 'page' : undefined} aria-disabled={!available}
          className={`nav-item ${available && activeNav === label ? 'active' : ''}${available ? '' : ' nav-item-locked'}`}
          onClick={() => navigate(label)}><Icon size={19} strokeWidth={1.8} aria-hidden="true"/><span>{label}</span>{!available && <LockKeyhole className="nav-lock" size={14} aria-hidden="true"/>}</button>
      })}</nav>
      <div className="sidebar-bottom"><div className="nav-label">СИСТЕМА</div><button type="button" className={`nav-item${activeNav === 'Налаштування' ? ' active' : ''}`} aria-label="Налаштування" title="Налаштування" aria-current={activeNav === 'Налаштування' ? 'page' : undefined} onClick={navigateSettings}><Settings size={19} strokeWidth={1.8} aria-hidden="true"/><span>Налаштування</span></button><button type="button" className="help-card help-card-button" onClick={() => setHelpOpen(true)}><span className="help-icon"><CircleHelp size={18}/></span><span className="help-copy"><strong>Потрібна допомога?</strong><span>Зверніться до адміністратора системи</span></span><ChevronRight size={17}/></button><div className="user-row"><div className="avatar">{user ? displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() : 'Л'}</div><button type="button" className="user-profile-link" onClick={navigateSettings} title="Мій обліковий запис"><strong>{displayName}</strong><span title={roles}>{roles}</span></button>{user && <div className="user-actions"><button type="button" className="icon-button" title="Вийти" aria-label="Вийти" disabled={logoutBusy} onClick={() => void logout()}><LogOut size={16}/></button></div>}</div></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="topbar-inner"><Breadcrumbs items={[{ label: 'Робочий простір', section: 'Головна' }, { label: activeNav }]} navigate={navigate}/><div className="top-actions"><YearPicker value={year} onChange={setYear} label="Рік"/></div></div></header>
      <div className={`content${activeNav === 'Головна' ? ' home-content' : ''}`}>
        {notice && <Alert variant="info" onDismiss={() => setNotice('')}>{notice}</Alert>}
        <div>{activeNav === 'Головна' ? <StartPage navigate={navigate} onCreate={newAssignment} canCreate={can('assignments.manage')} availableActions={{
          'Реєстр допомог': canOpenPage('assignments', 'assignments.read'),
          'Формування відомостей': canOpenPage('statements', 'statements.generate'),
          'Звітність': canOpenPage('reports', 'reports.read'),
          'Довідники': dictionarySections.some((section) => section === 'programs' || section === 'plans'),
        }} canViewOverview={canOpenPage('overview', 'dashboard.read')} onAccessDenied={showAccessDenied}/> :
          activeNav === 'Реєстр допомог' ? <AidRegistry createOnOpen={createAssignment} decisionContext={decisionContext ?? undefined} onReturnToDecision={decisionContext ? returnToDecision : undefined}/> :
          activeNav === 'Формування відомостей' ? <StatementFormation/> :
          activeNav === 'Довідники' ? <Dictionaries allowedSections={dictionarySections} initialSection={dictionarySection} onViewDecisionAssignments={viewDecisionAssignments} onAccessDenied={showAccessDenied} canManageCatalogs={can('catalogs.manage')} canManagePlans={can('planning.manage')} canManageDecisions={can('decisions.manage')} canManagePersonal={can('recipients.manage') || can('banks.manage')}/> :
          activeNav === 'Огляд' ? <Dashboard/> : activeNav === 'Користувачі' ? <UsersAdmin currentUserId={auth.user.id}/> : activeNav === 'Налаштування' ? <SettingsPage user={user} onChangePassword={onChangePassword} connectionActions={connectionActions}/> : <Reports/>}</div>
      </div>
    </main>
    {accessDeniedRevision > 0 && <AccessDeniedToast key={accessDeniedRevision} onClose={closeAccessDenied}/>}
    {helpOpen && <Modal title="Допомога та підтримка" description="З питань роботи системи, технічних несправностей та налаштування звертайтеся до розробника й адміністратора HromadaAID." onClose={() => setHelpOpen(false)} headerIcon={<CircleHelp size={19} aria-hidden="true"/>}><div className="support-contact-card"><div className="support-contact-owner"><strong>Розробник та адміністратор системи</strong><span>Анатолій Мироненко</span></div><a href="tel:+380985196340" onClick={event => { event.preventDefault(); void window.hromadaAid.appInfo.openExternal('tel:+380985196340') }}><Phone size={16}/><span><small>Телефон</small><strong>+380 98 519 63 40</strong></span></a><a href="mailto:tech.vishnsrada@ukr.net" onClick={event => { event.preventDefault(); void window.hromadaAid.appInfo.openExternal('mailto:tech.vishnsrada@ukr.net') }}><Mail size={16}/><span><small>Робоча електронна пошта</small><strong>tech.vishnsrada@ukr.net</strong></span></a><a href="mailto:myronenko.anatoliu@gmail.com" onClick={event => { event.preventDefault(); void window.hromadaAid.appInfo.openExternal('mailto:myronenko.anatoliu@gmail.com') }}><Mail size={16}/><span><small>Особиста електронна пошта</small><strong>myronenko.anatoliu@gmail.com</strong></span></a><a href="https://t.me/antlmrnnk" onClick={event => { event.preventDefault(); void window.hromadaAid.appInfo.openExternal('https://t.me/antlmrnnk') }}><Send size={16}/><span><small>Telegram</small><strong>@antlmrnnk</strong></span></a></div></Modal>}
  </div><UnsavedChangesConfirmation/></YearContext.Provider>
}

function StartupScreen() { return <main className="app-startup" aria-busy="true" aria-label="Підготовка робочого простору HromadaAid"><div className="app-startup-content" role="status" aria-live="polite"><div className="app-startup-mark"><HeartHandshake size={34} strokeWidth={2}/></div><div className="app-startup-name">Hromada<span>Aid</span></div><p>Автоматизована система обліку матеріальних допомог</p><span className="app-startup-loader" aria-hidden="true"/><span className="visually-hidden">Підготовка робочого простору…</span></div></main> }

type BreadcrumbItem = { label: string; section?: string }
function Breadcrumbs({ items, navigate }: { items: BreadcrumbItem[]; navigate: (section: string) => void }) { return <nav className="crumb" aria-label="Навігаційні крихти"><ol>{items.map((item, index) => <li key={`${index}-${item.label}`}>{index > 0 && <ChevronRight size={15} aria-hidden="true"/>}{index === items.length - 1 ? <span aria-current="page">{item.label}</span> : item.section ? <button type="button" onClick={() => navigate(item.section!)}>{item.label}</button> : <span>{item.label}</span>}</li>)}</ol></nav> }

function StartPage({ navigate, onCreate, canCreate, availableActions, canViewOverview, onAccessDenied }: { navigate: (label: string) => void; onCreate: () => void; canCreate: boolean; availableActions: Record<string, boolean>; canViewOverview: boolean; onAccessDenied: () => void }) {
  const { year } = useReportingYear()
  const links = [{ title: 'Відкрити реєстр призначень', section: 'Реєстр допомог', text: 'Пошук, редагування та зміна статусів', icon: HandCoins }, { title: 'Сформувати відомості', section: 'Формування відомостей', text: 'Персональні, зведені та банківські документи', icon: FileText }, { title: 'Переглянути звітність', section: 'Звітність', text: 'Виплати та виконання річного плану', icon: ChartNoAxesCombined }, { title: 'Перейти до довідників', section: 'Довідники', text: 'Програми, види допомог і планові показники', icon: BookOpen }]
  return <div className="workspace-page"><section className="page-heading workspace-heading"><div className="workspace-coat-area"><img src={communityCoat} alt="Герб Вишнівської територіальної громади"/></div><div className="workspace-identity-copy"><div className="eyebrow">РОБОЧИЙ ПРОСТІР ГРОМАДИ</div><h1><span>Вишнівська селищна</span>{' '}<span>територіальна громада</span></h1><p className="workspace-system-name">HromadaAID</p><p className="subtitle">Автоматизована система обліку матеріальних допомог</p></div></section><section className="dashboard-panel workspace-actions" aria-labelledby="workspace-actions-title"><div className="workspace-primary"><div><h2 id="workspace-actions-title">Щоденна робота</h2><p>Оберіть дію, щоб розпочати роботу з призначеннями.</p></div>{canCreate && <button type="button" className="primary-button" onClick={onCreate}><Plus size={19}/>Створити призначення</button>}</div><div className="workspace-shortcuts">{links.map(({ title, section, text, icon: Icon }, index) => { const available = availableActions[section] ?? false; return <button type="button" aria-label={available ? title : `${title}. ${ACCESS_RESTRICTED_HINT}`} aria-describedby={`workspace-shortcut-${index}`} aria-disabled={!available} title={available ? title : ACCESS_RESTRICTED_HINT} className={available ? '' : 'workspace-shortcut-locked'} key={section} onClick={() => available ? navigate(section) : onAccessDenied()}><span className="workspace-action-icon"><Icon size={20} aria-hidden="true"/></span><span><strong>{title}</strong><small id={`workspace-shortcut-${index}`}>{text}</small></span>{available ? <ArrowUpRight size={18} aria-hidden="true"/> : <Lock className="workspace-shortcut-lock" size={15} aria-hidden="true"/>}</button> })}</div></section><section className="dashboard-panel workspace-year" aria-label="Обліковий період"><div className="workspace-year-label"><CalendarDays size={21} aria-hidden="true"/><div><span>Обраний обліковий рік:</span><strong>{year}</strong></div></div>{canViewOverview ? <><OverviewHomeSummary year={year}/><button type="button" className="secondary-button" onClick={() => navigate('Огляд')}>Відкрити огляд<ArrowUpRight size={16}/></button></> : <div className="workspace-year-summary"><span>Робочий простір і доступні вам функції за {year} рік.</span></div>}</section><footer className="page-footer"><p>© {new Date().getFullYear()} Вишнівська селищна рада. Внутрішня інформаційна система.</p><hr aria-hidden="true"/><p className="home-footer-credit"><Code2 size={17} strokeWidth={1.7} aria-hidden="true"/><span>Developed by <strong>Anatolii Myronenko</strong></span></p></footer></div>
}

function OverviewHomeSummary({ year }: { year: number }) {
  const { data, loading, error, refresh } = useOverviewData(year, false)
  return <div className="workspace-year-summary" aria-live={loading || error ? undefined : 'polite'}>{loading ? <DataState kind="loading" compact message="Завантажуємо підсумок…"/> : error ? <Alert variant="error" action={<button type="button" onClick={() => void refresh()}>Повторити</button>}>{error}</Alert> : data ? <><strong>{`Призначено допомог: ${data.assignmentCount}`}</strong><span>{data.assignmentCount ? 'Показники та стан виконання доступні в огляді.' : 'Додайте призначення або перевірте записи в реєстрі.'}</span></> : null}</div>
}

export default App
