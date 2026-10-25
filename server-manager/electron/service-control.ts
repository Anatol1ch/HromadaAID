import type { ApiStatus, InspectionSnapshot, ServiceStatus } from './inspection-types.js'

export type ServiceControlOperation = 'start' | 'stop' | 'restart'
export type ServiceControlResult = {
  operationId: string
  operation: ServiceControlOperation
  success: boolean
  errorCode: string | null
  message: string
  inspection: InspectionSnapshot
}

export type ServiceControlActionResult = {
  success: boolean
  errorCode: string | null
  message: string
}

export type ServiceControlAdapters = {
  platform: string
  control(operation: ServiceControlOperation): Promise<ServiceControlActionResult>
  inspect(): Promise<InspectionSnapshot>
  failedInspection(): InspectionSnapshot
}

export function isServiceControlOperation(value: unknown): value is ServiceControlOperation {
  return value === 'start' || value === 'stop' || value === 'restart'
}

export async function runServiceControl(
  operation: ServiceControlOperation,
  operationId: string,
  adapters: ServiceControlAdapters,
): Promise<ServiceControlResult> {
  let action: ServiceControlActionResult
  if (adapters.platform !== 'win32') {
    action = { success: false, errorCode: 'WINDOWS_REQUIRED', message: 'Керування Windows Service доступне лише у Windows.' }
  } else {
    try { action = await adapters.control(operation) }
    catch { action = { success: false, errorCode: 'SERVICE_CONTROL_FAILED', message: 'Не вдалося передати дію диспетчеру служб Windows.' } }
  }

  let inspection: InspectionSnapshot
  try { inspection = await adapters.inspect() }
  catch { inspection = adapters.failedInspection() }

  if (!action.success) return { operationId, operation, success: false, errorCode: action.errorCode, message: action.message, inspection }

  const expected: ServiceStatus = operation === 'stop' ? 'stopped' : 'running'
  if (inspection.service.status !== expected) {
    return { operationId, operation, success: false, errorCode: inspection.service.status === 'missing' ? 'SERVICE_NOT_INSTALLED' : 'SERVICE_STATE_NOT_CONFIRMED', message: inspection.service.status === 'missing' ? 'Службу HromadaAIDApi не встановлено.' : 'Windows не підтвердив очікуваний стан служби. Перевірте діагностику та повторіть перевірку.', inspection }
  }
  if (expected === 'running' && inspection.api.status !== 'available') {
    return { operationId, operation, success: false, errorCode: 'API_UNAVAILABLE', message: 'Служба запущена, але API не пройшов health-check. Перегляньте діагностику сервера.', inspection }
  }

  const apiNote: Record<ApiStatus, string> = {
    available: ' API доступний.',
    unavailable: ' API зараз недоступний.',
    invalid_response: ' API повернув некоректну відповідь.',
    not_configured: ' Адресу API не визначено.',
    unknown: ' Стан API не вдалося визначити.',
  }
  const message = operation === 'stop'
    ? 'Сервер зупинено штатно.'
    : operation === 'restart'
      ? `Сервер перезапущено.${apiNote[inspection.api.status]}`
      : `Сервер запущено.${apiNote[inspection.api.status]}`
  return { operationId, operation, success: true, errorCode: null, message, inspection }
}

export type ServiceControlHandlerResult = ServiceControlResult | {
  operationId: string
  operation: ServiceControlOperation | null
  success: false
  errorCode: string
  message: string
  inspection: InspectionSnapshot
}

/** Serializes service actions and rejects untrusted renderer requests. */
export function createServiceControlRequestHandler<TEvent>(
  run: (operation: ServiceControlOperation, operationId: string) => Promise<ServiceControlResult>,
  isTrusted: (event: TEvent) => boolean,
  isBlocked: () => boolean,
  createOperationId: () => string,
  getInspection: () => InspectionSnapshot,
): (event: TEvent, value: unknown) => Promise<ServiceControlHandlerResult> {
  let inFlight = false
  return async (event, value) => {
    if (!isTrusted(event)) throw new Error('UNTRUSTED_RENDERER')
    if (!isServiceControlOperation(value)) return { operationId: createOperationId(), operation: null, success: false, errorCode: 'SERVICE_OPERATION_INVALID', message: 'Оберіть коректну дію для Windows Service.', inspection: getInspection() }
    if (inFlight || isBlocked()) return { operationId: createOperationId(), operation: value, success: false, errorCode: 'SERVICE_OPERATION_BUSY', message: 'Зараз виконується інша системна операція. Дочекайтеся її завершення.', inspection: getInspection() }
    inFlight = true
    try { return await run(value, createOperationId()) }
    catch { return { operationId: createOperationId(), operation: value, success: false, errorCode: 'SERVICE_CONTROL_FAILED', message: 'Не вдалося завершити дію Windows Service. Перевірте діагностику.', inspection: getInspection() } }
    finally { inFlight = false }
  }
}
