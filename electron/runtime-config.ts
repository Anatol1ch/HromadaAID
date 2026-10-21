export type ElectronMode = 'local' | 'remote'

export type ElectronRuntimeConfig =
  | { mode: 'local' }
  | { mode: 'remote'; apiUrl: URL }

export class ElectronRuntimeConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ElectronRuntimeConfigError'
  }
}

export function readElectronRuntimeConfig(environment = process.env): ElectronRuntimeConfig {
  const configuredMode = environment.HROMADAAID_MODE?.trim() || 'local'
  if (configuredMode !== 'local' && configuredMode !== 'remote') {
    throw new ElectronRuntimeConfigError('Змінна HROMADAAID_MODE має значення local або remote.')
  }
  if (configuredMode === 'local') return { mode: 'local' }

  const configuredApiUrl = environment.HROMADAAID_API_URL?.trim()
  if (!configuredApiUrl) {
    throw new ElectronRuntimeConfigError('Для режиму remote задайте HROMADAAID_API_URL, наприклад http://127.0.0.1:4310.')
  }

  let apiUrl: URL
  try { apiUrl = new URL(configuredApiUrl) }
  catch { throw new ElectronRuntimeConfigError('HROMADAAID_API_URL має бути коректною адресою HTTP API.') }
  if ((apiUrl.protocol !== 'http:' && apiUrl.protocol !== 'https:') || !apiUrl.hostname || apiUrl.username || apiUrl.password || apiUrl.search || apiUrl.hash || (apiUrl.pathname !== '/' && apiUrl.pathname !== '')) {
    throw new ElectronRuntimeConfigError('HROMADAAID_API_URL має містити лише базову адресу HTTP або HTTPS API без облікових даних, параметрів і шляху.')
  }

  return { mode: 'remote', apiUrl }
}
