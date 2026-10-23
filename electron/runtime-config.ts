import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export type ConnectionSource = 'environment' | 'saved' | 'none' | 'invalid'
export type ElectronRuntimeConfig = { source: ConnectionSource; apiUrl?: URL; configurationError?: string; lockedReason?: string }

export type SavedConnectionConfig = { apiUrl: string }

export class ElectronRuntimeConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ElectronRuntimeConfigError'
  }
}

export function validateServerBaseUrl(value: unknown): URL {
  if (typeof value !== 'string' || !value.trim()) throw new ElectronRuntimeConfigError('Укажіть адресу сервера.')
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new ElectronRuntimeConfigError('Введіть коректну адресу сервера.') }
  const host = url.hostname.toLowerCase()
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '') || (url.protocol === 'http:' && !loopback)) {
    throw new ElectronRuntimeConfigError('Вкажіть базову адресу сервера без шляху, облікових даних, параметрів чи фрагмента. Для віддаленого сервера потрібен HTTPS.')
  }
  return new URL(url.origin)
}

export function readSavedConnectionConfig(userDataPath: string): { config?: SavedConnectionConfig; error?: string } {
  const path = join(userDataPath, 'server-connection.json')
  let raw: string
  try { raw = readFileSync(path, 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    return { error: 'Не вдалося прочитати локальну адресу сервера. Вкажіть її повторно в налаштуваннях.' }
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || (parsed as Record<string, unknown>).version !== 1) throw new Error()
    const apiUrl = validateServerBaseUrl((parsed as Record<string, unknown>).apiUrl).origin
    return { config: { apiUrl } }
  } catch {
    return { error: 'Локальна адреса сервера пошкоджена або некоректна. Перевірте її в налаштуваннях підключення.' }
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
    catch { return { source: 'invalid', configurationError: 'Адреса сервера некоректна. Вкажіть її повторно в налаштуваннях.' } }
  }
  return { source: 'none', configurationError: 'Налаштуйте адресу сервера, щоб увійти.' }
}
