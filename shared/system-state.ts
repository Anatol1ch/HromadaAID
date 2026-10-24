import { HROMADAAID_API_CONTRACT_VERSION } from './api-compatibility.js'

export const RESTORE_MAINTENANCE_CODE = 'RESTORE_MAINTENANCE'

export type ConnectionStatus = 'unknown' | 'checking' | 'available' | 'unavailable' | 'maintenance'
export type ConnectionFailureReason = 'network' | 'timeout' | 'http' | 'incompatible' | 'maintenance'

export function isMaintenanceResponse(status: number, body: unknown): boolean {
  if (status !== 503 || !body || typeof body !== 'object') return false
  const value = body as Record<string, unknown>
  return value.code === RESTORE_MAINTENANCE_CODE ||
    (typeof value.message === 'string' && value.message.startsWith('Сервер у режимі відновлення.'))
}

/** An HTTP response proves reachability; the explicit restore code distinguishes maintenance. */
export function classifyHttpReachability(status: number, body: unknown): Exclude<ConnectionStatus, 'unknown' | 'checking'> {
  return isMaintenanceResponse(status, body) ? 'maintenance' : 'available'
}

export function classifyHealthResponse(status: number, body: unknown): 'available' | 'unavailable' | 'maintenance' {
  if (isMaintenanceResponse(status, body)) return 'maintenance'
  if (status !== 200 || !body || typeof body !== 'object') return 'unavailable'
  const value = body as Record<string, unknown>
  const contractVersion = Object.hasOwn(value, 'apiContractVersion') ? value.apiContractVersion : HROMADAAID_API_CONTRACT_VERSION
  return value.status === 'ok' && value.service === 'hromada-aid-api' && contractVersion === HROMADAAID_API_CONTRACT_VERSION ? 'available' : 'unavailable'
}

export function classifyHealthFailure(status: number, body: unknown): Exclude<ConnectionFailureReason, 'network' | 'timeout'> {
  if (isMaintenanceResponse(status, body)) return 'maintenance'
  if (status !== 200) return 'http'
  return classifyHealthResponse(status, body) === 'available' ? 'http' : 'incompatible'
}

/** Coalesces user-triggered and scheduled checks into one in-flight probe. */
export class SingleFlightProbe<T> {
  private current: Promise<T> | undefined

  run(probe: () => Promise<T>): Promise<T> {
    if (this.current) return this.current
    const operation = Promise.resolve().then(probe)
    this.current = operation
    void operation.finally(() => { if (this.current === operation) this.current = undefined }).catch(() => undefined)
    return operation
  }
}

export function reconnectDelay(attempt: number): number {
  return [2_000, 5_000, 10_000, 20_000, 30_000][Math.min(Math.max(0, attempt), 4)]
}
