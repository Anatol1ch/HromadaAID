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
    try {
      const result = await this.http.postJson('/auth/login', { username, password }, isLoginResult, { authorize: false })
      this.token = result.token
      const state = this.publish({ mode: 'remote', status: result.user.mustChangePassword ? 'password-change-required' : 'authenticated', user: result.user })
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

