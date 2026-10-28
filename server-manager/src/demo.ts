import type { InstallationOperation } from '../../shared/installation-contract'

export const sections = [
  { id: 'overview', label: 'Огляд' },
  { id: 'configuration', label: 'Конфігурація' },
  { id: 'diagnostics', label: 'Діагностика' },
  { id: 'backups', label: 'Резервне копіювання' },
  { id: 'updates', label: 'Оновлення' },
] as const
export type Section = typeof sections[number]['id']
type Tone = 'success' | 'warning' | 'error' | 'info'
type Scenario = { label: string; title: string; message: string; service: string; api: string; tone: Tone; installed: boolean; operation: InstallationOperation }
const operation: InstallationOperation = { operationId: 'demo-inspect-001', type: 'inspect', stage: 'complete', status: 'succeeded', errorCode: null, message: 'Демонстраційна перевірка завершена. Системні ресурси не опитувались.', requiresElevation: false, retry: { allowed: true, reason: 'Можна повторно показати демонстраційний результат.' } }
export const scenarios = {
  missing: { label: 'Сервер не встановлено', title: 'Почнімо з налаштування сервера', message: 'Майбутній майстер перевірить систему та допоможе встановити сервер. У цій версії доступний лише перегляд інтерфейсу.', service: 'Не встановлена', api: 'Не налаштований', tone: 'info', installed: false, operation },
  stopped: { label: 'Службу зупинено', title: 'Сервер зупинений', message: 'Демонстраційні серверні компоненти встановлено, але служба не працює.', service: 'Зупинена', api: 'Недоступний', tone: 'warning', installed: true, operation },
  running: { label: 'Служба працює · API доступний', title: 'Сервер працює', message: 'Служба й API доступні в цьому демонстраційному сценарії.', service: 'Працює', api: 'Доступний', tone: 'success', installed: true, operation },
  unavailable: { label: 'Служба працює · API недоступний', title: 'API не відповідає', message: 'Стан служби не гарантує доступності API. Перегляньте демонстраційну діагностику.', service: 'Працює', api: 'Недоступний', tone: 'error', installed: true, operation: { ...operation, status: 'failed', stage: 'health', errorCode: 'DEMO_API_UNAVAILABLE', message: 'Демонстраційна перевірка API завершилась помилкою.' } },
  interrupted: { label: 'Встановлення перервано', title: 'Встановлення потребує уваги', message: 'У прикладі підготовку завершено, а перевірку служби ще не виконано. Продовження операції буде доступне після підключення Installation Engine.', service: 'Не перевірена', api: 'Не перевірений', tone: 'warning', installed: false, operation: { ...operation, type: 'install', stage: 'service', status: 'failed', errorCode: 'DEMO_INSTALL_INTERRUPTED', message: 'Демонстраційна операція перервана перед перевіркою служби.', requiresElevation: true, retry: { allowed: false, reason: 'Спочатку потрібно перевірити стан часткової інсталяції.' } } },
  configuration: { label: 'Помилка конфігурації', title: 'Перевірте параметри сервера', message: 'У прикладі шлях до SQLite не є абсолютним. Запуск заблоковано до виправлення конфігурації.', service: 'Зупинена', api: 'Недоступний', tone: 'error', installed: true, operation: { ...operation, stage: 'configuration', status: 'failed', errorCode: 'DEMO_CONFIG_INVALID', message: 'Потрібен коректний абсолютний шлях до SQLite.', retry: { allowed: false, reason: 'Спочатку потрібно виправити шлях до серверних даних.' } } },
} satisfies Record<string, Scenario>
export type ScenarioId = keyof typeof scenarios
export const scenarioIds = Object.keys(scenarios) as ScenarioId[]
export const demoPaths = { program: 'D:\\HromadaAID', data: 'D:\\HromadaAID-Data', backups: 'E:\\HromadaAID-Backups' }
export const DEMO_CHECKED_AT = '24.10.2026, 10:30:00'
