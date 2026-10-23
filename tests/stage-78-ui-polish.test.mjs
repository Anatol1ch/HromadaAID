import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')
const [app, styles, login, toast, accessDenied, settings, planning, backups] = await Promise.all([
  read('../src/App.tsx'), read('../src/styles.css'), read('../src/components/LoginScreen.tsx'),
  read('../src/components/SystemToast.tsx'), read('../src/components/AccessDeniedToast.tsx'),
  read('../src/SettingsPage.tsx'), read('../src/AnnualPlanning.tsx'), read('../src/ServerBackupPanel.tsx'),
])

test('login connection action is an accessible icon-only button', () => {
  assert.match(login, /className="auth-connection-link" aria-label="Налаштувати підключення" title="Налаштувати підключення"/)
  assert.match(login, /<Settings size=\{16\} aria-hidden="true"\/>/)
  assert.doesNotMatch(login, /className="auth-connection-link"[^>]*>[^<]*Налаштувати підключення/)
})

test('home year remains horizontal while analytics stay behind the overview permission gate', () => {
  assert.match(app, /Обраний обліковий рік:<\/span><strong>\{year\}<\/strong>/)
  assert.match(app, /canViewOverview \? <>\s*<OverviewHomeSummary year=\{year\}\/>/)
  assert.match(styles, /\.workspace-year-label > div \{ display: flex; align-items: baseline/)
  assert.match(styles, /\.workspace-year-label strong \{[^}]*color: #2f7546/)
})

test('SystemToast uses one five-second card treatment and access-denied shares it', () => {
  assert.match(toast, /duration = 5_000/)
  assert.match(toast, /window\.setTimeout\(onClose, duration\)/)
  assert.match(accessDenied, /<SystemToast kind="access-denied"/)
  assert.match(styles, /\.system-toast \{[^}]*var\(--radius-modal\)[^}]*var\(--shadow-modal\)/)
  assert.match(styles, /\.system-toast-access-denied/)
})

test('settings tabs fill the row proportionally in the required order', () => {
  const labels = ['Мій обліковий запис', 'Підключення до сервера', 'Резервне копіювання', 'Про програму'].map(value => settings.indexOf(value))
  assert.deepEqual(labels, [...labels].sort((a, b) => a - b))
  assert.match(styles, /\.settings-section-nav \{[^}]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/)
  assert.match(styles, /\.settings-section-current \{ display: flex; width: 100%;[^}]*justify-content: center/)
})

test('support contacts keep safe Electron links and have visible labels', () => {
  for (const label of ['Телефон', 'Робоча електронна пошта', 'Особиста електронна пошта', 'Telegram']) assert(app.includes(`<small>${label}</small>`))
  assert.equal((app.match(/appInfo\.openExternal\(/g) ?? []).length, 4)
})

test('planning table constrains numeric columns and preserves a separate actions column', () => {
  assert(planning.includes('return <colgroup><col/><col style={{width:150}}/><col style={{width:190}}/><col style={{width:165}}/></colgroup>'))
  assert.match(planning, /col style=\{\{width:165\}\}/)
  assert.match(styles, /\.planning-table \{ width: 100%; min-width: 680px; table-layout: fixed;/)
})

test('restore confirmation retains its safeguards without the obsolete preview error block', () => {
  assert.doesNotMatch(backups, /<Alert variant="error">\{preview\.message\}<\/Alert>/)
  assert.match(backups, /Дата копії: \{date\(preview\.createdAt\)\}/)
  assert.match(backups, /Підготовка відновлення не означає, що дані вже відновлено/)
  assert.match(backups, /checked=\{confirmed\}/)
  assert.match(backups, /confirmRestore\(preview\.id, preview\.confirmationToken\)/)
})
