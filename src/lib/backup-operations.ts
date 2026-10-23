export type OperationLock = { current: boolean }

/** Synchronously claims a UI operation lock before asynchronous work begins. */
export function beginExclusiveOperation<T>(lock: OperationLock, operation: () => Promise<T>): { started: true; result: Promise<T> } | { started: false } {
  if (lock.current) return { started: false }
  lock.current = true
  return {
    started: true,
    result: (async () => {
      try { return await operation() }
      finally { lock.current = false }
    })(),
  }
}

export function safeBackupErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (/status:\s*401|потрібна чинна сесія/i.test(message)) return 'Сеанс завершився. Увійдіть повторно та спробуйте ще раз.'
  if (/status:\s*403|недостатньо прав/i.test(message)) return 'У вашого облікового запису немає дозволу на цю дію.'
  if (/status:\s*409|конфлікт|повторіть підтвердження/i.test(message)) return 'Дані резервування змінилися. Оновіть список і повторіть дію.'
  if (/підключ|мереж|час/i.test(message)) return 'Не вдалося зв’язатися із сервером. Перевірте підключення та повторіть спробу.'
  return 'Не вдалося виконати операцію резервного копіювання. Перевірте стан сервера та спробуйте ще раз.'
}

export const restorePendingNotice = {
  kind: 'warning' as const,
  title: 'Потрібно завершити відновлення на сервері',
  message: 'Fastify перейшов у режим технічного обслуговування. Зупиніть його та виконайте pnpm server:backup-restore у серверному терміналі. Не запускайте Fastify до завершення команди.',
}
