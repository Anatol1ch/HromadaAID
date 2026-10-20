import Alert from './components/Alert'
import DataState from './components/DataState'
import { useEffect, useState } from 'react'
import { initialAccountingYear, rememberAccountingYear } from './lib/accountingYear'
import { Activity, ChevronRight, CircleHelp, Code2, Plus, ArrowUpRight, CalendarDays, FileText, HandCoins, HeartHandshake, Home, MoreHorizontal, Settings, BookOpen, ChartNoAxesCombined } from 'lucide-react'
import StatementFormation from './StatementFormation'
import Dictionaries from './Dictionaries'
import AidRegistry from './AidRegistry'
import Dashboard from './Dashboard'
import Reports from './Reports'
import communityCoat from '../reference/ГЕРБ.png'
import YearPicker from './components/YearPicker'
import { UnsavedChangesConfirmation } from './components/ConfirmDialog'
import { useOverviewData } from './components/useOverviewData'
import { useReportingYear } from './context/YearContext'
import { YearContext } from './context/YearContext'

const nav = [
  { label: 'Головна', icon: Home },
  { label: 'Огляд', icon: Activity },
  { label: 'Реєстр допомог', icon: HandCoins },
  { label: 'Формування відомостей', icon: FileText },
  { label: 'Звітність', icon: ChartNoAxesCombined },
  { label: 'Довідники', icon: BookOpen },
]

function App() {
  const [ready, setReady] = useState(false)
  const [activeNav, setActiveNav] = useState('Головна')
  const [createAssignment, setCreateAssignment] = useState(false)
  const [notice, setNotice] = useState('')
  const [year, setYear] = useState(initialAccountingYear)
  useEffect(() => { setReady(true) }, [])
  useEffect(() => { rememberAccountingYear(year) }, [year])
  const navigate = (label: string) => { setCreateAssignment(false); setActiveNav(label); setNotice('') }
  const newAssignment = () => { setCreateAssignment(true); setActiveNav('Реєстр допомог'); setNotice('') }

  if (!ready) return <StartupScreen/>
  return <YearContext.Provider value={{ year, setYear }}><div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><HeartHandshake size={22} strokeWidth={2.1}/></div><div className="brand-copy"><div className="brand-name">Hromada<span>Aid</span></div><div className="brand-caption">Автоматизована система обліку матеріальних допомог</div></div></div>
      <div className="nav-label">РОБОЧИЙ ПРОСТІР</div>
      <nav className="nav-list">{nav.map(({ label, icon: Icon }) => <button key={label} type="button" aria-label={label} title={label} aria-current={activeNav === label ? 'page' : undefined} className={`nav-item ${activeNav === label ? 'active' : ''}`} onClick={() => navigate(label)}><Icon size={19} strokeWidth={1.8} aria-hidden="true"/><span>{label}</span></button>)}</nav>
      <div className="sidebar-bottom"><div className="nav-label">СИСТЕМА</div><button type="button" className="nav-item" aria-label="Налаштування" title="Налаштування" onClick={() => setNotice('Налаштування будуть доступні у наступному етапі.')}><Settings size={19} strokeWidth={1.8} aria-hidden="true"/><span>Налаштування</span></button><div className="help-card"><div className="help-icon"><CircleHelp size={18}/></div><div><strong>Потрібна допомога?</strong><p>Зверніться до адміністратора системи</p></div><ChevronRight size={17}/></div><div className="user-row"><div className="avatar">ОМ</div><div className="user-copy"><strong>Олена Мельник</strong><span>Адміністратор</span></div><MoreHorizontal size={20} className="muted-icon"/></div></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><Breadcrumbs items={[{ label: 'Робочий простір', section: 'Головна' }, { label: activeNav }]} navigate={navigate}/><div className="top-actions"><YearPicker value={year} onChange={setYear} label="Рік"/></div></header>
      <div className={`content${activeNav === 'Головна' ? ' home-content' : ''}`}>
        {notice && <Alert variant="info" onDismiss={() => setNotice('')}>{notice}</Alert>}
        <div className="page-transition" key={activeNav}>{activeNav === 'Головна' ? <StartPage navigate={navigate} onCreate={newAssignment}/> :
          activeNav === 'Реєстр допомог' ? <AidRegistry createOnOpen={createAssignment}/> :
          activeNav === 'Формування відомостей' ? <StatementFormation/> :
          activeNav === 'Довідники' ? <Dictionaries/> :
          activeNav === 'Огляд' ? <Dashboard/> : <Reports/>}</div>
      </div>
    </main>
  </div><UnsavedChangesConfirmation/></YearContext.Provider>
}

function StartupScreen() {
  return <main className="app-startup" aria-busy="true" aria-label="Підготовка робочого простору HromadaAid">
    <div className="app-startup-content" role="status" aria-live="polite">
      <div className="app-startup-mark"><HeartHandshake size={34} strokeWidth={2}/></div>
      <div className="app-startup-name">Hromada<span>Aid</span></div>
      <p>Автоматизована система обліку матеріальних допомог</p>
      <span className="app-startup-loader" aria-hidden="true"/>
      <span className="visually-hidden">Підготовка робочого простору…</span>
    </div>
  </main>
}

type BreadcrumbItem = { label: string; section?: string }

function Breadcrumbs({ items, navigate }: { items: BreadcrumbItem[]; navigate: (section: string) => void }) {
  return <nav className="crumb" aria-label="Навігаційні крихти"><ol>{items.map((item, index) => <li key={`${index}-${item.label}`}>
    {index > 0 && <ChevronRight size={15} aria-hidden="true"/>}
    {index === items.length - 1 ? <span aria-current="page">{item.label}</span> : item.section
      ? <button type="button" onClick={() => navigate(item.section!)}>{item.label}</button>
      : <span>{item.label}</span>}
  </li>)}</ol></nav>
}

function StartPage({ navigate, onCreate }: { navigate: (label: string) => void; onCreate: () => void }) {
  const { year } = useReportingYear()
  const { data, loading, error, refresh } = useOverviewData(year)
  const links = [
    { title: 'Відкрити реєстр призначень', section: 'Реєстр допомог', text: 'Пошук, редагування та зміна статусів', icon: HandCoins },
    { title: 'Сформувати відомості', section: 'Формування відомостей', text: 'Персональні, зведені та банківські документи', icon: FileText },
    { title: 'Переглянути звітність', section: 'Звітність', text: 'Виплати та виконання річного плану', icon: ChartNoAxesCombined },
    { title: 'Перейти до довідників', section: 'Довідники', text: 'Отримувачі, програми, рішення та банки', icon: BookOpen },
  ]
  return <div className="workspace-page">
    <section className="page-heading workspace-heading"><div className="workspace-coat-area"><img src={communityCoat} alt="Герб Вишнівської територіальної громади"/></div><div className="workspace-identity-copy"><div className="eyebrow">РОБОЧИЙ ПРОСТІР ГРОМАДИ</div><h1><span>Вишнівська селищна</span>{' '}<span>територіальна громада</span></h1><p className="workspace-system-name">HromadaAID</p><p className="subtitle">Автоматизована система обліку матеріальних допомог</p></div></section>
    <section className="dashboard-panel workspace-actions" aria-labelledby="workspace-actions-title">
      <div className="workspace-primary"><div><h2 id="workspace-actions-title">Щоденна робота</h2><p>Оберіть дію, щоб розпочати роботу з призначеннями.</p></div><button type="button" className="primary-button" onClick={onCreate}><Plus size={19}/>Створити призначення</button></div>
      <div className="workspace-shortcuts">{links.map(({ title, section, text, icon: Icon }, index) => <button type="button" aria-label={title} aria-describedby={`workspace-shortcut-${index}`} key={section} onClick={() => navigate(section)}><span className="workspace-action-icon"><Icon size={20} aria-hidden="true"/></span><span><strong>{title}</strong><small id={`workspace-shortcut-${index}`}>{text}</small></span><ArrowUpRight size={18} aria-hidden="true"/></button>)}</div>
    </section>
    <section className="dashboard-panel workspace-year" aria-label="Обліковий період"><div className="workspace-year-label"><CalendarDays size={21} aria-hidden="true"/><div><span>Обраний обліковий рік</span><strong>{year}</strong></div></div><div className="workspace-year-summary" aria-live={loading || error ? undefined : 'polite'}>{loading ? <DataState kind="loading" compact message="Завантажуємо підсумок…"/> : error ? <Alert variant="error" action={<button type="button" onClick={() => void refresh()}>Повторити</button>}>{error}</Alert> : data ? <><strong>{`Призначено допомог: ${data.assignmentCount}`}</strong><span>{data.assignmentCount ? 'Показники та стан виконання доступні в огляді.' : 'Додайте призначення або перевірте записи в реєстрі.'}</span></> : null}</div><button type="button" className="secondary-button" onClick={() => navigate('Огляд')}>Відкрити огляд<ArrowUpRight size={16}/></button></section>
    <footer className="page-footer">
      <p>© {new Date().getFullYear()} Вишнівська селищна рада. Внутрішня інформаційна система.</p>
      <hr aria-hidden="true"/>
      <p className="home-footer-credit"><Code2 size={17} strokeWidth={1.7} aria-hidden="true"/><span>Developed by <strong>Anatolii Myronenko</strong></span></p>
    </footer>
  </div>
}

export default App

