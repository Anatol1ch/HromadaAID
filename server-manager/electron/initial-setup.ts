import { lstat, readFile, readdir } from 'node:fs/promises'
import { dirname, join, win32 } from 'node:path'
import type { InspectionSnapshot } from './inspection-types.js'
import type { ServerInstallRequest } from './installation-contract.js'
import { inspectionDiagnostic } from './inspection-engine.js'
import { canResumeInitialInstallLayout, isInitialInstallRetryJournal } from './installation-recovery.js'

export function isInitialSetupCandidate(snapshot: InspectionSnapshot): boolean {
  const config = snapshot.configuration
  return snapshot.installation.status === 'partial_installation' && snapshot.service.status === 'missing' &&
    ['installer_registry', 'standard_locations'].includes(snapshot.discovery.source) && snapshot.discovery.confidence === 'corroborated' &&
    !!config.programDirectory && !!config.dataDirectory && !!config.backupDirectory && !!config.serverVersion &&
    snapshot.checks.find(item => item.id === 'package')?.status === 'passed'
}

function missing(error: unknown): boolean { return ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '') }
async function directoryExists(path: string): Promise<boolean> {
  try {
    const info = await lstat(path)
    if (info.isSymbolicLink() || !info.isDirectory()) throw Object.assign(new Error('Небезпечний або некоректний каталог інсталяції.'), { code: 'INSTALL_DIRECTORY_INVALID', path })
    return true
  } catch (error) { if (missing(error)) return false; throw error }
}

async function requireEmptyOrMissingDirectory(path: string): Promise<void> {
  try {
    const info = await lstat(path)
    if (info.isSymbolicLink() || !info.isDirectory()) throw Object.assign(new Error('Небезпечний або некоректний каталог інсталяції.'), { code: 'INSTALL_DIRECTORY_INVALID', path })
    if ((await readdir(path)).length) throw Object.assign(new Error('Вибраний каталог уже містить вміст; наявні дані не змінено.'), { code: 'INSTALL_DIRECTORY_NOT_EMPTY', path })
  } catch (error) { if (!missing(error)) throw error }
}

/** The same revalidation runs before showing the wizard and immediately before installation. */
export async function verifyInitialInstallCandidate(request: ServerInstallRequest, adapters: {
  inspect(): Promise<InspectionSnapshot>
  payloadRoot(): string
  verifyPackageCopy(source: string, candidate: string): Promise<void>
}): Promise<boolean> {
  const current = await adapters.inspect()
  if (!isInitialSetupCandidate(current)) return false
  const same = (left: string | null, right: string) => !!left && win32.resolve(left).toLowerCase() === win32.resolve(right).toLowerCase()
  // The NSIS locator records default data/backup paths before the Manager
  // wizard lets the administrator choose custom locations. Only the program
  // path owns the staged package; data locations may change while no install
  // has been initialized, provided both old and selected targets are empty.
  if (!same(current.configuration.programDirectory, request.programDirectory)) return false
  if ((current.configuration.host !== null && current.configuration.host !== request.host) || (current.configuration.port !== null && current.configuration.port !== request.port)) return false
  // Missing data/backup directories are normal before first setup; errors and links are not.
  for (const path of [request.programDirectory, request.dataDirectory, request.backupDirectory]) {
    for (let parent = path; dirname(parent) !== parent; parent = dirname(parent)) await directoryExists(parent)
  }
  const dataPaths = new Set([current.configuration.dataDirectory, request.dataDirectory].filter((path): path is string => !!path))
  const backupPaths = new Set([current.configuration.backupDirectory, request.backupDirectory].filter((path): path is string => !!path))
  for (const path of [...dataPaths, ...backupPaths]) await requireEmptyOrMissingDirectory(path)
  const program = request.programDirectory
  const stage = join(program, 'Server.next')
  const active = join(program, 'Server'), previous = join(program, 'Server.previous'), failed = join(program, 'Server.failed')
  const [activeExists, previousExists, failedExists, stageExists] = await Promise.all([active, previous, failed, stage].map(directoryExists))
  if (previousExists) return false
  const journalPath = join(request.dataDirectory, '.hromadaaid-update-state.json')
  let journal: unknown = null
  try {
    const info = await lstat(journalPath)
    if (info.isSymbolicLink() || !info.isFile() || info.size > 256 * 1024) return false
    journal = JSON.parse(await readFile(journalPath, 'utf8'))
  } catch (error) { if (!missing(error)) throw error }
  const retryJournal = journal !== null && isInitialInstallRetryJournal(journal, program)
  if (journal !== null && !retryJournal) return false
  if (!canResumeInitialInstallLayout({ retryJournal, stagedPackageExists: stageExists, activePackageExists: activeExists, previousPackageExists: previousExists, failedPackageExists: failedExists })) return false
  if (stageExists) await adapters.verifyPackageCopy(adapters.payloadRoot(), stage)
  if (activeExists) await adapters.verifyPackageCopy(adapters.payloadRoot(), active)
  if (failedExists) await adapters.verifyPackageCopy(adapters.payloadRoot(), failed)
  return true
}

export async function markInitialSetupReadiness(snapshot: InspectionSnapshot, verify: (request: ServerInstallRequest) => Promise<boolean>): Promise<void> {
  if (!isInitialSetupCandidate(snapshot) || snapshot.checks.find(item => item.id === 'configuration')?.details !== 'config_missing') return
  const config = snapshot.configuration
  const check = snapshot.checks.find(item => item.id === 'installation')
  try {
    const verified = await verify({
      programDirectory: config.programDirectory!, dataDirectory: config.dataDirectory!, backupDirectory: config.backupDirectory!,
      host: config.host === '::1' ? '::1' : '127.0.0.1', port: config.port ?? 4310,
      administrator: { displayName: '', username: '', password: '', confirmation: '' },
    })
    if (verified) {
      snapshot.installation = { status: 'ready_to_configure', message: 'Сервер готовий до початкового налаштування.' }
      if (check) { check.status = 'warning'; check.message = snapshot.installation.message }
    } else if (check) {
      check.message = 'Пакет виявлено, але стан каталогів або транзакції не дозволяє безпечне початкове налаштування.'
    }
  } catch (error) {
    const failure = error as NodeJS.ErrnoException
    const access = failure.code === 'EACCES' || failure.code === 'EPERM'
    const systemFailure = access || (!!failure.code && !['SERVER_PACKAGE_INVALID', 'ENOENT', 'ENOTDIR', 'INSTALL_DIRECTORY_INVALID'].includes(failure.code))
    snapshot.installation = { status: systemFailure ? 'unknown' : 'partial_installation', message: access ? 'Немає доступу для перевірки підготовленого пакета.' : 'Підготовлений пакет або стан інсталяції не пройшов перевірку. Перегляньте діагностику.' }
    if (check) {
      check.status = 'failed'; check.message = snapshot.installation.message
      check.diagnostics = [...(check.diagnostics ?? []), inspectionDiagnostic('package.verify', failure.path ?? join(config.programDirectory!, 'Server.next'), error)]
    }
  }
}
