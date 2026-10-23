import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync, openSync, closeSync, readFileSync, fsyncSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function writeJournal(path, record, create = false) {
  mkdirSync(dirname(path), { recursive: true })
  if (create) {
    let descriptor
    try { descriptor = openSync(path, 'wx', 0o600) }
    catch (error) { if (error.code === 'EEXIST') throw new Error('Журнал оновлення вже існує; нову операцію не розпочато.'); throw error }
    try { writeFileSync(descriptor, JSON.stringify(record) + '\n', 'utf8'); fsyncSync(descriptor) } finally { closeSync(descriptor) }
    return
  }
  const temporary = `${path}.${process.pid}.tmp`
  const descriptor = openSync(temporary, 'wx', 0o600)
  try {
    writeFileSync(descriptor, JSON.stringify(record) + '\n', 'utf8')
    fsyncSync(descriptor)
  } finally { closeSync(descriptor) }
  try {
    if (!existsSync(path)) throw new Error('Журнал оновлення зник; операцію зупинено.')
    renameSync(temporary, path)
  } finally { rmSync(temporary, { force: true }) }
}

function readJournal(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')) }
  catch { throw new Error('Журнал оновлення відсутній або некоректний.') }
}

export function preparePackageUpdate({ programDirectory, dataDirectory, hadPreviousPackage, oldSchemaMaximum, schemaBeforeActivation, serviceWasRunning }) {
  const program = resolve(programDirectory), data = resolve(dataDirectory)
  const active = join(program, 'Server'), staged = join(program, 'Server.next'), previous = join(program, 'Server.previous')
  const journalPath = join(data, '.hromadaaid-update-state.json')
  if (!existsSync(staged)) throw new Error('Новий серверний пакет не підготовлено.')
  if (hadPreviousPackage && !existsSync(active)) throw new Error('Попередній серверний пакет відсутній.')
  if (existsSync(previous)) throw new Error('Знайдено попередній серверний пакет; потрібне відновлення перед новим оновленням.')
  writeJournal(journalPath, {
    formatVersion: 1, phase: 'prepared', programDirectory: program,
    hadPreviousPackage: Boolean(hadPreviousPackage), oldSchemaMaximum: Number(oldSchemaMaximum),
    schemaBeforeActivation: Number(schemaBeforeActivation), serviceWasRunning: Boolean(serviceWasRunning),
    updatedAt: new Date().toISOString(),
  }, true)
  return journalPath
}

export function activateServerPackage({ programDirectory, dataDirectory, initialRetry = false }) {
  const program = resolve(programDirectory), data = resolve(dataDirectory)
  const active = join(program, 'Server'), staged = join(program, 'Server.next'), previous = join(program, 'Server.previous'), failed = join(program, 'Server.failed')
  const journalPath = join(data, '.hromadaaid-update-state.json'), journal = readJournal(journalPath)
  if (journal.phase !== 'prepared') throw new Error('Журнал не дозволяє активувати пакет на цьому етапі.')
  if (journal.hadPreviousPackage) {
    if (!existsSync(active) || existsSync(previous)) throw new Error('Не вдалося зберегти попередній серверний пакет.')
    renameSync(active, previous)
    journal.phase = 'old-package-preserved'; journal.updatedAt = new Date().toISOString(); writeJournal(journalPath, journal)
  } else if (initialRetry && existsSync(active)) {
    if (existsSync(failed)) throw new Error('Знайдено попередній невдалий початковий пакет.')
    renameSync(active, failed)
  }
  if (!existsSync(staged) || existsSync(active)) throw new Error('Новий серверний пакет не готовий до перемикання.')
  renameSync(staged, active)
  journal.phase = 'new-package-active'; journal.updatedAt = new Date().toISOString(); writeJournal(journalPath, journal)
  return journal
}

export function markPackageHealthCheck(dataDirectory) {
  const path = join(resolve(dataDirectory), '.hromadaaid-update-state.json'), journal = readJournal(path)
  if (journal.phase !== 'new-package-active') throw new Error('Неправильний етап перевірки нового серверного пакета.')
  journal.phase = 'health-check'; journal.updatedAt = new Date().toISOString(); writeJournal(path, journal)
  return journal
}

export function markPackageHealthy(dataDirectory) {
  const path = join(resolve(dataDirectory), '.hromadaaid-update-state.json'), journal = readJournal(path)
  if (journal.phase !== 'health-check') throw new Error('Новий серверний пакет ще не пройшов перевірку стану.')
  journal.phase = 'healthy'; journal.updatedAt = new Date().toISOString(); writeJournal(path, journal)
  return journal
}

export function rollbackServerPackage({ programDirectory, dataDirectory, schemaVersion }) {
  const program = resolve(programDirectory), data = resolve(dataDirectory)
  const active = join(program, 'Server'), previous = join(program, 'Server.previous'), failed = join(program, 'Server.failed')
  const journalPath = join(data, '.hromadaaid-update-state.json'), journal = readJournal(journalPath)
  if (!journal.hadPreviousPackage || !existsSync(previous) || existsSync(failed)) throw new Error('Попередній пакет недоступний для автоматичного відкату.')
  if (Number(schemaVersion) > Number(journal.oldSchemaMaximum)) throw new Error('Нова версія SQLite несумісна з попереднім серверним пакетом; відкат зупинено.')
  if (existsSync(active)) renameSync(active, failed)
  renameSync(previous, active)
  journal.phase = 'files-rolled-back'; journal.updatedAt = new Date().toISOString(); writeJournal(journalPath, journal)
  return journal
}

export function finalizePackageUpdate({ programDirectory, dataDirectory, initialRetry = false }) {
  const program = resolve(programDirectory), data = resolve(dataDirectory)
  const journalPath = join(data, '.hromadaaid-update-state.json'), journal = readJournal(journalPath)
  if (journal.phase !== 'healthy') throw new Error('Пакет не позначено як перевірений; видалення попередньої версії заборонено.')
  rmSync(join(program, 'Server.previous'), { recursive: true, force: true })
  if (initialRetry) rmSync(join(program, 'Server.failed'), { recursive: true, force: true })
  rmSync(journalPath, { force: true })
}

export function finalizePackageRollback({ programDirectory, dataDirectory }) {
  const program = resolve(programDirectory), data = resolve(dataDirectory)
  const journalPath = join(data, '.hromadaaid-update-state.json'), journal = readJournal(journalPath)
  if (journal.phase !== 'files-rolled-back') throw new Error('Попередній пакет не пройшов етап відновлення файлів.')
  rmSync(join(program, 'Server.failed'), { recursive: true, force: true })
  rmSync(journalPath, { force: true })
}

export function discardPreparedPackageUpdate({ programDirectory, dataDirectory }) {
  const active = join(resolve(programDirectory), 'Server'), previous = join(resolve(programDirectory), 'Server.previous')
  const journalPath = join(resolve(dataDirectory), '.hromadaaid-update-state.json'), journal = readJournal(journalPath)
  if (journal.phase !== 'prepared' || !existsSync(active) || existsSync(previous)) throw new Error('Журнал уже перейшов до перемикання; його не можна прибрати автоматично.')
  rmSync(journalPath, { force: true })
}

export function markInitialInstallNeedsReview(dataDirectory) {
  const path = join(resolve(dataDirectory), '.hromadaaid-update-state.json'), journal = readJournal(path)
  if (journal.hadPreviousPackage || existsSync(join(journal.programDirectory, 'Server.previous'))) throw new Error('Початкова інсталяція має збережений попередній пакет і потребує ручної перевірки.')
  journal.phase = 'initial-install-needs-review'; journal.updatedAt = new Date().toISOString(); writeJournal(path, journal)
}

function parseArguments(args) {
  const action = args.shift()
  const options = {}
  while (args.length) {
    const key = args.shift(), value = args.shift()
    if (!key?.startsWith('--') || value === undefined || Object.hasOwn(options, key)) throw new Error('Некоректні параметри процедури пакета сервера.')
    options[key] = value
  }
  return { action, options }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { action, options } = parseArguments(process.argv.slice(2))
    const programDirectory = options['--program-dir'], dataDirectory = options['--data-dir']
    if (!programDirectory || !dataDirectory) throw new Error('Не задано каталоги програми та серверних даних.')
    if (action === 'prepare') preparePackageUpdate({ programDirectory, dataDirectory, hadPreviousPackage: options['--had-previous'] === 'true', oldSchemaMaximum: options['--old-schema'] ?? '0', schemaBeforeActivation: options['--schema-before'] ?? '0', serviceWasRunning: options['--service-was-running'] === 'true' })
    else if (action === 'activate') activateServerPackage({ programDirectory, dataDirectory, initialRetry: options['--initial-retry'] === 'true' })
    else if (action === 'health-check') markPackageHealthCheck(dataDirectory)
    else if (action === 'healthy') markPackageHealthy(dataDirectory)
    else if (action === 'rollback') rollbackServerPackage({ programDirectory, dataDirectory, schemaVersion: options['--schema-version'] })
    else if (action === 'finalize') finalizePackageUpdate({ programDirectory, dataDirectory, initialRetry: options['--initial-retry'] === 'true' })
    else if (action === 'finalize-rollback') finalizePackageRollback({ programDirectory, dataDirectory })
    else if (action === 'discard-prepared') discardPreparedPackageUpdate({ programDirectory, dataDirectory })
    else if (action === 'initial-needs-review') markInitialInstallNeedsReview(dataDirectory)
    else throw new Error('Невідома операція пакета сервера.')
  } catch (error) {
    console.error('Операцію серверного пакета не виконано: ' + (error instanceof Error ? error.message : 'невідома помилка'))
    process.exitCode = 1
  }
}
