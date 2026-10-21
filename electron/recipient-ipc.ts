import type { DatabaseSync } from 'node:sqlite'
import { trustedIpcMain as ipcMain } from './ipc-security.js'
import { getRecipient, listRecipients } from './recipient-data.js'
import { saveRecipient } from './recipient-store.js'

export { saveRecipient } from './recipient-store.js'

export function registerRecipientIpc(database: DatabaseSync) {
  ipcMain.handle('recipients:list', (_event, _includeArchived: unknown) => listRecipients(database))
  ipcMain.handle('recipients:get', (_event, id: unknown) => typeof id === 'string' && id ? getRecipient(database, id) : null)
  ipcMain.handle('recipients:save', (_event, value: unknown, idValue?: unknown, confirmSameName?: unknown, expectedUpdatedAt?: unknown) =>
    saveRecipient(database, value, idValue, confirmSameName, expectedUpdatedAt))
}
