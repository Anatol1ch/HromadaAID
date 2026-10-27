import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, cp, access, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { copyManagerSetupPayload } from './manager-setup-payload.mjs'

test('Universal Setup retains Manager update/recovery helpers and their module graph without a second server runtime', async t => {
  const root = await mkdtemp(join(tmpdir(), 'hromada-manager-setup-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source'), destination = join(root, 'destination')
  const installer = join(source, 'resources', 'server-payload', 'installer')
  await mkdir(installer, { recursive: true })
  await writeFile(join(source, 'HromadaAID Server Manager.exe'), 'synthetic executable')
  await writeFile(join(source, 'resources', 'app.asar'), 'synthetic app')
  const helpers = ['install-server-service.ps1', 'server-package-transaction.mjs', 'verify-server-package.mjs', 'server-runtime-check.mjs']
  for (const name of helpers) await cp(new URL(name, import.meta.url), join(installer, name))
  for (const directory of ['app', 'runtime', 'service']) {
    const path = join(source, 'resources', 'server-payload', directory)
    await mkdir(path)
    await writeFile(join(path, 'sentinel'), 'excluded duplicate server payload')
  }
  copyManagerSetupPayload(source, destination)
  await access(join(destination, 'HromadaAID Server Manager.exe'))
  await access(join(destination, 'resources', 'app.asar'))
  const copied = join(destination, 'resources', 'server-payload', 'installer')
  for (const name of helpers) assert.deepEqual(await readFile(join(copied, name)), await readFile(new URL(name, import.meta.url)))
  for (const directory of ['app', 'runtime', 'service']) await assert.rejects(access(join(destination, 'resources', 'server-payload', directory)), { code: 'ENOENT' })
  assert.equal(typeof (await import(pathToFileURL(join(copied, 'verify-server-package.mjs')).href)).verifyServerPackage, 'function')
  assert.equal(typeof (await import(pathToFileURL(join(copied, 'server-package-transaction.mjs')).href)).preparePackageUpdate, 'function')
})
