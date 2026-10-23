import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { beginExclusiveOperation, restorePendingNotice } from '../src/lib/backup-operations.ts'

const settingsPage = await readFile(new URL('../src/SettingsPage.tsx', import.meta.url), 'utf8')
const backupPanel = await readFile(new URL('../src/ServerBackupPanel.tsx', import.meta.url), 'utf8')
const backupSettings = await readFile(new URL('../src/BackupSettings.tsx', import.meta.url), 'utf8')

test('settings tabs keep account, connection, backup, about order and preserve admin-only server actions', () => {
  const positions = ['Мій обліковий запис', 'Підключення до сервера', 'Резервне копіювання', 'Про програму'].map(label => settingsPage.indexOf(label))
  assert(positions.every(position => position >= 0))
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b))
  assert.match(backupSettings, /administrator && <ServerBackupPanel/)
})

test('a backup operation acquires a single in-flight lock and remains pending until completion', async () => {
  const lock = { current: false }
  let finish
  let secondRun = 0
  let completed = false
  const first = beginExclusiveOperation(lock, () => new Promise(resolve => { finish = resolve }))
  assert.equal(first.started, true)
  first.result.then(() => { completed = true })
  const second = beginExclusiveOperation(lock, async () => { secondRun += 1 })
  assert.equal(second.started, false)
  assert.equal(secondRun, 0)
  assert.equal(completed, false)
  finish({ ok: true })
  assert.deepEqual(await first.result, { ok: true })
  assert.equal(completed, true)
  assert.equal(lock.current, false)
})

test('completion notices are set only after awaited API success and restore confirmation is explicitly pending', () => {
  const create = backupPanel.indexOf('const value = await window.hromadaAid.backups.createServer()')
  const createdNotice = backupPanel.indexOf("title: 'Резервну копію створено'", create)
  assert(create >= 0 && createdNotice > create)
  const download = backupPanel.indexOf('const result = await window.hromadaAid.backups.downloadServer(item.id)')
  const downloadedNotice = backupPanel.indexOf("title: 'Архів завантажено'", download)
  assert(download >= 0 && downloadedNotice > download)
  assert.match(backupPanel, /if \(!mounted\.current \|\| !result\.ok\)/)
  const confirmed = backupPanel.indexOf('const result = await window.hromadaAid.backups.confirmRestore')
  const pending = backupPanel.indexOf('setMaintenance(true)', confirmed)
  assert(confirmed >= 0 && pending > confirmed)
  assert.match(restorePendingNotice.message, /ще не відновлено/)
  assert.doesNotMatch(restorePendingNotice.message, /pnpm server:backup-restore|зупиніть Fastify/)
  assert.match(backupPanel, /Для адміністратора сервера[\s\S]*pnpm server:backup-restore/)
  assert.match(backupPanel, /Увага! Відновлення замінить поточні дані системи/)
  assert.doesNotMatch(restorePendingNotice.title + restorePendingNotice.message, /відновлення завершено|базу відновлено/i)
  assert.match(backupPanel, /Резервна копія пройшла перевірку та готова до підтвердження відновлення/)
})
