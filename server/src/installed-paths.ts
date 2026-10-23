import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path'
import type { InstalledServerConfig } from './config.js'

type VolumeInfo = { driveType: number; fileSystem: string; freeBytes: number }
type ValidationOptions = {
  initialize?: boolean
  /** Test seam for synthetic paths; never exposed as a runtime configuration option. */
  inspectVolume?: (path: string) => VolumeInfo
  verifyWrite?: (directory: string) => void
  allowTemporaryLocationsForTests?: boolean
}

const minimumFreeBytes = 64 * 1024 * 1024

function volumeInfo(path: string): VolumeInfo {
  if (process.platform !== 'win32') throw new Error('Встановлений сервер підтримує лише Windows.')
  const drive = resolve(path).slice(0, 2)
  if (!/^[A-Za-z]:$/.test(drive)) throw new Error('Підтримуються лише локальні шляхи Windows виду D:\\каталог; мережеві шляхи заборонені.')
  const script = "$ErrorActionPreference='Stop'; $d=[Console]::In.ReadToEnd().Trim(); $v=Get-CimInstance Win32_LogicalDisk -Filter (\"DeviceID='\"+$d+\"'\"); if (-not $v) { throw 'volume-missing' }; @{driveType=[int]$v.DriveType;fileSystem=[string]$v.FileSystem;freeBytes=[int64]$v.FreeSpace} | ConvertTo-Json -Compress"
  let value: unknown
  try {
    const output = execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { input: drive, encoding: 'utf8', windowsHide: true, timeout: 10_000, stdio: ['pipe', 'pipe', 'ignore'] })
    value = JSON.parse(output)
  } catch { throw new Error(`Диск ${drive} відсутній або недоступний.`) }
  if (!value || typeof value !== 'object') throw new Error(`Не вдалося перевірити диск ${drive}.`)
  const result = value as Record<string, unknown>
  return { driveType: Number(result.driveType), fileSystem: String(result.fileSystem), freeBytes: Number(result.freeBytes) }
}

function canonicalPotentialPath(path: string): string {
  let current = resolve(path)
  const suffix: string[] = []
  while (!existsSync(current)) {
    const parent = dirname(current)
    if (parent === current) {
      const root = win32.parse(path).root
      if (/^[A-Za-z]:\\$/.test(root)) throw new Error(`Диск ${root.slice(0, 2)} відсутній або недоступний.`)
      throw new Error(`Не вдалося визначити реальне розташування каталогу ${path}.`)
    }
    suffix.unshift(basename(current))
    current = parent
  }
  return resolve(realpathSync.native(current), ...suffix)
}

function isWithin(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

function assertNotSystemOrTemporaryPath(path: string, allowTemporary: boolean): void {
  const volumeRoot = resolve(path).slice(0, 3)
  if (resolve(path).replace(/[\\/]+$/, '').toLocaleLowerCase('en-US') === volumeRoot.replace(/[\\/]+$/, '').toLocaleLowerCase('en-US')) throw new Error('Постійні дані не можна зберігати в корені диска.')
  const windowsDirectory = process.env.SystemRoot || process.env.WINDIR
  if (windowsDirectory && isWithin(canonicalPotentialPath(windowsDirectory), canonicalPotentialPath(path))) throw new Error('Каталог даних не може бути всередині системного каталогу Windows.')
  for (const programFiles of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) {
    if (programFiles && isWithin(canonicalPotentialPath(programFiles), canonicalPotentialPath(path))) throw new Error('Серверні дані не можна зберігати в каталозі програмних файлів.')
  }
  if (!allowTemporary) {
    const profile = process.env.USERPROFILE
    const temporary = process.env.TEMP || tmpdir()
    if ((profile && isWithin(canonicalPotentialPath(profile), canonicalPotentialPath(path))) || isWithin(canonicalPotentialPath(temporary), canonicalPotentialPath(path))) {
      throw new Error('Постійні серверні дані не можна зберігати у профілі користувача або тимчасовому каталозі.')
    }
  }
}

function verifyFixedNtfs(path: string, inspect: (path: string) => VolumeInfo): VolumeInfo {
  const volume = inspect(path)
  if (volume.driveType !== 3) throw new Error(`Диск для каталогу ${path} має бути локальним постійним диском.`)
  if (volume.fileSystem.toLocaleUpperCase('en-US') !== 'NTFS') throw new Error(`Каталог ${path} має розташовуватися на NTFS.`)
  return volume
}

function verifyWritable(directory: string): void {
  let probe: string
  try { probe = mkdtempSync(join(directory, '.hromadaaid-write-check-')) }
  catch { throw new Error(`Немає прав на створення файлів у каталозі ${directory}.`) }
  try { rmSync(probe, { recursive: true, force: true }) }
  catch { throw new Error(`Не вдалося прибрати тимчасовий файл перевірки з каталогу ${directory}.`) }
}

/** Validates only installed-mode paths, before opening the database. */
export function validateInstalledPaths(config: InstalledServerConfig, options: ValidationOptions = {}): void {
  const initialize = options.initialize === true
  const inspect = options.inspectVolume ?? volumeInfo
  const allowTemporary = options.allowTemporaryLocationsForTests === true
  const programDirectory = canonicalPotentialPath(config.programDirectory)
  if (!existsSync(programDirectory) || !statSync(programDirectory).isDirectory()) throw new Error(`Каталог програмних файлів недоступний: ${config.programDirectory}`)

  const databaseParent = dirname(config.databasePath)
  const prospectiveDatabase = canonicalPotentialPath(config.databasePath)
  const prospectiveBackups = canonicalPotentialPath(config.backupDirectory)
  if (isWithin(programDirectory, prospectiveDatabase) || isWithin(programDirectory, prospectiveBackups)) throw new Error('База даних і резервні копії мають бути поза каталогом програмних файлів.')
  if (isWithin(prospectiveBackups, prospectiveDatabase)) throw new Error('Файл SQLite не може розташовуватися всередині каталогу резервних копій.')
  if (initialize && existsSync(config.databasePath)) throw new Error(`Файл бази вже існує; первинна ініціалізація його не перезаписує: ${config.databasePath}`)
  const prospectiveDbVolume = verifyFixedNtfs(canonicalPotentialPath(databaseParent), inspect)
  const prospectiveBackupVolume = verifyFixedNtfs(prospectiveBackups, inspect)
  if (prospectiveDbVolume.freeBytes < minimumFreeBytes) throw new Error(`На диску каталогу бази недостатньо вільного місця (потрібно щонайменше ${minimumFreeBytes} байтів).`)
  if (prospectiveBackupVolume.freeBytes < minimumFreeBytes) throw new Error(`На диску резервних копій недостатньо вільного місця (потрібно щонайменше ${minimumFreeBytes} байтів).`)
  if (initialize) {
    assertNotSystemOrTemporaryPath(databaseParent, allowTemporary)
    assertNotSystemOrTemporaryPath(config.backupDirectory, allowTemporary)
    // Creation occurs only in the explicit initialize operation.
    mkdirSync(databaseParent, { recursive: true })
    mkdirSync(config.backupDirectory, { recursive: true })
  }
  if (!existsSync(databaseParent) || !statSync(databaseParent).isDirectory()) throw new Error(`Каталог бази даних недоступний: ${databaseParent}`)
  if (!existsSync(config.backupDirectory) || !statSync(config.backupDirectory).isDirectory()) throw new Error(`Каталог резервних копій недоступний: ${config.backupDirectory}`)

  const canonicalDatabase = canonicalPotentialPath(config.databasePath)
  const canonicalDbParent = canonicalPotentialPath(databaseParent)
  const canonicalBackups = canonicalPotentialPath(config.backupDirectory)
  if (isWithin(programDirectory, canonicalDatabase) || isWithin(programDirectory, canonicalBackups)) throw new Error('База даних і резервні копії мають бути поза каталогом програмних файлів.')
  if (isWithin(canonicalBackups, canonicalDatabase)) throw new Error('Файл SQLite не може розташовуватися всередині каталогу резервних копій.')
  assertNotSystemOrTemporaryPath(canonicalDbParent, allowTemporary)
  assertNotSystemOrTemporaryPath(canonicalBackups, allowTemporary)
  const stagingDirectory = join(config.backupDirectory, 'restore-staging')
  if (existsSync(stagingDirectory) && lstatSync(stagingDirectory).isSymbolicLink()) throw new Error(`Каталог підготовки відновлення не може бути junction або символічним посиланням: ${stagingDirectory}`)

  if (existsSync(config.databasePath)) {
    const databaseStat = lstatSync(config.databasePath)
    if (databaseStat.isSymbolicLink() || !databaseStat.isFile()) throw new Error(`Шлях бази не є звичайним файлом SQLite: ${config.databasePath}`)
  } else if (!initialize) {
    throw new Error(`Файл серверної бази не знайдено: ${config.databasePath}. Нова база автоматично не створюється.`)
  }

  const dbVolume = verifyFixedNtfs(canonicalDbParent, inspect)
  const backupVolume = verifyFixedNtfs(canonicalBackups, inspect)
  const dbBytes = existsSync(config.databasePath) ? statSync(config.databasePath).size : 0
  const needed = Math.max(minimumFreeBytes, dbBytes * 2)
  if (dbVolume.freeBytes < minimumFreeBytes) throw new Error(`На диску каталогу бази недостатньо вільного місця (потрібно щонайменше ${minimumFreeBytes} байтів).`)
  if (backupVolume.freeBytes < needed) throw new Error(`На диску резервних копій недостатньо місця для створення копії (потрібно щонайменше ${needed} байтів).`)

  const checkWrite = options.verifyWrite ?? verifyWritable
  checkWrite(canonicalDbParent)
  checkWrite(canonicalBackups)
}
