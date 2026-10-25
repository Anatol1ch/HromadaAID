import { spawn } from 'node:child_process'
import { cp, lstat, mkdir, readFile, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { inspectEnvironment } from './inspection-engine.js'
import { createWindowsInspectionAdapters } from './windows-inspection.js'
import type { ServerUpdateAdapters } from './server-update.js'
import type { ServerUpdateStage } from './server-update-contract.js'
import { verifyUpdatePackage, readInstalledPackageIdentity } from './server-update.js'

const extractionScript = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
function Test-HromadaZipCompressionRatio([long]$Length, [long]$CompressedLength) {
  if ($Length -le 1048576) { return $true }
  if ($CompressedLength -le 0) { return $false }
  [long]$remainder = 0
  [long]$minimumCompressedLength = [Math]::DivRem($Length, [long]1000, [ref]$remainder)
  if ($remainder -gt 0) { $minimumCompressedLength++ }
  return $CompressedLength -ge $minimumCompressedLength
}
try {
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archivePath = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__ARCHIVE__'))
$destination = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__DESTINATION__'))
if (-not [IO.File]::Exists($archivePath)) { throw 'ZIP-файл не знайдено.' }
if ((Get-Item -LiteralPath $archivePath).Length -gt 1073741824) { throw 'ZIP-файл перевищує дозволений розмір 1 ГБ.' }
if ([IO.Directory]::Exists($destination) -or [IO.File]::Exists($destination)) { throw 'Каталог тимчасового розпакування вже існує.' }
[void][IO.Directory]::CreateDirectory($destination)
$root = [IO.Path]::GetFullPath($destination).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
  if ($archive.Entries.Count -lt 1 -or $archive.Entries.Count -gt 20000) { throw 'ZIP має неочікувану кількість елементів.' }
  $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  [long]$total = 0
  foreach ($entry in $archive.Entries) {
    $name = [string]$entry.FullName
    $isDirectory = $name.EndsWith('/')
    $pathName = if ($isDirectory) { $name.Substring(0, $name.Length - 1) } else { $name }
    if (-not $pathName -or $pathName.Contains([char]92) -or $pathName.StartsWith('/') -or $pathName.Contains(':') -or $pathName.Contains([char]0) -or $pathName.Length -gt 240) { throw 'ZIP містить абсолютний або некоректний шлях.' }
    $parts = $pathName.Split('/')
    foreach ($part in $parts) {
      if (-not $part -or $part -eq '.' -or $part -eq '..' -or $part -match '[. ]$' -or $part -match '^(?i:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)') { throw 'ZIP містить небезпечний або несумісний шлях.' }
    }
    if (-not $seen.Add($pathName)) { throw 'ZIP містить повторні шляхи.' }
    $unixType = ([int]$entry.ExternalAttributes -shr 16) -band 0xF000
    if (($entry.ExternalAttributes -band [int][IO.FileAttributes]::ReparsePoint) -ne 0 -or ($unixType -ne 0 -and $unixType -notin @(0x8000, 0x4000))) { throw 'ZIP містить посилання або спеціальну файлову сутність.' }
    if ($entry.Length -gt 536870912) { throw 'Один елемент ZIP перевищує дозволений розмір.' }
    $total += $entry.Length
    if ($total -gt 2147483648) { throw 'Розпакований ZIP перевищує дозволений розмір 2 ГБ.' }
    if (-not (Test-HromadaZipCompressionRatio ([long]$entry.Length) ([long]$entry.CompressedLength))) { throw 'ZIP має небезпечний коефіцієнт стиснення.' }
    $target = [IO.Path]::GetFullPath([IO.Path]::Combine($destination, ($pathName -replace '/', [IO.Path]::DirectorySeparatorChar)))
    if (-not $target.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { throw 'Шлях ZIP виходить за межі каталогу розпакування.' }
    if ($target.Length -gt 240) { throw 'Шлях елемента ZIP надто довгий для сумісного розпакування.' }
    if ($isDirectory) { [void][IO.Directory]::CreateDirectory($target); continue }
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))
    $input = $entry.Open()
    try {
      $output = [IO.FileStream]::new($target, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
      try { $input.CopyTo($output) } finally { $output.Dispose() }
    } finally { $input.Dispose() }
    if ((Get-Item -LiteralPath $target).Length -ne $entry.Length) { throw 'Розмір розпакованого елемента не збігається.' }
  }
} finally { $archive.Dispose() }
} catch {
  $message = [string]$_.Exception.Message
  $message = $message -replace '[\r\n|]+', ' '
  $message = $message -replace '(?i)(password|token|secret|recovery.?key|private.?key|dpapi.?key|bearer)(\s*[:=]\s*)[^\s,;]+', '$1$2[redacted]'
  if ($message.Length -gt 1000) { $message = $message.Substring(0, 1000) }
  $encodedMessage = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($message))
  [Console]::Out.WriteLine('HROMADAAID_ZIP_ERROR|' + $encodedMessage)
  exit 1
}
`

function psBase64(text: string): string { return Buffer.from(text, 'utf8').toString('base64') }
function powershell(): string { return join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') }
async function run(executable: string, args: string[], cwd: string, timeoutMs = 180_000, onStdout?: (chunk: string) => void): Promise<{ stdout: string; stderr: string }> {
  try {
    if (!(await stat(cwd)).isDirectory()) throw new Error('not a directory')
  } catch {
    throw Object.assign(new Error(`Робочий каталог допоміжного процесу недоступний: ${cwd}`), { code: 'UPDATE_WORKING_DIRECTORY_UNAVAILABLE' })
  }
  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = '', settled = false
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk; onStdout?.(chunk); if (stdout.length > 256_000) child.kill() })
    child.stderr.on('data', chunk => { stderr += chunk; if (stderr.length > 256_000) child.kill() })
    child.once('error', error => {
      settled = true; clearTimeout(timer)
      const code = (error as NodeJS.ErrnoException).code
      reject(Object.assign(new Error(code === 'ENOENT'
        ? `Не вдалося запустити допоміжний процес. Перевірте PowerShell і робочий каталог: ${cwd}`
        : `Не вдалося запустити допоміжний процес із робочого каталогу: ${cwd}`), { code: 'UPDATE_CHILD_PROCESS_START_FAILED', cause: error, executable, cwd }))
    })
    child.once('close', code => {
      if (settled) return
      settled = true; clearTimeout(timer)
      if (code === 0) resolveResult({ stdout, stderr })
      else reject(Object.assign(new Error((stderr || stdout).trim().slice(0, 2_000) || `PowerShell завершився з кодом ${code ?? 'невідомо'}.`), { code: 'ZIP_EXTRACTION_FAILED', exitCode: code, stdout, stderr }))
    })
  })
}

export function buildSafeZipExtractionCommand(archivePath: string, destination: string): string {
  return extractionScript.replace('__ARCHIVE__', psBase64(archivePath)).replace('__DESTINATION__', psBase64(destination))
}

export function buildZipCompressionRatioProbeCommand(length: string, compressedLength: string): string {
  const maxInt64 = 9_223_372_036_854_775_807n
  for (const value of [length, compressedLength]) if (!/^(0|[1-9]\d*)$/.test(value) || BigInt(value) > maxInt64) throw new Error('Invalid ZIP length probe.')
  const functionSource = `${extractionScript.slice(extractionScript.indexOf('function Test-HromadaZipCompressionRatio'), extractionScript.indexOf('}\ntry {'))}}`
  return `${functionSource}\nif (Test-HromadaZipCompressionRatio ([long]${length}) ([long]${compressedLength})) { exit 0 } else { exit 1 }`
}

export function normalizePowerShellDiagnostic(value: string): string {
  const input = value.trim()
  if (!input.includes('#< CLIXML')) return input
  const decoded = [...input.matchAll(/<S\s+S="Error">([\s\S]*?)<\/S>/g)].map(match => match[1]
    .replace(/&#x([0-9a-f]+);/gi, (_entity, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_entity, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'))
  return decoded.join('\n').trim().replace(/(password|token|secret|recovery.?key|private.?key|dpapi.?key|bearer)(\s*[:=]\s*)[^\s,;]+/gi, '$1$2[redacted]')
}

export function createWindowsServerUpdateAdapters(options: { installerScriptPath?: string } = {}): ServerUpdateAdapters {
  return {
    inspect: () => inspectEnvironment(createWindowsInspectionAdapters()),
    extract: async (zipPath, destination) => {
      const info = await stat(zipPath)
      if (!info.isFile() || info.size < 1) throw Object.assign(new Error('ZIP-файл порожній або недоступний.'), { code: 'UPDATE_ARCHIVE_INVALID' })
      const workingDirectory = dirname(destination)
      try { await mkdir(workingDirectory, { recursive: true }) }
      catch (error) { throw Object.assign(new Error(`Не вдалося підготувати тимчасовий каталог розпакування: ${workingDirectory}`), { code: 'UPDATE_WORKING_DIRECTORY_UNAVAILABLE', cause: error }) }
      try {
        await run(powershell(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(buildSafeZipExtractionCommand(zipPath, destination), 'utf16le').toString('base64')], workingDirectory)
      } catch (error) {
        const failure = error as Error & { stdout?: string; stderr?: string; exitCode?: number }
        const marker = /^HROMADAAID_ZIP_ERROR\|([A-Za-z0-9+/=]+)$/m.exec(failure.stdout ?? '')?.[1]
        const diagnostic = marker ? Buffer.from(marker, 'base64').toString('utf8') : normalizePowerShellDiagnostic(failure.stderr ?? '')
        const details = `Код завершення PowerShell: ${failure.exitCode ?? 'невідомо'}\n${diagnostic || 'PowerShell не повернув тексту помилки.'}`.slice(0, 2_000)
        throw Object.assign(new Error('Не вдалося перевірити або безпечно розпакувати ZIP-пакет.'), { code: 'ZIP_EXTRACTION_FAILED', exitCode: failure.exitCode, details })
      }
    },
    readCurrentSchema: async environment => {
      const root = join(environment.programDirectory, 'Server')
      const node = join(root, 'runtime', 'node.exe')
      const cli = join(root, 'app', 'dist', 'server', 'src', 'create-admin.js')
      const database = environment.databasePath
      const result = await run(node, [cli, '--database', database, '--status'], join(root, 'app'), 30_000)
      const status = JSON.parse(result.stdout.trim()) as { schemaVersion?: unknown }
      if (!Number.isInteger(status.schemaVersion) || Number(status.schemaVersion) < 1) throw Object.assign(new Error('Не вдалося визначити версію наявної SQLite у режимі лише читання.'), { code: 'DATABASE_STATUS_INVALID' })
      return Number(status.schemaVersion)
    },
    readInstalledApiContract: async programDirectory => {
      const source = await readFile(join(programDirectory, 'Server', 'app', 'dist', 'shared', 'api-compatibility.js'), 'utf8')
      const match = /HROMADAAID_API_CONTRACT_VERSION\s*=\s*(\d+)/.exec(source)
      if (!match) throw Object.assign(new Error('Не знайдено версію API-контракту в установленому пакеті.'), { code: 'API_CONTRACT_UNKNOWN' })
      return Number(match[1])
    },
    readActivePackageIdentity: async environment => {
      const root = join(environment.programDirectory, 'Server')
      // Reuse the installed verifier to hash-check all declared program files;
      // generated WinSW XML is intentionally outside the archive manifests.
      const script = `import {join} from 'node:path';import {pathToFileURL} from 'node:url';const root=process.argv[1];const {verifyServerPackage}=await import(pathToFileURL(join(root,'installer/verify-server-package.mjs')).href);await verifyServerPackage(root);console.log('PACKAGE_VERIFIED');`
      const result = await run(join(root, 'runtime', 'node.exe'), ['--input-type=module', '--eval', script, root], join(root, 'app'), 120_000)
      if (result.stdout.trim() !== 'PACKAGE_VERIFIED') throw new Error('Не вдалося підтвердити цілісність установленого пакета сервера.')
      return readInstalledPackageIdentity(root)
    },
    prepare: async (environment, extractedPackage) => {
      const verified = await verifyUpdatePackage(extractedPackage)
      const activeStage = join(environment.programDirectory, 'Server.next')
      await mkdir(dirname(activeStage), { recursive: true })
      if (await lstat(activeStage).then(() => true, () => false)) throw Object.assign(new Error('Server.next уже існує; файли не перезаписано.'), { code: 'UPDATE_STAGE_EXISTS' })
      await cp(extractedPackage, activeStage, { recursive: true, errorOnExist: true, force: false })
      try {
        const copied = await verifyUpdatePackage(activeStage)
        if (copied.version !== verified.version) throw new Error('Версія після копіювання не збігається.')
        const config = JSON.parse(await readFile(join(environment.dataDirectory, 'server.json'), 'utf8')) as { programDirectory?: unknown }
        if (typeof config.programDirectory !== 'string' || resolve(config.programDirectory).toLocaleLowerCase('en-US') !== resolve(environment.programDirectory).toLocaleLowerCase('en-US')) throw new Error('Наявна конфігурація сервера несумісна; конфігурацію не змінено.')
        // Existing server.json is authoritative. Do not pass its host or port
        // through first-install loopback validation; prepare-server-install
        // preserves the existing config and uses these options only for a new one.
        const script = `import {createHash} from 'node:crypto';import {readFile} from 'node:fs/promises';import {join} from 'node:path';import {pathToFileURL} from 'node:url';const [root,programDirectory,dataDirectory,backupDirectory]=process.argv.slice(1);const options={mode:'server',programDirectory,dataDirectory,backupDirectory,packageRoot:root};const {prepareServerInstall}=await import(pathToFileURL(join(root,'installer/prepare-server-install.mjs')).href);const {renderWinSWConfig}=await import(pathToFileURL(join(root,'installer/windows-installer-config.mjs')).href);prepareServerInstall(options,root);const xml=renderWinSWConfig(await readFile(join(root,'service/HromadaAIDService.xml.template'),'utf8'),options);console.log(createHash('sha256').update(xml,'utf8').digest('hex'));`
        const result = await run(join(activeStage, 'runtime', 'node.exe'), ['--input-type=module', '--eval', script, activeStage, environment.programDirectory, environment.dataDirectory, environment.backupDirectory], join(activeStage, 'app'))
        await verifyUpdatePackage(activeStage, { serviceXmlSha256: result.stdout.trim() })
      } catch (error) {
        // Keep a failed/stale stage intact for inspection; never recursively clean a Program Files path.
        throw error
      }
    },
    runInstaller: async (environment, report) => {
      // Orchestration belongs to this Manager release, not to a possibly older
      // ZIP whose installer may predate UpdateOnly and live-service preflight.
      const script = options.installerScriptPath ?? resolve('packaging', 'install-server-service.ps1')
      let pending = ''
      try {
        await run(powershell(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', script,
          '-ProgramDirectory', environment.programDirectory, '-DataDirectory', environment.dataDirectory, '-BackupDirectory', environment.backupDirectory, '-FromServerManager', '-UpdateOnly'], join(process.env.SystemRoot || 'C:\\Windows', 'System32'), 300_000, chunk => {
          pending += chunk
          const lines = pending.split(/\r?\n/); pending = lines.pop() ?? ''
          for (const line of lines) {
            const match = /^HROMADAAID_INSTALL_STAGE\|(.+)$/.exec(line)
            if (match) report(mapInstallStage(match[1]), installStageLabel(match[1]))
          }
        })
      } catch (error) {
        const failure = error as Error & { stdout?: string; stderr?: string }
        const text = `${failure.stdout ?? ''}\n${failure.stderr ?? ''}`
        for (const line of text.split(/\r?\n/)) {
          const match = /^HROMADAAID_INSTALL_STAGE\|(.+)$/.exec(line)
          if (match) report(mapInstallStage(match[1]), installStageLabel(match[1]))
        }
        const errorLine = text.split(/\r?\n/).find(line => line.startsWith('SERVICE_INSTALL_ERROR|'))
        if (errorLine) {
          const stage = /(?:^|\|)stage=([^|]+)/.exec(errorLine)?.[1] ?? 'невідомий'
          const message = /(?:^|\|)message=([^|]+)/.exec(errorLine)?.[1] ?? 'Перегляньте журнал у %TEMP%.'
          const outcome = text.split(/\r?\n/).find(line => /Попередній серверний пакет відновлено|потрібне адміністративне відновлення/i.test(line))
          throw Object.assign(new Error(`Етап ${stage}: ${message}${outcome ? `; ${outcome.slice(0, 1_500)}` : ''}`), { code: 'SERVICE_INSTALL_FAILED', rollbackConfirmed: /^HROMADAAID_UPDATE_OUTCOME\|rolled-back\r?$/m.test(text), preservedBeforeSwitch: /^HROMADAAID_UPDATE_OUTCOME\|preserved-before-switch\r?$/m.test(text) })
        }
        throw error
      }
    },
    cleanup: async path => { await rm(path, { recursive: true, force: true }) },
    pathExists: async path => {
      try { await lstat(path); return true }
      catch (error) { if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return false; throw error }
    },
    nowId: randomUUID,
  }
}

function mapInstallStage(stage: string): ServerUpdateStage {
  if (stage === 'activate-server-package' || stage === 'prepare-package-journal') return 'switch'
  if (stage === 'start-service' || stage === 'register-service-and-sid') return 'start'
  if (stage === 'health-check') return 'health'
  if (stage === 'validate-inputs' || stage === 'verify-package' || stage === 'validate-configuration-and-existing-data' || stage === 'validate-server-preflight' || stage === 'inspect-database-and-create-admin') return 'compatibility'
  if (stage === 'configure-acl' || stage === 'initialize-data') return 'prepare'
  if (stage === 'stop-service') return 'stop'
  return 'switch'
}
function installStageLabel(stage: string): string {
  const labels: Record<string, string> = {
    'validate-inputs': 'Перевірка каталогів і прав.', 'verify-package': 'Перевірка цілісності пакета.',
    'validate-configuration-and-existing-data': 'Перевірка конфігурації та наявних даних.', 'validate-server-preflight': 'Перевірка конфігурації сервера.',
    'inspect-database-and-create-admin': 'Перевірка сумісності SQLite без зміни облікових записів.', 'configure-acl': 'Перевірка доступу служби.',
    'prepare-package-journal': 'Підготовка транзакції оновлення.', 'stop-service': 'Штатна зупинка служби.',
    'activate-server-package': 'Перемикання Server.next та Server.', 'register-service-and-sid': 'Реєстрація служби з WinSW.',
    'grant-service-acl': 'Налаштування доступу служби.', 'verify-service-acl': 'Перевірка доступу служби.',
    'start-service': 'Запуск оновленої служби.', 'health-check': 'Перевірка API.', 'finalize-update': 'Фіксація перевіреного оновлення.',
  }
  return labels[stage] ?? 'Виконується контрольований етап оновлення.'
}
