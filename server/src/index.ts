import { readServerConfig } from './config.js'
import { startServer } from './server-runtime.js'

// This entry point remains explicitly development/test only.
void startServer(readServerConfig(), false).catch(error => {
  console.error(`API не запущено: ${error instanceof Error ? error.message : 'невідома помилка запуску'}`)
  process.exitCode = 1
})
