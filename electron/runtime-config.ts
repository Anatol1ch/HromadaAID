import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export type ConnectionSource = 'environment' | 'saved' | 'none' | 'invalid'
export type ElectronRuntimeConfig = { source: ConnectionSource; apiUrl?: URL; configurationError?: string; lockedReason?: string }

export type SavedConnectionConfig = { apiUrl: string }

import { ElectronRuntimeConfigError, validateServerBaseUrl } from '../shared/server-base-url.mjs'
export { ElectronRuntimeConfigError, validateServerBaseUrl } from '../shared/server-base-url.mjs'

/** Prevent an inherited environment setting from disabling Node's normal TLS verification. */
export function enforceTlsCertificateValidation(): void {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1'
}

/** Converts Node's nested fetch/TLS errors to safe, actionable user text. */
export function safeTransportErrorMessage(error: unknown, timedOut = false): string | undefined {
  if (timedOut) return 'Сервер не відповів у встановлений час.'
  let current: unknown = error
  for (let depth = 0; depth < 6 && current && typeof current === 'object'; depth += 1) {
    const value = current as { code?: unknown; message?: unknown; cause?: unknown }
    if (typeof value.code === 'string' && /^(CERT_HAS_EXPIRED|ERR_TLS_CERT_ALTNAME_INVALID|UNABLE_TO_VERIFY_LEAF_SIGNATURE|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|ERR_CERT_AUTHORITY_INVALID|ERR_TLS_CERT_SIGNATURE_ALGORITHM_UNSUPPORTED)$/.test(value.code)) {
      return 'Не вдалося встановити захищене з’єднання: сертифікат сервера недовірений, прострочений або не відповідає адресі.'
    }
    if (typeof value.message === 'string' && value.message.toLowerCase() === 'unexpected redirect') {
      return 'Сервер перенаправив запит. Для безпеки перехід не виконано.'
    }
    current = value.cause
  }
  return undefined
}

export function readSavedConnectionConfig(userDataPath: string, packagedDefaultPath?: string): { config?: SavedConnectionConfig; error?: string } {
  let path = join(userDataPath, 'server-connection.json')
  let raw: string
  try { raw = readFileSync(path, 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      if (!packagedDefaultPath) return {}
      path = packagedDefaultPath
      try { raw = readFileSync(path, 'utf8') }
      catch (defaultError) {
        if ((defaultError as NodeJS.ErrnoException).code === 'ENOENT') return {}
        return { error: 'Не вдалося прочитати встановлену адресу сервера.' }
      }
    } else {
    return { error: 'Не вдалося прочитати збережену адресу сервера. Вкажіть її повторно в налаштуваннях.' }
    }
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || (parsed as Record<string, unknown>).version !== 1) throw new Error()
    const apiUrl = validateServerBaseUrl((parsed as Record<string, unknown>).apiUrl).origin
    return { config: { apiUrl } }
  } catch {
    return { error: 'Збережена адреса сервера пошкоджена або некоректна. Перевірте її в налаштуваннях підключення.' }
  }
}

/** A configured environment URL pins the address; otherwise use the saved client setting. */
export function readElectronRuntimeConfig(environment = process.env, saved: ReturnType<typeof readSavedConnectionConfig> = {}): ElectronRuntimeConfig {
  const explicitUrl = environment.HROMADAAID_API_URL?.trim()
  if (explicitUrl) {
    try { return { source: 'environment', apiUrl: validateServerBaseUrl(explicitUrl), lockedReason: 'Адресу зафіксовано змінною HROMADAAID_API_URL у цьому запуску.' } }
    catch (error) { return { source: 'invalid', configurationError: error instanceof Error ? error.message : 'Некоректна адреса сервера.', lockedReason: 'Адресу зафіксовано змінною HROMADAAID_API_URL у цьому запуску.' } }
  }
  if (saved.error) return { source: 'invalid', configurationError: saved.error }
  if (saved.config) {
    try { return { source: 'saved', apiUrl: validateServerBaseUrl(saved.config.apiUrl) } }
    catch (error) { return { source: 'invalid', configurationError: error instanceof Error ? error.message : 'Адреса сервера некоректна. Вкажіть її повторно в налаштуваннях.' } }
  }
  return { source: 'none', configurationError: 'Налаштуйте адресу сервера, щоб увійти.' }
}
