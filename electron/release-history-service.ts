import { randomUUID } from 'node:crypto'
import { readFile, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fetchStableReleaseNotes } from '../shared/release-updates.mjs'
import { mergeReleaseHistory } from '../shared/release-history.mjs'
import type { ReleaseHistoryEntry, ReleaseHistorySnapshot } from '../shared/api-contract.js'

type CachedHistory = { formatVersion: 1; refreshedAt: string; entries: ReleaseHistoryEntry[] }

async function readJson(path: string): Promise<unknown> {
  try { return JSON.parse(await readFile(path, 'utf8')) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; return null }
}

export function createReleaseHistoryService(options: {
  repository: string
  embeddedHistoryPath: string
  cachePath: string
  fetchImpl?: typeof fetch
  now?: () => Date
}) {
  let localSnapshot: ReleaseHistorySnapshot | undefined
  let refreshPromise: Promise<ReleaseHistorySnapshot> | undefined
  let embeddedEntries: ReleaseHistoryEntry[] = []
  let cachedEntries: ReleaseHistoryEntry[] = []

  const getLocal = async (): Promise<ReleaseHistorySnapshot> => {
    if (localSnapshot) return { ...localSnapshot, entries: [...localSnapshot.entries] }
    const [embeddedRaw, cacheRaw] = await Promise.all([
      readJson(options.embeddedHistoryPath),
      readJson(options.cachePath),
    ])
    embeddedEntries = embeddedRaw && typeof embeddedRaw === 'object' && Array.isArray((embeddedRaw as { entries?: unknown }).entries)
      ? (embeddedRaw as { entries: ReleaseHistoryEntry[] }).entries : []
    const cache = cacheRaw && typeof cacheRaw === 'object' && (cacheRaw as CachedHistory).formatVersion === 1
      ? cacheRaw as CachedHistory : null
    cachedEntries = cache && Array.isArray(cache.entries) ? cache.entries : []
    const entries = mergeReleaseHistory({ embedded: embeddedEntries, cached: cachedEntries })
    const refreshedAt = cache && typeof cache.refreshedAt === 'string' && Number.isFinite(Date.parse(cache.refreshedAt)) ? cache.refreshedAt : undefined
    localSnapshot = { entries, source: cachedEntries.length ? 'cache' : entries.length ? 'embedded' : 'empty', ...(refreshedAt ? { refreshedAt } : {}) }
    return { ...localSnapshot, entries: [...entries] }
  }

  const refresh = (): Promise<ReleaseHistorySnapshot> => {
    if (refreshPromise) return refreshPromise
    refreshPromise = (async () => {
      const local = await getLocal()
      try {
        const remote = await fetchStableReleaseNotes({ repository: options.repository, fetchImpl: options.fetchImpl }) as ReleaseHistoryEntry[]
        const refreshedAt = (options.now?.() ?? new Date()).toISOString()
        const entries = mergeReleaseHistory({ embedded: embeddedEntries, cached: cachedEntries, remote })
        const result: ReleaseHistorySnapshot = { entries, source: 'github', refreshedAt }
        const temporary = `${options.cachePath}.${randomUUID()}.tmp`
        try {
          await mkdir(dirname(options.cachePath), { recursive: true })
          await writeFile(temporary, `${JSON.stringify({ formatVersion: 1, refreshedAt, entries }, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
          await rename(temporary, options.cachePath)
          cachedEntries = entries
          localSnapshot = result
        } catch {
          await rm(temporary, { force: true }).catch(() => {})
          // A successful GitHub response remains usable even when local storage is read-only.
          cachedEntries = entries
          localSnapshot = result
        }
        return { ...result, entries: [...entries] }
      } catch (error) {
        const result: ReleaseHistorySnapshot = {
          ...local,
          refreshError: error instanceof Error ? error.message.slice(0, 300) : 'Не вдалося оновити історію релізів.',
        }
        return result
      }
    })().finally(() => { refreshPromise = undefined })
    return refreshPromise
  }

  return { getLocal, refresh }
}
