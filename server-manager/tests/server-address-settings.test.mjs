import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createServerAddressSettings, createAddressHandlers, normalizeAddress } from '../../dist-server-manager/main/server-address-settings.js'
import { validateServerBaseUrl, ElectronRuntimeConfigError } from '../../shared/server-base-url.mjs'
import { LOCAL_HEALTH_URL } from '../../dist-server-manager/main/inspection-engine.js'

const initial = { version: 1, loopback: 'http://127.0.0.1:4310', lan: null, tailscale: null }
async function fixture(t) {
  const root = await fs.mkdtemp(join(tmpdir(), 'hromada-address-settings-'))
  t.after(async () => { assert.equal(dirname(resolve(root)), resolve(tmpdir())); await fs.rm(root, { recursive: true, force: true }) })
  const profile = join(root, 'manager')
  return { root, profile, path: join(profile, 'server-addresses.json'), store: createServerAddressSettings(profile) }
}

test('one pure URL validator keeps Client formats and Manager normalization', async () => {
  for (const value of ['http://127.0.0.1:4310', 'http://localhost:4310', 'http://192.168.1.2:4310', 'http://100.101.102.103:4310', 'http://server:4310', 'http://api.tailnet.ts.net:4310', ' HTTP://EXAMPLE.COM:4310/ ']) {
    assert.equal(await normalizeAddress('lan', value), validateServerBaseUrl(value).origin)
    assert.equal(await normalizeAddress('tailscale', value), validateServerBaseUrl(value).origin)
  }
  for (const value of ['', 'https://server:4310', 'http://server', 'http://server:4311', 'http://user:pass@server:4310', 'http://@server:4310', 'http://server:4310/api', 'http://server:4310/api/..', 'http://server:4310/?', 'http://server:4310/#', 'http://[::1]:4310', 'http://0.0.0.0:4310', 'http://999.1.1.1:4310', 'http://bad..name:4310', 'http://-bad:4310', 'http://ser\nver:4310', 'http://server\\other:4310']) {
    assert.throws(() => validateServerBaseUrl(value), ElectronRuntimeConfigError)
    if (value) await assert.rejects(normalizeAddress('lan', value))
  }
  assert.equal(await normalizeAddress('loopback', 'HTTP://LOCALHOST:4310/'), 'http://localhost:4310')
  for (const value of ['', ' ', 'http://127.0.0.2:4310', 'http://server:4310']) await assert.rejects(normalizeAddress('loopback', value))
  assert.equal(await normalizeAddress('lan', ' '), null)
})

test('missing file uses defaults without creating a directory or file', async t => {
  const f = await fixture(t)
  assert.deepEqual(await f.store.read(), { ok: true, addresses: initial })
  await assert.rejects(fs.stat(f.profile), { code: 'ENOENT' })
})

test('all positions survive new store instances; optional positions clear and Loopback cannot clear', async t => {
  const f = await fixture(t)
  assert.equal((await f.store.save('loopback', 'http://localhost:4310/')).ok, true)
  assert.equal((await f.store.save('lan', ' HTTP://SERVER:4310/ ')).ok, true)
  assert.equal((await f.store.save('tailscale', 'http://100.101.102.103:4310')).ok, true)
  const expected = { version: 1, loopback: 'http://localhost:4310', lan: 'http://server:4310', tailscale: 'http://100.101.102.103:4310' }
  assert.deepEqual(await createServerAddressSettings(f.profile).read(), { ok: true, addresses: expected })
  const before = await fs.readFile(f.path, 'utf8')
  assert.equal((await f.store.save('loopback', '')).ok, false)
  assert.equal(await fs.readFile(f.path, 'utf8'), before)
  await f.store.save('lan', ''); await f.store.save('tailscale', ' ')
  assert.deepEqual((await f.store.read()).addresses, { ...initial, loopback: expected.loopback })
})

test('damaged, unknown and malformed settings block writes without changing original bytes', async t => {
  const f = await fixture(t); await fs.mkdir(f.profile)
  for (const raw of ['{', JSON.stringify({ ...initial, version: 2 }), 'null', '[]', JSON.stringify({ ...initial, lan: 42 }), JSON.stringify({ ...initial, tailscale: '' }), JSON.stringify({ ...initial, extra: true }), JSON.stringify({ version: 1 }), JSON.stringify({ ...initial, loopback: 'http://server:4310' }), JSON.stringify({ ...initial, lan: 'https://server:4310' })]) {
    await fs.writeFile(f.path, raw)
    const loaded = await f.store.read()
    assert.equal(loaded.ok, false); assert.equal(loaded.storageError, true)
    assert.equal((await f.store.save('lan', 'http://server:4310')).ok, false)
    assert.equal(await fs.readFile(f.path, 'utf8'), raw)
  }
})

test('unreadable file is not treated as missing and safe errors hide paths', async t => {
  const f = await fixture(t)
  const store = createServerAddressSettings(f.profile, { ...fs, readFile: async () => { throw Object.assign(new Error('secret-path'), { code: 'EACCES' }) } })
  const result = await store.read()
  assert.equal(result.ok, false); assert.equal(result.storageError, true)
  assert.doesNotMatch(result.message, /secret-path/)
  assert.equal((await store.save('lan', 'http://server:4310')).ok, false)
  await assert.rejects(fs.stat(f.profile), { code: 'ENOENT' })
})

test('write, sync, close and rename failures preserve old data and remove only own temporary file', async t => {
  const f = await fixture(t); await f.store.save('lan', 'http://old:4310')
  const before = await fs.readFile(f.path, 'utf8')
  const unrelated = join(f.profile, '.server-addresses-unrelated.tmp'); await fs.writeFile(unrelated, 'keep')
  for (const stage of ['open', 'writeFile', 'sync', 'close', 'rename']) {
    const fault = () => { throw new Error('private path') }
    const operations = { ...fs, rename: stage === 'rename' ? fault : fs.rename, open: async (...args) => {
      if (stage === 'open') return fault()
      const handle = await fs.open(...args)
      let closed = false
      return {
        writeFile: (...values) => stage === 'writeFile' ? fault() : handle.writeFile(...values),
        sync: () => stage === 'sync' ? fault() : handle.sync(),
        close: async () => { if (!closed) { closed = true; await handle.close(); if (stage === 'close') fault() } },
      }
    } }
    const result = await createServerAddressSettings(f.profile, operations).save('tailscale', 'http://new:4310')
    assert.equal(result.ok, false, stage); assert.doesNotMatch(result.message, /private path/)
    assert.equal(await fs.readFile(f.path, 'utf8'), before)
    assert.deepEqual((await fs.readdir(f.profile)).sort(), ['.server-addresses-unrelated.tmp', 'server-addresses.json'])
  }
  assert.equal((await f.store.save('tailscale', 'http://new:4310')).ok, true)
})

test('queued changes re-read current settings and do not lose other positions', async t => {
  const f = await fixture(t)
  const results = await Promise.all([f.store.save('lan', 'http://lan:4310'), f.store.save('tailscale', 'http://tail:4310'), f.store.save('loopback', 'http://localhost:4310')])
  assert.ok(results.every(result => result.ok))
  assert.deepEqual((await f.store.read()).addresses, { version: 1, loopback: 'http://localhost:4310', lan: 'http://lan:4310', tailscale: 'http://tail:4310' })
})

test('IPC trusts renderer, checks keys/types and copies freshly read saved values only', async t => {
  const f = await fixture(t), copied = []
  const handlers = createAddressHandlers(event => event === 'trusted', f.store, value => copied.push(value))
  assert.throws(() => handlers.read('bad'), /UNTRUSTED_RENDERER/)
  assert.throws(() => handlers.save('bad', 'lan', 'http://server:4310'), /UNTRUSTED_RENDERER/)
  await assert.rejects(handlers.copy('bad', 'loopback'), /UNTRUSTED_RENDERER/)
  for (const key of ['__proto__', 'constructor', 'server.json', 'http://server:4310', null, {}, 1]) {
    assert.equal((await handlers.save('trusted', key, 'http://server:4310')).ok, false)
    assert.equal((await handlers.copy('trusted', key)).ok, false)
  }
  for (const value of [null, {}, 1]) assert.equal((await handlers.save('trusted', 'lan', value)).ok, false)
  assert.equal((await handlers.copy('trusted', 'lan')).ok, false)
  await handlers.save('trusted', 'lan', 'http://old:4310')
  await fs.writeFile(f.path, JSON.stringify({ ...initial, lan: 'http://current:4310' }))
  assert.equal((await handlers.copy('trusted', 'lan')).ok, true)
  assert.deepEqual(copied, ['http://current:4310'])
  await fs.writeFile(f.path, '{')
  assert.equal((await handlers.copy('trusted', 'lan')).ok, false)
  assert.equal(copied.length, 1)
})

test('settings are local and never invoke network/SCM or modify server and Client configs', async t => {
  const f = await fixture(t)
  const server = join(f.root, 'server.json'), client = join(f.root, 'server-connection.json')
  await fs.writeFile(server, 'synthetic server config'); await fs.writeFile(client, 'synthetic Client config')
  const oldFetch = globalThis.fetch
  globalThis.fetch = () => assert.fail('settings must not probe the network')
  try { await f.store.save('loopback', 'http://localhost:4310'); await f.store.save('lan', 'http://unreachable.example:4310') }
  finally { globalThis.fetch = oldFetch }
  assert.equal(LOCAL_HEALTH_URL, 'http://127.0.0.1:4310/health')
  assert.equal(await fs.readFile(server, 'utf8'), 'synthetic server config')
  assert.equal(await fs.readFile(client, 'utf8'), 'synthetic Client config')
  const source = await fs.readFile(new URL('../electron/server-address-settings.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /child_process|windows-inspection|inspection-engine|fetch\(|server-connection\.json|server\.json/)
  for (const file of ['windows-inspection.ts', 'inspection-engine.ts', 'main.ts']) {
    assert.doesNotMatch(await fs.readFile(new URL('../electron/' + file, import.meta.url), 'utf8'), /readNetworkAddresses|Get-NetAdapter|Get-NetIPAddress|networkAddresses/)
  }
})

test('isolated main deployment includes the exact pure validator; dev uses the same copy step', async t => {
  const f = await fixture(t)
  const source = new URL('../../dist-server-manager/main/', import.meta.url)
  await fs.cp(source, join(f.root, 'main'), { recursive: true })
  await fs.writeFile(join(f.root, 'package.json'), '{"type":"module"}')
  assert.deepEqual(await fs.readFile(join(f.root, 'main/shared/server-base-url.mjs')), await fs.readFile(new URL('../../shared/server-base-url.mjs', import.meta.url)))
  const module = pathToFileURL(join(f.root, 'main/server-address-settings.js')).href
  await f.store.save('lan', 'http://persisted:4310')
  const code = 'const {normalizeAddress,createServerAddressSettings}=await import(' + JSON.stringify(module) + ');if(await normalizeAddress("lan","http://server:4310/")!=="http://server:4310")throw Error("validator unavailable");const result=await createServerAddressSettings(' + JSON.stringify(f.profile) + ').read();if(!result.ok||result.addresses.lan!=="http://persisted:4310")throw Error("settings not retained")'
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: f.root, encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, result.stderr)
  const dev = await fs.readFile(new URL('../../scripts/server-manager.mjs', import.meta.url), 'utf8')
  assert.match(dev, /import\('\.\/copy-manager-shared\.mjs'\)/)
  const pack = await fs.readFile(new URL('../../scripts/package-server-manager.mjs', import.meta.url), 'utf8')
  assert.match(pack, /cp\(resolve\(root, 'dist-server-manager\/main'\), resolve\(packageRoot, 'main'\), \{ recursive: true \}\)/)
  assert.equal(fileURLToPath(source).includes('dist-server-manager'), true)
})
