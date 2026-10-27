import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { createClientUpdateService } from './client-update-service.ts'

const bytes = Buffer.from('signed-through-https-test-installer')
const hash = createHash('sha256').update(bytes).digest('hex')
const release = { tag_name: 'v1.2.0', draft: false, prerelease: false, body: 'Виправлення', assets: [
  { name: 'release-manifest.json', browser_download_url: 'https://github.com/owner/repo/releases/download/v1.2.0/release-manifest.json' },
  { name: 'HromadaAID-Setup-1.2.0.exe', browser_download_url: 'https://github.com/owner/repo/releases/download/v1.2.0/HromadaAID-Setup-1.2.0.exe' },
  { name: 'HromadaAID-Server-v1.2.0-win-x64.zip', browser_download_url: 'https://github.com/owner/repo/releases/download/v1.2.0/HromadaAID-Server-v1.2.0-win-x64.zip' },
] }
const manifest = { formatVersion: 1, version: '1.2.0', platform: 'win32', architecture: 'x64', compatibility: { installer: 'hromadaaid-universal-nsis-v1', installModes: ['Client-only', 'Server-only', 'Combined'], api: { contract: 'hromadaaid-rest', version: 1 }, manager: { versionPolicy: 'same-release-version', apiContract: 'hromadaaid-rest', apiContractVersion: 1 } }, artifacts: [
  { component: 'installer', name: 'HromadaAID-Setup-1.2.0.exe', sha256: hash, sizeBytes: bytes.length },
  { component: 'server', name: 'HromadaAID-Server-v1.2.0-win-x64.zip', sha256: 'a'.repeat(64), sizeBytes: 100, packageIntegrity: 'embedded-package-integrity-v1' },
] }
const response = (url, json) => ({ ok: true, status: 200, url: String(url), json: async () => json, text: async () => JSON.stringify(json) })

test('client update serializes checks, persists confirmed updates, verifies downloads, and prepares the launcher', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hromada-client-update-'))
  const resourcesPath = join(root, 'resources'), userDataPath = join(root, 'userdata')
  await mkdir(resourcesPath); await mkdir(userDataPath); await mkdir(join(userDataPath, 'updates'))
  await writeFile(join(userDataPath, 'client-update-state.json.12345678-1234-1234-1234-123456789abc.tmp'), 'interrupted state write')
  await writeFile(join(userDataPath, 'updates', 'client-update-12345678-1234-1234-1234-123456789abc.part'), 'partial download')
  await writeFile(join(resourcesPath, 'release-channel.json'), JSON.stringify({ repository: 'owner/repo' }))
  await writeFile(join(resourcesPath, 'client-update-launcher.ps1'), 'fixture')
  let releaseCalls = 0
  let artifactCalls = 0
  const fetchImpl = async url => {
    if (String(url).endsWith('/releases/latest')) { releaseCalls++; await new Promise(resolve => setTimeout(resolve, 20)); return response(url, release) }
    if (String(url).endsWith('release-manifest.json')) return response(url, manifest)
    artifactCalls++
    await new Promise(resolve => setTimeout(resolve, 20))
    return { ...response(url), body: Readable.from([bytes.subarray(0, 7), bytes.subarray(7)]) }
  }
  const events = []
  let launcherInvocation
  const spawnProcess = (executable, args, options) => {
    const child = Object.assign(new EventEmitter(), { unref() {} })
    queueMicrotask(async () => {
      const config = JSON.parse(await readFile(args.at(-1), 'utf8'))
      launcherInvocation = { executable, args: config.argumentLine, options }
      child.emit('spawn')
      await writeFile(config.resultPath, JSON.stringify({ status: 'ready', launcherProcessId: 123 }))
      child.emit('exit', 0, null)
    })
    return child
  }
  const service = createClientUpdateService({ currentVersion: '1.1.9', resourcesPath, userDataPath, executablePath: join(root, 'Client', 'HromadaAID.exe'), processId: 44, publish: value => events.push(value.status), fetchImpl, spawnProcess })
  try {
    await service.restore()
    await assert.rejects(readFile(join(userDataPath, 'client-update-state.json.12345678-1234-1234-1234-123456789abc.tmp')))
    await assert.rejects(readFile(join(userDataPath, 'updates', 'client-update-12345678-1234-1234-1234-123456789abc.part')))
    const firstCheck = service.check()
    const concurrentCheck = await service.check()
    assert.equal(concurrentCheck.status, 'checking')
    const checked = await firstCheck
    assert.equal(releaseCalls, 1)
    assert.equal(checked.confirmed, true)
    assert.equal(checked.targetVersion, '1.2.0')
    const firstDownload = service.download()
    const concurrentDownload = await service.download()
    assert.equal(concurrentDownload.status, 'downloading')
    const downloaded = await firstDownload
    assert.equal(artifactCalls, 1)
    assert.equal(downloaded.status, 'ready')
    assert.equal(downloaded.confirmed, true)
    const launcherResult = await service.install()
    assert.equal(launcherResult.ok, true)
    assert.ok(events.includes('installing'))
    assert.ok(launcherInvocation.executable.endsWith('\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'))
    assert.equal(launcherInvocation.options.detached, false)
    assert.equal(launcherInvocation.options.stdio[0], 'ignore')
    assert.equal(typeof launcherInvocation.options.stdio[2], 'number')
    assert.ok(launcherInvocation.args.includes('-Component') && launcherInvocation.args.includes('Client'))
    assert.ok(launcherInvocation.args.includes('/CLIENTUPDATE=1') === false, 'NSIS mode is passed by the external launcher after UAC elevation')
    assert.ok(launcherInvocation.args.includes('installer-launcher.log'))
    const launcherEvents = (await readFile(join(userDataPath, 'updates', 'installer-launcher.log'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    assert.deepEqual(launcherEvents.map(event => event.stage), ['install-command-received', 'powershell-launch-requested', 'powershell-process-created', 'powershell-bootstrap-exited', 'powershell-handoff-result'])
    assert.equal(launcherEvents[2].details.processId, null)
    const resumed = createClientUpdateService({ currentVersion: '1.1.9', resourcesPath, userDataPath, executablePath: 'unused', processId: 45, publish: () => {}, fetchImpl })
    await resumed.restore()
    assert.equal(resumed.getState().status, 'ready')
    assert.equal(resumed.getState().confirmed, true)
    assert.equal((await readFile(downloaded.targetPath ?? join(userDataPath, 'updates', `client-update-${hash}.exe`))).length, bytes.length)
    const failedLauncher = createClientUpdateService({ currentVersion: '1.1.9', resourcesPath, userDataPath, executablePath: 'unused', processId: 46, publish: () => {}, fetchImpl, spawnProcess: () => { const child = Object.assign(new EventEmitter(), { unref() {} }); queueMicrotask(() => child.emit('error', new Error('launcher missing'))); return child } })
    await failedLauncher.restore()
    const launchResult = await failedLauncher.install()
    assert.equal(launchResult.ok, false)
    assert.equal(failedLauncher.getState().status, 'error')
    const failedEvents = (await readFile(join(userDataPath, 'updates', 'installer-launcher.log'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    assert.ok(failedEvents.some(event => event.stage === 'powershell-process-error'))
  } finally { await rm(root, { recursive: true, force: true }) }
})
