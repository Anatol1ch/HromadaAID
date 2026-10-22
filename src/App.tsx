import Alert from './components/Alert'
import DataState from './components/DataState'
import LoginScreen from './components/LoginScreen'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { initialAccountingYear, rememberAccountingYear } from './lib/accountingYear'
import { Activity, ChevronRight, CircleHelp, Code2, Plus, ArrowUpRight, CalendarDays, FileText, HandCoins, HeartHandshake, Home, LogOut, Settings, BookOpen, ChartNoAxesCombined, UsersRound, LockKeyhole } from 'lucide-react'
import type { ClientAuthState } from '../shared/auth-contract'
import { allowedDictionarySections as dictionarySectionsForRoles, hasWorkspacePage, USER_ROLE_LABELS, USER_ROLES, type Permission, type WorkspacePage } from '../shared/authorization'
import StatementFormation from './StatementFormation'
import Dictionaries, { type DictionarySection } from './Dictionaries'
import AidRegistry from './AidRegistry'
import Dashboard from './Dashboard'
import Reports from './Reports'
import UsersAdmin from './UsersAdmin'
import TemporaryPasswordScreen from './components/TemporaryPasswordScreen'
import AccessDeniedToast from './components/AccessDeniedToast'
import communityCoat from '../reference/ГЕРБ.png'
import YearPicker from './components/YearPicker'
import { UnsavedChangesConfirmation } from './components/ConfirmDialog'
import { useOverviewData } from './components/useOverviewData'
import { useReportingYear } from './context/YearContext'
import { YearContext } from './context/YearContext'

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
  useEffect(() => {
    let active = true
    let receivedEvent = false
    void window.hromadaAid.auth.getState().then((state) => { if (active && !receivedEvent) setAuth(state) }, () => { if (active && !receivedEvent) setAuth({ mode: 'remote', status: 'unavailable', user: null, message: 'Не вдалося отримати стан авторизації.' }) })
    const unsubscribe = window.hromadaAid.auth.onStateChange((state) => { receivedEvent = true; if (active) setAuth(state) })
    return () => { active = false; unsubscribe() }
  }, [])
  const login = async (username: string, password: string) => {
    const result = await window.hromadaAid.auth.login(username, password)
    setAuth(result.state)
    return { ok: result.ok, message: 'message' in result ? result.message : undefined }
  }
  if (!auth) return <StartupScreen/>
  if (auth.mode === 'remote' && auth.status === 'password-change-required') return <TemporaryPasswordScreen state={auth} onChangePassword={async (currentPassword, newPassword) => { const result = await window.hromadaAid.auth.changePassword(currentPassword, newPassword); setAuth(result.state); return { ok: result.ok, message: 'message' in result ? result.message : undefined } }}/>
  if (auth.mode === 'remote' && auth.status !== 'authenticated') return <LoginScreen state={auth} onLogin={login}/>
  return <Workspace key={auth.mode === 'remote' ? auth.user.id : 'local'} auth={auth}/>
}

function Workspace({ auth }: { auth: Extract<ClientAuthState, { status: 'authenticated' }> }) {
  const [activeNav, setActiveNav] = useState('Головна')
  const [createAssignment, setCreateAssignment] = useState(false)
  const [notice, setNotice] = useState('')
  const [accessDeniedRevision, setAccessDeniedRevision] = useState(0)
  const [year, setYear] = useState(initialAccountingYear)
  const [logoutBusy, setLogoutBusy] = useState(false)
  const permissions = useMemo(() => new Set(auth.mode === 'local' ? nav.map((item) => item.permission).concat(['catalogs.manage', 'program_approvals.manage', 'personal_data.read', 'recipients.manage', 'banks.manage', 'decisions.read', 'decisions.manage', 'assignments.manage', 'assignments.change_financial_status', 'planning.read', 'planning.manage', 'reports.export', 'protected_entities.delete', 'users.manage'] as Permission[]) : auth.user.permissions), [auth])
  const can = (permission: Permission) => permissions.has(permission)
  const visibleNav = nav.filter((item) => item.label !== 'Користувачі' || (auth.mode === 'remote' && can('users.manage')))
  const dictionarySections = useMemo(() => auth.mode === 'local'
    ? ['people', 'programs', 'decisions', 'banks', 'plans'] as DictionarySection[]
    : dictionarySectionsForRoles(auth.user.roles) as DictionarySection[], [auth])
  const canOpenPage = (page: WorkspacePage, permission: Permission) => auth.mode === 'local'
    || (page === 'dictionaries' ? dictionarySections.length > 0 : hasWorkspacePage(auth.user.roles, page) && can(permission))
  const showAccessDenied = useCallback(() => setAccessDeniedRevision((revision) => revision + 1), [])
  const closeAccessDenied = useCallback(() => setAccessDeniedRevision(0), [])
  useEffect(() => { rememberAccountingYear(year) }, [year])
  useEffect(() => { if (!visibleNav.some((item) => item.label === activeNav && canOpenPage(item.page, item.permission))) setActiveNav('Головна') }, [activeNav, visibleNav, dictionarySections, permissions])
  const requiredRolesFor = (item: typeof nav[number]) => item.page === 'dictionaries'
    ? USER_ROLES.filter((role) => dictionarySectionsForRoles([role]).length > 0)
    : USER_ROLES.filter((role) => hasWorkspacePage([role], item.page))
  const navigate = (label: string) => { const item = visibleNav.find((value) => value.label === label); if (!item) return; if (!canOpenPage(item.page, item.permission)) { showAccessDenied(); return }; setCreateAssignment(false); setActiveNav(label); setNotice(''); closeAccessDenied() }
  const newAssignment = () => { if (!can('assignments.manage') || !canOpenPage('assignments', 'assignments.read')) return; setCreateAssignment(true); setActiveNav('Реєстр допомог'); setNotice('') }
  const logout = async () => {
    if (logoutBusy) return
    setLogoutBusy(true)
    try { const result = await window.hromadaAid.auth.logout(); if (!result.ok) setNotice(result.message ?? 'Локальну сесію видалено.') }
    finally { setLogoutBusy(false) }
  }
  const user = auth.mode === 'remote' ? auth.user : null
  const displayName = user?.displayName || user?.username || 'Локальний режим'
  const roles = user ? user.roles.map((role) => USER_ROLE_LABELS[role]).join(', ') : 'Автономна робота'
  return <YearContext.Provider value={{ year, setYear }}><div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><HeartHandshake size={22} strokeWidth={2.1}/></div><div className="brand-copy"><div className="brand-name">Hromada<span>Aid</span></div><div className="brand-caption">Автоматизована система обліку матеріальних допомог</div></div></div>
      <div className="nav-label">РОБОЧИЙ ПРОСТІР</div>
      <nav className="nav-list">{visibleNav.map(({ label, icon: Icon, permission }) => {
        const item = nav.find((entry) => entry.label === label)!
        const available = canOpenPage(item.page, permission)
        const hint = available ? label : `Доступ мають ролі: ${requiredRolesFor(item).map((role) => USER_ROLE_LABELS[role]).join(', ')}.`
        return <button key={label} type="button" aria-label={available ? label : `${label}. ${hint}`} title={hint}
          aria-current={available && activeNav === label ? 'page' : undefined} aria-disabled={!available}
          className={`nav-item ${available && activeNav === label ? 'active' : ''}${available ? '' : ' nav-item-locked'}`}
          onClick={() => navigate(label)}><Icon size={19} strokeWidth={1.8} aria-hidden="true"/><span>{label}</span>{!available && <LockKeyhole className="nav-lock" size={14} aria-hidden="true"/>}</button>
      })}</nav>
      <div className="sidebar-bottom"><div className="nav-label">СИСТЕМА</div><button type="button" className="nav-item" aria-label="Налаштування" title="Налаштування" onClick={() => setNotice('Налаштування будуть доступні у наступному етапі.')}><Settings size={19} strokeWidth={1.8} aria-hidden="true"/><span>Налаштування</span></button><div className="help-card"><div className="help-icon"><CircleHelp size={18}/></div><div><strong>Потрібна допомога?</strong><p>Зверніться до адміністратора системи</p></div><ChevronRight size={17}/></div><div className="user-row"><div className="avatar">{user ? displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() : 'Л'}</div><div className="user-copy"><strong>{displayName}</strong><span title={roles}>{roles}</span></div>{user && <div className="user-actions"><button type="button" className="icon-button" title="Вийти" aria-label="Вийти" disabled={logoutBusy} onClick={() => void logout()}><LogOut size={16}/></button></div>}</div></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><Breadcrumbs items={[{ label: 'Робочий простір', section: 'Головна' }, { label: activeNav }]} navigate={navigate}/><div className="top-actions"><YearPicker value={year} onChange={setYear} label="Рік"/></div></header>
      <div className={`content${activeNav === 'Головна' ? ' home-content' : ''}`}>
        {notice && <Alert variant="info" onDismiss={() => setNotice('')}>{notice}</Alert>}
        <div>{activeNav === 'Головна' ? <StartPage navigate={navigate} onCreate={newAssignment} canCreate={can('assignments.manage')} allowedLinks={new Set(visibleNav.filter((item) => canOpenPage(item.page, item.permission)).map((item) => item.label))}/> :
          activeNav === 'Реєстр допомог' ? <AidRegistry createOnOpen={createAssignment}/> :
          activeNav === 'Формування відомостей' ? <StatementFormation/> :
          activeNav === 'Довідники' ? <Dictionaries allowedSections={dictionarySections} onAccessDenied={showAccessDenied} canManageCatalogs={can('catalogs.manage')} canManagePlans={can('planning.manage')} canManageDecisions={can('decisions.manage')} canManagePersonal={can('recipients.manage') || can('banks.manage')}/> :
          activeNav === 'Огляд' ? <Dashboard/> : activeNav === 'Користувачі' && auth.mode === 'remote' ? <UsersAdmin currentUserId={auth.user.id}/> : <Reports/>}</div>
      </div>
    </main>
    {accessDeniedRevision > 0 && <AccessDeniedToast key={accessDeniedRevision} onClose={closeAccessDenied}/>}
  </div><UnsavedChangesConfirmation/></YearContext.Provider>
}

function StartupScreen() { return <main className="app-startup" aria-busy="true" aria-label="Підготовка робочого простору HromadaAid"><div className="app-startup-content" role="status" aria-live="polite"><div className="app-startup-mark"><HeartHandshake size={34} strokeWidth={2}/></div><div className="app-startup-name">Hromada<span>Aid</span></div><p>Автоматизована система обліку матеріальних допомог</p><span className="app-startup-loader" aria-hidden="true"/><span className="visually-hidden">Підготовка робочого простору…</span></div></main> }

type BreadcrumbItem = { label: string; section?: string }
function Breadcrumbs({ items, navigate }: { items: BreadcrumbItem[]; navigate: (section: string) => void }) { return <nav className="crumb" aria-label="Навігаційні крихти"><ol>{items.map((item, index) => <li key={`${index}-${item.label}`}>{index > 0 && <ChevronRight size={15} aria-hidden="true"/>}{index === items.length - 1 ? <span aria-current="page">{item.label}</span> : item.section ? <button type="button" onClick={() => navigate(item.section!)}>{item.label}</button> : <span>{item.label}</span>}</li>)}</ol></nav> }

function StartPage({ navigate, onCreate, canCreate, allowedLinks }: { navigate: (label: string) => void; onCreate: () => void; canCreate: boolean; allowedLinks: Set<string> }) {
  const { year } = useReportingYear(); const { data, loading, error, refresh } = useOverviewData(year, false)
  const links = [{ title: 'Відкрити реєстр призначень', section: 'Реєстр допомог', text: 'Пошук, редагування та зміна статусів', icon: HandCoins }, { title: 'Сформувати відомості', section: 'Формування відомостей', text: 'Персональні, зведені та банківські документи', icon: FileText }, { title: 'Переглянути звітність', section: 'Звітність', text: 'Виплати та виконання річного плану', icon: ChartNoAxesCombined }, { title: 'Перейти до довідників', section: 'Довідники', text: 'Програми, види допомог і планові показники', icon: BookOpen }].filter((item) => allowedLinks.has(item.section))
  return <div className="workspace-page"><section className="page-heading workspace-heading"><div className="workspace-coat-area"><img src={communityCoat} alt="Герб Вишнівської територіальної громади"/></div><div className="workspace-identity-copy"><div className="eyebrow">РОБОЧИЙ ПРОСТІР ГРОМАДИ</div><h1><span>Вишнівська селищна</span>{' '}<span>територіальна громада</span></h1><p className="workspace-system-name">HromadaAID</p><p className="subtitle">Автоматизована система обліку матеріальних допомог</p></div></section><section className="dashboard-panel workspace-actions" aria-labelledby="workspace-actions-title"><div className="workspace-primary"><div><h2 id="workspace-actions-title">Щоденна робота</h2><p>Оберіть дію, щоб розпочати роботу з призначеннями.</p></div>{canCreate && <button type="button" className="primary-button" onClick={onCreate}><Plus size={19}/>Створити призначення</button>}</div><div className="workspace-shortcuts">{links.map(({ title, section, text, icon: Icon }, index) => <button type="button" aria-label={title} aria-describedby={`workspace-shortcut-${index}`} key={section} onClick={() => navigate(section)}><span className="workspace-action-icon"><Icon size={20} aria-hidden="true"/></span><span><strong>{title}</strong><small id={`workspace-shortcut-${index}`}>{text}</small></span><ArrowUpRight size={18} aria-hidden="true"/></button>)}</div></section><section className="dashboard-panel workspace-year" aria-label="Обліковий період"><div className="workspace-year-label"><CalendarDays size={21} aria-hidden="true"/><div><span>Обраний обліковий рік</span><strong>{year}</strong></div></div><div className="workspace-year-summary" aria-live={loading || error ? undefined : 'polite'}>{loading ? <DataState kind="loading" compact message="Завантажуємо підсумок…"/> : error ? <Alert variant="error" action={<button type="button" onClick={() => void refresh()}>Повторити</button>}>{error}</Alert> : data ? <><strong>{`Призначено допомог: ${data.assignmentCount}`}</strong><span>{data.assignmentCount ? 'Показники та стан виконання доступні в огляді.' : 'Додайте призначення або перевірте записи в реєстрі.'}</span></> : null}</div><button type="button" className="secondary-button" onClick={() => navigate('Огляд')}>Відкрити огляд<ArrowUpRight size={16}/></button></section><footer className="page-footer"><p>© {new Date().getFullYear()} Вишнівська селищна рада. Внутрішня інформаційна система.</p><hr aria-hidden="true"/><p className="home-footer-credit"><Code2 size={17} strokeWidth={1.7} aria-hidden="true"/><span>Developed by <strong>Anatolii Myronenko</strong></span></p></footer></div>
}

export default App
