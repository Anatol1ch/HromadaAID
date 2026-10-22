import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { AuthActionResult, ClientAuthState } from '../shared/auth-contract.js'
import { isLoginResult } from '../shared/auth-contract.js'
import { HttpClient, HttpClientError } from './http-client.js'

const sessionFileName = 'remote-session.dat'
const signedOut = (message?: string): ClientAuthState => ({ mode: 'remote', status: 'unauthenticated', user: null, ...(message ? { message } : {}) })

/** Owns a remote bearer token exclusively for this Electron process lifetime. */
export class RemoteAuthSession {
  private token: string | undefined
  private state: ClientAuthState = signedOut()
  private readonly legacySessionPath: string
  private loginGeneration = 0
  private pendingLogin: Promise<AuthActionResult> | undefined
  private switchingServer = false

  constructor(userDataPath: string, private readonly http: HttpClient, private readonly notify: (state: ClientAuthState) => void) {
    this.legacySessionPath = join(userDataPath, sessionFileName)
  }

  get accessToken(): string | undefined { return this.token }
  get currentState(): ClientAuthState { return this.state }

  async initialize(): Promise<ClientAuthState> {
    // Versions before 4.3.1 stored a DPAPI-protected token in userData. Never
    // read it: every new Electron process must begin at the sign-in screen.
    await rm(this.legacySessionPath, { force: true }).catch(() => undefined)
    return this.publish(signedOut())
  }

  async login(username: string, password: string): Promise<AuthActionResult> {
    if (this.switchingServer) return { ok: false, state: this.state, message: 'Зачекайте завершення зміни сервера.' }
    if (this.pendingLogin) return { ok: false, state: this.state, message: 'Вхід уже виконується.' }
    const generation = ++this.loginGeneration
    const operation = this.performLogin(username, password, generation)
    this.pendingLogin = operation
    try { return await operation }
    finally { if (this.pendingLogin === operation) this.pendingLogin = undefined }
  }

  private async performLogin(username: string, password: string, generation: number): Promise<AuthActionResult> {
    try {
      const result = await this.http.postJson('/auth/login', { username, password }, isLoginResult, { authorize: false })
      if (generation !== this.loginGeneration || this.switchingServer) {
        await this.http.postNoContent('/auth/logout', undefined, { accessToken: result.token }).catch(() => undefined)
        return { ok: false, state: this.state, message: 'Підключення змінилося. Повторіть вхід.' }
      }
      this.token = result.token
      const state = this.publish({ mode: 'remote', status: result.user.mustChangePassword ? 'password-change-required' : 'authenticated', user: result.user })
      return { ok: true, state }
    } catch (error) {
      const message = error instanceof HttpClientError ? error.message : 'Не вдалося виконати вхід.'
      if (generation !== this.loginGeneration || this.switchingServer) return { ok: false, state: this.state, message: 'Підключення змінилося. Повторіть вхід.' }
      const state = this.state.status === 'authenticated' ? this.state : signedOut(message)
      return { ok: false, state: this.publish(state), message }
    }
  }

  async logout(): Promise<AuthActionResult> {
    this.loginGeneration += 1
    const token = this.token
    const state = await this.clear()
    let message: string | undefined
    try {
      if (token) await this.http.postNoContent('/auth/logout', undefined, { accessToken: token })
    } catch {
      message = 'Не вдалося відкликати сесію на сервері. Локальну сесію видалено.'
    }
    if (message && !this.token && this.state.status === 'unauthenticated') this.publish(signedOut(message))
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

  async expired(requestToken?: string): Promise<void> { if (requestToken && requestToken !== this.token) return; await this.clear('Сесію завершено. Увійдіть повторно.') }

  async beginServerChange(): Promise<void> {
    this.switchingServer = true
    await this.pendingLogin?.catch(() => undefined)
  }

  endServerChange(): void { this.switchingServer = false }

  async serverChanged(message = 'Адресу сервера змінено. Увійдіть до нового сервера.'): Promise<void> { this.loginGeneration += 1; await this.clear(message) }

  setNotice(message: string): void { this.publish(signedOut(message)) }

  setUnavailable(message: string): void { this.publish({ mode: 'remote', status: 'unavailable', user: null, message }) }

  /** Best-effort server revocation during process shutdown; never blocks exit indefinitely. */
  async close(): Promise<void> {
    const logout = this.logout().catch(() => undefined)
    await Promise.race([logout, new Promise<void>((resolve) => setTimeout(resolve, 1_500))])
  }

  private publish(state: ClientAuthState): ClientAuthState {
    this.state = state
    this.notify(state)
    return state
  }

  private async clear(message?: string): Promise<ClientAuthState> {
    this.token = undefined
    return this.publish(signedOut(message))
  }
}

export function localAuthState(): ClientAuthState {
  return { mode: 'local', status: 'authenticated', user: null }
}
