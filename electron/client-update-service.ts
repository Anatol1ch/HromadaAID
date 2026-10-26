import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { checkLatestRelease, compareVersions, downloadVerifiedArtifact, validateRepository, type ReleaseArtifact } from '../shared/release-updates.mjs'

export type ClientUpdateState = {
  status: 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'verifying' | 'ready' | 'preparing' | 'installing' | 'restarting' | 'error'
  currentVersion: string
  checkedAt?: string
  targetVersion?: string
  notes?: string
  receivedBytes?: number
  totalBytes?: number
  error?: string
  confirmed: boolean
}

type PendingUpdate = { version: string; notes: string; artifact: ReleaseArtifact; url: string; downloadedPath?: string }
const friendlyError = (error: unknown) => error instanceof Error ? error.message.slice(0, 300) : 'Не вдалося завершити операцію оновлення.'
async function matchesArtifact(path: string, artifact: ReleaseArtifact) {
  const info = await stat(path)
  if (info.size !== artifact.sizeBytes) return false
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex') === artifact.sha256
}

export function createClientUpdateService(options: {
  currentVersion: string; resourcesPath: string; userDataPath: string; executablePath: string; processId: number
  publish: (state: ClientUpdateState) => void; fetchImpl?: typeof fetch; spawnProcess?: typeof spawn
}) {
  const statePath = join(options.userDataPath, 'client-update-state.json')
  const updateDirectory = join(options.userDataPath, 'updates')
  let state: ClientUpdateState = { status: 'idle', currentVersion: options.currentVersion, confirmed: false }
  let pending: PendingUpdate | undefined
  let busy = false
  let saveQueue = Promise.resolve()

  const publish = () => options.publish({ ...state })
  const persist = () => {
    const snapshot = JSON.stringify({ checkedAt: state.checkedAt, status: state.status, error: state.error, pending }, null, 2) + '\n'
    const temporary = `${statePath}.${randomUUID()}.tmp`
    const operation = saveQueue.then(async () => {
      await mkdir(options.userDataPath, { recursive: true })
      await writeFile(temporary, snapshot, { flag: 'wx', mode: 0o600 })
      await rename(temporary, statePath)
    }).catch(async error => { await rm(temporary, { force: true }).catch(() => {}); throw error })
    saveQueue = operation.catch(() => {})
    return operation
  }
  const setState = (next: Partial<ClientUpdateState>) => { state = { ...state, ...next }; publish() }
  const cleanOwnedTemporaryFiles = async (directory: string, pattern: RegExp) => {
    try {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isFile() && pattern.test(entry.name)) await rm(join(directory, entry.name), { force: true })
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  const restore = async () => {
    await cleanOwnedTemporaryFiles(options.userDataPath, /^client-update-state\.json\.[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.tmp$/)
    await cleanOwnedTemporaryFiles(updateDirectory, /^client-update-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.part$/)
    try {
      const saved = JSON.parse(await readFile(statePath, 'utf8'))
      if (typeof saved.checkedAt === 'string') state.checkedAt = saved.checkedAt
      if (saved.status === 'up-to-date' || saved.status === 'error') state.status = saved.status
      if (saved.status === 'error' && typeof saved.error === 'string') state.error = saved.error
      const candidate = saved.pending as PendingUpdate | undefined
      if (candidate && compareVersions(candidate.version, options.currentVersion) <= 0) {
        if (candidate.downloadedPath === join(updateDirectory, `client-update-${candidate.artifact?.sha256}.exe`)) await rm(candidate.downloadedPath, { force: true }).catch(() => {})
        state = { ...state, status: 'up-to-date', checkedAt: new Date().toISOString(), confirmed: false }
        await persist()
      } else if (candidate && candidate.artifact?.component === 'installer') {
        pending = candidate
        state = { ...state, status: 'available', confirmed: true, targetVersion: candidate.version, notes: candidate.notes, checkedAt: state.checkedAt }
        if (candidate.downloadedPath === join(updateDirectory, `client-update-${candidate.artifact.sha256}.exe`)) {
          try {
            if (await matchesArtifact(candidate.downloadedPath, candidate.artifact)) state.status = 'ready'
            else { await rm(candidate.downloadedPath, { force: true }); delete pending.downloadedPath }
          } catch { delete pending.downloadedPath }
        }
      }
    } catch { /* First launch or malformed local state: GitHub remains the source of release truth. */ }
    publish()
  }

  const getState = () => ({ ...state })
  const check = async () => {
    if (busy || pending) return getState()
    busy = true
    setState({ status: 'checking', error: undefined })
    try {
      const config = JSON.parse(await readFile(join(options.resourcesPath, 'release-channel.json'), 'utf8'))
      const repository = validateRepository(config?.repository)
      const result = await checkLatestRelease({ repository, currentVersion: options.currentVersion, fetchImpl: options.fetchImpl })
      state.checkedAt = result.checkedAt
      if (!result.available) { setState({ status: 'up-to-date', checkedAt: result.checkedAt, confirmed: false }); await persist(); return getState() }
      pending = { version: result.version, notes: result.notes, artifact: result.artifact, url: result.url }
      setState({ status: 'available', targetVersion: result.version, notes: result.notes, checkedAt: result.checkedAt, confirmed: true, error: undefined })
      await persist()
      return getState()
    } catch (error) {
      setState({ status: 'error', checkedAt: new Date().toISOString(), confirmed: Boolean(pending), error: friendlyError(error) })
      await persist()
      return getState()
    } finally { busy = false }
  }

  const download = async () => {
    if (busy) return getState()
    if (!pending) return getState()
    if (state.status === 'installing' || state.status === 'restarting') return getState()
    if (pending.downloadedPath) {
      try {
        if (await matchesArtifact(pending.downloadedPath, pending.artifact)) { setState({ status: 'ready', error: undefined }); return getState() }
        await rm(pending.downloadedPath, { force: true })
        delete pending.downloadedPath
      } catch { delete pending.downloadedPath }
    }
    busy = true
    setState({ status: 'downloading', receivedBytes: 0, totalBytes: pending.artifact.sizeBytes, error: undefined })
    try {
      const path = await downloadVerifiedArtifact({ url: pending.url, artifact: pending.artifact, directory: updateDirectory, fetchImpl: options.fetchImpl, onProgress: progress => {
        setState({ status: progress.receivedBytes >= progress.totalBytes ? 'verifying' : 'downloading', ...progress })
      } })
      pending.downloadedPath = path
      await persist()
      setState({ status: 'ready', receivedBytes: pending.artifact.sizeBytes, totalBytes: pending.artifact.sizeBytes, error: undefined })
      return getState()
    } catch (error) {
      setState({ status: 'error', confirmed: true, error: friendlyError(error) })
      await persist()
      return getState()
    } finally { busy = false }
  }

  const install = async () => {
    if (busy || state.status === 'installing' || state.status === 'restarting') return { ok: false as const, message: 'Операція оновлення вже виконується.' }
    if (!pending?.downloadedPath) return { ok: false as const, message: 'Спочатку завантажте й перевірте інсталятор.' }
    busy = true
    const launcher = join(options.resourcesPath, 'client-update-launcher.ps1')
    try {
      await access(launcher)
      if (!await matchesArtifact(pending.downloadedPath, pending.artifact)) throw new Error('Перевірена копія інсталятора пошкоджена. Завантажте її повторно.')
      setState({ status: 'preparing', error: undefined })
      const child = (options.spawnProcess ?? spawn)('powershell.exe', [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', launcher,
        '-ProcessId', String(options.processId), '-InstallerPath', pending.downloadedPath, '-ApplicationExecutable', options.executablePath,
        '-ExpectedVersion', pending.version, '-Component', 'Client',
      ], { detached: true, windowsHide: true, stdio: 'ignore' })
      const started = await new Promise<boolean>(resolve => {
        child.once('spawn', () => resolve(true))
        child.once('error', error => { setState({ status: 'error', confirmed: true, error: friendlyError(error) }); resolve(false) })
      })
      if (!started) return { ok: false as const, message: state.error }
      child.unref()
      setState({ status: 'installing' })
      return { ok: true as const }
    } catch (error) {
      setState({ status: 'error', confirmed: true, error: friendlyError(error) })
      return { ok: false as const, message: state.error }
    } finally { busy = false }
  }

  const markRestarting = () => setState({ status: 'restarting' })

  return { restore, getState, check, download, install, markRestarting }
}
