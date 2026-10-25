import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')
const [settings, clientMain, clientPreload, manager, managerMain] = await Promise.all([
  read('../src/SettingsPage.tsx'), read('../electron/main.ts'), read('../electron/preload.cts'),
  read('../server-manager/src/BackupManagement.tsx'), read('../server-manager/electron/main.ts'),
])

test('Client no longer exposes or starts backup replication and keeps normal account settings', () => {
  assert.doesNotMatch(settings, /BackupSettings|Резервне копіювання|activeSection.*backup/)
  assert.doesNotMatch(clientMain, /RemoteBackupClient|BackupInstallationIdentity|backups:/)
  assert.doesNotMatch(clientPreload, /backups:/)
  assert.match(settings, /Мій обліковий запис/)
  assert.match(settings, /Підключення до сервера/)
})

test('Server Manager requires backup permission and keeps restore confirmation separate from archive validation', () => {
  assert.match(managerMain, /result\.user\.permissions\.includes\('backups\.manage'\)/)
  assert.match(managerMain, /--verify-only/)
  assert.match(managerMain, /--manager-confirmed/)
  assert.match(manager, /Архів і база SQLite перевірені/)
  assert.match(manager, /Розпочати відновлення/)
  assert.match(manager, /Перед заміною буде створено страхову копію/)
})
