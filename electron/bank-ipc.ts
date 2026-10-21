import type { DatabaseSync } from 'node:sqlite'
import { trustedIpcMain as ipcMain } from './ipc-security.js'
import { bankDetails, getBank, listBanks, removeBank, saveBank } from './bank-store.js'

export function registerBankIpc(database: DatabaseSync) {
  ipcMain.handle('banks:list', (_event, query: unknown) => {
    if (query !== undefined && typeof query !== 'string') throw new Error('Некоректний пошуковий запит.')
    return listBanks(database, query as string | undefined)
  })
  ipcMain.handle('banks:get', (_event, id: unknown) => typeof id === 'string' && id ? getBank(database, id) : null)
  ipcMain.handle('banks:details', (_event, id: unknown) => typeof id === 'string' && id ? bankDetails(database, id) : [])
  ipcMain.handle('banks:save', (_event, input: unknown, id: unknown, expectedUpdatedAt: unknown) => saveBank(database, input, id, expectedUpdatedAt))
  ipcMain.handle('banks:remove', (_event, id: unknown) => typeof id === 'string' && id ? removeBank(database, id) : { ok: false, message: 'Оберіть банк для видалення.' })
}
