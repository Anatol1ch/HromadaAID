import { hostname } from 'node:os'
import { join } from 'node:path'
import type { ClientAuthState } from '../shared/auth-contract.js'
import type { ClientBackupState } from '../shared/backup-contract.js'
import { isBackupArchiveList, isBackupInstallation } from '../shared/backup-contract.js'
import { HttpClient, HttpClientError } from './http-client.js'
import { archiveMatches } from './backup-download.js'
import { BackupInstallationIdentity, BackupReplicaStorage } from './backup-storage.js'

export class RemoteBackupClient {
  private enabled = false
  private epoch = 0
  private timer: ReturnType<typeof setInterval> | undefined
  private controller: AbortController | undefined
  private running: Promise<void> | undefined
  private storage: BackupReplicaStorage | undefined
  private origin: string | undefined
  private state: ClientBackupState = { status: 'signed-out' }
  constructor(private readonly http: HttpClient, private readonly identity: BackupInstallationIdentity, private readonly root: string, private readonly computerName = hostname()) {}
  get currentState(): ClientBackupState { return { ...this.state } }
  get archiveDirectory(): string | undefined { return this.storage?.directory }
  authChanged(state: ClientAuthState): void {
    this.enabled = state.status === 'authenticated'
    this.epoch++
    this.controller?.abort()
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    if (!this.enabled) { this.state = { status: 'signed-out' }; this.storage = undefined; this.origin = undefined; return }
    this.timer = setInterval(() => this.wake(), 5 * 60_000)
    this.wake()
  }
  wake(): void {
    if (!this.enabled || this.running) return
    const epoch = this.epoch
    const operation = this.sync(epoch)
    this.running = operation
    void operation.finally(() => { this.running = undefined; if (this.enabled && epoch !== this.epoch) this.wake() }).catch(() => undefined)
  }
  async stop(): Promise<void> {
    this.enabled = false; this.epoch++; this.controller?.abort()
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    await this.running
  }
  private async sync(epoch: number): Promise<void> {
    const controller = new AbortController(); this.controller = controller
    const current = () => { if (!this.enabled || epoch !== this.epoch) throw new Error('Синхронізацію попередньої сесії скасовано.'); controller.signal.throwIfAborted() }
    try {
      this.state = { ...this.state, status: 'checking' }
      const origin = this.http.serverOrigin
      const url = new URL(origin)
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Error('Для резервування потрібне захищене HTTPS-підключення.')
      const credential = this.identity.credential(origin)
      if (!this.storage || this.origin !== origin) { this.storage = new BackupReplicaStorage(this.root, origin); this.origin = origin }
      const headers = { 'x-hromada-installation-id': credential.id, 'x-hromada-installation-key': credential.secret }
      const options = { headers, signal: controller.signal }
      const device = await this.http.postJson('/api/backups/installations/register', { computerName: this.computerName.slice(0, 100) }, isBackupInstallation, options)
      current()
      if (!device.allowed) {
        const lastBackupAt = device.lastBackupAt ?? this.storage.records.map(item => item.receivedAt).sort().at(-1)
        this.state = { status: 'disabled', message: lastBackupAt ? 'Резервування для цього комп’ютера вимкнено. Наявні копії збережено.' : 'Адміністратор ще не дозволив резервування для цього комп’ютера.', ...(lastBackupAt ? { lastBackupAt } : {}) }
        return
      }
      const available = await this.http.getJson('/api/backups/archives', isBackupArchiveList, options)
      const desired = [...available].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).slice(0, 7).reverse()
      for (const archive of desired) {
        current()
        const target = join(this.storage.directory, archive.fileName)
        const present = await archiveMatches(target, archive, controller.signal)
        current()
        if (!present) await this.http.downloadBackup(`/api/backups/archives/${archive.id}`, target, archive, headers, controller.signal)
        current()
        this.storage.markSaved(archive)
        if (!this.storage.records.find(item => item.archive.id === archive.id)?.acknowledged) {
          await this.http.postJson(`/api/backups/archives/${archive.id}/received`, {}, undefined, options)
          current(); this.storage.acknowledge(archive.id)
        }
      }
      const lastBackupAt = this.storage.records.map(item => item.receivedAt).sort().at(-1)
      current(); this.state = { status: 'enabled', ...(lastBackupAt ? { lastBackupAt } : {}), message: available.length ? 'Доступні резервні копії збережено.' : 'Очікуємо першу серверну резервну копію.' }
    } catch (error) {
      if (epoch !== this.epoch || !this.enabled) return
      this.state = error instanceof HttpClientError && error.status === 403
        ? { ...this.state, status: 'disabled', message: 'Адміністратор вимкнув резервування для цього комп’ютера. Наявні копії збережено.' }
        : { ...this.state, status: 'error', message: 'Резервування тимчасово недоступне. Роботу можна продовжувати; спробу буде повторено автоматично.' }
    }
  }
}
