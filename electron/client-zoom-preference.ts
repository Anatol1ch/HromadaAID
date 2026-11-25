import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isValidClientZoomFactor, MAX_CLIENT_ZOOM_FACTOR, MIN_CLIENT_ZOOM_FACTOR } from '../shared/client-zoom.js'

export { CLIENT_ZOOM_PRESETS, MAX_CLIENT_ZOOM_FACTOR, MIN_CLIENT_ZOOM_FACTOR, isValidClientZoomFactor } from '../shared/client-zoom.js'
const preferenceFile = 'client-zoom.json'

export function clampClientZoomLevel(level: number): number {
  const safeLevel = Number.isFinite(level) ? level : 0
  return Math.max(Math.log(MIN_CLIENT_ZOOM_FACTOR) / Math.log(1.2), Math.min(Math.log(MAX_CLIENT_ZOOM_FACTOR) / Math.log(1.2), safeLevel))
}

export type ClientZoomAction = 'decrease' | 'increase' | 'reset'
export function applyClientZoomAction(contents: { getZoomLevel: () => number; setZoomLevel: (level: number) => void; getZoomFactor: () => number }, action: ClientZoomAction): number {
  if (action === 'increase') contents.setZoomLevel(clampClientZoomLevel(contents.getZoomLevel() + 0.5))
  else if (action === 'decrease') contents.setZoomLevel(clampClientZoomLevel(contents.getZoomLevel() - 0.5))
  else if (action === 'reset') contents.setZoomLevel(0)
  else throw new Error('Недопустима дія зміни масштабу.')
  const factor = contents.getZoomFactor()
  if (!isValidClientZoomFactor(factor)) throw new Error('Electron не застосував допустимий масштаб.')
  return factor
}

export async function setClientWindowZoomFactor(window: { webContents: { setZoomFactor: (factor: number) => void; getZoomFactor: () => number } }, value: unknown, persist: (factor: number) => Promise<void>): Promise<number> {
  if (!isValidClientZoomFactor(value)) throw new Error('Недопустиме значення масштабу.')
  window.webContents.setZoomFactor(value)
  const applied = window.webContents.getZoomFactor()
  if (!isValidClientZoomFactor(applied)) throw new Error('Electron не застосував допустимий масштаб.')
  await persist(applied)
  return applied
}

export async function readClientZoomPreference(userDataPath: string): Promise<number> {
  try {
    const value: unknown = JSON.parse(await readFile(join(userDataPath, preferenceFile), 'utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) return 1
    const factor = (value as Record<string, unknown>).factor
    return isValidClientZoomFactor(factor) ? factor : 1
  } catch { return 1 }
}

export async function writeClientZoomPreference(userDataPath: string, factor: unknown): Promise<void> {
  if (!isValidClientZoomFactor(factor)) throw new Error('Недопустиме значення масштабу.')
  await mkdir(userDataPath, { recursive: true })
  const destination = join(userDataPath, preferenceFile)
  const temporary = join(userDataPath, `.client-zoom-${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, `${JSON.stringify({ version: 1, factor })}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await rename(temporary, destination)
  } finally { await rm(temporary, { force: true }).catch(() => undefined) }
}
