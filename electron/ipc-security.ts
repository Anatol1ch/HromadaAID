import { ipcMain, type BrowserWindow, type IpcMain } from 'electron'

let getMainWindow: () => BrowserWindow | null = () => null
let expectedPageUrl = ''

const localIpcChannels = [
  'recipients:list', 'recipients:get', 'recipients:save', 'recipients:assignment-history',
  'banks:list', 'banks:get', 'banks:details', 'banks:save', 'banks:remove',
  'catalogs:list', 'catalogs:save', 'catalogs:reorder',
  'program-approvals:list', 'program-approvals:save',
  'decisions:list', 'decisions:get', 'decisions:save', 'decisions:add-assignments',
  'assignments:list', 'assignments:save', 'assignments:change-statuses',
  'dashboard:get',
  'reports:get', 'reports:summary', 'reports:annual-plan-list', 'reports:annual-plan-save',
  'reports:generate', 'reports:save-pdf', 'reports:save-excel', 'reports:release',
  'reports:plan-list', 'reports:plan-save', 'reports:plan-remove',
  'deletion:preview', 'deletion:execute',
  'statements:list', 'statements:generate', 'statements:generate-bank', 'statements:save', 'statements:save-pdf',
] as const

export function configureIpcSecurity(getWindow: () => BrowserWindow | null, pageUrl: string) {
  getMainWindow = getWindow
  expectedPageUrl = pageUrl
}

export function isTrustedAppUrl(value: string): boolean {
  if (!expectedPageUrl) return false
  try {
    const url = new URL(value)
    // In-page anchors do not change the trusted document. Paths, queries and
    // origins must still match the exact dev entry or production index file.
    url.hash = ''
    return url.href === expectedPageUrl
  } catch { return false }
}

export const trustedIpcMain = {
  handle(channel: string, listener: Parameters<IpcMain['handle']>[1]) {
    ipcMain.handle(channel, (event, ...args) => {
      const window = getMainWindow()
      if (!window || window.isDestroyed() || window.webContents.isDestroyed() ||
        event.sender !== window.webContents || !event.senderFrame ||
        event.senderFrame !== window.webContents.mainFrame ||
        !isTrustedAppUrl(event.senderFrame.url)) {
        throw new Error('Виклик недоступний із цього вікна застосунку.')
      }
      return listener(event, ...args)
    })
  },
}

/** Registers one shared safe failure path until a remote equivalent is available. */
export function registerRemoteIpcBlockers(unblockedChannels: readonly string[] = []) {
  const unblocked = new Set(unblockedChannels)
  for (const channel of localIpcChannels) {
    if (unblocked.has(channel)) continue
    trustedIpcMain.handle(channel, () => {
      throw new Error('Віддалений режим ще не підтримує цю операцію. Доступ до локальної бази даних заблоковано.')
    })
  }
}
