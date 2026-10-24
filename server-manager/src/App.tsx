import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Activity, ArrowRight, ChevronRight, CircleAlert, CircleCheck, Clock3, Cog, Download, FileText, Folder, HeartHandshake, House, Info, Package, RefreshCw, Server, Settings2, ShieldCheck, Wifi } from 'lucide-react'
import Alert from '../../src/components/Alert'
import { DEMO_CHECKED_AT, demoPaths, scenarioIds, scenarios, sections, type ScenarioId, type Section } from './demo'

const navIcons = { overview: House, configuration: Settings2, diagnostics: Activity, updates: Download }
const headings = {
  overview: ['Стан сервера', 'Поточний стан служби Windows, доступність API та основна інформація.'],
  configuration: ['Конфігурація', 'Каталоги та параметри серверного середовища.'],
  diagnostics: ['Діагностика', 'Результати перевірки та безпечні технічні відомості.'],
  updates: ['Оновлення сервера', 'Версії, сумісність і кероване оновлення серверного пакета.'],
} as const

function Panel({ title, icon, children, action, example = false }: { title: string; icon: ReactNode; children: ReactNode; action?: ReactNode; example?: boolean }) {
  return <section className="dashboard-panel sm-panel">
    <header className="sm-panel-header"><h2>{icon}<span>{title}{example && <small> (приклад)</small>}</span></h2>{action}</header>
    {children}
  </section>
}

function Status({ children, tone, plain = false }: { children: ReactNode; tone: string; plain?: boolean }) {
  return <span className={`sm-status sm-status-${tone}${plain ? ' sm-status-plain' : ''}`}><span aria-hidden="true"/>{children}</span>
}

type DemoEvent = { id: string; time: string; title: string; detail: string; level: string; code: string }
function EventTable({ events, compact = false }: { events: DemoEvent[]; compact?: boolean }) {
  return <div className="sm-table-wrap"><table className="sm-events">
    <caption className="visually-hidden">Демонстраційні діагностичні події</caption>
    <thead><tr><th scope="col">Час</th><th scope="col">Рівень</th><th scope="col">Подія</th><th scope="col">Деталі</th></tr></thead>
    <tbody>{events.map(event => <tr key={event.id}>
      <td><time>{event.time}</time></td>
      <td><Status tone={event.level}>{event.level === 'error' ? 'Помилка' : event.level === 'success' ? 'Успіх' : 'Інформація'}</Status></td>
      <td>{event.title}</td>
      <td>{event.detail}{!compact && <details><summary>Технічні відомості</summary><dl className="sm-details"><div><dt>Код</dt><dd>{event.code}</dd></div><div><dt>Ідентифікатор</dt><dd>{event.id}</dd></div></dl></details>}</td>
    </tr>)}{events.length === 0 && <tr><td colSpan={4} className="sm-empty">У вибраному сценарії немає демонстраційних помилок.</td></tr>}</tbody>
  </table></div>
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

  const events: DemoEvent[] = [
    { id: operation.operationId, time: checkedAt, title: operation.status === 'failed' ? 'Демонстраційна перевірка не завершена' : 'Демонстраційна перевірка завершена', detail: operation.status === 'failed' ? operation.message : 'Системні ресурси не опитувались.', level: operation.status === 'failed' ? 'error' : 'success', code: operation.errorCode ?? 'DEMO_OK' },
    { id: 'demo-package-001', time: DEMO_CHECKED_AT, title: 'Серверний пакет відповідає маніфесту', detail: 'Версія 0.1.0 (тестова).', level: 'info', code: 'DEMO_PACKAGE_VALID' },
    { id: 'demo-transport-001', time: DEMO_CHECKED_AT, title: 'Параметри перевірені', detail: 'Локальний HTTP, доступ лише з цього комп’ютера.', level: 'info', code: 'DEMO_LOOPBACK' },
  ]
  const version = scenario.installed ? '0.1.0 · тестова' : 'Не визначена'
  const serviceTone = scenario.service === 'Працює' ? 'success' : scenario.service === 'Зупинена' ? 'warning' : 'info'
  const apiTone = scenario.api === 'Доступний' ? 'success' : scenario.api === 'Недоступний' ? 'error' : 'info'
  const inspect = () => {
    setCheckedAt(new Date().toLocaleString('uk-UA'))
    setNotice('Демонстраційний результат оновлено локально. Запитів до служби чи API не виконано.')
  }
  const viewButton = (target: Section, label = 'Переглянути') => <button className="sm-view-button" type="button" onClick={() => setSection(target)}>{label}<ArrowRight size={16} aria-hidden="true"/></button>
  const scenarioPicker = <div className="sm-scenario"><label htmlFor="demo-scenario">Демонстраційний стан</label><select id="demo-scenario" value={scenarioId} onChange={event => { setScenarioId(event.target.value as ScenarioId); setCheckedAt(DEMO_CHECKED_AT); setNotice('') }}>{scenarioIds.map(id => <option key={id} value={id}>{scenarios[id].label}</option>)}</select></div>

  return <div className="sm-app">
    <a className="sm-skip" href="#manager-content">Перейти до вмісту</a>
    <aside className="sm-sidebar">
      <div className="sm-brand"><span className="sm-brand-mark"><HeartHandshake size={25} aria-hidden="true"/></span><div><strong>Hromada<span>AID</span></strong><small>Server Manager</small></div></div>
      <nav aria-label="Розділи Server Manager">{sections.map(item => { const Icon = navIcons[item.id]; return <button key={item.id} type="button" aria-current={section === item.id ? 'page' : undefined} onClick={() => setSection(item.id)}><Icon size={19} aria-hidden="true"/>{item.label}</button> })}</nav>
      <div className="sm-sidebar-footer"><ShieldCheck size={20} aria-hidden="true"/><div><strong>Ізольована оболонка</strong><span>Лише демонстраційні дані</span></div></div>
    </aside>
    <div className="sm-workspace">
      <header className="sm-topbar"><div><strong>HromadaAID Server Manager</strong><span>Керування серверною службою та технічна діагностика</span></div><div className="sm-topbar-meta"><span className="sm-version">Версія {__MANAGER_VERSION__}</span><Status tone="success">Демонстраційний режим</Status></div></header>
      <main id="manager-content" className="sm-main" tabIndex={-1}>
        <div className="sm-demo-banner"><Info size={17} aria-hidden="true"/><span><strong>Демонстраційний режим.</strong> Усі стани, шляхи й події тестові. Системні операції недоступні.</span></div>
        <div className="sm-page-heading"><div><h1 ref={heading} tabIndex={-1}>{headings[section][0]}</h1><p>{headings[section][1]}</p></div><div className="sm-heading-controls">{scenarioPicker}{section === 'overview' && <button className="secondary-button" type="button" onClick={inspect}><RefreshCw size={16} aria-hidden="true"/>Демоперевірка</button>}</div></div>
        {notice && <p className="sm-local-notice" role="status">{notice}</p>}

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
            <Panel title="Конфігурація" icon={<Settings2 size={21} aria-hidden="true"/>} example action={viewButton('configuration')}><dl className="sm-details sm-summary-rows"><div><dt>Адреса API</dt><dd>http://127.0.0.1:3000</dd></div><div><dt>Каталог програми</dt><dd>{demoPaths.program}</dd></div><div><dt>Серверні дані</dt><dd>{demoPaths.data}</dd></div><div><dt>Резервні копії</dt><dd>{demoPaths.backups}</dd></div></dl></Panel>
            <Panel title="Оновлення" icon={<Download size={21} aria-hidden="true"/>} example action={viewButton('updates')}><p className="sm-card-lead">Доступна нова версія сервера</p><dl className="sm-details sm-summary-rows"><div><dt>Встановлена версія</dt><dd>{version}</dd></div><div><dt>Доступна версія</dt><dd>0.1.1</dd></div></dl><p className="sm-card-note">Приклад. Перевірка релізів і завантаження ще не підключені.</p></Panel>
          </div>
          <Panel title="Останні діагностичні події" icon={<Activity size={21} aria-hidden="true"/>} action={<button className="sm-link" type="button" onClick={() => setSection('diagnostics')}>Усі події<ArrowRight size={16} aria-hidden="true"/></button>}><EventTable events={events} compact/></Panel>
          {!scenario.installed && <div className="sm-future-action"><button className="primary-button" type="button" disabled>Встановити сервер</button><span>Майстер і Installation Engine будуть підключені на наступних етапах.</span></div>}
        </>}

        {section === 'configuration' && <>
          <Panel title="Каталоги" icon={<Folder size={21} aria-hidden="true"/>} example><dl className="sm-directory-list">{([['Каталог програми', demoPaths.program, 'Виконувані файли та ресурси сервера.'], ['Каталог даних', demoPaths.data, 'SQLite, конфігурація, журнали й захищені службові файли.'], ['Каталог резервних копій', demoPaths.backups, 'Незалежний каталог архівів .hraid.']] as const).map(([label, path, hint]) => <div key={label}><span className="sm-card-icon"><Folder size={21} aria-hidden="true"/></span><div><dt>{label}</dt><small>{hint}</small></div><dd>{path}</dd></div>)}</dl></Panel>
          <Panel title="Параметри підключення" icon={<Settings2 size={21} aria-hidden="true"/>} example><dl className="sm-details sm-setting-rows"><div><dt><Server size={17} aria-hidden="true"/>Адреса і порт</dt><dd>127.0.0.1:3000</dd></div><div><dt><ShieldCheck size={17} aria-hidden="true"/>Транспорт</dt><dd>HTTP · лише цей комп’ютер</dd></div><div><dt><Cog size={17} aria-hidden="true"/>Назва служби</dt><dd>HromadaAIDApi</dd></div><div><dt><ShieldCheck size={17} aria-hidden="true"/>Обліковий запис</dt><dd>LocalService</dd></div></dl></Panel>
          <Alert variant="info">Показано тестові параметри. Редагування недоступне. Для мережевого доступу потрібен HTTPS; зміна каталогу не переміщуватиме дані автоматично.</Alert>
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
      </main>
    </div>
  </div>
}
