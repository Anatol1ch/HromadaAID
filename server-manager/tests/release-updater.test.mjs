import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { createReleaseUpdater } from '../electron/release-updater.ts'

const setup = Buffer.from('synthetic setup payload')
const server = Buffer.from('synthetic server zip payload')
const digest = value => createHash('sha256').update(value).digest('hex')
const version = '1.1.0'
const manifest = { formatVersion: 1, version, platform: 'win32', architecture: 'x64', compatibility: { installer: 'hromadaaid-universal-nsis-v1', installModes: ['Client-only', 'Server-only', 'Combined'], api: { contract: 'hromadaaid-rest', version: 1 }, manager: { versionPolicy: 'same-release-version', apiContract: 'hromadaaid-rest', apiContractVersion: 1 } }, artifacts: [
  { component: 'installer', name: `HromadaAID-Setup-${version}.exe`, sizeBytes: setup.length, sha256: digest(setup) },
  { component: 'server', name: `HromadaAID-Server-v${version}-win-x64.zip`, sizeBytes: server.length, sha256: digest(server), packageIntegrity: 'embedded-package-integrity-v1' },
] }
const release = { tag_name: `v${version}`, draft: false, prerelease: false, body: 'Стабільний реліз', assets: [
  'release-manifest.json', `HromadaAID-Setup-${version}.exe`, `HromadaAID-Server-v${version}-win-x64.zip`,
].map(name => ({ name, browser_download_url: `https://github.com/owner/repo/releases/download/v${version}/${name}` })) }

test('Manager and API checks share one Stable manifest, verify separate downloads, and serialize operations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hromada-manager-updates-'))
  const resourcesPath = join(root, 'resources'), userDataPath = join(root, 'user-data')
  const managerDirectory = join(root, 'ServerManager'), executablePath = join(managerDirectory, 'HromadaAID Server Manager.exe')
  await mkdir(resourcesPath); await mkdir(managerDirectory); await writeFile(join(resourcesPath, 'release-channel.json'), JSON.stringify({ repository: 'owner/repo' }))
  const fetchImpl = async url => {
    const target = String(url)
    if (target.endsWith('/releases/latest')) { await new Promise(resolve => setTimeout(resolve, 15)); return { ok: true, status: 200, url: target, text: async () => JSON.stringify(release) } }
    if (target.endsWith('release-manifest.json')) return { ok: true, status: 200, url: target, text: async () => JSON.stringify(manifest) }
    const payload = target.endsWith('.exe') ? setup : server
    return { ok: true, status: 200, url: target, headers: { get: () => String(payload.length) }, body: Readable.from([payload.subarray(0, 4), payload.subarray(4)]) }
  }
  const updater = createReleaseUpdater({ currentVersion: '1.0.0', resourcesPath, userDataPath, executablePath, processId: 17, sharedModulePath: fileURLToPath(new URL('../../shared/release-updates.mjs', import.meta.url)), fetchImpl, publish: () => {} })
  try {
    const first = updater.check('1.0.0')
    assert.equal((await updater.check('1.0.0')).manager.status, 'checking')
    const state = await first
    assert.equal(state.manager.confirmed, true)
    assert.equal(state.manager.availableVersion, version)
    assert.equal(state.server.availableVersion, version)
    const downloadedManager = await updater.download('installer')
    assert.equal((await readFile(downloadedManager.packagePath)).equals(setup), true)
    assert.equal(updater.getState().manager.status, 'ready')
    await assert.rejects(updater.download('server'), /Спочатку оновіть Server Manager/)
    await writeFile(join(managerDirectory, 'manager-update-success.txt'), version)
    const updatedManager = createReleaseUpdater({ currentVersion: version, resourcesPath, userDataPath, executablePath, processId: 18, sharedModulePath: fileURLToPath(new URL('../../shared/release-updates.mjs', import.meta.url)), fetchImpl, publish: () => {} })
    await updatedManager.restore()
    await updatedManager.check('1.0.0')
    const downloadedServer = await updatedManager.download('server')
    assert.equal((await readFile(downloadedServer.packagePath)).equals(server), true)
    assert.equal(updatedManager.getState().server.status, 'ready')
  } finally { await rm(root, { recursive: true, force: true }) }
})
