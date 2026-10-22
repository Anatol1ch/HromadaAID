import { createReadStream, createWriteStream, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync, openSync, closeSync, fsyncSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { listDailyBackups } from './backup.js'
import { decodeRecoveryKey, decryptBackupFile, encryptBackupFile, hashFile, type DriveSecrets } from './backup-crypto.js'

const driveApi = 'https://www.googleapis.com/drive/v3/files'
const driveUploadApi = 'https://www.googleapis.com/upload/drive/v3/files'
const tokenEndpoint = 'https://oauth2.googleapis.com/token'
const backupMarkerKey = 'hromadaAidBackup'
const backupIdKey = 'hromadaAidBackupId'
const retryDelayMs = 5 * 60 * 1000
const managedBackup = /^hromada-aid-daily-(\d{4}-\d{2}-\d{2})-created-.*\.sqlite\.hraid$/

export class GoogleDriveError extends Error {
  constructor(message: string, readonly status?: number, readonly operation?: string, readonly reason?: string) { super(message); this.name = 'GoogleDriveError' }
}

type DriveFile = { id: string; name: string; size?: string; md5Checksum?: string; appProperties?: Record<string, string>; createdTime?: string }
type DriveList = { files?: DriveFile[]; nextPageToken?: string }
type DriveErrorResponse = { error?: { status?: unknown; errors?: { reason?: unknown }[] } }
const safeDriveReasons = new Set(['badRequest', 'invalid', 'invalidArgument', 'required', 'failedPrecondition', 'notFound', 'insufficientPermissions', 'appNotAuthorizedToFile', 'storageQuotaExceeded', 'authError', 'rateLimitExceeded', 'backendError', 'unsupportedContentType', 'domainPolicy'])

export class GoogleDriveClient {
  private accessToken: string | undefined
  private accessExpiresAt = 0

  constructor(
    private readonly oauth: { clientId: string; clientSecret?: string; refreshToken: string; folderId: string },
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async findBackup(backupId: string): Promise<DriveFile[]> {
    const escapedFolder = this.oauth.folderId.replaceAll("'", "\\'")
    const escapedId = backupId.replaceAll("'", "\\'")
    const q = `'${escapedFolder}' in parents and trashed = false and appProperties has { key='${backupMarkerKey}' and value='true' } and appProperties has { key='${backupIdKey}' and value='${escapedId}' }`
    return this.list(q, 'пошуку резервної копії')
  }

  async listManagedBackups(): Promise<DriveFile[]> {
    const escapedFolder = this.oauth.folderId.replaceAll("'", "\\'")
    const q = `'${escapedFolder}' in parents and trashed = false and appProperties has { key='${backupMarkerKey}' and value='true' }`
    return this.list(q, 'переліку резервних копій')
  }

  async uploadBackup(localEncryptedPath: string, fileName: string, backupId: string, checksum: { size: number; md5: string }): Promise<DriveFile> {
    const boundary = `hromada-aid-${randomBytes(18).toString('hex')}`
    const metadata = JSON.stringify({
      name: fileName,
      mimeType: 'application/octet-stream',
      parents: [this.oauth.folderId],
      appProperties: { [backupMarkerKey]: 'true', [backupIdKey]: backupId },
    })
    const prefix = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`)
    const suffix = Buffer.from(`\r\n--${boundary}--`)
    const stream = Readable.from((async function* () {
      yield prefix
      const fileStream = createReadStream(localEncryptedPath)
      try { for await (const chunk of fileStream) yield chunk as Buffer }
      finally {
        fileStream.destroy()
        if (!fileStream.closed) await new Promise<void>((resolveClose) => fileStream.once('close', () => resolveClose()))
      }
      yield suffix
    })())
    const length = prefix.length + checksum.size + suffix.length
    const response = await this.request(`${driveUploadApi}?uploadType=multipart&fields=id,name,size,md5Checksum,appProperties,createdTime`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}`, 'Content-Length': String(length) },
      body: stream as unknown as BodyInit,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' }, [200], 'завантаження зашифрованої копії')
    const file = await this.readJson<DriveFile>(response)
    if (!file.id || file.name !== fileName || Number(file.size) !== checksum.size || file.md5Checksum?.toLowerCase() !== checksum.md5.toLowerCase() || file.appProperties?.[backupMarkerKey] !== 'true' || file.appProperties?.[backupIdKey] !== backupId) {
      throw new GoogleDriveError('Google Drive не підтвердив цілісність завантаженої копії.')
    }
    return file
  }

  async verifyBackup(fileId: string, expected: { name: string; size?: number; md5?: string; backupId: string }): Promise<DriveFile> {
    const url = new URL(`${driveApi}/${encodeURIComponent(fileId)}`)
    url.searchParams.set('fields', 'id,name,size,md5Checksum,appProperties,createdTime')
    const response = await this.request(url.toString(), {}, [200], 'перевірки метаданих копії')
    const file = await this.readJson<DriveFile>(response)
    if (file.name !== expected.name || (expected.size !== undefined && Number(file.size) !== expected.size) || (expected.md5 !== undefined && file.md5Checksum?.toLowerCase() !== expected.md5.toLowerCase()) || !file.md5Checksum || !Number(file.size) || file.appProperties?.[backupMarkerKey] !== 'true' || file.appProperties?.[backupIdKey] !== expected.backupId) {
      throw new GoogleDriveError('Перевірка копії в Google Drive не пройдена.')
    }
    return file
  }

  async deleteManagedBackup(fileId: string): Promise<void> {
    await this.request(`${driveApi}/${encodeURIComponent(fileId)}`, { method: 'DELETE' }, [204], 'видалення старої копії')
  }

  async downloadBackup(fileId: string, outputPath: string): Promise<void> {
    const url = new URL(`${driveApi}/${encodeURIComponent(fileId)}`)
    url.searchParams.set('alt', 'media')
    const response = await this.request(url.toString(), {}, [200], 'завантаження копії для перевірки')
    if (!response.body) throw new GoogleDriveError('Google Drive не повернув файл резервної копії.')
    try { await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), createWriteStream(outputPath, { flags: 'wx', mode: 0o600 })) }
    catch { try { unlinkSync(outputPath) } catch { /* incomplete file cleanup is best effort */ }; throw new GoogleDriveError('Не вдалося перевірити копію з Google Drive.') }
  }

  private async list(query: string, operation: string): Promise<DriveFile[]> {
    const files: DriveFile[] = []
    let pageToken: string | undefined
    do {
      const url = new URL(driveApi)
      url.searchParams.set('q', query)
      url.searchParams.set('spaces', 'drive')
      url.searchParams.set('pageSize', '1000')
      url.searchParams.set('fields', 'nextPageToken,files(id,name,size,md5Checksum,appProperties,createdTime)')
      if (pageToken) url.searchParams.set('pageToken', pageToken)
      const response = await this.request(url.toString(), {}, [200], operation)
      const page = await this.readJson<DriveList>(response)
      files.push(...(page.files ?? []))
      pageToken = page.nextPageToken
    } while (pageToken)
    return files
  }

  private async request(url: string, init: RequestInit = {}, allowedStatuses: number[] = [200], operation = 'запиту до Google Drive') : Promise<Response> {
    const token = await this.getAccessToken()
    let response: Response
    try { response = await this.fetcher(url, { ...init, signal: init.signal ?? AbortSignal.timeout(60_000), headers: { ...Object.fromEntries(new Headers(init.headers)), Authorization: `Bearer ${token}` } }) }
    catch { throw new GoogleDriveError('Не вдалося з’єднатися з Google Drive.') }
    if (response.status === 401) {
      this.accessToken = undefined
      if (init.body !== undefined) throw new GoogleDriveError(`HTTP 401 під час операції «${operation}»; запит із тілом не повторювався.`, 401, operation, 'authError')
      const refreshed = await this.getAccessToken(true)
      try { response = await this.fetcher(url, { ...init, signal: init.signal ?? AbortSignal.timeout(60_000), headers: { ...Object.fromEntries(new Headers(init.headers)), Authorization: `Bearer ${refreshed}` } }) }
      catch { throw new GoogleDriveError('Не вдалося з’єднатися з Google Drive.') }
    }
    if (!allowedStatuses.includes(response.status)) {
      const reason = await safeDriveErrorReason(response)
      if (response.status === 403) throw new GoogleDriveError(`Google Drive відхилив доступ під час операції «${operation}»${reason ? ` (${reason})` : ''}. Перевірте підключений обліковий запис і доступ до папки резервних копій.`, response.status, operation, reason)
      throw new GoogleDriveError(`Google Drive повернув HTTP ${response.status} під час операції «${operation}»${reason ? ` (${reason})` : ''}.`, response.status, operation, reason)
    }
    return response
  }

  private async getAccessToken(force = false): Promise<string> {
    if (!force && this.accessToken && Date.now() < this.accessExpiresAt - 30_000) return this.accessToken
    const body = new URLSearchParams({ client_id: this.oauth.clientId, refresh_token: this.oauth.refreshToken, grant_type: 'refresh_token' })
    if (this.oauth.clientSecret) body.set('client_secret', this.oauth.clientSecret)
    let response: Response
    try { response = await this.fetcher(tokenEndpoint, { method: 'POST', signal: AbortSignal.timeout(60_000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }) }
    catch { throw new GoogleDriveError('Не вдалося підключитися до служби авторизації Google.') }
    if (!response.ok) throw new GoogleDriveError(response.status === 400 || response.status === 401 ? 'Потрібно повторно підключити обліковий запис Google Drive.' : `Служба авторизації Google повернула HTTP ${response.status}.`, response.status)
    let token: { access_token?: string; expires_in?: number }
    try { token = await response.json() as typeof token } catch { throw new GoogleDriveError('Служба авторизації Google повернула некоректну відповідь.') }
    if (!token.access_token || !Number.isFinite(token.expires_in)) throw new GoogleDriveError('Служба авторизації Google повернула неповну відповідь.')
    this.accessToken = token.access_token
    this.accessExpiresAt = Date.now() + token.expires_in! * 1000
    return this.accessToken
  }

  private async readJson<T>(response: Response): Promise<T> {
    try { return await response.json() as T } catch { throw new GoogleDriveError('Google Drive повернув некоректну відповідь.') }
  }
}

async function safeDriveErrorReason(response: Response): Promise<string | undefined> {
  try {
    const data = await response.clone().json() as DriveErrorResponse
    const candidate = data.error?.errors?.find((item) => typeof item.reason === 'string')?.reason ?? data.error?.status
    return typeof candidate === 'string' && safeDriveReasons.has(candidate) ? candidate : undefined
  } catch { return undefined }
}

type SyncState = { version: 1; uploaded: Record<string, { driveFileId: string; uploadedAt: string }> }

export class DriveSyncStateStore {
  readonly path: string
  private state: SyncState = { version: 1, uploaded: {} }

  constructor(directory: string) { this.path = join(resolve(directory), '.hromadaaid-drive-sync.json') }

  load(): void {
    if (!existsSync(this.path)) return
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as SyncState
      if (parsed.version !== 1 || !parsed.uploaded || typeof parsed.uploaded !== 'object') throw new Error('invalid')
      this.state = parsed
    } catch { throw new Error('Не вдалося прочитати стан синхронізації резервних копій.') }
  }

  isUploaded(name: string): boolean { return Boolean(this.state.uploaded[name]) }
  markUploaded(name: string, driveFileId: string, uploadedAt = new Date().toISOString()): void {
    this.state.uploaded[name] = { driveFileId, uploadedAt }
    this.persist()
  }
  pruneTo(existingLocalNames: Set<string>): void {
    let changed = false
    for (const name of Object.keys(this.state.uploaded)) {
      if (!existingLocalNames.has(name)) { delete this.state.uploaded[name]; changed = true }
    }
    if (changed) this.persist()
  }

  private persist(): void {
    const temporary = `${this.path}.${randomBytes(8).toString('hex')}.tmp`
    const descriptor = openSync(temporary, 'wx', 0o600)
    try { writeFileSync(descriptor, JSON.stringify(this.state)); fsyncSync(descriptor) } finally { closeSync(descriptor) }
    try { renameSync(temporary, this.path) } catch (error) { try { unlinkSync(temporary) } catch { /* leave prior state */ }; throw error }
  }
}

export type DriveSyncLogger = { info?: (message: string) => void; warn: (message: string) => void; error: (message: string) => void }

export class GoogleDriveBackupSync {
  private active = false
  private stopped = true
  private timer: ReturnType<typeof setTimeout> | undefined
  private retryDelayMs: number

  constructor(
    private readonly directory: string,
    private readonly secrets: DriveSecrets,
    private readonly client: GoogleDriveClient,
    private readonly state: DriveSyncStateStore,
    private readonly logger: DriveSyncLogger,
    options: { retryDelayMs?: number } = {},
  ) { this.retryDelayMs = options.retryDelayMs ?? retryDelayMs }

  start(): void { if (!this.stopped) return; this.stopped = false; void this.runAndSchedule(0) }
  wake(): void { if (this.stopped || this.active) return; if (this.timer) clearTimeout(this.timer); void this.runAndSchedule(0) }
  async stop(): Promise<void> { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.timer = undefined; while (this.active) await new Promise((resolve) => setTimeout(resolve, 25)) }

  async syncOne(): Promise<boolean> {
    if (this.active) return false
    this.active = true
    try {
      const backups = listDailyBackups(this.directory).sort((a, b) => a.slotDate.localeCompare(b.slotDate) || a.createdAt.localeCompare(b.createdAt))
      this.state.pruneTo(new Set(backups.map((file) => file.name)))
      const pending = backups.find((file) => !this.state.isUploaded(file.name))
      if (!pending) return false
      let temporaryEncrypted: string | undefined
      try {
        const key = decodeRecoveryKey(this.secrets.encryptionKey)
        const remoteName = `${pending.name}.hraid`
        const existing = await this.client.findBackup(pending.name)
        let uploaded: DriveFile
        if (existing.length) {
          uploaded = await this.verifyExistingBackup(existing[0]!, remoteName, pending.name, pending.path, key)
          for (const duplicate of existing.slice(1)) {
            if (duplicate.name === remoteName && duplicate.appProperties?.[backupMarkerKey] === 'true' && duplicate.appProperties[backupIdKey] === pending.name) {
              await this.client.deleteManagedBackup(duplicate.id)
            }
          }
        } else {
          temporaryEncrypted = `${pending.path}.${randomBytes(8).toString('hex')}.hraid.partial`
          await encryptBackupFile(pending.path, temporaryEncrypted, key)
          const checksum = await hashFile(temporaryEncrypted)
          uploaded = await this.client.uploadBackup(temporaryEncrypted, remoteName, pending.name, checksum)
          uploaded = await this.client.verifyBackup(uploaded.id, { name: remoteName, size: checksum.size, md5: checksum.md5, backupId: pending.name })
        }
        await this.pruneCloudBackups()
        this.state.markUploaded(pending.name, uploaded.id)
        return true
      } finally {
        if (temporaryEncrypted) { try { unlinkSync(temporaryEncrypted) } catch { /* incomplete encrypted files are ignored */ } }
      }
    } catch (error) {
      const message = error instanceof GoogleDriveError ? error.message : 'Не вдалося синхронізувати резервну копію з Google Drive.'
      this.logger.warn(message)
      return false
    } finally { this.active = false }
  }

  private async pruneCloudBackups(): Promise<void> {
    const files = (await this.client.listManagedBackups())
      .filter((file) => file.appProperties?.[backupMarkerKey] === 'true' && managedBackup.test(file.name) && file.appProperties[backupIdKey] === file.name.slice(0, -6))
      .sort((a, b) => {
        const dateA = managedBackup.exec(a.name)?.[1] ?? ''
        const dateB = managedBackup.exec(b.name)?.[1] ?? ''
        return dateB.localeCompare(dateA) || (b.createdTime ?? '').localeCompare(a.createdTime ?? '')
      })
    for (const stale of files.slice(30)) await this.client.deleteManagedBackup(stale.id)
  }

  private async verifyExistingBackup(file: DriveFile, name: string, backupId: string, sourcePath: string, key: Buffer): Promise<DriveFile> {
    const verifiedMetadata = await this.client.verifyBackup(file.id, { name, backupId })
    const encryptedPath = `${sourcePath}.${randomBytes(8).toString('hex')}.verify.hraid.partial`
    const decryptedPath = `${sourcePath}.${randomBytes(8).toString('hex')}.verify.sqlite.partial`
    try {
      await this.client.downloadBackup(file.id, encryptedPath)
      const downloadedHash = await hashFile(encryptedPath)
      if (downloadedHash.size !== Number(verifiedMetadata.size) || downloadedHash.md5.toLowerCase() !== verifiedMetadata.md5Checksum?.toLowerCase()) {
        throw new GoogleDriveError('Завантажена з Google Drive копія не пройшла перевірку цілісності.')
      }
      await decryptBackupFile(encryptedPath, decryptedPath, key)
      const [sourceHash, restoredHash] = await Promise.all([hashFile(sourcePath), hashFile(decryptedPath)])
      if (sourceHash.sha256 !== restoredHash.sha256) throw new GoogleDriveError('Копія у Google Drive не відповідає локальному резервному архіву.')
      return verifiedMetadata
    } finally {
      try { unlinkSync(encryptedPath) } catch { /* temporary ciphertext cleanup is best effort */ }
      try { unlinkSync(decryptedPath) } catch { /* temporary plaintext cleanup is best effort */ }
    }
  }

  private async runAndSchedule(delay: number): Promise<void> {
    if (this.stopped) return
    if (delay > 0) await new Promise((resolveDelay) => { this.timer = setTimeout(resolveDelay, delay) })
    this.timer = undefined
    if (this.stopped) return
    await this.syncOne()
    if (!this.stopped) this.timer = setTimeout(() => { this.timer = undefined; void this.runAndSchedule(0) }, this.retryDelayMs)
  }
}

export function createDriveClient(secrets: DriveSecrets, environment = process.env, fetcher?: typeof fetch): GoogleDriveClient | null {
  const clientId = environment.HROMADA_AID_GOOGLE_CLIENT_ID?.trim()
  if (!clientId) return null
  return new GoogleDriveClient({ clientId, clientSecret: environment.HROMADA_AID_GOOGLE_CLIENT_SECRET, refreshToken: secrets.google.refreshToken, folderId: secrets.google.folderId }, fetcher)
}

