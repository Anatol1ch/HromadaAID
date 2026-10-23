// Test-only compatibility harness for server business-rule fixtures; never shipped to Electron.
import type { DatabaseSync } from 'node:sqlite'
import { trustedIpcMain as ipcMain } from './ipc-security.mjs'
import { getRecipient, listRecipients } from '../../electron/recipient-data.js'
import { saveRecipient } from '../../electron/recipient-store.js'

export { saveRecipient } from '../../electron/recipient-store.js'

export function registerRecipientFixture(database: DatabaseSync) {
  ipcMain.handle('recipients:list', (_event, _includeArchived: unknown) => listRecipients(database))
  ipcMain.handle('recipients:get', (_event, id: unknown) => typeof id === 'string' && id ? getRecipient(database, id) : null)
  ipcMain.handle('recipients:save', (_event, value: unknown, idValue?: unknown, confirmSameName?: unknown, expectedUpdatedAt?: unknown) =>
    saveRecipient(database, value, idValue, confirmSameName, expectedUpdatedAt))
}
