import type { DatabaseSync } from 'node:sqlite'
import { trustedIpcMain as ipcMain } from './ipc-security.js'
import { executeDeletion, isDeleteEntity, previewDeletion } from './deletion-service.js'

export function registerDeletionIpc(database: DatabaseSync) {
  ipcMain.handle('deletion:preview', (_event, entityValue: unknown, idValue: unknown) =>
    isDeleteEntity(entityValue) && typeof idValue === 'string' && idValue ? previewDeletion(database, entityValue, idValue) : null)
  ipcMain.handle('deletion:execute', (_event, entityValue: unknown, idValue: unknown, confirmationToken?: unknown) =>
    isDeleteEntity(entityValue) && typeof idValue === 'string' && idValue ? executeDeletion(database, entityValue, idValue, confirmationToken) : { ok: false, message: 'Запис не знайдено.' })
}
