export class ElectronRuntimeConfigError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ElectronRuntimeConfigError'
  }
}

function parseServerBaseUrl(value) {
  if (typeof value !== 'string' || !value.trim()) throw new ElectronRuntimeConfigError('Укажіть адресу сервера.')
  if (/[\u0000-\u0020\u007f\\]/.test(value.trim())) throw new ElectronRuntimeConfigError('Введіть коректну адресу сервера без пробілів або керівних символів.')
  if (!/^https?:\/\/[^/?#@]+\/?$/i.test(value.trim())) throw new ElectronRuntimeConfigError('Вкажіть базову адресу сервера без шляху, облікових даних, параметрів чи фрагмента.')
  let url
  try { url = new URL(value.trim()) } catch { throw new ElectronRuntimeConfigError('Введіть коректну адресу сервера.') }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new ElectronRuntimeConfigError('Вкажіть базову адресу сервера без шляху, облікових даних, параметрів чи фрагмента.')
  }
  return new URL(url.origin)
}

export function validateServerBaseUrl(value) {
  const url = parseServerBaseUrl(value)
  if (url.protocol !== 'http:') throw new ElectronRuntimeConfigError('Внутрішній API використовує HTTP на порту 4310. Укажіть нову адресу й перевірте підключення перед збереженням.')
  if (url.port !== '4310') throw new ElectronRuntimeConfigError('Адреса сервера має використовувати фіксований порт 4310.')
  const host = url.hostname.replace(/\.$/, '')
  if (host === '0.0.0.0' || host.length > 253 || !host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) {
    throw new ElectronRuntimeConfigError('Укажіть IPv4-адресу або DNS-ім’я сервера; 0.0.0.0 та IPv6 не є адресами підключення до цього API.')
  }
  return url
}
