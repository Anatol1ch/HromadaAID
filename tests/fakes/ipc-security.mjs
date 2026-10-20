// Test-only registration adapter. No Electron process or working profile is opened.
export const handlers = new Map()
export const trustedIpcMain = { handle(channel, handler) { handlers.set(channel, handler) } }
