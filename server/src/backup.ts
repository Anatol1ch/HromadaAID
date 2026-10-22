import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'

const backupFilePattern = /^hromada-aid-daily-(\d{4}-\d{2}-\d{2})-created-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3})-([a-f\d-]+)\.sqlite$/
const backupPartialPattern = /^hromada-aid-daily-\d{4}-\d{2}-\d{2}-created-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}-[a-f\d-]+\.sqlite\.partial$/
const retainedBackupCount = 14
const maxPendingBackupBytes = 20 * 1024 * 1024 * 1024
const maxBackupAttempts = 3
const retryDelayMs = 5 * 60 * 1000

export type BackupLogger = { error: (message: string) => void; warn: (message: string) => void }
export type BackupResult = { status: 'created' | 'already-exists' | 'already-created-today' | 'busy' | 'pending-storage-limit'; path?: string }

export function localDateKey(date: Date): string {
  const year = date.getFullYear().toString().padStart(4, '0')
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const day = date.getDate().toString().padStart(2, '0')
  return `${year}-${month}-${day}`
}

function localTimeKey(date: Date): string {
  return `${localDateKey(date)}T${date.getHours().toString().padStart(2, '0')}-${date.getMinutes().toString().padStart(2, '0')}-${date.getSeconds().toString().padStart(2, '0')}-${date.getMilliseconds().toString().padStart(3, '0')}`
}

export function dueBackupDate(now: Date): string {
  const due = new Date(now)
  if (due.getHours() < 12) due.setDate(due.getDate() - 1)
  return localDateKey(due)
}

export function nextDailyBackupTime(now: Date): Date {
  const next = new Date(now)
  next.setHours(12, 0, 0, 0)
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
  return next
}

export function listDailyBackups(directory: string): { name: string; slotDate: string; createdAt: string; path: string }[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isFile()) return []
    const match = backupFilePattern.exec(entry.name)
    return match ? [{ name: entry.name, slotDate: match[1], createdAt: match[2], path: join(directory, entry.name) }] : []
  })
}

export function secureBackupDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') {
    chmodSync(directory, 0o700)
    return
  }

  const whoami = execFileSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
  const sid = whoami.match(/\bS-\d-(?:\d+-)+\d+\b/)?.[0]
  if (!sid) throw new Error('Не вдалося визначити власника каталогу резервних копій.')
  execFileSync('icacls.exe', [
    directory,
    '/inheritance:r',
    '/grant:r',
    `*${sid}:(OI)(CI)F`,
    '*S-1-5-18:(OI)(CI)F',
    '*S-1-5-32-544:(OI)(CI)F',
    '/T',
    '/C',
  ], { windowsHide: true, stdio: 'ignore' })
}

export class SqliteBackupService {
  private busy = false
  private preparedDirectory = false

  constructor(private readonly database: DatabaseSync, readonly directory: string, private readonly logger: BackupLogger, private readonly isPendingUpload: (fileName: string) => boolean = () => false) {
    this.directory = resolve(directory)
  }

  async createDailyBackup(slotDate: string, createdAt: Date): Promise<BackupResult> {
    if (this.busy) return { status: 'busy' }
    this.busy = true
    let partialPath: string | undefined
    try {
      this.prepareDirectory()
      const currentBackups = listDailyBackups(this.directory)
      const pendingBytes = currentBackups.filter((file) => this.isPendingUpload(file.name)).reduce((total, file) => {
        try { return total + statSync(file.path).size } catch { return total }
      }, 0)
      if (pendingBytes >= maxPendingBackupBytes) {
        this.logger.error('Досягнуто ліміт 20 ГіБ для локальних копій, що очікують Google Drive. Копії не видалено; нове резервування призупинено до звільнення місця або відновлення синхронізації.')
        return { status: 'pending-storage-limit' }
      }
      if (currentBackups.some((file) => file.slotDate === slotDate)) return { status: 'already-exists' }
      if (currentBackups.some((file) => file.createdAt.slice(0, 10) === localDateKey(createdAt))) return { status: 'already-created-today' }

      const id = randomUUID()
      const created = localTimeKey(createdAt)
      const fileName = `hromada-aid-daily-${slotDate}-created-${created}-${id}.sqlite`
      const finalPath = join(this.directory, fileName)
      partialPath = `${finalPath}.partial`

      await backup(this.database, partialPath)
      const copy = new DatabaseSync(partialPath, { readOnly: true })
      try {
        const result = copy.prepare('PRAGMA integrity_check').all() as { integrity_check?: string }[]
        if (result.length !== 1 || result[0]?.integrity_check !== 'ok') {
          throw new Error('Перевірка цілісності резервної копії не пройдена.')
        }
      } finally {
        copy.close()
      }

      renameSync(partialPath, finalPath)
      partialPath = undefined
      if (this.isPendingUpload(fileName)) {
        const pendingAfterCreate = listDailyBackups(this.directory).filter((file) => this.isPendingUpload(file.name))
        const pendingBytesAfterCreate = pendingAfterCreate.reduce((total, file) => {
          try { return total + statSync(file.path).size } catch { return total }
        }, 0)
        if (pendingBytesAfterCreate >= maxPendingBackupBytes) {
          this.logger.error('Локальні копії, що очікують Google Drive, досягли ліміту 20 ГіБ. Архіви збережено; нове резервування призупиниться до звільнення місця або відновлення синхронізації.')
        }
      }
      try { this.pruneOldBackups() }
      catch { this.logger.warn('Не вдалося завершити очищення застарілих резервних копій.') }
      return { status: 'created', path: finalPath }
    } finally {
      if (partialPath) {
        try { rmSync(partialPath, { force: true }) } catch { this.logger.warn('Не вдалося прибрати незавершений тимчасовий файл резервної копії.') }
      }
      this.busy = false
    }
  }

  private prepareDirectory(): void {
    if (this.preparedDirectory) return
    secureBackupDirectory(this.directory)
    this.preparedDirectory = true
    // A process crash may leave only an unpublished partial file. Never treat it as a backup.
    for (const entry of readdirSync(this.directory, { withFileTypes: true })) {
      if (!entry.isFile() || !backupPartialPattern.test(entry.name)) continue
      try {
        const path = join(this.directory, entry.name)
        if (Date.now() - statSync(path).mtimeMs > 24 * 60 * 60 * 1000) rmSync(path, { force: true })
      } catch { this.logger.warn('Не вдалося прибрати застарілий тимчасовий файл резервної копії.') }
    }
  }

  private pruneOldBackups(): void {
    const files = listDailyBackups(this.directory).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const retained = new Set(files.slice(0, retainedBackupCount).map((file) => file.name))
    for (const stale of files) {
      if (retained.has(stale.name) || this.isPendingUpload(stale.name)) continue
      try { rmSync(stale.path, { force: true }) }
      catch { this.logger.warn('Не вдалося видалити застарілу резервну копію.') }
    }
  }
}

type SchedulerOptions = {
  now?: () => Date
  setTimeout?: typeof setTimeout
  clearTimeout?: typeof clearTimeout
  retryDelayMs?: number
  onBackupCreated?: (path: string) => void
}

export function startDailyBackupScheduler(service: SqliteBackupService, logger: BackupLogger, options: SchedulerOptions = {}): { initialRun: Promise<void>; stop: () => Promise<void> } {
  const now = options.now ?? (() => new Date())
  const scheduleTimeout = options.setTimeout ?? setTimeout
  const cancelTimeout = options.clearTimeout ?? clearTimeout
  const retryMs = options.retryDelayMs ?? retryDelayMs
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let resolveDelay: (() => void) | undefined
  let activeRun: Promise<void> | undefined

  const delay = () => new Promise<void>((resolveDelayPromise) => {
    resolveDelay = resolveDelayPromise
    timer = scheduleTimeout(() => { timer = undefined; resolveDelay = undefined; resolveDelayPromise() }, retryMs)
  })

  const runCycle = async (slotDate: string): Promise<void> => {
    for (let attempt = 1; attempt <= maxBackupAttempts && !stopped; attempt++) {
      try {
        const result = await service.createDailyBackup(slotDate, now())
        if (result.status === 'pending-storage-limit') return
        if (result.status === 'created' && result.path) options.onBackupCreated?.(result.path)
        return
      } catch {
        logger.error(`Не вдалося створити щоденну резервну копію (спроба ${attempt} з ${maxBackupAttempts}).`)
        if (attempt < maxBackupAttempts && !stopped) await delay()
      }
    }
  }

  const scheduleNext = () => {
    if (stopped) return
    const current = now()
    const waitMs = Math.max(0, nextDailyBackupTime(current).getTime() - current.getTime())
    timer = scheduleTimeout(() => {
      timer = undefined
      activeRun = runCycle(dueBackupDate(now())).finally(() => {
        activeRun = undefined
        scheduleNext()
      })
    }, waitMs)
  }

  activeRun = runCycle(dueBackupDate(now())).finally(() => {
    activeRun = undefined
    scheduleNext()
  })

  return {
    initialRun: activeRun,
    stop: async () => {
      stopped = true
      if (timer) cancelTimeout(timer)
      timer = undefined
      resolveDelay?.()
      resolveDelay = undefined
      await activeRun
    },
  }
}
