import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { effectivePermissions, hasWorkspacePage } from '../shared/authorization.ts'

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const aidRegistry = await readFile(new URL('../src/AidRegistry.tsx', import.meta.url), 'utf8')
const dictionaries = await readFile(new URL('../src/Dictionaries.tsx', import.meta.url), 'utf8')
const login = await readFile(new URL('../src/components/LoginScreen.tsx', import.meta.url), 'utf8')
const select = await readFile(new URL('../src/components/Select.tsx', import.meta.url), 'utf8')

test('overview home card and its data query use the same page and permission gate', () => {
  for (const role of ['administrator', 'planning_specialist', 'viewer']) assert(hasWorkspacePage([role], 'overview') && effectivePermissions([role]).includes('dashboard.read'))
  for (const role of ['assignment_specialist', 'payment_specialist']) assert.equal(hasWorkspacePage([role], 'overview'), false)
  assert(hasWorkspacePage(['payment_specialist', 'viewer'], 'overview'))
  assert.match(app, /canViewOverview=\{canOpenPage\('overview', 'dashboard\.read'\)\}/)
  assert.match(app, /canViewOverview \? <>\s*<OverviewHomeSummary/)
  assert.match(app, /function OverviewHomeSummary[\s\S]*useOverviewData\(year, false\)/)
  assert.doesNotMatch(app, /const \{ year \} = useReportingYear\(\); const \{ data, loading, error, refresh \} = useOverviewData/)
})

test('blocked navigation uses the single role-neutral hint and visible dictionary tabs retain their lock', () => {
  assert.match(app, /const ACCESS_RESTRICTED_HINT = 'Доступ для вашої ролі обмежено'/)
  assert.doesNotMatch(app, /Доступ мають ролі/)
  assert.match(dictionaries, /title=\{available \? label : 'Доступ для вашої ролі обмежено'\}/)
})

test('filters retain their IDs and options while duplicate captions are removed and long selections get a title', () => {
  assert.match(aidRegistry, /decisionId: value/)
  assert.match(aidRegistry, /programId: value, aidTypeId: ''/)
  assert.match(aidRegistry, /aidTypeId: value/)
  assert.doesNotMatch(aidRegistry, /aid-filter-value|filterProgramName|filterAidTypeName|filterDecisionName/)
  assert.match(select, /title=\{selected\?\.label\}/)
  assert.match(select, /aria-valuetext=\{selected\?\.label \?\? placeholder\}/)
})

test('batch actions render after the register table and preserve the selection state actions', () => {
  const table = aidRegistry.indexOf('className="aid-table-wrap"')
  const toolbar = aidRegistry.indexOf('className="aid-batch-toolbar"')
  assert(table >= 0 && toolbar > table)
  assert.match(aidRegistry, /selectedIds\.size > 0 && <div className="aid-batch-toolbar"/)
  assert.match(aidRegistry, /Змінити статус/)
  assert.match(aidRegistry, /Скасувати вибір/)
})

test('login connection configuration remains available and Server Manager owns the restore UI', async () => {
  assert.match(login, /className="auth-connection-link"/)
  const manager = await readFile(new URL('../server-manager/src/BackupManagement.tsx', import.meta.url), 'utf8')
  assert.match(manager, /Під час відновлення сервер буде тимчасово недоступний/)
  assert.match(manager, /Розпочати відновлення/)
})

test('settings navigation remains full width and Client excludes backup administration', async () => {
  const settings = await readFile(new URL('../src/SettingsPage.tsx', import.meta.url), 'utf8')
  const labels = ['Мій обліковий запис', 'Підключення до сервера', 'Про програму'].map(value => settings.indexOf(value))
  assert.doesNotMatch(settings, /Резервне копіювання/)
  assert.deepEqual(labels, [...labels].sort((a, b) => a - b))
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')
  assert.match(styles, /\.settings-section-nav \{ width: 100%/)
  assert.doesNotMatch(styles, /\.settings-section-current:last-child/)
})
