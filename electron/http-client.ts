import type { BackupArchive } from '../shared/backup-contract.js'
import { saveBackupResponse } from './backup-download.js'
import { closeSync, createReadStream, openSync, readSync, statSync } from 'node:fs'
import { classifyHttpReachability, isMaintenanceResponse, type ConnectionFailureReason, type ConnectionStatus } from '../shared/system-state.js'
import { safeTransportErrorMessage } from './runtime-config.js'

export class HttpClientError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'HttpClientError'
  }
}

export type JsonValidator<T> = (value: unknown) => value is T
type RequestOptions = { authorize?: boolean; accessToken?: string; headers?: Record<string, string>; signal?: AbortSignal; timeoutMs?: number }
type HttpClientOptions = { getAccessToken?: () => string | undefined; onUnauthorized?: (token: string | undefined) => void; onConnectionStatus?: (status: Exclude<ConnectionStatus, 'unknown' | 'checking'>, failureReason?: ConnectionFailureReason) => void }

/** Main-process HTTP transport. Tokens are obtained only through its private callback. */
export class HttpClient {
  private baseUrl: URL | undefined
  private generation = 0

  constructor(baseUrl: URL | undefined, private readonly timeoutMs = 5_000, private readonly options: HttpClientOptions = {}) { this.baseUrl = baseUrl ? new URL(baseUrl.origin) : undefined }
  get serverOrigin(): string { return this.configuredBaseUrl().origin }

  private configuredBaseUrl(): URL {
    if (!this.baseUrl) throw new HttpClientError('Налаштуйте адресу сервера перед входом.')
    return this.baseUrl
  }

  async downloadBackup(path: string, target: string, archive: BackupArchive, headers: Record<string, string>, signal: AbortSignal): Promise<void> {
    const baseUrl = this.configuredBaseUrl()
    if (baseUrl.protocol !== 'https:' && !(baseUrl.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(baseUrl.hostname))) throw new HttpClientError('Для передавання резервних копій потрібен HTTPS.')
    if (!/^\/api\/backups\/(?:archives\/[a-f0-9]{64}|server\/[a-f0-9]{64}\/download)$/.test(path)) throw new HttpClientError('Некоректний шлях резервного архіву.')
    const generation = this.generation, token = this.options.getAccessToken?.()
    if (!token) throw new HttpClientError('Потрібна чинна сесія.', 401)
    const current = () => { this.checkConnectionGeneration(generation); this.checkRequestSession(true, token) }
    let response: Response
    try { response = await fetch(new URL(path, baseUrl), { redirect: 'error', headers: { ...headers, authorization: `Bearer ${token}` }, signal: AbortSignal.any([signal, AbortSignal.timeout(300_000)]) }) }
    catch (error) { const timedOut = error instanceof DOMException && error.name === 'TimeoutError'; const message = safeTransportErrorMessage(error, timedOut) ?? 'Не вдалося підключитися до сервера.'; this.options.onConnectionStatus?.('unavailable', timedOut ? 'timeout' : message !== 'Не вдалося підключитися до сервера.' ? 'incompatible' : 'network'); throw new HttpClientError(message) }
    current()
    const responseBody = await response.clone().json().catch(() => undefined)
    this.options.onConnectionStatus?.(classifyHttpReachability(response.status, responseBody))
    if (response.status === 401) this.options.onUnauthorized?.(token)
    if (!response.ok) { await response.body?.cancel(); throw new HttpClientError(response.status === 403 ? 'Резервування для цього комп’ютера вимкнено.' : `Не вдалося завантажити резервну копію (HTTP ${response.status}).`, response.status) }
    await saveBackupResponse(response, target, archive, current, signal)
  }

  async uploadBackup<T>(file: string, validator: JsonValidator<T>): Promise<T> {
    const baseUrl = this.configuredBaseUrl()
    if (!file.toLowerCase().endsWith('.hraid')) throw new HttpClientError('Оберіть зашифрований архів .hraid.')
    if (baseUrl.protocol !== 'https:' && !(baseUrl.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(baseUrl.hostname))) throw new HttpClientError('Для передавання резервних копій потрібен HTTPS.')
    const size = statSync(file).size
    if (size > 2 * 1024 * 1024 * 1024 || size < 29) throw new HttpClientError('Розмір архіву має бути не більше 2 ГіБ.')
    const fd = openSync(file, 'r'), prefix = Buffer.alloc(9)
    try { if (readSync(fd, prefix, 0, 9, 0) !== 9 || prefix.subarray(0, 8).toString('ascii') !== 'HRAIDBKP' || ![1, 2].includes(prefix[8])) throw new HttpClientError('Файл не є підтримуваним зашифрованим архівом.') } finally { closeSync(fd) }
    const generation = this.generation, token = this.options.getAccessToken?.()
    if (!token) throw new HttpClientError('Потрібна чинна сесія.', 401)
    const stream = createReadStream(file)
    try {
      const init = { method: 'POST', redirect: 'error' as const, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream', 'content-length': String(size) }, body: stream, duplex: 'half', signal: AbortSignal.timeout(300_000) }
      let response: Response
      try { response = await fetch(new URL('/api/backups/restore/upload', baseUrl), init as unknown as RequestInit) }
      catch (error) { const timedOut = error instanceof DOMException && error.name === 'TimeoutError'; this.options.onConnectionStatus?.('unavailable', timedOut ? 'timeout' : 'network'); throw new HttpClientError(timedOut ? 'Сервер не відповів у встановлений час.' : 'Не вдалося підключитися до сервера.') }
      this.checkConnectionGeneration(generation)
      const responseBody = await response.clone().json().catch(() => undefined)
      this.options.onConnectionStatus?.(classifyHttpReachability(response.status, responseBody))
      if (response.status === 401) this.options.onUnauthorized?.(token)
      this.checkRequestSession(true, token)
      const value: unknown = await response.json()
      this.checkConnectionGeneration(generation); this.checkRequestSession(true, token)
      if (!response.ok) throw this.responseError(response.status, value, '/api/backups/restore/upload')
      if (!validator(value)) throw new HttpClientError('Некоректна відповідь перевірки архіву.')
      return value
    } finally { stream.destroy() }
  }

  /** Switches the trusted server origin and invalidates responses from the previous connection. */
  setBaseUrl(baseUrl: URL): void {
    this.baseUrl = new URL(baseUrl.origin)
    this.generation += 1
  }

  async getJson<T>(path: string, validator?: JsonValidator<T>, options?: RequestOptions): Promise<T> {
    return this.requestJson('GET', path, undefined, validator, options)
  }

  async postJson<T>(path: string, body: unknown, validator?: JsonValidator<T>, options?: RequestOptions): Promise<T> {
    return this.requestJson('POST', path, body, validator, options)
  }

  async putJson<T>(path: string, body: unknown, validator?: JsonValidator<T>, options?: RequestOptions): Promise<T> {
    return this.requestJson('PUT', path, body, validator, options)
  }

  async deleteJson<T>(path: string, body?: unknown, validator?: JsonValidator<T>, options?: RequestOptions): Promise<T> {
    return this.requestJson('DELETE', path, body, validator, options)
  }

  async postNoContent(path: string, body?: unknown, options?: RequestOptions): Promise<void> {
    const { response, body: responseBody } = await this.request('POST', path, body, options)
    if (!response.ok) throw this.responseError(response.status, responseBody, path)
  }

  private async requestJson<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body: unknown, validator?: JsonValidator<T>, options?: RequestOptions): Promise<T> {
    const { response, body: responseBody } = await this.request(method, path, body, options)
    if (!response.ok) {
      // Write endpoints deliberately return their typed validation/conflict result with 4xx status.
      if (validator && validator(responseBody)) return responseBody
      throw this.responseError(response.status, responseBody, path)
    }
    if (validator && !validator(responseBody)) throw new HttpClientError('Сервер повернув відповідь у непідтримуваному форматі.')
    return responseBody as T
  }

  private async request(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body: unknown, options?: RequestOptions): Promise<{ response: Response; body: unknown }> {
    if (!path.startsWith('/')) throw new HttpClientError('Шлях HTTP API має починатися з «/».')
    const requestGeneration = this.generation
    const baseUrl = this.configuredBaseUrl()
    const authorize = options?.authorize !== false
    const token = authorize ? (options?.accessToken ?? this.options.getAccessToken?.()) : undefined
    if (authorize && !token) throw new HttpClientError('Потрібна чинна сесія.', 401)
    let response: Response
    const diagnosePasswordChange = path === '/auth/change-password' && !!process.env.HROMADA_AID_TEST_DATA_DIR
    if (diagnosePasswordChange) console.info(`[HromadaAID test] POST ${baseUrl.origin}/auth/change-password: sending`)
    try {
      response = await fetch(new URL(path, baseUrl), {
        method,
        redirect: 'error',
        headers: {
          ...options?.headers,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: options?.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs ?? this.timeoutMs)]) : AbortSignal.timeout(options?.timeoutMs ?? this.timeoutMs),
      })
    } catch (error) {
      this.checkConnectionGeneration(requestGeneration)
      const timedOut = error instanceof DOMException && error.name === 'TimeoutError'
      const message = safeTransportErrorMessage(error, timedOut) ?? 'Не вдалося підключитися до сервера.'
      const failureReason = timedOut ? 'timeout' : message !== 'Не вдалося підключитися до сервера.' ? 'incompatible' : 'network'
      this.options.onConnectionStatus?.('unavailable', failureReason)
      if (diagnosePasswordChange) console.info('[HromadaAID test] password-change: transport error (no confirmed response)')
      throw new HttpClientError(message)
    }

    if (diagnosePasswordChange) console.info(`[HromadaAID test] password-change: HTTP ${response.status}`)

    this.checkConnectionGeneration(requestGeneration)
    if (authorize && response.status === 401) this.options.onUnauthorized?.(token)
    this.checkRequestSession(authorize, token, options)
    if (response.status === 204) { this.options.onConnectionStatus?.('available'); return { response, body: undefined } }
    let responseBody: unknown
    try { responseBody = await response.json() }
    catch { this.checkConnectionGeneration(requestGeneration); this.options.onConnectionStatus?.(classifyHttpReachability(response.status, undefined)); throw new HttpClientError('Сервер повернув некоректну відповідь.') }
    this.checkConnectionGeneration(requestGeneration)
    this.checkRequestSession(authorize, token, options)
    this.options.onConnectionStatus?.(classifyHttpReachability(response.status, responseBody))
    return { response, body: responseBody }
  }

  private checkRequestSession(authorize: boolean, token: string | undefined, options?: RequestOptions): void {
    // A response belongs to the session that issued it, never to a later login.
    if (authorize && options?.accessToken === undefined && token !== this.options.getAccessToken?.()) {
      throw new HttpClientError('Запит попередньої сесії скасовано.', 401)
    }
  }

  private checkConnectionGeneration(generation: number): void {
    if (generation !== this.generation) throw new HttpClientError('Запит до попередньої адреси сервера скасовано.')
  }

  private responseError(status: number, responseBody: unknown, path?: string): HttpClientError {
    if (status === 401) {
      const message = path === '/auth/login' ? 'Неправильний логін або пароль.' : 'Час сеансу минув. Увійдіть повторно.'
      return new HttpClientError(message, status)
    }
    if (status === 403) return new HttpClientError('У вашого облікового запису немає дозволу на виконання цієї дії.', status)
    if (status === 503) return new HttpClientError(isMaintenanceResponse(status, responseBody) ? 'Сервер тимчасово виконує технічне обслуговування.' : 'Сервер тимчасово недоступний. Спробуйте пізніше.', status)
    if (status >= 500) return new HttpClientError('Не вдалося виконати запит через помилку сервера.', status)
    const message = responseBody && typeof responseBody === 'object' && 'message' in responseBody && typeof responseBody.message === 'string'
      ? responseBody.message
      : `Сервер повернув помилку HTTP ${status}.`
    return new HttpClientError(message, status)
  }
}
