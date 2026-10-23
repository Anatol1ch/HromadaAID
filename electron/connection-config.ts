import { randomUUID } from 'node:crypto'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { ServerConnectionCheckResult, ServerConnectionState } from '../shared/api-contract.js'
import { safeTransportErrorMessage, validateServerBaseUrl } from './runtime-config.js'
import type { RemoteAuthSession } from './auth-session.js'
import type { HttpClient } from './http-client.js'
import { classifyHealthFailure, classifyHealthResponse } from '../shared/system-state.js'

export type { ServerConnectionState } from '../shared/api-contract.js'
export type ConnectionCheckResult = ServerConnectionCheckResult
export type ConnectionSaveResult = { ok: true; state: ServerConnectionState; message?: string } | { ok: false; state: ServerConnectionState; message: string }

export async function checkServerAddress(value: unknown, timeoutMs = 3_500): Promise<ConnectionCheckResult> {
  let base: URL
  try { base = validateServerBaseUrl(value) }
  catch (error) { return { ok: false, status: 'unavailable', failureReason: 'incompatible', message: error instanceof Error ? error.message : 'Некоректна адреса сервера.' } }
  let response: Response
  try {
    response = await fetch(new URL('/health', base), { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError'
    const transportMessage = safeTransportErrorMessage(error, timedOut)
    return { ok: false, apiUrl: base.origin, status: 'unavailable', failureReason: transportMessage && !timedOut ? 'incompatible' : timedOut ? 'timeout' : 'network', message: transportMessage ?? 'Не вдалося підключитися до сервера.' }
  }
  let body: unknown
  try { body = await response.json() }
  catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError'
    return { ok: false, apiUrl: base.origin, status: 'unavailable', failureReason: timedOut ? 'timeout' : 'http', message: timedOut ? 'Сервер не відповів у встановлений час.' : 'Сервер повернув некоректну відповідь.' }
  }
  const status = classifyHealthResponse(response.status, body)
  if (status === 'maintenance') return { ok: false, apiUrl: base.origin, status, failureReason: 'maintenance', message: 'Сервер тимчасово виконує технічне обслуговування.' }
  if (status !== 'available') {
    const failureReason = classifyHealthFailure(response.status, body)
    return { ok: false, apiUrl: base.origin, status: 'unavailable', failureReason, message: failureReason === 'http' ? 'Сервер відповів помилкою під час перевірки доступності.' : 'За цією адресою не виявлено сумісний сервер HromadaAID.' }
  }
  return { ok: true, apiUrl: base.origin, status, message: 'Сервер доступний.' }
}

/** Atomically replaces a URL-only client config in Electron userData. */
export async function saveServerAddress(userDataPath: string, apiUrl: string): Promise<void> {
  const normalized = validateServerBaseUrl(apiUrl).origin
  await mkdir(userDataPath, { recursive: true })
  const destination = join(userDataPath, 'server-connection.json')
  const temporary = join(userDataPath, `.server-connection-${randomUUID()}.tmp`)
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(temporary, 'wx', 0o600)
    await handle.writeFile(`${JSON.stringify({ version: 1, apiUrl: normalized }, null, 2)}\n`, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporary, destination)
  } catch (error) {
    await handle?.close().catch(() => undefined)
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

/** Checks a new origin without credentials, revokes the old session, then commits and activates it. */
export async function switchRemoteServer(userDataPath: string, value: string, http: HttpClient, session: RemoteAuthSession, onConfigured: (url: URL) => void): Promise<{ ok: true; apiUrl: string; message?: string } | { ok: false; message: string }> {
  const checked = await checkServerAddress(value)
  if (!checked.ok) return { ok: false, message: checked.message }
  const nextUrl = validateServerBaseUrl(checked.apiUrl)
  await session.beginServerChange()
  try {
    const logoutResult = await session.logout()
    try { await saveServerAddress(userDataPath, nextUrl.origin) }
    catch {
      const message = 'Не вдалося зберегти адресу. Сесію завершено; попередня адреса залишилася без змін.'
      session.setNotice(message)
      return { ok: false, message }
    }
    http.setBaseUrl(nextUrl)
    onConfigured(nextUrl)
    const logoutWarning = !logoutResult.ok ? 'Адресу змінено. Старий сервер був недоступний для відкликання сесії; увійдіть до нового сервера.' : undefined
    await session.serverChanged(logoutWarning)
    return {
      ok: true,
      apiUrl: nextUrl.origin,
      ...(logoutWarning ? { message: logoutWarning } : {}),
    }
  } finally {
    session.endServerChange()
  }
}
