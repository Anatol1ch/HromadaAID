import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { access, appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { checkLatestRelease, compareVersions, downloadVerifiedArtifact, validateRepository, type ReleaseArtifact } from '../shared/release-updates.mjs'
import { launchUpdatePowerShell } from '../shared/windows-update-launcher.mjs'

export type ClientUpdateState = {
  status: 'idle' | 'checking' | 'up-to-date' | 'waiting-for-server' | 'available' | 'downloading' | 'verifying' | 'ready' | 'preparing' | 'installing' | 'restarting' | 'error'
  currentVersion: string
  checkedAt?: string
  targetVersion?: string
  notes?: string
  receivedBytes?: number
  totalBytes?: number
  error?: string
  updateDeferralReason?: 'server-contract' | 'server-unavailable' | 'compatibility-unconfirmed'
  canContinue?: boolean
  confirmed: boolean
}

type PendingUpdate = { version: string; notes: string; targetApiContractVersion?: number; artifact: ReleaseArtifact; url: string; downloadedPath?: string }
type ServerContractProbe = { reachable: boolean; apiContractVersion?: number }
const friendlyError = (error: unknown) => error instanceof Error ? error.message.slice(0, 300) : 'Не вдалося завершити операцію оновлення.'
const validContractVersion = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
async function matchesArtifact(path: string, artifact: ReleaseArtifact) {
  const info = await stat(path)
  if (info.size !== artifact.sizeBytes) return false
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex') === artifact.sha256
}

export function createClientUpdateService(options: {
  currentVersion: string; resourcesPath: string; releaseChannelPath?: string; isDevelopment?: boolean; userDataPath: string; executablePath: string; processId: number
  publish: (state: ClientUpdateState) => void; fetchImpl?: typeof fetch; spawnProcess?: typeof spawn; probeServerApiContract?: () => Promise<ServerContractProbe>; currentApiContractVersion?: number
}) {
  const statePath = join(options.userDataPath, 'client-update-state.json')
  const updateDirectory = join(options.userDataPath, 'updates')
  let state: ClientUpdateState = { status: 'idle', currentVersion: options.currentVersion, confirmed: false }
  let pending: PendingUpdate | undefined
  let busy = false
  const currentApiContractVersion = options.currentApiContractVersion ?? 2
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
  const assessUpdateCompatibility = async (targetApiContractVersion: number) => {
    if (targetApiContractVersion === currentApiContractVersion) return { allowed: true as const }
    let probe: ServerContractProbe | undefined
    try { probe = await options.probeServerApiContract?.() } catch { probe = undefined }
    if (probe?.reachable && validContractVersion(probe.apiContractVersion) && probe.apiContractVersion === targetApiContractVersion) return { allowed: true as const }
    if (probe?.reachable && probe.apiContractVersion === currentApiContractVersion) return { allowed: false as const, reason: 'server-contract' as const, canContinue: true }
    if (probe?.reachable && validContractVersion(probe.apiContractVersion)) return { allowed: false as const, reason: 'compatibility-unconfirmed' as const, canContinue: false }
    return { allowed: false as const, reason: probe?.reachable ? 'compatibility-unconfirmed' as const : 'server-unavailable' as const, canContinue: false }
  }
  const setDeferredUpdate = (candidate: PendingUpdate, reason: NonNullable<ClientUpdateState['updateDeferralReason']>, canContinue: boolean) => {
    setState({ status: 'waiting-for-server', targetVersion: candidate.version, notes: candidate.notes, checkedAt: state.checkedAt, confirmed: false, updateDeferralReason: reason, canContinue, error: undefined })
  }
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
        if (!validContractVersion(candidate.targetApiContractVersion)) {
          state = { ...state, status: 'error', targetVersion: candidate.version, notes: candidate.notes, confirmed: false, error: 'Не вдалося підтвердити цільовий API-контракт цього оновлення.' }
        } else {
          const decision = await assessUpdateCompatibility(candidate.targetApiContractVersion)
          if (!decision.allowed) {
            state = { ...state, status: 'waiting-for-server', targetVersion: candidate.version, notes: candidate.notes, confirmed: false, updateDeferralReason: decision.reason, canContinue: decision.canContinue, error: undefined }
          } else {
            state = { ...state, status: 'available', confirmed: true, targetVersion: candidate.version, notes: candidate.notes, checkedAt: state.checkedAt, updateDeferralReason: undefined, canContinue: undefined }
            if (candidate.downloadedPath === join(updateDirectory, `client-update-${candidate.artifact.sha256}.exe`)) {
              try {
                if (await matchesArtifact(candidate.downloadedPath, candidate.artifact)) state.status = 'ready'
                else { await rm(candidate.downloadedPath, { force: true }); delete pending.downloadedPath }
              } catch { delete pending.downloadedPath }
            }
          }
        }
      }
    } catch { /* First launch or malformed local state: GitHub remains the source of release truth. */ }
    publish()
  }

  const getState = () => ({ ...state })
  const check = async () => {
    if (busy) return getState()
    if (pending && state.confirmed) {
      const candidate = pending
      if (!validContractVersion(candidate.targetApiContractVersion) || candidate.targetApiContractVersion === currentApiContractVersion) return getState()
      busy = true
      try {
        const decision = await assessUpdateCompatibility(candidate.targetApiContractVersion)
        if (!decision.allowed) {
          setDeferredUpdate(candidate, decision.reason, decision.canContinue)
          await persist()
        }
        return getState()
      } finally { busy = false }
    }
    busy = true
    setState({ status: 'checking', confirmed: false, error: undefined, updateDeferralReason: undefined, canContinue: undefined })
    let config: { repository?: unknown }
    try {
      config = JSON.parse(await readFile(options.releaseChannelPath ?? join(options.resourcesPath, 'release-channel.json'), 'utf8')) as { repository?: unknown }
    } catch (error) {
      const missingDevelopmentChannel = options.isDevelopment === true && (error as NodeJS.ErrnoException)?.code === 'ENOENT'
      setState({
        status: 'error', checkedAt: new Date().toISOString(), confirmed: false,
        error: missingDevelopmentChannel
          ? 'Перевірка оновлень недоступна в режимі розробки.'
          : 'Не вдалося прочитати конфігурацію оновлень. Перевірте встановлення програми або зверніться до адміністратора.',
      })
      await persist()
      return getState()
    }
    try {
      const repository = validateRepository(config?.repository)
      const result = await checkLatestRelease({ repository, currentVersion: options.currentVersion, fetchImpl: options.fetchImpl, allowTargetApiContractTransition: true })
      state.checkedAt = result.checkedAt
      if (!result.available) { pending = undefined; setState({ status: 'up-to-date', checkedAt: result.checkedAt, targetVersion: undefined, notes: undefined, confirmed: false, updateDeferralReason: undefined, canContinue: undefined }); await persist(); return getState() }
      if (!validContractVersion(result.targetApiContractVersion)) {
        pending = undefined
        setState({ status: 'error', targetVersion: result.version, notes: result.notes, checkedAt: result.checkedAt, confirmed: false, updateDeferralReason: undefined, canContinue: undefined, error: 'Не вдалося підтвердити цільовий API-контракт нового релізу.' })
        await persist()
        return getState()
      }
      const candidate: PendingUpdate = { version: result.version, notes: result.notes, targetApiContractVersion: result.targetApiContractVersion, artifact: result.artifact, url: result.url }
      const targetContractVersion = result.targetApiContractVersion
      const decision = await assessUpdateCompatibility(targetContractVersion)
      pending = candidate
      if (!decision.allowed) setDeferredUpdate(candidate, decision.reason, decision.canContinue)
      else setState({ status: 'available', targetVersion: result.version, notes: result.notes, checkedAt: result.checkedAt, confirmed: true, error: undefined, updateDeferralReason: undefined, canContinue: undefined })
      await persist()
      return getState()
    } catch (error) {
      setState({ status: 'error', checkedAt: new Date().toISOString(), confirmed: false, updateDeferralReason: undefined, canContinue: undefined, error: friendlyError(error) })
      await persist()
      return getState()
    } finally { busy = false }
  }

  const download = async () => {
    if (busy) return getState()
    if (!pending || !state.confirmed || !validContractVersion(pending.targetApiContractVersion)) return getState()
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
    const logPath = join(updateDirectory, 'installer-launcher.log')
    const logEvent = async (stage: string, details: Record<string, unknown> = {}) => {
      await mkdir(updateDirectory, { recursive: true })
      await appendFile(logPath, `${JSON.stringify({ timestamp: new Date().toISOString(), component: 'Client', stage, parentProcessId: options.processId, details })}\n`, 'utf8')
    }
    await logEvent('install-command-received', { installerPath: pending?.downloadedPath ?? null, expectedVersion: pending?.version ?? null })
    if (busy || state.status === 'installing' || state.status === 'restarting') return { ok: false as const, message: 'Операція оновлення вже виконується.' }
    if (!pending?.downloadedPath || !state.confirmed || state.status !== 'ready') return { ok: false as const, message: 'Спочатку завантажте й перевірте інсталятор.', state: getState() }
    busy = true
    const launcher = join(options.resourcesPath, 'client-update-launcher.ps1')
    try {
      const candidate = pending
      const targetContractVersion = candidate.targetApiContractVersion
      const installerPath = candidate.downloadedPath
      if (!validContractVersion(targetContractVersion) || !installerPath) {
        setState({ status: 'error', confirmed: false, error: 'Не вдалося підтвердити цільовий API-контракт цього оновлення.' })
        await persist()
        return { ok: false as const, message: state.error, state: getState() }
      }
      await access(launcher)
      if (!await matchesArtifact(installerPath, candidate.artifact)) throw new Error('Перевірена копія інсталятора пошкоджена. Завантажте її повторно.')
      const compatibility = await assessUpdateCompatibility(targetContractVersion)
      if (!compatibility.allowed) {
        setDeferredUpdate(candidate, compatibility.reason, compatibility.canContinue)
        await persist()
        return { ok: false as const, message: 'Сумісність оновлення із сервером більше не підтверджена. Перевірте оновлення пізніше.', state: getState() }
      }
      setState({ status: 'preparing', error: undefined })
      const args = [
        '-ProcessId', String(options.processId), '-InstallerPath', installerPath, '-ApplicationExecutable', options.executablePath,
        '-ExpectedVersion', candidate.version, '-Component', 'Client', '-LogPath', join(updateDirectory, 'installer-launcher.log'),
      ]
      await launchUpdatePowerShell({ updateDirectory, launcherPath: launcher, launcherArguments: args, logEvent, spawnProcess: options.spawnProcess })
      setState({ status: 'installing' })
      return { ok: true as const }
    } catch (error) {
      setState({ status: 'error', confirmed: true, error: friendlyError(error) })
      return { ok: false as const, message: state.error, state: getState() }
    } finally { busy = false }
  }

  const markRestarting = () => setState({ status: 'restarting' })

  return { restore, getState, check, download, install, markRestarting }
}
