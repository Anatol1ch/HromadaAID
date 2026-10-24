import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyComponentPackage, writeComponentManifest } from './component-package.mjs'

async function makeServerFixture(root) {
  const files = [
    'runtime/node.exe', 'service/HromadaAIDService.exe', 'service/HromadaAIDService.xml.template',
    'app/dist/server/src/installed.js', 'app/node_modules/argon2/package.json',
    'app/node_modules/@phc/format/package.json', 'app/node_modules/fastify/package.json',
    'installer/prepare-server-install.mjs', 'installer/install-server-service.ps1',
  ]
  for (const path of files) {
    const destination = join(root, path)
    await mkdir(join(destination, '..'), { recursive: true })
    await writeFile(destination, path.endsWith('package.json') ? '{"name":"synthetic"}\n' : 'synthetic package file')
  }
}

test('component manifest covers exact package bytes, metadata and SQLite/API compatibility', async () => {
  const root = await mkdtemp(join(tmpdir(), 'HromadaAID пакет server '))
  try {
    await makeServerFixture(root)
    const metadata = {
      component: 'server', name: 'HromadaAID Server', version: '0.1.0', platform: 'win32', architecture: 'x64',
      compatibility: { serverApi: { contract: 'hromadaaid-rest', version: 1 }, sqliteSchema: { minimum: 1, maximum: 28 } },
    }
    const manifest = await writeComponentManifest(root, metadata)
    assert.equal(manifest.authenticity.detachedSignature, null)
    assert.equal((await verifyComponentPackage(root, 'server')).compatibility.sqliteSchema.maximum, 28)
    await writeFile(join(root, 'runtime', 'node.exe'), 'changed')
    await assert.rejects(verifyComponentPackage(root, 'server'), /не відповідає маніфесту/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('component verifier rejects incomplete server packages and incompatible manifest schema', async () => {
  const root = await mkdtemp(join(tmpdir(), 'HromadaAID пакет неповний '))
  try {
    await makeServerFixture(root)
    await rm(join(root, 'app', 'node_modules', '@phc', 'format', 'package.json'))
    await assert.rejects(writeComponentManifest(root, {
      component: 'server', name: 'HromadaAID Server', version: '0.1.0', platform: 'win32', architecture: 'x64',
      compatibility: { serverApi: { contract: 'hromadaaid-rest', version: 1 }, sqliteSchema: { minimum: 1, maximum: 28 } },
    }), /неповний/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
