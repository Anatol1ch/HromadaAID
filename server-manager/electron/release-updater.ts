import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import { appendFile, readFile, mkdir, stat, rm } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import type { ReleaseUpdateState, ServerReleaseState } from './server-update-contract.js'
type Artifact = NonNullable<ServerReleaseState['artifact']>
type Update = { version: string; notes: string; artifact: Artifact; url: string; downloadedPath?: string }
async function matchesArtifact(path: string, artifact: Artifact): Promise<boolean> {
  if ((await stat(path)).size !== artifact.sizeBytes) return false
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex') === artifact.sha256
}

export function createReleaseUpdater(options: { currentVersion: string; resourcesPath: string; userDataPath: string; executablePath: string; processId: number; publish: (state: { manager: ReleaseUpdateState; server: ServerReleaseState }) => void; spawnProcess?: typeof import('node:child_process').spawn; sharedModulePath?: string; fetchImpl?: typeof fetch }) {
  const statePath = join(options.userDataPath, 'release-update-state.json')
  const updateDir = join(options.userDataPath, 'updates')
  let manager: ReleaseUpdateState = { installedVersion: options.currentVersion, status: 'idle', confirmed: false }
  let server: ServerReleaseState = { installedVersion: null, status: 'unknown' }
  let pending: Update | undefined
  let serverPending: { artifact: Artifact; url: string; version: string; notes: string } | undefined
  let busy = false
  let saveChain = Promise.resolve()
  const emit = () => options.publish({ manager: { ...manager }, server: { ...server } })
  const persist = () => {
    const data = JSON.stringify({ manager, pending }, null, 2) + '\n', temp = `${statePath}.${randomUUID()}.tmp`
    const task = saveChain.then(async () => { await mkdir(options.userDataPath, { recursive: true }); const { writeFile, rename, rm } = await import('node:fs/promises'); try { await writeFile(temp, data, { flag: 'wx', mode: 0o600 }); await rename(temp, statePath) } catch (error) { await rm(temp, { force: true }).catch(() => {}); throw error } })
    saveChain = task.catch(() => {}); return task
  }
  const modules = async () => await import(pathToFileURL(options.sharedModulePath ?? join(dirname(fileURLToPath(import.meta.url)), 'shared', 'release-updates.mjs')).href) as any
  const restore = async () => {
    const uuid = '[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}'
    const cleanOwnedFiles = async (directory: string, pattern: RegExp) => {
      try { for (const entry of await (await import('node:fs/promises')).readdir(directory, { withFileTypes: true })) if (entry.isFile() && pattern.test(entry.name)) await rm(join(directory, entry.name), { force: true }) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
    await cleanOwnedFiles(options.userDataPath, new RegExp(`^release-update-state\\.json\\.${uuid}\\.tmp$`))
    await cleanOwnedFiles(updateDir, new RegExp(`^(?:client|server)-update-${uuid}\\.part$`))
    try {
      const saved = JSON.parse(await readFile(statePath, 'utf8')), lib = await modules(), candidate = saved.pending as Update | undefined
      if (candidate && lib.parseStableVersion(candidate.version)?.prerelease.length === 0 && lib.compareVersions(candidate.version, options.currentVersion) >= 0 && candidate.artifact?.component === 'installer' && candidate.artifact.name === `HromadaAID-Setup-${candidate.version}.exe` && /^[a-f0-9]{64}$/.test(candidate.artifact.sha256) && Number.isSafeInteger(candidate.artifact.sizeBytes) && candidate.artifact.sizeBytes > 0) {
        if (candidate.version === options.currentVersion) {
          const markerPath = join(dirname(options.executablePath), 'manager-update-success.txt')
          const marker = await readFile(markerPath, 'utf8').catch(() => '')
          if (marker.trim() === candidate.version) {
            await rm(markerPath, { force: true }).catch(() => {})
            manager = { ...manager, checkedAt: saved.manager?.checkedAt, availableVersion: candidate.version, status: 'up-to-date', confirmed: false }
            pending = undefined
            await persist()
            emit()
            return
          }
        }
        pending = candidate
        manager = { ...manager, ...saved.manager, confirmed: true, availableVersion: candidate.version, notes: candidate.notes, status: 'available' }
        const expected = join(updateDir, `client-update-${candidate.artifact.sha256}.exe`)
        if (candidate.downloadedPath === expected) {
          try { if (await matchesArtifact(expected, candidate.artifact)) { manager.status = 'ready' } else { await rm(expected, { force: true }); delete pending.downloadedPath } } catch { delete pending.downloadedPath }
        } else delete pending.downloadedPath
      }
    } catch { /* GitHub remains the source until a release is confirmed. */ }
    emit()
  }
  const check = async (serverVersion: string | null) => {
    if (busy) return { manager: { ...manager }, server: { ...server } }
    busy = true; manager = { ...manager, status: 'checking', error: undefined }
    try {
      const config = JSON.parse(await readFile(join(options.resourcesPath, 'release-channel.json'), 'utf8'))
      const lib = await modules(), repository = lib.validateRepository(config?.repository)
      const current = serverVersion && lib.compareVersions(serverVersion, options.currentVersion) < 0 ? serverVersion : options.currentVersion
      const result = await lib.checkLatestRelease({ repository, currentVersion: current, fetchImpl: options.fetchImpl })
      const checkedAt = result.checkedAt
      if (result.available) {
        if (lib.compareVersions(result.version, options.currentVersion) > 0) { const currentPending = pending, downloadedPath = currentPending?.version === result.version ? currentPending?.downloadedPath : undefined; pending = { version: result.version, notes: result.notes, artifact: result.artifact, url: result.url, downloadedPath }; manager = { ...manager, status: downloadedPath ? 'ready' : 'available', checkedAt, availableVersion: result.version, notes: result.notes, confirmed: true } }
        else if (pending && manager.confirmed) manager = { ...manager, status: pending.downloadedPath ? 'ready' : 'available', checkedAt, error: undefined }
        else manager = { ...manager, status: 'up-to-date', checkedAt, error: undefined }
        if (serverVersion && lib.compareVersions(result.version, serverVersion) > 0) {
          serverPending = { version: result.version, notes: result.notes, artifact: result.serverArtifact, url: result.serverUrl }
          const packagePath = server.availableVersion === result.version ? server.packagePath : undefined
          server = { ...server, status: packagePath ? 'ready' : 'available', availableVersion: result.version, checkedAt, notes: result.notes, artifact: result.serverArtifact, url: result.serverUrl, packagePath, error: options.currentVersion === result.version ? undefined : 'Оновлення API Server дозволено після підтвердження відповідної версії Server Manager.' }
        } else if (serverVersion) server = { installedVersion: serverVersion, status: 'up-to-date', checkedAt }
      } else {
        manager = pending && manager.confirmed ? { ...manager, status: 'available', checkedAt, error: undefined } : { ...manager, status: 'up-to-date', checkedAt, error: undefined }
        if (serverVersion) server = { installedVersion: serverVersion, status: 'up-to-date', checkedAt }
      }
      await persist()
    } catch (error) { const message = error instanceof Error ? error.message.slice(0, 300) : 'Перевірка GitHub не вдалася.'; manager = { ...manager, status: pending ? 'available' : 'error', error: pending ? undefined : message }; server = { ...server, status: serverPending ? server.status : 'error', error: serverPending ? undefined : message } }
    finally { busy = false; emit() }
    return { manager: { ...manager }, server: { ...server } }
  }
  const download = async (component: 'installer' | 'server') => {
    if (busy || manager.status === 'installing' || manager.status === 'restarting') throw new Error('Інша операція оновлення вже виконується.')
    const candidate = component === 'installer' ? pending : serverPending
    if (!candidate) throw new Error('Спочатку перевірте доступність оновлення.')
    if (component === 'server' && options.currentVersion !== candidate.version) throw new Error('Спочатку оновіть Server Manager до версії серверного релізу та повторно перевірте сумісність.')
    busy = true
    const set = (patch: Partial<ReleaseUpdateState>, serverPatch: Partial<ServerReleaseState>) => { if (component === 'installer') manager = { ...manager, ...patch }; else server = { ...server, ...serverPatch }; emit() }
    set({ status: 'downloading', error: undefined, receivedBytes: 0, totalBytes: candidate.artifact.sizeBytes }, { status: 'downloading', error: undefined, receivedBytes: 0, totalBytes: candidate.artifact.sizeBytes })
    try {
      const lib = await modules(), packagePath = await lib.downloadVerifiedArtifact({ url: candidate.url, artifact: candidate.artifact, directory: updateDir, fetchImpl: options.fetchImpl, onProgress: (progress: { receivedBytes: number; totalBytes: number }) => set({ status: progress.receivedBytes === progress.totalBytes ? 'verifying' : 'downloading', ...progress }, { status: progress.receivedBytes === progress.totalBytes ? 'verifying' : 'downloading', ...progress }) })
      if (component === 'installer') { pending = { ...candidate, downloadedPath: packagePath }; await persist(); manager = { ...manager, status: 'ready' } }
      else server = { ...server, status: 'ready', packagePath }
      emit(); return { packagePath, version: candidate.version }
    } catch (error) { const message = error instanceof Error ? error.message.slice(0, 300) : 'Завантаження не вдалося.'; set({ status: 'error', error: message }, { status: 'error', error: message }); throw error }
    finally { busy = false }
  }
  const installManager = async () => {
    const logPath = join(updateDir, 'installer-launcher.log')
    const logEvent = async (stage: string, details: Record<string, unknown> = {}) => {
      await mkdir(updateDir, { recursive: true })
      await appendFile(logPath, `${JSON.stringify({ timestamp: new Date().toISOString(), component: 'ServerManager', stage, parentProcessId: options.processId, details })}\n`, 'utf8')
    }
    await logEvent('install-command-received', { installerPath: pending?.downloadedPath ?? null, expectedVersion: pending?.version ?? null })
    if (busy || manager.status === 'installing' || manager.status === 'restarting') throw new Error('Інша операція оновлення вже виконується.')
    const candidate = pending
    const packagePath = candidate?.downloadedPath
    if (!candidate || !packagePath) throw new Error('Завантажте й перевірте Setup перед встановленням.')
    busy = true
    try {
      if (packagePath !== join(updateDir, `client-update-${candidate.artifact.sha256}.exe`) || !await matchesArtifact(packagePath, candidate.artifact)) {
        delete candidate.downloadedPath
        manager = { ...manager, status: 'available', error: 'Перевірений Setup змінився або пошкоджений. Завантажте його повторно.' }
        await persist(); emit()
        throw new Error(manager.error)
      }
      manager = { ...manager, status: 'installing' }; emit()
      const helperPath = options.sharedModulePath ? join(dirname(options.sharedModulePath), 'windows-update-launcher.mjs') : join(dirname(fileURLToPath(import.meta.url)), 'shared', 'windows-update-launcher.mjs')
      const { launchUpdatePowerShell } = await import(pathToFileURL(helperPath).href)
      const args = ['-ProcessId', String(options.processId), '-InstallerPath', packagePath, '-ApplicationExecutable', options.executablePath, '-ExpectedVersion', candidate.version, '-Component', 'ServerManager', '-LogPath', logPath]
      await launchUpdatePowerShell({ updateDirectory: updateDir, launcherPath: join(options.resourcesPath, 'component-update-launcher.ps1'), launcherArguments: args, logEvent, spawnProcess: options.spawnProcess })
      manager = { ...manager, status: 'restarting' }; emit(); setTimeout(() => appQuit(), 250)
    } catch (error) {
      manager = { ...manager, status: 'error', error: `Не вдалося створити процес launcher: ${error instanceof Error ? error.message.slice(0, 200) : 'невідома помилка'}` }
      busy = false
      emit()
      throw new Error(manager.error)
    }
    return true
  }
  return { restore, check, getState: () => ({ manager: { ...manager }, server: { ...server } }), download, installManager, setServerVersion(version: string | null) { server = { ...server, installedVersion: version }; emit() }, markServerUpdated(version: string) { server = { installedVersion: version, availableVersion: version, checkedAt: new Date().toISOString(), status: 'up-to-date' }; serverPending = undefined; emit() }, setServerError(message: string) { server = { ...server, status: 'error', error: message.slice(0, 300) }; emit() }, getServerPackage() { if (!server.packagePath || !serverPending) return null; return { path: server.packagePath, artifact: serverPending.artifact, version: serverPending.version } } }
}
let appQuit = () => { /* assigned by main to avoid coupling this service to Electron */ }
export function setReleaseUpdaterQuit(callback: () => void) { appQuit = callback }
