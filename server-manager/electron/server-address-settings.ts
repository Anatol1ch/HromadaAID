import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'

import type { ServerAddressKey, ServerAddresses, AddressResult, AddressCopyResult } from './server-address-contract.js'
const defaults = (): ServerAddresses => ({ version: 1, loopback: 'http://127.0.0.1:4310', lan: null, tailscale: null })
export const isAddressKey = (key: unknown): key is ServerAddressKey => key === 'loopback' || key === 'lan' || key === 'tailscale'
// This runtime asset is copied into the isolated Manager main output for both dev and deployment.
const validator = () => import(new URL('./shared/server-base-url.mjs', import.meta.url).href) as Promise<typeof import('../../shared/server-base-url.mjs')>
class AddressValidationError extends Error {}

export async function normalizeAddress(key: ServerAddressKey, value: unknown): Promise<string | null> {
  if (!isAddressKey(key) || typeof value !== 'string') throw new AddressValidationError('Перевірте назву підключення та адресу.')
  if (!value.trim() && key !== 'loopback') return null
  const shared = await validator()
  let url: URL
  try { url = shared.validateServerBaseUrl(value) }
  catch (error) {
    if (!(error instanceof shared.ElectronRuntimeConfigError)) throw error
    throw new AddressValidationError(error.message.replace(' Укажіть нову адресу й перевірте підключення перед збереженням.', ''))
  }
  if (key === 'loopback' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') throw new AddressValidationError('Для Loopback дозволено лише http://127.0.0.1:4310 або http://localhost:4310.')
  return url.origin
}

type FileOperations = Pick<typeof import('node:fs/promises'), 'mkdir' | 'open' | 'readFile' | 'rename' | 'rm'>
export function createServerAddressSettings(userData: string, fs: FileOperations = { mkdir, open, readFile, rename, rm }) {
  const path = join(userData, 'server-addresses.json')
  let chain: Promise<unknown> = Promise.resolve()
  const read = async (): Promise<AddressResult> => {
    let raw: string
    try { raw = await fs.readFile(path, 'utf8') }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true, addresses: defaults() }
      return { ok: false, storageError: true, message: 'Сховище адрес недоступне. Перевірте доступ до налаштувань Server Manager.' }
    }
    let value: unknown
    try { value = JSON.parse(raw) }
    catch { return { ok: false, storageError: true, message: 'Файл адрес пошкоджений. Редагування заблоковано; наявні дані збережено.' } }
    if (value && typeof value === 'object' && !Array.isArray(value) && 'version' in value && value.version !== 1) return { ok: false, storageError: true, message: 'Версія налаштувань адрес не підтримується. Редагування заблоковано.' }
    try {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
      const record = value as Record<string, unknown>
      if (Object.keys(record).sort().join(',') !== 'lan,loopback,tailscale,version' || record.version !== 1 || typeof record.loopback !== 'string') throw new Error()
      const addresses = defaults()
      addresses.loopback = (await normalizeAddress('loopback', record.loopback))!
      for (const key of ['lan', 'tailscale'] as const) {
        if (record[key] !== null && (typeof record[key] !== 'string' || !record[key].trim())) throw new Error()
        addresses[key] = record[key] === null ? null : await normalizeAddress(key, record[key])
      }
      return { ok: true, addresses }
    } catch { return { ok: false, storageError: true, message: 'Структура або адреси в налаштуваннях некоректні. Редагування заблоковано; файл не змінено.' } }
  }
  const save = (key: unknown, value: unknown): Promise<AddressResult> => {
    const task = chain.then(async (): Promise<AddressResult> => {
      if (!isAddressKey(key) || typeof value !== 'string') return { ok: false, storageError: false, message: 'Некоректні параметри адреси.' }
      let normalized: string | null
      try { normalized = await normalizeAddress(key, value) }
      catch (error) { return { ok: false, storageError: false, message: error instanceof AddressValidationError ? error.message : 'Не вдалося перевірити адресу. Повторіть спробу.' } }
      const current = await read()
      if (!current.ok) return current
      const addresses = { ...current.addresses, [key]: normalized } as ServerAddresses
      const temporary = join(userData, `.server-addresses-${randomUUID()}.tmp`)
      let handle: Awaited<ReturnType<typeof open>> | undefined
      let created = false
      try {
        await fs.mkdir(userData, { recursive: true })
        handle = await fs.open(temporary, 'wx', 0o600)
        created = true
        await handle.writeFile(JSON.stringify(addresses, null, 2) + '\n', 'utf8')
        await handle.sync()
        await handle.close(); handle = undefined
        await fs.rename(temporary, path)
        return { ok: true, addresses }
      } catch {
        await handle?.close().catch(() => undefined)
        if (created) await fs.rm(temporary, { force: true }).catch(() => undefined)
        return { ok: false, storageError: false, message: 'Не вдалося зберегти адресу. Попередні налаштування залишилися без змін.' }
      }
    })
    chain = task.catch(() => undefined)
    return task
  }
  return { read, save }
}

export function createAddressHandlers<TEvent>(trusted: (event: TEvent) => boolean, settings: ReturnType<typeof createServerAddressSettings>, copy: (text: string) => void) {
  const assertTrusted = (event: TEvent) => { if (!trusted(event)) throw new Error('UNTRUSTED_RENDERER') }
  return {
    read: (event: TEvent) => { assertTrusted(event); return settings.read() },
    save: (event: TEvent, key: unknown, value: unknown) => { assertTrusted(event); return settings.save(key, value) },
    copy: async (event: TEvent, key: unknown): Promise<AddressCopyResult> => {
      assertTrusted(event)
      if (!isAddressKey(key)) return { ok: false, message: 'Некоректне підключення.' }
      const result = await settings.read()
      if (!result.ok) return result
      const value = result.addresses[key]
      if (!value) return { ok: false, message: 'Адресу не задано.' }
      try { copy(value); return { ok: true } }
      catch { return { ok: false, message: 'Не вдалося скопіювати адресу.' } }
    },
  }
}
