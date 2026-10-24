import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { initializeInstalledServerDatabase } from './database.js'
import { login } from './auth.js'

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'hromada-admin-bootstrap-'))
  return { directory, database: join(directory, 'синтетична база.sqlite'), cli: fileURLToPath(new URL('./create-admin.js', import.meta.url)) }
}

function run(f: ReturnType<typeof fixture>, mode: string, input?: string) {
  return spawnSync(process.execPath, [f.cli, '--database', f.database, mode], { input, encoding: 'utf8', timeout: 15_000 })
}

test('installer form stdin contract creates a Ukrainian administrator through Argon2id/RBAC logic without exposing the password', async () => {
  const f = fixture(); const password = 'Synthetic installer password'; const displayName = 'Ірина Ємельяненко'
  try {
    initializeInstalledServerDatabase(f.database)
    const helper = readFileSync(join(process.cwd(), 'packaging', 'admin-setup.ps1'), 'utf8')
    assert.match(helper, /displayName\s*=\s*\$displayName\.Trim\(\)/)
    assert.match(helper, /ConvertTo-Json[\s\S]*displayName\s*=\s*\$displayName/)
    const payload = JSON.stringify({ displayName, username: 'synthetic-admin', password, confirmation: password }) + '\n'
    const child = run(f, '--installer-stdin', payload)
    assert.equal(child.status, 0, child.stderr)
    assert.equal(child.stdout.trim(), 'admin-created')
    assert.ok(!child.stdout.includes(password)); assert.ok(!child.stderr.includes(password))
    assert.ok(![f.cli, '--database', f.database, '--installer-stdin'].includes(password))
    const db = new DatabaseSync(f.database)
    try {
      const user = db.prepare('SELECT display_name, password_hash FROM users WHERE username_key=?').get('synthetic-admin') as { display_name: string; password_hash: string }
      assert.equal(user.display_name, displayName)
      assert.match(user.password_hash, /^\$argon2id\$/)
      const authenticated = await login(db, { username: 'synthetic-admin', password })
      assert.equal(authenticated.ok, true)
      assert.equal((db.prepare('SELECT role FROM user_roles').get() as { role: string }).role, 'administrator')
    } finally { db.close() }
  } finally { rmSync(f.directory, { recursive: true, force: true }) }
})

test('installer stdin rejects mismatch, empty or invalid display names, and invalid credentials without creating a user', () => {
  const f = fixture()
  try {
    initializeInstalledServerDatabase(f.database)
    const mismatch = run(f, '--installer-stdin', JSON.stringify({ displayName: 'Синтетичний адміністратор', username: 'synthetic-admin', password: 'synthetic password', confirmation: 'different password' }) + '\n')
    assert.notEqual(mismatch.status, 0); assert.match(mismatch.stdout, /не збігаються/)
    const emptyName = run(f, '--installer-stdin', JSON.stringify({ displayName: '  ', username: 'synthetic-admin', password: 'synthetic password', confirmation: 'synthetic password' }) + '\n')
    assert.notEqual(emptyName.status, 0); assert.match(emptyName.stdout, /ім’я користувача/)
    const tooLongName = run(f, '--installer-stdin', JSON.stringify({ displayName: 'я'.repeat(151), username: 'synthetic-admin', password: 'synthetic password', confirmation: 'synthetic password' }) + '\n')
    assert.notEqual(tooLongName.status, 0)
    const invalid = run(f, '--installer-stdin', JSON.stringify({ displayName: 'Синтетичний адміністратор', username: 'x', password: 'short', confirmation: 'short' }) + '\n')
    assert.notEqual(invalid.status, 0)
    const db = new DatabaseSync(f.database, { readOnly: true })
    try { assert.equal((db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }).count, 0) } finally { db.close() }
  } finally { rmSync(f.directory, { recursive: true, force: true }) }
})

test('administrator status is read-only and an existing administrator cannot be replaced', () => {
  const f = fixture(); const password = 'Synthetic installer password'
  try {
    initializeInstalledServerDatabase(f.database)
    const statusEmpty = run(f, '--status')
    assert.equal(JSON.parse(statusEmpty.stdout).users, 0)
    const payload = JSON.stringify({ displayName: 'Синтетичний адміністратор', username: 'synthetic-admin', password, confirmation: password }) + '\n'
    const created = run(f, '--installer-stdin', payload)
    assert.equal(created.status, 0)
    assert.equal(JSON.parse(run(f, '--status').stdout).users, 'present')
    const second = run(f, '--installer-stdin', JSON.stringify({ displayName: 'Інший адміністратор', username: 'other-admin', password, confirmation: password }) + '\n')
    assert.notEqual(second.status, 0); assert.match(second.stdout, /уже створений/)
    const db = new DatabaseSync(f.database, { readOnly: true })
    try { assert.equal((db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }).count, 1) } finally { db.close() }
  } finally { rmSync(f.directory, { recursive: true, force: true }) }
})
