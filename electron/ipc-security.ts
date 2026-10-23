import { ipcMain, type BrowserWindow, type IpcMain } from 'electron'
import { HttpClientError } from './http-client.js'

let getMainWindow: () => BrowserWindow | null = () => null
let expectedPageUrl = ''

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
    ipcMain.handle(channel, async (event, ...args) => {
      const window = getMainWindow()
      if (!window || window.isDestroyed() || window.webContents.isDestroyed() ||
        event.sender !== window.webContents || !event.senderFrame ||
        event.senderFrame !== window.webContents.mainFrame ||
        !isTrustedAppUrl(event.senderFrame.url)) {
        throw new Error('Виклик недоступний із цього вікна застосунку.')
      }
      try { return await listener(event, ...args) }
      catch (error) {
        // Expected session expiry/cancellation is delivered as a normal IPC
        // envelope. Preload still rejects the operation for its caller.
        if (error instanceof HttpClientError && error.status === 401) {
          return { __hromadaAuthError: true, message: error.message }
        }
        throw error
      }
    })
  },
}
