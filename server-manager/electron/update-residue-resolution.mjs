import { lstat, mkdir, open, readFile, rename, rm, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'

export const UPDATE_RESIDUE_ARCHIVE_NAME = 'HromadaAID-Update-Residue-Archive'
export const UPDATE_RESIDUE_LOCK_NAME = '.hromadaaid-update-residue-resolution.lock'
export const RESIDUE_NAMES = ['Server.next', 'Server.previous', 'Server.failed']

const BLOCKED = 'Безпечне усунення не підтверджене. Файли залишено без змін.'

export function residueResolutionBlockReason(checks) {
  if (checks.operationBusy) return 'Виконується інша системна операція.'
  if (checks.journalExists) return 'Знайдено журнал оновлення. Спочатку перевірте незавершену транзакцію.'
  if (checks.restorePending) return 'Виявлено незавершену операцію з базою даних.'
  if (!checks.administrator) return 'Для архівування потрібен запуск Server Manager від імені адміністратора.'
  if (!checks.installationInstalled || !checks.discoveryConfirmed || !checks.serviceRunning) return 'Не вдалося підтвердити справний активний сервер і стан Windows Service.'
  if (!checks.serviceUsesActivePackage) return 'Шлях Windows Service не збігається з активним каталогом Server.'
  if (!checks.apiAvailable || !checks.apiContractMatches) return 'API недоступний або його контракт не збігається з активним серверним пакетом.'
  if (!checks.activePackageIntegrityVerified) return 'Цілісність активного серверного пакета не підтверджена.'
  if (checks.lockExists) return 'Інша операція з файлами оновлення вже виконується.'
  return ''
}

function isWithin(root, candidate) {
  const rel = resolve(candidate).slice(resolve(root).length)
  return rel === '' || (rel.startsWith(sep) && !rel.split(sep).includes('..'))
}

async function requireDirectory(path, label, lstatPath) {
  const info = await lstatPath(path)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`${label} не є звичайним каталогом.`)
}

/** A crashed Manager may leave a lock marker. It is cleared only when its PID is provably gone. */
export async function clearStaleResidueLock(programDirectory, io = {}) {
  const lockPath = join(resolve(programDirectory), UPDATE_RESIDUE_LOCK_NAME)
  const lstatPath = io.lstat ?? lstat, readFilePath = io.readFile ?? readFile, removePath = io.rm ?? rm
  let info
  try { info = await lstatPath(lockPath) } catch (error) { if (error?.code === 'ENOENT') return false; throw error }
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1_024) throw new Error('Файл блокування має неочікуваний тип; нові файлові операції заблоковано.')
  const contents = await readFilePath(lockPath, 'utf8')
  let pid
  try { pid = JSON.parse(contents)?.pid } catch { throw new Error('Файл блокування некоректний; потрібна ручна перевірка.') }
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Файл блокування не містить достовірного процесу-власника.')
  try { process.kill(pid, 0); return true }
  catch (error) {
    if (error?.code !== 'ESRCH') return true
  }
  const confirm = await readFilePath(lockPath, 'utf8')
  if (confirm !== contents) throw new Error('Власник блокування змінився; повторіть перевірку.')
  await removePath(lockPath)
  return false
}

/**
 * Move only the three known direct-child transaction directories into a unique
 * archive on the same volume. Never inspect or delete their contents. A partial
 * move is intentionally retained and reported so it can be diagnosed safely.
 */
export async function archiveUpdateResidues({ programDirectory, artifacts, checks, confirmed, operationId, revalidate, io = {} }) {
  const lstatPath = io.lstat ?? lstat, mkdirPath = io.mkdir ?? mkdir, renamePath = io.rename ?? rename
  const openPath = io.open ?? open, removePath = io.rm ?? rm, realpathPath = io.realpath ?? realpath
  const blockReason = residueResolutionBlockReason(checks)
  if (blockReason) throw new Error(blockReason)
  if (confirmed !== true) throw new Error('Потрібне підтвердження адміністратора.')
  if (!/^[a-f0-9-]{16,64}$/i.test(operationId)) throw new Error('Ідентифікатор архівної операції некоректний.')
  if (!Array.isArray(artifacts) || !artifacts.length) throw new Error('Залишкових службових каталогів більше не виявлено.')

  const program = resolve(programDirectory)
  await requireDirectory(program, 'Каталог програми', lstatPath)
  const canonicalProgram = await realpathPath(program)
  if (resolve(canonicalProgram).toLocaleLowerCase('en-US') !== program.toLocaleLowerCase('en-US')) throw new Error('Фактичний шлях каталогу програми відрізняється від підтвердженого.')
  const unique = new Set()
  const sources = artifacts.map(item => {
    if (!item || !RESIDUE_NAMES.includes(item.name) || unique.has(item.name) || item.kind !== 'directory') throw new Error('Знайдено невідомий або небезпечний службовий об’єкт.')
    unique.add(item.name)
    const expected = join(program, item.name)
    if (resolve(item.path) !== expected || dirname(resolve(item.path)) !== program || basename(resolve(item.path)) !== item.name || !isAbsolute(item.path)) throw new Error('Шлях службового каталогу не збігається з дозволеним прямим шляхом.')
    return { name: item.name, source: expected }
  })

  const lockPath = join(program, UPDATE_RESIDUE_LOCK_NAME)
  let lock
  try { lock = await openPath(lockPath, 'wx', 0o600) }
  catch (error) {
    if (error?.code === 'EEXIST') {
      await clearStaleResidueLock(program, io)
      try { lock = await openPath(lockPath, 'wx', 0o600) }
      catch { throw new Error('Інша операція з файлами оновлення вже виконується.') }
    } else {
      throw new Error('Не вдалося створити захисне блокування файлової операції.')
    }
  }
  let archiveDirectory = ''
  const moved = []
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, operationId }) + '\n', 'utf8')
    await lock.sync()
    const archiveRoot = join(program, UPDATE_RESIDUE_ARCHIVE_NAME)
    try { await requireDirectory(archiveRoot, 'Каталог архіву', lstatPath) }
    catch (error) {
      if (error?.code !== 'ENOENT') throw error
      await mkdirPath(archiveRoot)
      await requireDirectory(archiveRoot, 'Каталог архіву', lstatPath)
    }
    archiveDirectory = join(archiveRoot, `operation-${operationId}`)
    await mkdirPath(archiveDirectory)
    if (!isWithin(program, archiveDirectory) || archiveDirectory === program) throw new Error('Шлях архіву виходить за межі каталогу програми.')

    for (const item of sources) {
      if (revalidate) {
        const reason = await revalidate()
        if (reason) throw new Error(reason)
      }
      await requireDirectory(item.source, item.name, lstatPath)
      const target = join(archiveDirectory, item.name)
      try { await lstatPath(target); throw new Error('У каталозі архіву вже є об’єкт із таким ім’ям.') }
      catch (error) { if (error?.code !== 'ENOENT') throw error }
      await renamePath(item.source, target)
      moved.push(item.name)
    }
    return { success: true, archiveDirectory, moved }
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Помилка файлової системи.'
    throw Object.assign(new Error(`${BLOCKED} ${detail}${moved.length ? ` Переміщено до архіву: ${moved.join(', ')} (${archiveDirectory}).` : ''}`), { moved, archiveDirectory })
  } finally {
    await lock.close().catch(() => undefined)
    await removePath(lockPath, { force: true }).catch(() => undefined)
  }
}
