import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')
const [app, styles, login, toast, accessDenied, settings, planning, backups, toastHost] = await Promise.all([
  read('../src/App.tsx'), read('../src/styles.css'), read('../src/components/LoginScreen.tsx'),
  read('../src/components/SystemToast.tsx'), read('../src/components/AccessDeniedToast.tsx'),
  read('../src/SettingsPage.tsx'), read('../src/AnnualPlanning.tsx'), read('../server-manager/src/BackupManagement.tsx'), read('../src/components/SystemToastHost.tsx'),
])

test('login connection action is an accessible icon-only button', () => {
  assert.match(login, /className="auth-connection-link" aria-label="Налаштувати підключення" title="Налаштувати підключення"/)
  assert.match(login, /<Settings size=\{16\} aria-hidden="true"\/>/)
  assert.doesNotMatch(login, /className="auth-connection-link"[^>]*>[^<]*Налаштувати підключення/)
})

test('home year remains horizontal while analytics stay behind the overview permission gate', () => {
  assert.match(app, /workspace-year-label"><CalendarDays[^>]*\/><strong>\{year\}<\/strong>/)
  assert.match(app, /canViewOverview \? <>\s*<OverviewHomeSummary year=\{year\}\/>/)
  assert.match(styles, /\.workspace-year-label \{ display: flex; flex: none; align-items: center/)
  assert.match(styles, /\.workspace-year-label > strong \{ color: #2f7546; font-size: 22px;/)
  assert.match(app, /workspace-year-neutral"><span>Робочий простір громади<\/span>/)
  assert.match(app, /data \? <strong>\{`Призначено допомог:/)
  assert.doesNotMatch(app, /Показники та стан виконання доступні в огляді/)
})

test('SystemToast keeps the access-denied visual treatment with a short default duration', () => {
  assert.match(toast, /duration = 3_500/)
  assert.match(toast, /window\.setTimeout\(\(\) => setClosing\(true\), duration\)/)
  assert.match(toast, /createPortal\(<aside className=\{`system-toast/)
  assert.match(toast, /setTimeout\(\(\) => closeRef\.current\(\), 180\)/)
  assert.match(accessDenied, /<SystemToast kind="access-denied"/)
  assert.match(accessDenied, /duration=\{5_000\}/)
  assert.match(toastHost, /duration: typeof detail\.duration === 'number'/)
  assert.match(toastHost, /notifySystemToast\(kind: SystemNoticeKind, title: string, message: string, duration = 3_500\)/)
  assert.match(app, /notifySystemToast\('access-denied'/)
  assert.match(styles, /\.system-toast-success/)
  assert.match(styles, /\.system-toast-error/)
  assert.match(styles, /\.system-toast-warning/)
  assert.match(styles, /\.system-toast \{[^}]*left: 50%;[^}]*var\(--radius-modal\)[^}]*var\(--shadow-modal\)[^}]*transform: translateX\(-50%\)/)
  assert.match(styles, /\.system-toast.is-closing/)
  assert.match(styles, /\.system-toast-access-denied/)
})

test('settings tabs fill the row proportionally without backup administration in Client', () => {
  const labels = ['Мій обліковий запис', 'Підключення до сервера', 'Про програму'].map(value => settings.indexOf(value))
  assert.deepEqual(labels, [...labels].sort((a, b) => a - b))
  assert.doesNotMatch(settings, /Резервне копіювання/)
  assert.match(styles, /\.settings-section-nav \{[^}]*display: flex/)
  assert.match(styles, /\.settings-section-current \{ display: flex; flex: 1 1 0; width: 100%;[^}]*justify-content: center/)
  assert.doesNotMatch(styles, /\.settings-section-nav \{[^}]*grid-template-columns/)
})

test('support contacts keep safe Electron links and have visible labels', () => {
  for (const label of ['Телефон', 'Робоча електронна пошта', 'Особиста електронна пошта', 'Telegram']) assert(app.includes(`<small>${label}</small>`))
  assert.equal((app.match(/appInfo\.openExternal\(/g) ?? []).length, 4)
})

test('planning table constrains numeric columns and preserves a separate actions column', () => {
  assert(planning.includes('return <colgroup><col/><col style={{width:150}}/><col style={{width:190}}/><col style={{width:185}}/></colgroup>'))
  assert.match(styles, /\.planning-table th:nth-child\(3\), \.planning-table td:nth-child\(3\) \{ padding-right: 26px; \}/)
  assert.match(styles, /\.planning-table \{ width: 100%; min-width: 680px; table-layout: fixed;/)
})

test('Manager restore requires separate verification and explicit confirmation', () => {
  assert.match(backups, /backupVerify\(id, key \|\| undefined\)/)
  assert.match(backups, /backupRestore\(restore\.id, true/)
  assert.match(backups, /Поточні дані сервера буде замінено/)
  assert.match(backups, /Розпочати відновлення/)
})
