import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Activity, ArrowRight, Check, CircleAlert, Clock3, Download, Folder, HardDrive, HeartHandshake, Info, LayoutDashboard, RefreshCw, Server, Settings2, ShieldCheck, Wifi } from 'lucide-react'
import Alert from '../../src/components/Alert'
import { DEMO_CHECKED_AT, demoPaths, scenarioIds, scenarios, sections, type ScenarioId, type Section } from './demo'

const navIcons = { overview: LayoutDashboard, configuration: Settings2, diagnostics: Activity, updates: Download }
const headings = {
  overview: ['Огляд сервера', 'Стан служби, доступність API та останні події в одному місці.'],
  configuration: ['Конфігурація', 'Каталоги та параметри серверного середовища.'],
  diagnostics: ['Діагностика', 'Етапи перевірки та безпечні технічні відомості.'],
  updates: ['Оновлення сервера', 'Версії, сумісність і майбутнє кероване оновлення.'],
} as const

function Panel({ title, icon, children, action }: { title: string; icon: ReactNode; children: ReactNode; action?: ReactNode }) {
  return <section className="dashboard-panel sm-panel"><header className="sm-panel-header"><h2>{icon}{title}</h2>{action}</header>{children}</section>
}

function Status({ children, tone }: { children: ReactNode; tone: string }) {
  return <span className={`sm-status sm-status-${tone}`}><span aria-hidden="true"/>{children}</span>
}

export default function App() {
  const [section, setSection] = useState<Section>('overview')
  const [scenarioId, setScenarioId] = useState<ScenarioId>('running')
  const [checkedAt, setCheckedAt] = useState(DEMO_CHECKED_AT)
  const [filter, setFilter] = useState<'all' | 'issues'>('all')
  const [notice, setNotice] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)
  const previousSection = useRef(section)
  const scenario = scenarios[scenarioId]
  const operation = scenario.operation
  useEffect(() => {
    if (previousSection.current !== section) heading.current?.focus()
    previousSection.current = section
  }, [section])

  const events = [
    { id: operation.operationId, time: checkedAt, title: operation.message, level: operation.status === 'failed' ? 'error' : 'info', code: operation.errorCode ?? 'DEMO_OK' },
    { id: 'demo-package-001', time: DEMO_CHECKED_AT, title: 'Приклад результату: серверний пакет відповідає маніфесту.', level: 'info', code: 'DEMO_PACKAGE_VALID' },
    { id: 'demo-transport-001', time: DEMO_CHECKED_AT, title: 'Приклад параметрів: локальний HTTP, доступ лише з цього комп’ютера.', level: 'info', code: 'DEMO_LOOPBACK' },
  ]
  const version = scenario.installed ? '0.1.0 · тестова' : 'Не визначена'
  const inspect = () => {
    setCheckedAt(new Date().toLocaleString('uk-UA'))
    setNotice('Демонстраційний результат оновлено локально. Запитів до служби чи API не виконано.')
  }

  const eventList = (compact = false) => <ul className="sm-events">{events.filter(event => compact || filter === 'all' || event.level === 'error').map(event => <li key={event.id}>
    <span className={`sm-event-icon ${event.level === 'error' ? 'is-error' : ''}`}>{event.level === 'error' ? <CircleAlert size={17} aria-hidden="true"/> : <Check size={17} aria-hidden="true"/>}</span>
    <div><strong>{event.title}</strong><span>{event.time} · тестова подія</span>{!compact && <details><summary>Технічні відомості</summary><dl className="sm-details"><div><dt>Код</dt><dd>{event.code}</dd></div><div><dt>Ідентифікатор</dt><dd>{event.id}</dd></div></dl></details>}</div>
  </li>)}{!compact && filter === 'issues' && !events.some(event => event.level === 'error') && <li>У вибраному сценарії немає демонстраційних помилок.</li>}</ul>

  return <div className="sm-app">
    <a className="sm-skip" href="#manager-content">Перейти до вмісту</a>
    <aside className="sm-sidebar">
      <div className="sm-brand"><span className="sm-brand-mark"><HeartHandshake size={27} aria-hidden="true"/></span><div><strong>Hromada<span>AID</span></strong><small>Server Manager</small></div></div>
      <div className="sm-nav-label">СЕРВЕРНЕ СЕРЕДОВИЩЕ</div>
      <nav aria-label="Розділи Server Manager">{sections.map(item => { const Icon = navIcons[item.id]; return <button key={item.id} type="button" aria-current={section === item.id ? 'page' : undefined} onClick={() => setSection(item.id)}><Icon size={19} aria-hidden="true"/>{item.label}{section === item.id && <span className="sm-nav-dot"/>}</button> })}</nav>
      <div className="sm-sidebar-footer"><ShieldCheck size={20} aria-hidden="true"/><div><strong>Ізольована оболонка</strong><span>Демонстраційні дані</span></div></div>
    </aside>
    <div className="sm-workspace">
      <header className="sm-topbar"><span>HromadaAID Server Manager</span><span className="sm-version">Версія {__MANAGER_VERSION__}</span></header>
      <main id="manager-content" className="sm-main" tabIndex={-1}>
        <div className="sm-demo-banner"><Info size={18} aria-hidden="true"/><span><strong>Демонстраційний режим.</strong> Усі стани, шляхи й події тестові. Системні операції недоступні.</span></div>
        <div className="sm-page-heading"><div><p className="sm-eyebrow">ТЕХНІЧНЕ АДМІНІСТРУВАННЯ</p><h1 ref={heading} tabIndex={-1}>{headings[section][0]}</h1><p>{headings[section][1]}</p></div>{section === 'overview' && <button className="secondary-button" type="button" onClick={inspect}><RefreshCw size={16} aria-hidden="true"/>Демоперевірка</button>}</div>
        <div className="sm-scenario"><label htmlFor="demo-scenario">Демонстраційний стан</label><select id="demo-scenario" value={scenarioId} onChange={event => { setScenarioId(event.target.value as ScenarioId); setCheckedAt(DEMO_CHECKED_AT); setNotice('') }}>{scenarioIds.map(id => <option key={id} value={id}>{scenarios[id].label}</option>)}</select></div>
        {notice && <p className="sm-local-notice" role="status">{notice}</p>}

        {section === 'overview' && <>
          <section className={`dashboard-panel sm-hero sm-hero-${scenario.tone}`} aria-labelledby="server-state-title"><div className="sm-hero-top"><span className="sm-hero-icon"><Server size={28} aria-hidden="true"/></span><Status tone={scenario.tone}>Тестовий стан</Status></div><h2 id="server-state-title">{scenario.title}</h2><p>{scenario.message}</p><div className="sm-state-grid"><div><span><Server size={16} aria-hidden="true"/>Windows Service</span><strong>{scenario.service}</strong><small>HromadaAIDApi · приклад</small></div><div><span><Wifi size={16} aria-hidden="true"/>Доступність API</span><strong>{scenario.api}</strong><small>Синтетичний результат</small></div><div><span><HardDrive size={16} aria-hidden="true"/>Серверний пакет</span><strong>{version}</strong><small>Windows · x64</small></div></div><div className="sm-hero-footer"><Clock3 size={15} aria-hidden="true"/>Остання демоперевірка: {checkedAt}<button type="button" onClick={() => setSection('diagnostics')}>Діагностика<ArrowRight size={15} aria-hidden="true"/></button></div></section>
          <div className="sm-two-columns"><Panel title="Конфігурація" icon={<Settings2 size={19} aria-hidden="true"/>} action={<button className="sm-link" type="button" onClick={() => setSection('configuration')}>Переглянути<ArrowRight size={15} aria-hidden="true"/></button>}><dl className="sm-details"><div><dt>Адреса · приклад</dt><dd>http://127.0.0.1:3000</dd></div><div><dt>Дані · приклад</dt><dd>{demoPaths.data}</dd></div></dl></Panel><Panel title="Оновлення" icon={<Download size={19} aria-hidden="true"/>}><p className="sm-card-lead">Кероване оновлення сервера</p><p className="sm-muted">Приклад доступної версії: 0.1.1. Автоматична перевірка та завантаження ще не підключені.</p><button className="sm-link" type="button" onClick={() => setSection('updates')}>Переглянути приклад<ArrowRight size={15} aria-hidden="true"/></button></Panel></div>
          <Panel title="Останні діагностичні події" icon={<Activity size={19} aria-hidden="true"/>} action={<button className="sm-link" type="button" onClick={() => setSection('diagnostics')}>Усі події<ArrowRight size={15} aria-hidden="true"/></button>}>{eventList(true)}</Panel>
          {!scenario.installed && <div className="sm-future-action"><button className="primary-button" type="button" disabled>Встановити сервер</button><span>Майстер і Installation Engine будуть підключені на наступних етапах.</span></div>}
        </>}

        {section === 'configuration' && <>
          <Alert variant="info">Перегляд тестових параметрів. Значення не зчитуються з комп’ютера й не зберігаються.</Alert>
          <Panel title="Каталоги" icon={<Folder size={19} aria-hidden="true"/>}><dl className="sm-directory-list">{([['Програмні файли', demoPaths.program, 'Виконувані файли та ресурси сервера.'], ['Серверні дані', demoPaths.data, 'SQLite, конфігурація, журнали й захищені службові файли.'], ['Резервні копії', demoPaths.backups, 'Незалежний каталог архівів .hraid.']] as const).map(([label, path, hint]) => <div key={label}><span className="sm-folder-icon"><Folder size={20} aria-hidden="true"/></span><div><dt>{label} · приклад</dt><dd>{path}</dd><small>{hint}</small></div></div>)}</dl></Panel>
          <Panel title="Підключення та служба" icon={<Server size={19} aria-hidden="true"/>}><dl className="sm-details sm-config-grid"><div><dt>Транспорт · приклад</dt><dd>HTTP · лише цей комп’ютер</dd></div><div><dt>Адреса і порт · приклад</dt><dd>127.0.0.1:3000</dd></div><div><dt>Назва служби · приклад</dt><dd>HromadaAIDApi</dd></div><div><dt>Обліковий запис · приклад</dt><dd>LocalService</dd></div></dl><p className="sm-muted">Для мережевого доступу потрібен HTTPS. Зміна каталогів не означатиме автоматичного переміщення даних.</p><div className="sm-future-action"><button type="button" className="secondary-button" disabled>Змінити конфігурацію</button><span>Редагування недоступне в ізольованій оболонці.</span></div></Panel>
        </>}

        {section === 'diagnostics' && <>
          <Panel title="Остання демонстраційна операція" icon={<Activity size={19} aria-hidden="true"/>}><p className="sm-card-lead">{operation.message}</p><dl className="sm-details sm-config-grid"><div><dt>Ідентифікатор</dt><dd>{operation.operationId}</dd></div><div><dt>Етап / статус</dt><dd>{operation.stage} / {operation.status}</dd></div><div><dt>Код помилки</dt><dd>{operation.errorCode ?? 'Немає'}</dd></div><div><dt>Підвищення прав</dt><dd>{operation.requiresElevation ? 'Буде потрібне для реальної операції' : 'Не потрібне'}</dd></div><div><dt>Повторення</dt><dd>{operation.retry.reason}</dd></div></dl></Panel>
          <Panel title="Тестовий журнал подій" icon={<Clock3 size={19} aria-hidden="true"/>} action={<label className="sm-filter">Показати<select value={filter} onChange={event => setFilter(event.target.value as 'all' | 'issues')}><option value="all">Усі події</option><option value="issues">Лише помилки</option></select></label>}>{eventList()}</Panel>
          <p className="sm-muted">Експорт реальної діагностики ще не підключено. Паролі, токени та ключі не входять до контракту операції.</p>
        </>}

        {section === 'updates' && <>
          <Alert variant="info">Приклад майбутнього оновлення. Перевірка релізів, завантаження та встановлення не виконуються.</Alert>
          <Panel title="Серверний пакет" icon={<Download size={19} aria-hidden="true"/>}><div className="sm-update-versions"><div><span>Поточна · тестова</span><strong>{version}</strong></div><ArrowRight size={24} aria-hidden="true"/><div><span>Доступна · приклад</span><strong>0.1.1</strong></div></div><dl className="sm-details sm-config-grid"><div><dt>API-контракт · приклад</dt><dd>hromadaaid-rest v1</dd></div><div><dt>Схема SQLite · приклад</dt><dd>Підтримувані версії 1–28</dd></div></dl><p className="sm-muted">Перед застосуванням потрібно перевірити автентичність пакета, сумісність схеми й можливість безпечного відкату. Суми SHA-256 самі по собі не підтверджують походження.</p><div className="sm-future-action"><button className="primary-button" type="button" disabled>Перевірити оновлення</button><span>Система оновлень буде реалізована окремо.</span></div></Panel>
          <Panel title="Як працюватиме оновлення" icon={<ShieldCheck size={19} aria-hidden="true"/>}><ol className="sm-update-steps"><li>Перевірка пакета та сумісності</li><li>Підтвердження адміністратора</li><li>Контрольоване зупинення й заміна серверних файлів</li><li>Запуск служби та перевірка API</li></ol><p className="sm-muted">Дані, ключі й резервні копії зберігаються незалежно від виконуваних файлів. Оновлення основного клієнта керується в самому клієнті.</p></Panel>
        </>}
        <footer className="sm-page-footer">HromadaAID Server Manager · ізольована оболонка D2.3B</footer>
      </main>
    </div>
  </div>
}
