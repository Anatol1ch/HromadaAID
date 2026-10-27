import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, rename, rm, stat, statfs } from 'node:fs/promises'
import { join } from 'node:path'

const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const allowedAssetHosts = new Set(['api.github.com', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'])

export function parseStableVersion(value) {
  if (typeof value !== 'string') return null
  const match = stableVersion.exec(value)
  if (!match) return null
  const numbers = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (numbers.some(part => !Number.isSafeInteger(part))) return null
  return { major: numbers[0], minor: numbers[1], patch: numbers[2], prerelease: match[4]?.split('.') ?? [] }
}

export function compareVersions(left, right) {
  const a = parseStableVersion(left), b = parseStableVersion(right)
  if (!a || !b) throw new Error('Версія не відповідає SemVer.')
  for (const key of ['major', 'minor', 'patch']) if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1
  if (!a.prerelease.length || !b.prerelease.length) return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length ? -1 : 1
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index++) {
    const av = a.prerelease[index], bv = b.prerelease[index]
    if (av === undefined || bv === undefined) return av === undefined ? -1 : 1
    if (av === bv) continue
    const an = /^\d+$/.test(av), bn = /^\d+$/.test(bv)
    if (an && bn) return BigInt(av) < BigInt(bv) ? -1 : 1
    if (an !== bn) return an ? -1 : 1
    return av < bv ? -1 : 1
  }
  return 0
}

export function validateRepository(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value) || value.includes('..')) throw new Error('Не налаштовано адресу GitHub-репозиторію оновлень (owner/repository).')
  return value
}

export function validateReleaseManifest(value, release, currentVersion) {
  const parsedVersion = value && parseStableVersion(value.version)
  if (!value || value.formatVersion !== 1 || value.platform !== 'win32' || value.architecture !== 'x64' || !parsedVersion || parsedVersion.prerelease.length) throw new Error('Маніфест релізу має некоректну версію або платформу.')
  const tagVersion = typeof release.tag_name === 'string' ? release.tag_name.replace(/^v/, '') : ''
  if (release.draft || release.prerelease || tagVersion !== value.version) throw new Error('Реліз не є стабільним або версія не відповідає тегу.')
  if (compareVersions(value.version, currentVersion) <= 0) return null
  if (value.compatibility?.installer !== 'hromadaaid-universal-nsis-v1' || !Array.isArray(value.compatibility?.installModes) || !['Client-only', 'Server-only', 'Combined'].every(mode => value.compatibility.installModes.includes(mode))) throw new Error('Маніфест не підтверджує сумісність з універсальним інсталятором HromadaAID.')
  if (value.compatibility?.api?.contract !== 'hromadaaid-rest' || value.compatibility?.api?.version !== 1) throw new Error('Маніфест має некоректний API contract compatibility marker.')
  if (value.compatibility?.manager?.versionPolicy !== 'same-release-version' || value.compatibility?.manager?.apiContract !== 'hromadaaid-rest' || value.compatibility?.manager?.apiContractVersion !== 1) throw new Error('Маніфест не підтверджує сумісність Server Manager із сервером цього релізу.')
  if (!Array.isArray(value.artifacts)) throw new Error('У маніфесті відсутній перелік артефактів.')
  const setupName = `HromadaAID-Setup-${value.version}.exe`
  const serverName = `HromadaAID-Server-v${value.version}-win-x64.zip`
  const setup = value.artifacts.find(item => item?.component === 'installer' && item.name === setupName)
  const server = value.artifacts.find(item => item?.component === 'server' && item.name === serverName)
  for (const artifact of [setup, server]) if (!artifact || !/^[a-f0-9]{64}$/.test(artifact.sha256) || !Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes < 1 || artifact.sizeBytes > 2_000_000_000) throw new Error('Маніфест містить неповні або некоректні артефакти.')
  if (server.packageIntegrity !== 'embedded-package-integrity-v1') throw new Error('Маніфест має посилатися на наявний package-integrity.json сервера.')
  return { version: value.version, notes: safeReleaseNotes(release.body), artifact: setup, serverArtifact: server }
}

export function safeReleaseNotes(value) {
  if (typeof value !== 'string') return 'Опис змін для цього випуску не надано.'
  // Markdown is rendered as React text nodes. Remove embedded HTML while preserving
  // the Markdown structure; the renderer never creates links or raw HTML elements.
  const text = value.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, '')
  return text.trim() || 'Опис змін для цього випуску не надано.'
}

async function request(url, fetchImpl, connectTimeoutMs, headers = {}) {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:') throw new Error('Канал оновлень має використовувати HTTPS.')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), connectTimeoutMs)
  try {
    const response = await fetchImpl(url, { headers, signal: controller.signal, redirect: 'follow' })
    if (response.url && (new URL(response.url).protocol !== 'https:' || !allowedAssetHosts.has(new URL(response.url).hostname))) throw new Error('Відповідь сервера оновлень вийшла за межі GitHub HTTPS.')
    if (!response.ok) throw new Error(`GitHub відповів HTTP ${response.status}.`)
    return { response, controller }
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Не вдалося встановити з’єднання з GitHub у відведений час.')
    throw error
  } finally { clearTimeout(timer) }
}

async function requestJson(url, fetchImpl, timeoutMs, headers) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, { headers, signal: controller.signal, redirect: 'follow' })
    if (response.url && (new URL(response.url).protocol !== 'https:' || !allowedAssetHosts.has(new URL(response.url).hostname))) throw new Error('Відповідь сервера оновлень вийшла за межі GitHub HTTPS.')
    if (!response.ok) throw new Error(`GitHub відповів HTTP ${response.status}.`)
    const declaredLength = Number(response.headers?.get?.('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > 1_000_000) throw new Error('Метадані GitHub мають надмірний розмір.')
    const body = await response.text()
    if (Buffer.byteLength(body) > 1_000_000) throw new Error('Метадані GitHub мають надмірний розмір.')
    try { return JSON.parse(body) } catch { throw new Error('GitHub повернув пошкоджений JSON.') }
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Перевищено час очікування відповіді GitHub.')
    throw error
  } finally { clearTimeout(timer) }
}

export async function checkLatestRelease({ repository, currentVersion, fetchImpl = fetch, timeoutMs = 12_000 }) {
  validateRepository(repository)
  if (!parseStableVersion(currentVersion)) throw new Error('Поточна версія застосунку некоректна.')
  const base = `https://api.github.com/repos/${repository}`
  const release = await requestJson(`${base}/releases/latest`, fetchImpl, timeoutMs, { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'HromadaAID' })
  if (!release || typeof release.tag_name !== 'string' || release.draft || release.prerelease) throw new Error('GitHub не повернув стабільний опублікований реліз.')
  const manifestAsset = release.assets?.find(item => item?.name === 'release-manifest.json')
  if (!manifestAsset || typeof manifestAsset.browser_download_url !== 'string') throw new Error('У релізі відсутній release-manifest.json.')
  const url = new URL(manifestAsset.browser_download_url)
  if (url.protocol !== 'https:' || url.hostname !== 'github.com') throw new Error('Посилання на маніфест не належить GitHub Releases.')
  const releaseManifest = await requestJson(url.href, fetchImpl, timeoutMs, { Accept: 'application/octet-stream', 'User-Agent': 'HromadaAID' })
  const manifest = validateReleaseManifest(releaseManifest, release, currentVersion)
  if (!manifest) return { available: false, checkedAt: new Date().toISOString() }
  const asset = release.assets.find(item => item?.name === manifest.artifact.name)
  if (!asset || typeof asset.browser_download_url !== 'string') throw new Error('У релізі відсутній інсталятор, зазначений у маніфесті.')
  const artifactUrl = new URL(asset.browser_download_url)
  if (artifactUrl.protocol !== 'https:' || artifactUrl.hostname !== 'github.com') throw new Error('Посилання на інсталятор не належить GitHub Releases.')
  const serverAsset = release.assets.find(item => item?.name === manifest.serverArtifact.name)
  if (!serverAsset || typeof serverAsset.browser_download_url !== 'string') throw new Error('У релізі відсутній серверний ZIP, зазначений у маніфесті.')
  const serverUrl = new URL(serverAsset.browser_download_url)
  if (serverUrl.protocol !== 'https:' || serverUrl.hostname !== 'github.com') throw new Error('Посилання на серверний ZIP не належить GitHub Releases.')
  return { available: true, checkedAt: new Date().toISOString(), version: manifest.version, notes: manifest.notes, artifact: manifest.artifact, url: artifactUrl.href, serverArtifact: manifest.serverArtifact, serverUrl: serverUrl.href }
}

export async function downloadVerifiedArtifact({ url, artifact, directory, fetchImpl = fetch, connectTimeoutMs = 20_000, idleTimeoutMs = 45_000, onProgress = () => {} }) {
  const origin = new URL(url)
  if (origin.protocol !== 'https:' || origin.hostname !== 'github.com') throw new Error('Посилання на пакет не належить GitHub Releases.')
  await mkdir(directory, { recursive: true })
  const volume = await statfs(directory)
  if (BigInt(volume.bavail) * BigInt(volume.bsize) < BigInt(artifact.sizeBytes) + 64n * 1024n * 1024n) throw new Error('Недостатньо вільного місця для завантаження інсталятора.')
  const prefix = artifact.component === 'installer' ? 'client-update' : 'server-update'
  const extension = artifact.component === 'installer' ? 'exe' : 'zip'
  const id = randomUUID(), temporary = join(directory, `${prefix}-${id}.part`), destination = join(directory, `${prefix}-${artifact.sha256}.${extension}`)
  let file
  let controller
  let idleTimer
  let idleTimedOut = false
  const armIdleTimeout = () => {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => { idleTimedOut = true; controller?.abort() }, idleTimeoutMs)
  }
  try {
    const requested = await request(url, fetchImpl, connectTimeoutMs, { Accept: 'application/octet-stream', 'User-Agent': 'HromadaAID' })
    controller = requested.controller
    const response = requested.response
    if (!response.body) throw new Error('GitHub повернув порожнє завантаження.')
    armIdleTimeout()
    file = await open(temporary, 'wx', 0o600)
    const hash = createHash('sha256')
    let received = 0
    for await (const chunk of response.body) {
      armIdleTimeout()
      const bytes = Buffer.from(chunk)
      received += bytes.length
      if (received > artifact.sizeBytes) throw new Error('Завантажений файл більший за розмір у маніфесті.')
      hash.update(bytes)
      let offset = 0
      while (offset < bytes.length) offset += (await file.write(bytes, offset, bytes.length - offset)).bytesWritten
      onProgress({ receivedBytes: received, totalBytes: artifact.sizeBytes })
    }
    await file.sync()
    await file.close(); file = undefined
    if (received !== artifact.sizeBytes) throw new Error('Завантаження перервано: розмір файлу не збігається з маніфестом.')
    if (hash.digest('hex') !== artifact.sha256) throw new Error('SHA-256 інсталятора не збігається з release-manifest.json.')
    try {
      const existing = await stat(destination)
      if (existing.size !== artifact.sizeBytes) throw new Error('Файл оновлення з такою контрольною сумою вже існує, але має неправильний розмір.')
      const existingHash = createHash('sha256')
      for await (const chunk of createReadStream(destination)) existingHash.update(chunk)
      if (existingHash.digest('hex') !== artifact.sha256) throw new Error('Файл оновлення з такою контрольною сумою вже існує, але пошкоджений.')
      await rm(temporary, { force: true })
      return destination
    } catch (error) { if (error?.code !== 'ENOENT') throw error }
    await rename(temporary, destination)
    return destination
  } catch (error) {
    if (file) await file.close().catch(() => {})
    await rm(temporary, { force: true }).catch(() => {})
    if (idleTimedOut) throw new Error(`Завантаження зупинено: протягом ${Math.ceil(idleTimeoutMs / 1000)} с не надходили дані; частковий файл видалено.`)
    if (error?.name === 'AbortError') throw new Error('Завантаження перервано мережею; частковий файл видалено.')
    throw error
  } finally { clearTimeout(idleTimer) }
}
