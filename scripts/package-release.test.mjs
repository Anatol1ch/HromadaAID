import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { createServerZip, packageRelease } from './package-release.mjs'
import { packageFiles, writeComponentManifest, verifyComponentPackage } from '../packaging/component-package.mjs'
import { verifyServerPackage } from '../packaging/verify-server-package.mjs'
import { writeReleaseManifest, verifyReleaseManifest } from '../packaging/release-manifest.mjs'
import { verifyUpdatePackage } from '../dist-server-manager/main/server-update.js'
import { createWindowsServerUpdateAdapters } from '../dist-server-manager/main/windows-server-update.js'

test('Server ZIP round-trips through the actual updater and both integrity contracts', { skip: process.platform !== 'win32' }, async () => {
  const work = await mkdtemp(join(tmpdir(), 'hromada-release-test-'))
  try {
    const server = join(work, 'payload')
    const version = '1.2.3'
    const files = {
      'runtime/node.exe': 'synthetic runtime, never executed',
      'service/HromadaAIDService.exe': 'synthetic service, never executed',
      'service/HromadaAIDService.xml.template': '<service/>',
      'app/package.json': JSON.stringify({ version }),
      'app/dist/server/src/installed.js': '// fixture',
      'app/dist/server/src/create-admin.js': '// fixture',
      'app/dist/electron/database.js': 'const migrations = [{ version: 28 }]',
      'app/dist/shared/api-compatibility.js': 'export const HROMADAAID_API_CONTRACT_VERSION = 1;',
      'app/node_modules/argon2/package.json': '{}',
      'app/node_modules/@phc/format/package.json': '{}',
      'app/node_modules/fastify/package.json': '{}',
      'app/.hidden': 'included',
      'app/Українська назва.txt': 'synthetic Unicode content',
    }
    for (const name of ['verify-server-package.mjs', 'server-runtime-check.mjs', 'server-package-transaction.mjs', 'prepare-server-install.mjs', 'windows-installer-config.mjs', 'install-server-service.ps1', 'write-installation-locator.ps1']) files[`installer/${name}`] = '// fixture'
    for (const [path, bytes] of Object.entries(files)) {
      await mkdir(dirname(join(server, path)), { recursive: true })
      await writeFile(join(server, path), bytes)
    }
    await writeFile(join(server, 'package-integrity.json'), JSON.stringify({ formatVersion: 1, files: await packageFiles(server) }))
    await writeComponentManifest(server, { component: 'server', name: 'HromadaAID Server', version, platform: 'win32', architecture: 'x64', compatibility: { serverApi: { contract: 'hromadaaid-rest', version: 1 }, sqliteSchema: { minimum: 1, maximum: 28 } } })
    const zip = join(work, `HromadaAID-Server-v${version}-win-x64.zip`)
    createServerZip(server, zip)
    const extracted = join(work, 'extracted')
    await createWindowsServerUpdateAdapters().extract(zip, extracted)
    assert.equal((await verifyUpdatePackage(extracted)).version, version)
    await verifyComponentPackage(extracted, 'server')
    await verifyServerPackage(extracted)
    assert.equal(await readFile(join(extracted, 'app/.hidden'), 'utf8'), 'included')
    assert.equal(await readFile(join(extracted, 'app/Українська назва.txt'), 'utf8'), files['app/Українська назва.txt'])
    await writeFile(join(work, `HromadaAID-Setup-${version}.exe`), 'synthetic setup, never executed')
    const manifest = await writeReleaseManifest(work, version)
    await verifyReleaseManifest(work, manifest)
    assert.deepEqual(manifest.artifacts.map(item => item.name), [`HromadaAID-Setup-${version}.exe`, `HromadaAID-Server-v${version}-win-x64.zip`])
    await writeFile(join(extracted, 'app/.hidden'), 'corruption')
    await assert.rejects(verifyUpdatePackage(extracted))
    await assert.rejects(verifyServerPackage(extracted))
    await writeFile(zip, 'corruption')
    await assert.rejects(verifyReleaseManifest(work, manifest))
    await writeFile(join(server, 'server.json'), '{}')
    await assert.rejects(verifyUpdatePackage(server))
  } finally { await rm(work, { recursive: true, force: true }) }
})

test('release packaging rejects prerelease versions and preserves existing output', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'hromada-release-guards-'))
  try {
    await writeFile(join(root, 'package.json'), JSON.stringify({ version: '1.2.3-beta.1' }))
    await assert.rejects(packageRelease(root), /SemVer/)
    await writeFile(join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }))
    await mkdir(join(root, 'release/1.2.3'), { recursive: true })
    await writeFile(join(root, 'release/1.2.3/keep.txt'), 'preserve')
    await assert.rejects(packageRelease(root), /already exists/)
    assert.equal(await readFile(join(root, 'release/1.2.3/keep.txt'), 'utf8'), 'preserve')
  } finally { await rm(root, { recursive: true, force: true }) }
})
