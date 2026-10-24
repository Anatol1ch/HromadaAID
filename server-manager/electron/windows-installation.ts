import { app } from 'electron'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, lstat, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, win32 } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import type { ServerInstallRequest } from './installation-contract.js'
import type { ServerInstallAdapters } from './installation-engine.js'
import { canResumeInitialInstallLayout, isInitialInstallRetryJournal } from './installation-recovery.js'
import { inspectEnvironment } from './inspection-engine.js'
import { createWindowsInspectionAdapters } from './windows-inspection.js'

type Emit = (message: string) => void

async function verifyPackageCopy(source: string, candidate: string): Promise<void> {
  const sourceManifest = await readFile(join(source, 'package-integrity.json'))
  const candidateManifest = await readFile(join(candidate, 'package-integrity.json'))
  if (!sourceManifest.equals(candidateManifest)) throw new Error('Незавершений Server.next відрізняється від комплектного серверного пакета; файли збережено для перевірки.')
  await verifyPackagedServer(source)
  await verifyPackagedServer(candidate)
  const manifest = JSON.parse(sourceManifest.toString('utf8')) as { files?: Array<{ path: string; sha256: string; sizeBytes: number }> }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) throw new Error('Маніфест комплектного серверного пакета порожній.')
  for (const file of manifest.files) {
    const expected = await readFile(join(source, ...file.path.split('/')))
    const actual = await readFile(join(candidate, ...file.path.split('/')))
    if (expected.length !== file.sizeBytes || createHash('sha256').update(expected).digest('hex') !== file.sha256 || !actual.equals(expected)) {
      throw new Error('Незавершений Server.next не збігається з перевіреним пакетом; його не перезаписано.')
    }
  }
}

async function verifyPackagedServer(root: string): Promise<void> {
  try {
    await callNode(root, [join(root, 'installer', 'verify-server-package.mjs'), root], join(root, 'app'), undefined, 120_000)
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'невідома помилка локального модуля'
    throw Object.assign(new Error(`Перевірка комплекту сервера не пройшла: ${detail}`), { code: 'SERVER_PACKAGE_INVALID' })
  }
}

function windowsRoot(): string { return process.env.SystemRoot || 'C:\\Windows' }
function powershell(): string { return join(windowsRoot(), 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') }
function shellCwd(): string { return join(windowsRoot(), 'System32') }
function payloadRoot(): string {
  if (process.platform !== 'win32') throw new Error('Встановлення сервера доступне лише у Windows.')
  return appResourcesServerRoot()
}
function appResourcesServerRoot(): string {
  // The packaged manager receives the server package as a read-only extraResource.
  // Development uses the same generated package as the existing Windows packager.
  if (app.isPackaged) return join(process.resourcesPath, 'server-payload')
  return resolve('release', 'installer-payload', 'Server')
}

function run(executable: string, args: string[], options: { cwd?: string; input?: Buffer; timeoutMs?: number; onStdout?: (chunk: string) => void } = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, args, { cwd: options.cwd ?? shellCwd(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = '', finished = false
    const timeout = setTimeout(() => { if (!finished) child.kill() }, options.timeoutMs ?? 180_000)
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk; options.onStdout?.(chunk); if (stdout.length > 256_000) child.kill() })
    child.stderr.on('data', chunk => { stderr += chunk; if (stderr.length > 256_000) child.kill() })
    child.once('error', error => { finished = true; clearTimeout(timeout); reject(error) })
    child.once('close', code => {
      finished = true; clearTimeout(timeout)
      if (code === 0) resolveResult({ stdout, stderr })
      else reject(Object.assign(new Error((stderr || stdout).trim() || `Допоміжний процес завершився з кодом ${code ?? 'невідомо'}.`), { code: 'CHILD_PROCESS_FAILED', exitCode: code, stdout, stderr }))
    })
    if (options.input) child.stdin.end(options.input)
    else child.stdin.end()
  })
}

function safeFailure(error: unknown, secretValues: string[] = []): string {
  let message = error instanceof Error ? error.message : 'Не вдалося виконати операцію.'
  for (const secret of secretValues) if (secret) message = message.split(secret).join('[приховано]')
  return message.replace(/(?:password|token|secret|recovery.?key|private.?key|dpapi.?key)(\s*[:=]\s*)[^\s,;]+/gi, '$1[приховано]').slice(0, 2_000)
}

async function writeSafeDiagnostic(name: string, error: unknown): Promise<string | null> {
  const failure = error as Error & { stdout?: string; stderr?: string; exitCode?: number | null }
  const text = [failure.stderr, failure.stdout, failure.message].filter(Boolean).join('\n')
    .replace(/(?:password|token|secret|recovery.?key|private.?key|dpapi.?key|bearer)(\s*[:=]\s*)[^\s,;]+/gi, '$1[приховано]')
    .slice(0, 12_000)
  const path = join(tmpdir(), `HromadaAID-ServerManager-${name}-${randomUUID()}.log`)
  try {
    await writeFile(path, `Етап: ${name}\r\nКод завершення: ${failure.exitCode ?? 'невідомий'}\r\n${text || 'Діагностика відсутня.'}\r\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    return path
  } catch { return null }
}

async function callNode(root: string, args: string[], cwd: string, input?: Buffer, timeoutMs?: number) {
  return run(join(root, 'runtime', 'node.exe'), args, { cwd, input, timeoutMs })
}

export function createWindowsInstallationAdapters(): ServerInstallAdapters {
  return {
    inspect: () => inspectEnvironment(createWindowsInspectionAdapters()),
    canResume: async request => {
      const current = await inspectEnvironment(createWindowsInspectionAdapters())
      if (current.installation.status !== 'partial_installation' || current.service.status !== 'missing' || current.discovery.source !== 'installer_registry' || current.discovery.confidence !== 'corroborated') return false
      const same = (left: string | null, right: string) => !!left && win32.resolve(left).toLocaleLowerCase('en-US') === win32.resolve(right).toLocaleLowerCase('en-US')
      if (!same(current.configuration.programDirectory, request.programDirectory) || !same(current.configuration.dataDirectory, request.dataDirectory) || !same(current.configuration.backupDirectory, request.backupDirectory)) return false
      if ((current.configuration.host !== null && current.configuration.host !== request.host) || (current.configuration.port !== null && current.configuration.port !== request.port)) return false
      const program = request.programDirectory
      const stage = join(program, 'Server.next')
      const active = join(program, 'Server'), previous = join(program, 'Server.previous'), failed = join(program, 'Server.failed')
      const [activeExists, previousExists, failedExists] = await Promise.all([active, previous, failed].map(path => lstat(path).then(info => info.isDirectory() && !info.isSymbolicLink(), () => false)))
      if (previousExists) return false
      const journalPath = join(request.dataDirectory, '.hromadaaid-update-state.json')
      let journal: unknown = null
      try { journal = JSON.parse(await readFile(journalPath, 'utf8')) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false }
      const retryJournal = journal === null ? false : isInitialInstallRetryJournal(journal, program)
      const stageExists = await lstat(stage).then(info => info.isDirectory() && !info.isSymbolicLink(), () => false)
      if (journal !== null && !retryJournal) return false
      if (!canResumeInitialInstallLayout({ retryJournal, stagedPackageExists: stageExists, activePackageExists: activeExists, previousPackageExists: previousExists, failedPackageExists: failedExists })) return false
      if (stageExists) await verifyPackageCopy(payloadRoot(), stage)
      if (activeExists) await verifyPackageCopy(payloadRoot(), active)
      if (failedExists) await verifyPackageCopy(payloadRoot(), failed)
      return true
    },
    preflight: async request => {
      const root = payloadRoot()
      const configModule = await import(pathToFileURL(join(root, 'installer', 'windows-installer-config.mjs')).href)
      configModule.validateInstallerOptions({ mode: 'server', programDirectory: request.programDirectory, dataDirectory: request.dataDirectory, backupDirectory: request.backupDirectory })
      await verifyPackagedServer(root)
      const integrity = JSON.parse(await readFile(join(root, 'package-integrity.json'), 'utf8')) as { files: Array<{ sizeBytes: number }> }
      if (!Array.isArray(integrity.files) || integrity.files.length < 1) throw new Error('Маніфест серверного пакета порожній або пошкоджений.')
      const serverBytes = integrity.files.reduce((total, file) => total + file.sizeBytes, 0) + (await stat(join(root, 'package-integrity.json'))).size
      const script = join(root, 'installer', 'windows-installer-paths.ps1')
      await run(powershell(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', script,
        '-Mode', 'server', '-ProgramDirectory', request.programDirectory, '-DataDirectory', request.dataDirectory, '-BackupDirectory', request.backupDirectory,
        '-ClientBytes', '0', '-ServerBytes', String(serverBytes), '-SupportBytes', '0'])
    },
    stagePackage: async request => {
      const root = payloadRoot()
      const stage = join(request.programDirectory, 'Server.next')
      await mkdir(dirname(stage), { recursive: true })
      if (await stat(stage).then(() => true, () => false)) {
        await verifyPackageCopy(root, stage)
        return
      }
      await verifyPackagedServer(root)
      await cp(root, stage, { recursive: true, errorOnExist: true, force: false })
      await verifyPackageCopy(root, stage)
    },
    prepareConfiguration: async request => {
      const root = join(request.programDirectory, 'Server.next')
      await callNode(root, [join(root, 'installer', 'prepare-server-install.mjs'), '--program-dir', request.programDirectory, '--data-dir', request.dataDirectory, '--backup-dir', request.backupDirectory, '--package-root', root, '--host', request.host, '--port', String(request.port)], join(root, 'app'))
    },
    recordLocator: async request => {
      const script = join(payloadRoot(), 'installer', 'write-installation-locator.ps1')
      try {
        await run(powershell(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', script,
          '-ProgramDirectory', request.programDirectory, '-DataDirectory', request.dataDirectory, '-BackupDirectory', request.backupDirectory])
      } catch (error) {
        const diagnostic = await writeSafeDiagnostic('installation-locator', error)
        throw Object.assign(new Error(`Не вдалося записати метадані розташування сервера. Перевірте права адміністратора.${diagnostic ? ` Технічні подробиці: ${diagnostic}` : ''}`), { code: 'INSTALLATION_METADATA_WRITE_FAILED' })
      }
    },
    initialize: async (request, onRecoveryKey, report) => {
      const root = join(request.programDirectory, 'Server.next')
      const config = join(request.dataDirectory, 'server.json')
      await new Promise<void>((resolveResult, reject) => {
        const child = spawn(join(root, 'runtime', 'node.exe'), [join(root, 'app', 'dist', 'server', 'src', 'installer-initialization.js'), '--config', config, '--confirm-initialization', '--manager-recovery-stdin'], {
          cwd: join(root, 'app'), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
        })
        let stdout = '', stderr = '', pending = '', settled = false
        const timeout = setTimeout(() => child.kill(), 120_000)
        child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
        child.stderr.on('data', chunk => { stderr += chunk })
        child.stdout.on('data', chunk => {
          pending += chunk
          const lines = pending.split(/\r?\n/); pending = lines.pop() ?? ''
          for (const line of lines) {
            if (line.startsWith('HROMADAAID_RECOVERY_KEY|')) {
              const key = line.slice('HROMADAAID_RECOVERY_KEY|'.length)
              void onRecoveryKey(key).then(saved => { child.stdin.end(saved ? 'saved\n' : 'cancel\n') }, () => child.stdin.end('cancel\n'))
            } else if (line) { stdout += `${line}\n`; report('Перевіряємо DPAPI-ключ і цілісність SQLite.') }
          }
        })
        child.once('error', error => { settled = true; clearTimeout(timeout); reject(error) })
        child.once('close', code => {
          if (settled) return
          settled = true; clearTimeout(timeout)
          if (code === 0) resolveResult()
          else reject(new Error(safeFailure(new Error(stderr || stdout || `Ініціалізація завершилася з кодом ${code ?? 'невідомо'}.`), [request.administrator.password, request.administrator.confirmation])))
        })
      })
    },
    databaseStatus: async request => {
      const root = join(request.programDirectory, 'Server.next')
      const db = join(request.dataDirectory, 'Database', 'hromada-aid.sqlite')
      const { stdout } = await callNode(root, [join(root, 'app', 'dist', 'server', 'src', 'create-admin.js'), '--database', db, '--status'], join(root, 'app'))
      const result = JSON.parse(stdout.trim()) as { users?: unknown }
      if (result.users !== 0 && result.users !== 'present') throw new Error('Стан облікових записів має неочікуваний формат.')
      return { users: result.users }
    },
    hasPendingAdminMarker: async request => {
      const path = join(request.dataDirectory, '.hromadaaid-first-admin-pending.json')
      try {
        const marker = JSON.parse(await readFile(path, 'utf8')) as { formatVersion?: unknown; databasePath?: unknown }
        const expected = join(request.dataDirectory, 'Database', 'hromada-aid.sqlite')
        return marker.formatVersion === 1 && typeof marker.databasePath === 'string' && resolve(marker.databasePath).toLocaleLowerCase('en-US') === resolve(expected).toLocaleLowerCase('en-US')
      } catch { return false }
    },
    createAdministrator: async request => {
      const root = join(request.programDirectory, 'Server.next')
      const database = join(request.dataDirectory, 'Database', 'hromada-aid.sqlite')
      let serialized = JSON.stringify({ displayName: request.administrator.displayName, username: request.administrator.username, password: request.administrator.password, confirmation: request.administrator.confirmation }) + '\n'
      const input = Buffer.from(serialized, 'utf8'); serialized = ''
      try {
        const result = await callNode(root, [join(root, 'app', 'dist', 'server', 'src', 'create-admin.js'), '--database', database, '--installer-stdin'], join(root, 'app'), input)
        if (!result.stdout.includes('admin-created')) throw new Error('Серверна команда не підтвердила створення адміністратора.')
      } catch (error) { throw new Error(safeFailure(error, [request.administrator.password, request.administrator.confirmation])) }
      finally { input.fill(0); request.administrator.password = ''; request.administrator.confirmation = '' }
    },
    installService: async (request, report) => {
      const root = join(request.programDirectory, 'Server.next')
      try {
        let pending = ''
        const stageNames: Record<string, string> = {
          'validate-inputs': 'Перевірка прав і каталогів', 'verify-package': 'Перевірка цілісності серверного пакета',
          'validate-resume-state': 'Перевірка незавершеного встановлення', 'validate-configuration-and-existing-data': 'Перевірка конфігурації та наявних даних',
          'validate-server-preflight': 'Перевірка параметрів сервера', 'configure-acl': 'Налаштування доступу для служби',
          'initialize-data': 'Перевірка SQLite та DPAPI', 'inspect-database-and-create-admin': 'Перевірка першого адміністратора',
          'prepare-package-journal': 'Підготовка перемикання пакета', 'activate-server-package': 'Активація серверного пакета',
          'register-service-and-sid': 'Реєстрація Windows Service', 'grant-service-acl': 'Надання службі доступу до ресурсів',
          'verify-service-acl': 'Перевірка прав доступу служби',
          'start-service': 'Запуск Windows Service', 'health-check': 'Перевірка доступності API', 'finalize-update': 'Завершення встановлення',
        }
        await run(powershell(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'installer', 'install-server-service.ps1'),
          '-ProgramDirectory', request.programDirectory, '-DataDirectory', request.dataDirectory, '-BackupDirectory', request.backupDirectory, '-FromServerManager'], {
          timeoutMs: 240_000,
          onStdout: chunk => {
            pending += chunk
            const lines = pending.split(/\r?\n/); pending = lines.pop() ?? ''
            for (const line of lines) {
              if (line.startsWith('HROMADAAID_INSTALL_STAGE|')) {
                const stage = line.slice('HROMADAAID_INSTALL_STAGE|'.length)
                if (stageNames[stage]) report(stageNames[stage] + '.')
              }
            }
          },
        })
      } catch (error) {
        const failure = error as Error & { stdout?: string; stderr?: string }
        const text = `${failure.stdout ?? ''}\n${failure.stderr ?? ''}`
        const line = text.split(/\r?\n/).find(value => value.startsWith('SERVICE_INSTALL_ERROR|'))
        if (line) {
          const stage = /(?:^|\|)stage=([^|]+)/.exec(line)?.[1] ?? 'невідомий'
          const message = /(?:^|\|)message=([^|]+)/.exec(line)?.[1]
          throw new Error(`Не вдалося налаштувати Windows Service (етап ${stage}). ${message ?? 'Перевірте діагностичний файл у %TEMP%.'}`)
        }
        throw new Error(safeFailure(error))
      }
      const locatorScript = join(root, 'installer', 'write-installation-locator.ps1')
      // SCM, WinSW and the API have already passed the service installer health check.
      // A locator write failure does not undo a working installation; SCM discovery remains available.
      await run(powershell(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', locatorScript,
        '-ProgramDirectory', request.programDirectory, '-DataDirectory', request.dataDirectory, '-BackupDirectory', request.backupDirectory]).catch(() => report('Сервер працює, але метадані каталогу не записано; шлях доступний через Windows Service.'))
    },
  }
}
