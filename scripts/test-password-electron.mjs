import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'vite'
import { openInitializedDatabase } from '../dist-server/electron/database.js'
import { createApp } from '../dist-server/server/src/app.js'
import { createFirstAdministrator } from '../dist-server/server/src/auth.js'

// Functional submit/IPC/HTTP regression only; no visual assertions or production data.
const root = await mkdtemp(join(tmpdir(), 'hromada-password-electron-'))
const profile = join(root, 'profile')
const username = 'synthetic-admin'
const oldPassword = 'initial password 😀'
const newPassword = ' новий пароль 😀 '
let database, api, vite, electron
try {
  database = openInitializedDatabase(join(root, 'test.sqlite'))
  assert.equal((await createFirstAdministrator(database, { username, password: oldPassword })).ok, true)
  api = createApp(database)
  api.log.level = 'silent'
  const changes = []
  api.addHook('onResponse', async (request, reply) => {
    if (request.url === '/auth/change-password') changes.push(reply.statusCode)
  })
  await api.listen({ host: '127.0.0.1', port: 0 })
  const baseUrl = `http://127.0.0.1:${api.server.address().port}`
  const login = async password => {
    const response = await fetch(`${baseUrl}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) })
    return { status: response.status, body: await response.json() }
  }
  const observer = await login(oldPassword)
  assert.equal(observer.status, 200)
  vite = await createServer({ server: { host: '127.0.0.1', port: 5175, strictPort: true, open: false }, clearScreen: false })
  await vite.listen()
  const runtime = join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')
  const { _electron } = await import(pathToFileURL(runtime).href)
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'ELECTRON_RUN_AS_NODE'))
  electron = await _electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), args: [resolve('.')], cwd: resolve('.'), env: { ...env, HROMADAAID_MODE: 'remote', HROMADAAID_API_URL: baseUrl, HROMADA_AID_TEST_DATA_DIR: profile } })
  let diagnostics = ''
  electron.process().stdout.on('data', chunk => { diagnostics += chunk.toString().split('\n').filter(line => line.includes('[HromadaAID test]')).join('\n') })
  const page = await electron.firstWindow()
  page.setDefaultTimeout(10_000)
  assert.equal(resolve(await electron.evaluate(({ app }) => app.getPath('userData'))), resolve(profile))
  await page.getByLabel('Логін', { exact: true }).fill(username)
  await page.getByLabel('Пароль', { exact: true }).fill(oldPassword)
  await page.getByRole('button', { name: 'Увійти', exact: true }).click()
  await page.getByRole('button', { name: 'Налаштування', exact: true }).click()
  await page.getByRole('button', { name: 'Змінити пароль', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Зміна пароля', exact: true })
  await dialog.getByLabel('Поточний пароль', { exact: true }).fill('incorrect password')
  await dialog.getByLabel('Новий пароль', { exact: true }).fill(newPassword)
  await dialog.getByLabel('Підтвердження нового пароля', { exact: true }).fill(newPassword)
  await dialog.getByRole('button', { name: 'Змінити пароль', exact: true }).click()
  await dialog.getByText('Поточний пароль неправильний.', { exact: true }).waitFor()
  assert.equal((await page.evaluate(() => window.hromadaAid.auth.getState())).status, 'authenticated')
  assert.equal((await login(oldPassword)).status, 200)
  assert.equal((await login(newPassword)).status, 401)
  assert.deepEqual(changes, [400])
  console.log('PASS real Electron form submit, preload/IPC and HTTP reject wrong current password without logout')
  await dialog.getByLabel('Поточний пароль', { exact: true }).fill(oldPassword)
  await dialog.getByRole('button', { name: 'Змінити пароль', exact: true }).click()
  await page.getByRole('heading', { name: 'Вхід до системи', exact: true }).waitFor()
  await page.getByText('Пароль змінено. Увійдіть з новим паролем.', { exact: true }).waitFor()
  assert.deepEqual(changes, [400, 204])
  assert.equal((await login(oldPassword)).status, 401)
  assert.equal((await login(newPassword)).status, 200)
  assert.equal((await fetch(`${baseUrl}/auth/me`, { headers: { authorization: `Bearer ${observer.body.token}` } })).status, 401)
  await page.getByLabel('Логін', { exact: true }).fill(username)
  await page.getByLabel('Пароль', { exact: true }).fill(newPassword)
  await page.getByRole('button', { name: 'Увійти', exact: true }).click()
  await page.getByRole('button', { name: 'Налаштування', exact: true }).waitFor()
  assert.equal((await page.evaluate(() => window.hromadaAid.auth.getState())).status, 'authenticated')
  assert.ok(diagnostics.includes(`POST ${baseUrl}/auth/change-password: sending`))
  assert.ok(diagnostics.includes('password-change: HTTP 400'))
  assert.ok(diagnostics.includes('password-change: HTTP 204'))
  console.log('PASS real Electron success, old password rejection, new password login and session revocation')
  assert.equal(database.prepare('PRAGMA quick_check').get().quick_check, 'ok')
  assert.equal(database.prepare('PRAGMA foreign_key_check').all().length, 0)
  console.log('PASS isolated SQLite integrity and isolated Electron userData')
} finally {
  await electron?.close()
  await vite?.close()
  await api?.close()
  database?.close()
  await rm(root, { recursive: true, force: true })
}
