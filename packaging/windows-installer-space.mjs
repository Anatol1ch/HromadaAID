import { win32 } from 'node:path'

export const installerSpaceBudgets = Object.freeze({
  dataBytes: 16 * 1024 * 1024,
  backupBytes: 16 * 1024 * 1024,
  temporaryOverheadBytes: 8 * 1024 * 1024,
  payloadReserveRatio: 0.15,
})

export function computeInstallerVolumeRequirements({ mode, programDirectory, dataDirectory, backupDirectory, temporaryDirectory, clientBytes, serverBytes, managerBytes = 0, supportBytes }) {
  if (!['client', 'server', 'server-client', 'manager'].includes(mode)) throw new Error('Невідомий режим інсталяції.')
  for (const value of [clientBytes, serverBytes, managerBytes, supportBytes]) if (!Number.isSafeInteger(value) || value < 0) throw new Error('Розмір пакета має бути невід’ємним цілим числом.')
  const volumes = new Map()
  const add = (path, bytes) => {
    const root = win32.parse(win32.resolve(path)).root.toLocaleUpperCase('en-US')
    volumes.set(root, (volumes.get(root) ?? 0) + bytes)
  }
  const includesClient = mode === 'client' || mode === 'server-client'
  const includesServer = mode === 'server' || mode === 'server-client'
  const programPayload = mode === 'manager' ? managerBytes : (includesClient ? clientBytes : 0) + (includesServer ? serverBytes + managerBytes : 0)
  add(programDirectory, programPayload + Math.ceil(programPayload * installerSpaceBudgets.payloadReserveRatio))
  if (includesServer) {
    add(dataDirectory, installerSpaceBudgets.dataBytes)
    add(backupDirectory, installerSpaceBudgets.backupBytes)
  }
  add(temporaryDirectory, supportBytes + installerSpaceBudgets.temporaryOverheadBytes)
  return volumes
}

export function formatBytes(bytes) {
  const units = ['Б', 'КіБ', 'МіБ', 'ГіБ', 'ТіБ']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++ }
  return `${value.toLocaleString('uk-UA', { maximumFractionDigits: 1 })} ${units[unit]}`
}
