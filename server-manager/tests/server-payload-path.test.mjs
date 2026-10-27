import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { verifyServerPackage } from '../../packaging/verify-server-package.mjs'

const { resolvePackagedServerPayloadRoot } = await import('../../dist-server-manager/main/server-payload-path.js')

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'hromada-server-payload-path-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const resources = join(root, 'install', 'ServerManager', 'resources')
  const appPath = join(resources, 'app.asar')
  const installRoot = join(root, 'install')
  const bundled = join(resources, 'server-payload')
  const staged = join(installRoot, 'Server.next')
  return { resources, appPath, bundled, staged, installRoot }
}

async function makePackage(directory, manifest = undefined) {
  await mkdir(directory, { recursive: true })
  const payload = Buffer.from('synthetic verified server payload')
  await writeFile(join(directory, 'payload.txt'), payload)
  await writeFile(join(directory, 'package-integrity.json'), manifest ?? JSON.stringify({
    formatVersion: 1,
    files: [{ path: 'payload.txt', sizeBytes: payload.length, sha256: createHash('sha256').update(payload).digest('hex') }],
  }))
}

test('uses the complete bundled package for portable Manager', async t => {
  const f = await fixture(t)
  await makePackage(f.bundled)
  assert.equal(resolvePackagedServerPayloadRoot(f.resources, f.appPath), f.bundled)
})

test('ignores helper-only bundled payload and selects the complete Server.next package', async t => {
  const f = await fixture(t)
  await mkdir(join(f.bundled, 'installer'), { recursive: true })
  await writeFile(join(f.bundled, 'installer', 'install-server-service.ps1'), '# synthetic helper')
  await makePackage(f.staged)
  assert.equal(resolvePackagedServerPayloadRoot(f.resources, f.appPath), f.staged)
})

test('fails closed when neither bundled nor staged payload has integrity metadata', async t => {
  const f = await fixture(t)
  await mkdir(join(f.bundled, 'installer'), { recursive: true })
  await writeFile(join(f.bundled, 'installer', 'verify-server-package.mjs'), '// helper only')
  await mkdir(f.staged, { recursive: true })
  await assert.throws(() => resolvePackagedServerPayloadRoot(f.resources, f.appPath), /package-integrity\.json/)
})

test('does not fall back from a bundled package with a corrupt integrity manifest', async t => {
  const f = await fixture(t)
  await makePackage(f.bundled, '{broken')
  await makePackage(f.staged)
  const selected = resolvePackagedServerPayloadRoot(f.resources, f.appPath)
  assert.equal(selected, f.bundled)
  await assert.rejects(verifyServerPackage(selected), /маніфест|Маніфест/)
})
