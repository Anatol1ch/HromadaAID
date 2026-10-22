export class RestoreError extends Error {
  constructor(readonly code: string, readonly stage: string, message: string) { super(message); this.name = 'RestoreError' }
}

export function restoreError(stage: string, error: unknown): RestoreError {
  if (error instanceof RestoreError) return error
  const value = error as { code?: unknown; errcode?: unknown } | null
  const fileCode = typeof value?.code === 'string' && ['ENOENT', 'EACCES', 'EPERM', 'EBUSY', 'ENOSPC'].includes(value.code) ? value.code : undefined
  if (stage === 'load-plan' && fileCode === 'ENOENT') return new RestoreError('RESTORE_PLAN_MISSING', stage, 'План не знайдено у вказаному --backup-dir. Використайте каталог, у якому сервер підготував і підтвердив цю копію; не переміщуйте службові файли.')
  if (stage === 'load-marker' && fileCode === 'ENOENT') return new RestoreError('RESTORE_CONFIRMATION_MISSING', stage, 'Для вказаної --database немає підтвердження відновлення. Перевірте шлях до серверної SQLite.')
  if (stage === 'ownership' && !fileCode && typeof value?.errcode !== 'number') return new RestoreError('RESTORE_DATABASE_BUSY', stage, 'SQLite використовується іншим серверним процесом. Зупиніть Fastify й інші серверні інструменти перед відновленням.')
  const codes: Record<string, string> = { ENOENT: 'Не знайдено необхідний файл. Перевірте серверні шляхи; не видаляйте журнал.', EACCES: 'Недостатньо прав доступу до серверних файлів.', EPERM: 'Операцію з файлом заборонено. Перевірте права доступу та відкриті файлові дескриптори.', EBUSY: 'Файл зайнятий іншим процесом.', ENOSPC: 'Недостатньо вільного місця на диску.' }
  if (fileCode) return new RestoreError(`RESTORE_${fileCode}`, stage, codes[fileCode])
  if (typeof value?.errcode === 'number') return new RestoreError(`RESTORE_SQLITE_${value.errcode & 255}`, stage, 'SQLite відхилила операцію. Перевірте цілісність копії та відсутність іншого процесу, що використовує базу.')
  return new RestoreError('RESTORE_STAGE_FAILED', stage, 'Перевірка або операція на цьому етапі не завершена. Збережіть службові файли для діагностики; роботу сервера не відновлюйте до завершення процедури.')
}

export function formatRestoreError(error: unknown): string {
  const safe = restoreError('cli', error)
  return `[${safe.code}] Етап: ${safe.stage}. ${safe.message}`
}
