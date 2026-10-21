import { safeStorage } from 'electron'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AuthActionResult, ClientAuthState } from '../shared/auth-contract.js'
import { isAuthenticatedUser, isLoginResult } from '../shared/auth-contract.js'
import { HttpClient, HttpClientError } from './http-client.js'

const sessionFileName = 'remote-session.dat'
const unavailable = (message: string): ClientAuthState => ({ mode: 'remote', status: 'unavailable', user: null, message })
const signedOut = (message?: string): ClientAuthState => ({ mode: 'remote', status: 'unauthenticated', user: null, ...(message ? { message } : {}) })

/** Owns a remote bearer token exclusively in Electron main process memory and DPAPI storage. */
export class RemoteAuthSession {
  private token: string | undefined
  private state: ClientAuthState = signedOut()
  private readonly path: string

  constructor(userDataPath: string, private readonly http: HttpClient, private readonly notify: (state: ClientAuthState) => void) {
    this.path = join(userDataPath, sessionFileName)
  }

  get accessToken(): string | undefined { return this.token }
  get currentState(): ClientAuthState { return this.state }

  async initialize(): Promise<ClientAuthState> {
    if (!safeStorage.isEncryptionAvailable()) return this.publish(unavailable('Захищене сховище Windows недоступне. Вхід у віддалений режим неможливий.'))
    const token = await this.readToken()
    if (!token) return this.publish(signedOut())
    this.token = token
    try {
      const user = await this.http.getJson('/auth/me', isAuthenticatedUser)
      return this.publish({ mode: 'remote', status: 'authenticated', user })
    } catch (error) {
      if (error instanceof HttpClientError && error.status === 401) return this.clear('Сесію завершено. Увійдіть повторно.')
      this.token = undefined
      return this.publish(unavailable('Не вдалося з’єднатися із сервером. Перевірте підключення та повторіть спробу.'))
    }
  }

  async login(username: string, password: string): Promise<AuthActionResult> {
    if (!safeStorage.isEncryptionAvailable()) return { ok: false, state: this.publish(unavailable('Захищене сховище Windows недоступне. Вхід неможливий.')), message: 'Захищене сховище Windows недоступне.' }
    try {
      const result = await this.http.postJson('/auth/login', { username, password }, isLoginResult, { authorize: false })
      await this.writeToken(result.token)
      this.token = result.token
      const state = this.publish({ mode: 'remote', status: 'authenticated', user: result.user })
      return { ok: true, state }
    } catch (error) {
      const message = error instanceof HttpClientError ? error.message : 'Не вдалося виконати вхід.'
      const state = this.state.status === 'authenticated' ? this.state : signedOut(message)
      return { ok: false, state: this.publish(state), message }
    }
  }

  async logout(): Promise<AuthActionResult> {
    let message: string | undefined
    try {
      if (this.token) await this.http.postNoContent('/auth/logout')
    } catch {
      message = 'Не вдалося відкликати сесію на сервері. Локальну сесію видалено.'
    }
    const state = await this.clear(message)
    return message ? { ok: false, state, message } : { ok: true, state }
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<AuthActionResult> {
    try {
      await this.http.postNoContent('/auth/change-password', { currentPassword, newPassword })
      const state = await this.clear('Пароль змінено. Увійдіть з новим паролем.')
      return { ok: true, state }
    } catch (error) {
      const message = error instanceof HttpClientError ? error.message : 'Не вдалося змінити пароль.'
      return { ok: false, state: this.state, message }
    }
  }

  async expired(): Promise<void> { await this.clear('Сесію завершено. Увійдіть повторно.') }

  private publish(state: ClientAuthState): ClientAuthState {
    this.state = state
    this.notify(state)
    return state
  }

  private async clear(message?: string): Promise<ClientAuthState> {
    this.token = undefined
    await rm(this.path, { force: true }).catch(() => undefined)
    return this.publish(signedOut(message))
  }

  private async readToken(): Promise<string | undefined> {
    try {
      const encrypted = await readFile(this.path)
      const token = safeStorage.decryptString(encrypted)
      if (!/^[A-Za-z0-9_-]{32,1024}$/.test(token)) throw new Error('invalid token format')
      return token
    } catch {
      await rm(this.path, { force: true }).catch(() => undefined)
      return undefined
    }
  }

  private async writeToken(token: string): Promise<void> {
    const encrypted = safeStorage.encryptString(token)
    await mkdir(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.${process.pid}.tmp`
    try {
      await writeFile(temporary, encrypted, { mode: 0o600 })
      await chmod(temporary, 0o600).catch(() => undefined)
      await rename(temporary, this.path)
      await chmod(this.path, 0o600).catch(() => undefined)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
  }
}

export function localAuthState(): ClientAuthState {
  return { mode: 'local', status: 'authenticated', user: null }
}

