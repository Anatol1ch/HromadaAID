export type SafeConnectionDiagnostics = {
  clientVersion: string
  apiUrl: string | null
  apiAvailability: 'available' | 'unavailable' | 'maintenance' | 'checking' | 'unknown'
  compatibility: 'compatible' | 'incompatible' | 'unknown'
  clientContractVersion: number
  serverContractVersion?: number
  addressEditable: boolean | null
  addressLockReason?: string
  lastError?: string
  checkedAt?: string
}

const scrub = (value: string | undefined, redactPhone = true): string | undefined => {
  if (!value) return undefined
  const safe = value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 300)
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [приховано]')
    .replace(/(password|token|secret|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[приховано]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[електронну адресу приховано]')
    .replace(redactPhone ? /\+?\d(?:[\d\s().-]{7,}\d)/g : /$^/, '[номер телефону приховано]')
    .replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/gi, '$1[облікові дані приховано]@')
    .trim()
  return safe || undefined
}

export function sanitizeConnectionDiagnosticText(value: string | undefined): string | undefined {
  return scrub(value)
}

const statusLabels: Record<SafeConnectionDiagnostics['apiAvailability'], string> = {
  available: 'Доступний', unavailable: 'Недоступний', maintenance: 'Технічне обслуговування', checking: 'Перевіряється', unknown: 'Не визначено',
}

export function formatConnectionDiagnostics(input: SafeConnectionDiagnostics): string {
  const lines = [
    'Діагностика підключення HromadaAID',
    `Версія Client: ${scrub(input.clientVersion, false) ?? 'невідома'}`,
    `Адреса сервера: ${scrub(input.apiUrl ?? undefined, false) ?? 'не налаштована'}`,
    `Доступність API: ${statusLabels[input.apiAvailability]}`,
    `Сумісність: ${input.compatibility === 'compatible' ? 'сумісний' : input.compatibility === 'incompatible' ? 'несумісний' : 'не визначена'}`,
    `Контракт, потрібний Client: v${input.clientContractVersion}`,
    `Зміну адреси дозволено: ${input.addressEditable === null ? 'не визначено' : input.addressEditable ? 'так' : 'ні'}`,
  ]
  if (input.serverContractVersion !== undefined) lines.splice(5, 0, `Версія API-контракту сервера: v${input.serverContractVersion}`)
  const lockReason = sanitizeConnectionDiagnosticText(input.addressLockReason)
  const lastError = sanitizeConnectionDiagnosticText(input.lastError)
  if (lockReason) lines.push(`Причина обмеження адреси: ${lockReason}`)
  if (lastError) lines.push(`Остання відома помилка: ${lastError}`)
  if (input.checkedAt) lines.push(`Остання перевірка: ${scrub(input.checkedAt, false) ?? 'не визначена'}`)
  return lines.join('\n')
}
