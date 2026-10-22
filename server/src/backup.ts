import { securePrivateDirectory as secureBackupDirectory } from '../../electron/protected-directory.js'
import { readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'

const backupFilePattern = /^hromada-aid-daily-(\d{4}-\d{2}-\d{2})-created-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3})-([a-f\d-]+)\.sqlite$/
const backupPartialPattern = /^hromada-aid-daily-\d{4}-\d{2}-\d{2}-created-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}-[a-f\d-]+\.sqlite\.partial$/
const retainedBackupCount = 14
const maxBackupAttempts = 3
const retryDelayMs = 5 * 60 * 1000

export type BackupLogger = { error: (message: string) => void; warn: (message: string) => void }
export type BackupResult = { status: 'created' | 'already-exists' | 'already-created-today' | 'busy'; path?: string }

export function localDateKey(date: Date): string {
  const year = date.getFullYear().toString().padStart(4, '0')
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const day = date.getDate().toString().padStart(2, '0')
  return `${year}-${month}-${day}`
}

function localTimeKey(date: Date): string {
  return `${localDateKey(date)}T${date.getHours().toString().padStart(2, '0')}-${date.getMinutes().toString().padStart(2, '0')}-${date.getSeconds().toString().padStart(2, '0')}-${date.getMilliseconds().toString().padStart(3, '0')}`
}

function removeClosedBackupSidecars(path: string): void {
  // The unpublished, uniquely named backup has no open handles here. Remove only
  // its own SQLite WAL artifacts; never touch the source database sidecars.
  for (const suffix of ['-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true })
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

export function listManualBackups(directory: string): ReturnType<typeof listDailyBackups> {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const match = /^hromada-aid-manual-(\d{4}-\d{2}-\d{2})-created-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3})-([a-f\d-]+)\.sqlite$/.exec(entry.name)
    return entry.isFile() && match ? [{ name: entry.name, slotDate: match[1], createdAt: match[2], path: join(directory, entry.name) }] : []
  })
}

export { securePrivateDirectory as secureBackupDirectory } from '../../electron/protected-directory.js'

export class SqliteBackupService {
  private busy = false
  private preparedDirectory = false

  constructor(private readonly database: DatabaseSync, readonly directory: string, private readonly logger: BackupLogger) {
    this.directory = resolve(directory)
  }

  createManualBackup(createdAt = new Date()): Promise<BackupResult> {
    return this.createDailyBackup(localDateKey(createdAt), createdAt, true)
  }

  async createDailyBackup(slotDate: string, createdAt: Date, manual = false): Promise<BackupResult> {
    if (this.busy) return { status: 'busy' }
    this.busy = true
    let partialPath: string | undefined
    try {
      this.prepareDirectory()
      const currentBackups = listDailyBackups(this.directory)
      if (!manual && currentBackups.some((file) => file.slotDate === slotDate)) return { status: 'already-exists' }
      if (!manual && currentBackups.some((file) => file.createdAt.slice(0, 10) === localDateKey(createdAt))) return { status: 'already-created-today' }

      const id = randomUUID()
      const created = localTimeKey(createdAt)
      const fileName = `hromada-aid-${manual ? 'manual' : 'daily'}-${slotDate}-created-${created}-${id}.sqlite`
      const finalPath = join(this.directory, fileName)
      partialPath = `${finalPath}.partial`

      await backup(this.database, partialPath)
      const copy = new DatabaseSync(partialPath)
      try {
        const checkpoint = copy.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as { busy?: number; log?: number; checkpointed?: number }
        if (checkpoint.busy !== 0 || (checkpoint.log !== undefined && checkpoint.log >= 0 && (checkpoint.checkpointed ?? -1) < checkpoint.log)) {
          throw new Error('Не вдалося завершити WAL-контрольну точку резервної копії.')
        }
        const result = copy.prepare('PRAGMA integrity_check').all() as { integrity_check?: string }[]
        if (result.length !== 1 || result[0]?.integrity_check !== 'ok') {
          throw new Error('Перевірка цілісності резервної копії не пройдена.')
        }
      } finally {
        copy.close()
      }
      removeClosedBackupSidecars(partialPath)

      renameSync(partialPath, finalPath)
      partialPath = undefined
      try { this.pruneOldBackups() }
      catch { this.logger.warn('Не вдалося завершити очищення застарілих резервних копій.') }
      return { status: 'created', path: finalPath }
    } finally {
      if (partialPath) {
        try { removeClosedBackupSidecars(partialPath) } catch { this.logger.warn('Не вдалося прибрати тимчасові WAL-файли резервної копії.') }
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
      if (retained.has(stale.name)) continue
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
        if (result.status === 'busy') throw new Error('Резервування вже триває.')
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
