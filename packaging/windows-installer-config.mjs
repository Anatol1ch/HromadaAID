import { existsSync, realpathSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, win32 } from 'node:path'

const pathKeys = ['programDirectory', 'dataDirectory', 'backupDirectory']

function canonicalPotentialPath(path) {
  let current = win32.resolve(path)
  const suffix = []
  while (!existsSync(current)) {
    const parent = win32.dirname(current)
    if (parent === current) throw new Error(`Не вдалося визначити розташування каталогу ${path}.`)
    suffix.unshift(win32.basename(current))
    current = parent
  }
  return win32.resolve(realpathSync.native(current), ...suffix)
}

function isWithin(parent, candidate) {
  const rel = win32.relative(parent, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${win32.sep}`) && !win32.isAbsolute(rel))
}

function normalizedDirectory(path, label) {
  if (typeof path !== 'string' || path.trim() !== path || /[\u0000-\u001f\u007f<>|?*]/.test(path) || !/^[A-Za-z]:\\/.test(path) || path.slice(2).includes(':') || !win32.isAbsolute(path)) {
    throw new Error(`Каталог «${label}» має бути абсолютним локальним шляхом Windows.`)
  }
  const normalized = win32.resolve(path)
  if (normalized === win32.parse(normalized).root) throw new Error(`Каталог «${label}» не може бути коренем диска.`)
  return normalized.replace(/[\\]+$/, '')
}

/** Validates installer choices without opening or creating a SQLite database. */
export function validateInstallerOptions(options, { inspectVolume } = {}) {
  if (!options || !['client', 'server', 'server-client'].includes(options.mode)) throw new Error('Виберіть режим: клієнт, сервер або сервер + клієнт.')
  const hasServer = options.mode !== 'client'
  const paths = { programDirectory: normalizedDirectory(options.programDirectory, 'програма') }
  if (hasServer) {
    paths.dataDirectory = normalizedDirectory(options.dataDirectory, 'серверні дані')
    paths.backupDirectory = normalizedDirectory(options.backupDirectory, 'резервні копії')
  } else if (options.dataDirectory || options.backupDirectory) {
    throw new Error('Для режиму «Клієнт» каталоги серверних даних не задаються.')
  }

  const canonical = Object.fromEntries(Object.entries(paths).map(([key, value]) => [key, canonicalPotentialPath(value)]))
  const keys = Object.keys(canonical)
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const a = canonical[keys[i]], b = canonical[keys[j]]
    if (isWithin(a, b) || isWithin(b, a)) throw new Error(`Каталоги «${keys[i]}» та «${keys[j]}» не повинні перекриватися.`)
  }

  if (inspectVolume) for (const key of keys) {
    const volume = inspectVolume(paths[key])
    if (!volume || volume.driveType !== 3 || String(volume.fileSystem).toUpperCase() !== 'NTFS') throw new Error(`Каталог «${key}» має бути на доступному локальному диску NTFS.`)
    if (Number(volume.freeBytes) < 64 * 1024 * 1024) throw new Error(`На диску каталогу «${key}» недостатньо вільного місця.`)
  }

  if (hasServer) {
    const existingConfig = join(paths.dataDirectory, 'server.json')
    const existingDatabase = join(paths.dataDirectory, 'hromada-aid.sqlite')
    const freshDatabase = join(paths.dataDirectory, 'Database', 'hromada-aid.sqlite')
    const keyPath = join(paths.backupDirectory, '.hromadaaid-backup-key.dpapi')
    const archivePresent = existsSync(paths.backupDirectory) && readdirSync(paths.backupDirectory).some(name => name.toLocaleLowerCase('en-US').endsWith('.hraid'))
    if ((existsSync(existingDatabase) || existsSync(freshDatabase)) && !existsSync(existingConfig)) throw new Error('У каталозі вже є база HromadaAID без конфігурації. Встановлення зупинено, щоб не створити іншу порожню базу.')
    if (existsSync(existingConfig)) {
      if (!statSync(existingConfig).isFile()) throw new Error('server.json має бути звичайним файлом.')
      let current
      try { current = JSON.parse(readFileSync(existingConfig, 'utf8')) } catch { throw new Error('Наявний server.json некоректний; його не буде перезаписано.') }
      if (typeof current.databasePath !== 'string' || typeof current.backupDirectory !== 'string') throw new Error('Наявний server.json не містить очікуваних шляхів; перевірте його вручну.')
      const samePath = (a, b) => win32.resolve(a).toLocaleLowerCase('en-US') === win32.resolve(b).toLocaleLowerCase('en-US')
      const databaseInsideSelectedData = samePath(current.databasePath, existingDatabase) || samePath(current.databasePath, freshDatabase)
      if (!databaseInsideSelectedData || !samePath(current.backupDirectory, paths.backupDirectory)) {
        throw new Error('Вибрані каталоги відрізняються від наявної конфігурації. Для оновлення залиште попередні шляхи.')
      }
      if (typeof current.programDirectory === 'string' && !samePath(current.programDirectory, paths.programDirectory)) {
        throw new Error('Каталог програми відрізняється від наявного server.json. Для оновлення залиште попередній шлях.')
      }
      const configuredDatabase = win32.resolve(current.databasePath)
      const databaseExists = existsSync(configuredDatabase)
      if ((existsSync(existingDatabase) || existsSync(freshDatabase)) && !databaseExists) throw new Error('Знайдено SQLite поза шляхом із server.json. Встановлення зупинено, наявні дані не змінено.')
      const keyExists = existsSync(keyPath)
      if (databaseExists !== keyExists || (archivePresent && !(databaseExists && keyExists))) throw new Error('Наявні база, DPAPI-ключ або резервні архіви не утворюють повний комплект. Потрібне явне рішення адміністратора.')
    } else {
      const databaseExists = existsSync(existingDatabase) || existsSync(freshDatabase)
      if (databaseExists || existsSync(keyPath) || archivePresent) throw new Error('У вибраних каталогах уже є база, DPAPI-ключ або архіви без сумісної конфігурації. Автоматичну ініціалізацію зупинено.')
    }
  }
  return { mode: options.mode, ...paths }
}

function xmlEscape(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

export function renderInstalledServerConfig(options) {
  const valid = validateInstallerOptions(options)
  if (valid.mode === 'client') throw new Error('Режим «Клієнт» не створює конфігурацію сервера.')
  return JSON.stringify({
    configVersion: 2,
    mode: 'local',
    programDirectory: valid.programDirectory,
    host: '127.0.0.1',
    port: 4310,
    databasePath: join(valid.dataDirectory, 'Database', 'hromada-aid.sqlite'),
    backupDirectory: valid.backupDirectory,
  }, null, 2) + '\n'
}

export function renderWinSWConfig(template, options) {
  const valid = validateInstallerOptions(options)
  if (valid.mode === 'client') throw new Error('Режим «Клієнт» не створює конфігурацію служби.')
  const replacements = {
    __PROGRAM_DIRECTORY__: valid.programDirectory,
    __DATA_DIRECTORY__: valid.dataDirectory,
    __BACKUP_DIRECTORY__: valid.backupDirectory,
  }
  let result = template
  for (const [token, path] of Object.entries(replacements)) result = result.replaceAll(token, xmlEscape(path))
  if (/__[A-Z_]+__/.test(result)) throw new Error('Шаблон WinSW містить незаповнений параметр.')
  return result
}

export function defaultInstallerPaths(programRoot, commonDataRoot) {
  return {
    programDirectory: join(programRoot, 'HromadaAID'),
    dataDirectory: join(commonDataRoot, 'HromadaAID', 'Data'),
    backupDirectory: join(commonDataRoot, 'HromadaAID', 'Backups'),
  }
}

export const installerPathKeys = pathKeys;
