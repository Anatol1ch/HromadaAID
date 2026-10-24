import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const runtimeProbe = String.raw`
const { createRequire } = require('node:module');
const { DatabaseSync } = require('node:sqlite');
const localRequire = createRequire(require('node:path').join(process.cwd(), 'package.json'));
const argon2 = localRequire('argon2');
const fastify = localRequire('fastify');
(async () => {
  const database = new DatabaseSync(':memory:');
  database.exec('CREATE TABLE runtime_probe(id INTEGER)');
  database.close();
  const hash = await argon2.hash('synthetic-package-probe');
  if (!(await argon2.verify(hash, 'synthetic-package-probe'))) throw new Error('argon2 verification failed');
  const app = fastify();
  app.get('/runtime-probe', async () => ({ status: 'ok' }));
  await app.ready();
  await app.close();
})().catch(error => { console.error(error?.stack || String(error)); process.exitCode = 1; });
`

function childError(result) {
  const text = [result.stderr, result.stdout].filter(Boolean).join('\n').trim()
    .replace(/(password|token|secret|recovery.?key|private.?key|dpapi.?key|bearer)(\s*[:=]\s*)[^\s,;]+/gi, '$1$2[redacted]')
  return text.slice(0, 2500) || result.error?.message || 'дочірній процес завершився без діагностики'
}

function runChecked(executable, args, cwd, label) {
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 30000 })
  if (result.error || result.status !== 0) throw new Error(`${label}: код ${result.status ?? 'невідомий'}. ${childError(result)}`)
  return result
}

export function verifyServerRuntime(packageRoot, options = {}) {
  const root = resolve(packageRoot)
  const appDirectory = join(root, 'app')
  const node = options.nodeExecutable ?? join(root, 'runtime', 'node.exe')
  runChecked(node, ['-e', runtimeProbe], appDirectory, 'Production-залежності сервера не завантажуються')

  const tempDirectory = mkdtempSync(join(tmpdir(), 'HromadaAID перевірка payload '))
  try {
    const databasePath = join(tempDirectory, 'синтетична база.sqlite')
    runChecked(node, ['-e', String.raw`
      const { DatabaseSync } = require('node:sqlite');
      const database = new DatabaseSync(process.argv[1]);
      database.exec('CREATE TABLE users(id TEXT); PRAGMA user_version=1');
      database.close();
    `, databasePath], appDirectory, 'Не вдалося створити ізольовану тестову SQLite для перевірки payload')

    const cli = join(appDirectory, 'dist', 'server', 'src', 'create-admin.js')
    const status = runChecked(node, [cli, '--database', databasePath, '--status'], appDirectory, 'Перевірка create-admin.js --status у production payload не пройшла')
    const record = status.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1)
    let result
    try { result = JSON.parse(record ?? '') } catch { throw new Error('create-admin.js --status повернув некоректний результат у production payload.') }
    if (result.users !== 0 || !Number.isInteger(result.schemaVersion) || !Number.isInteger(result.maximumSupportedSchemaVersion) || result.maximumSupportedSchemaVersion < result.schemaVersion) throw new Error('create-admin.js --status повернув неочікуваний стан синтетичної бази.')
    return {
      nodeVersion: runChecked(node, ['--version'], appDirectory, 'Не вдалося визначити версію комплектного Node.js').stdout.trim(),
      users: result.users,
      schemaVersion: result.schemaVersion,
      maximumSupportedSchemaVersion: result.maximumSupportedSchemaVersion,
    }
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true })
  }
}
