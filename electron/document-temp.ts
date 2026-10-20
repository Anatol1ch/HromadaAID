import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

const markerName = '.hromadaaid-owner.json'
const owner = 'HromadaAID-generated-documents-v1'
const jobName = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
let root = ''
let token = ''

function readMarker(directory: string): Record<string, unknown> {
  if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw new Error('Unsafe document directory')
  const path = join(directory, markerName)
  if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error('Unsafe document marker')
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

function ownedJob(directory: string) {
  if (!root || dirname(directory) !== root || !jobName.test(basename(directory))) throw new Error('Unowned document directory')
  const rootMarker = readMarker(root)
  const marker = readMarker(directory)
  if (rootMarker.owner !== owner || rootMarker.token !== token || marker.owner !== owner ||
    marker.token !== token || marker.id !== basename(directory)) throw new Error('Unowned document directory')
  return marker
}

function writeJobMarker(directory: string, marker: Record<string, unknown>) {
  // A crash during writing must not destroy the previous ownership record.
  const pending = join(directory, `${markerName}.${randomUUID()}.pending`)
  writeFileSync(pending, JSON.stringify(marker), { flag: 'wx' })
  renameSync(pending, join(directory, markerName))
}

function hasLiveWorker(marker: Record<string, unknown>) {
  if (!Number.isInteger(marker.workerPid) || Number(marker.workerPid) <= 0) return false
  try { process.kill(Number(marker.workerPid), 0); return true }
  catch (error) {
    // An inaccessible or reused PID is never grounds to kill a process or remove
    // potentially live files. This is only a conservative cleanup veto.
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH')
  }
}

function rejectLinks(directory: string) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) throw new Error('Linked document directory entry')
    if (stat.isDirectory()) rejectLinks(path)
  }
}

export function removeDocumentDirectory(directory: string) {
  try {
    const marker = ownedJob(directory)
    if (hasLiveWorker(marker)) return
    rejectLinks(directory)
    // Only a direct UUID child with matching profile and job markers reaches rm.
    rmSync(directory, { recursive: true, force: false, maxRetries: 2, retryDelay: 100 })
  } catch {
    // Do not expose paths or personal data. Keep ownership records for next startup.
    console.warn('[HromadaAid] Тимчасовий каталог не очищено: немає підтвердження належності або файли недоступні.')
  }
}

export function initializeDocumentTemp() {
  if (root) return
  const location = join(app.getPath('userData'), 'generated-documents-temp')
  mkdirSync(location, { recursive: true })
  if (lstatSync(location).isSymbolicLink()) throw new Error('Unsafe document root')
  root = realpathSync(location)
  if (readdirSync(root).length === 0) {
    writeFileSync(join(root, markerName), JSON.stringify({ owner, token: randomUUID() }), { flag: 'wx' })
  }
  const marker = readMarker(root)
  if (marker.owner !== owner || typeof marker.token !== 'string' || !jobName.test(marker.token)) throw new Error('Unowned document root')
  token = marker.token
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !jobName.test(entry.name)) continue
    const directory = join(root, entry.name)
    try {
      ownedJob(directory)
      cancelDocumentGeneration(directory)
      removeDocumentDirectory(directory)
    } catch { /* Unknown directories are never adopted or deleted. */ }
  }
}

export function createDocumentDirectory() {
  if (!root || !token) throw new Error('Document storage unavailable')
  const id = randomUUID()
  const directory = join(root, id)
  // Verify the root marker again before creating or adopting any files.
  const marker = readMarker(root)
  if (marker.owner !== owner || marker.token !== token) throw new Error('Unowned document root')
  mkdirSync(directory)
  writeFileSync(join(directory, markerName), JSON.stringify({ owner, token, id }), { flag: 'wx' })
  return directory
}

export function setDocumentWorker(directory: string, workerPid: number | null) {
  const marker = ownedJob(directory)
  writeJobMarker(directory, { ...marker, workerPid })
}

export function cancelDocumentGeneration(directory: string) {
  ownedJob(directory)
  // Atomic creation refuses to follow an existing symbolic link.
  try { writeFileSync(join(directory, '.cancel'), '', { flag: 'wx' }) }
  catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
  }
}

export function isDocumentTempPath(path: string) {
  if (!root) return false
  // Resolve existing ancestors as well, so a junction cannot turn an exported
  // destination outside the root into a file inside the cleanup area.
  let ancestor = resolve(path)
  const suffix: string[] = []
  for (;;) {
    try { ancestor = resolve(realpathSync(ancestor), ...suffix); break }
    catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) return true
      const parent = dirname(ancestor)
      if (parent === ancestor) return true
      suffix.unshift(basename(ancestor))
      ancestor = parent
    }
  }
  const child = relative(root, ancestor)
  return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`))
}

export function cleanupDocumentTemp() {
  if (!root || !token) return
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.isSymbolicLink() && jobName.test(entry.name)) removeDocumentDirectory(join(root, entry.name))
  }
}
