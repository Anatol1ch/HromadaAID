export type ShutdownLogger = {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

export type ShutdownStep = {
  name: string
  close(): void | Promise<void>
}

export type ShutdownOptions = {
  timeoutMs?: number
  onCleanupFailure?: () => void
}

/** Runs shutdown steps once, in order, and never closes later resources ahead of a stuck earlier step. */
export function createGracefulShutdown(
  steps: ShutdownStep[],
  logger: ShutdownLogger,
  options: ShutdownOptions = {},
): (signal: string) => Promise<void> {
  const timeoutMs = options.timeoutMs ?? 45_000
  let shutdown: Promise<void> | undefined
  let phase = 'ініціалізація'
  let timeout: NodeJS.Timeout | undefined

  return (signal) => {
    if (shutdown) {
      logger.warn(`Отримано повторний сигнал ${signal}; очікуємо поточне завершення.`)
      return shutdown
    }

    logger.info(`Отримано сигнал ${signal}; починаємо штатне завершення.`)
    timeout = setTimeout(() => {
      logger.error(`Завершення триває довше ${timeoutMs} мс на етапі «${phase}». Очікування продовжується; SQLite не закривається передчасно.`)
    }, timeoutMs)
    timeout.unref()

    shutdown = (async () => {
      let cleanupFailed = false
      try {
        for (const step of steps) {
          phase = step.name
          try {
            await step.close()
          } catch {
            cleanupFailed = true
            logger.error(`Не вдалося завершити ресурс «${step.name}».`)
          }
        }
        if (cleanupFailed) {
          options.onCleanupFailure?.()
          logger.error('HromadaAID API завершив роботу з помилкою під час закриття ресурсів.')
        } else {
          logger.info('HromadaAID API штатно завершив роботу.')
        }
      } finally {
        if (timeout) clearTimeout(timeout)
      }
    })()
    return shutdown
  }
}
