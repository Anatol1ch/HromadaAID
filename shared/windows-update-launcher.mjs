import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, openSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve, win32 } from 'node:path'

export function windowsPowerShellPath(systemRoot = process.env.SystemRoot) {
  if (!systemRoot || !win32.isAbsolute(systemRoot)) throw new Error('Не визначено системний каталог Windows PowerShell.')
  return win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

// Start-Process takes a command line, not an argv array. Apply Windows argv quoting.
export function quoteWindowsArgument(value) {
  return '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1') + '"'
}

export const bootstrapScript = `param([Parameter(Mandatory=$true)][string]$ConfigPath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$result = @{ status = 'error'; bootstrapProcessId = $PID; launcherProcessId = $null; exitCode = $null }
try {
  $process = Start-Process -FilePath $config.executable -ArgumentList $config.argumentLine -WorkingDirectory $config.cwd -WindowStyle Hidden -RedirectStandardOutput $config.stdoutPath -RedirectStandardError $config.stderrPath -PassThru
  $null = $process.Handle
  $result.launcherProcessId = $process.Id
  $deadline = [DateTime]::UtcNow.AddMilliseconds($config.readyTimeoutMs)
  do {
    $process.Refresh()
    if ($process.HasExited) {
      $process.WaitForExit()
      $result.status = 'exited-before-ready'
      $result.exitCode = $process.ExitCode
      break
    }
    if (Test-Path -LiteralPath $config.readyPath -PathType Leaf) {
      $ready = Get-Content -LiteralPath $config.readyPath -Raw | ConvertFrom-Json
      if ($ready.launcherProcessId -eq $process.Id) { $result.status = 'ready'; break }
    }
    Start-Sleep -Milliseconds 50
  } while ([DateTime]::UtcNow -lt $deadline)
  if ($result.status -eq 'error') { $result.status = 'readiness-timeout' }
} catch {
  $result.error = $_.Exception.Message
  [Console]::Error.WriteLine($_.Exception.ToString())
} finally {
  [IO.File]::WriteAllText($config.resultPath, ($result | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
}
if ($result.status -ne 'ready') { exit 1 }
`

export async function launchUpdatePowerShell(options) {
  const { updateDirectory, launcherPath, launcherArguments, logEvent, spawnProcess = spawn, readyTimeoutMs = 15000 } = options
  const executable = windowsPowerShellPath()
  // Never retain a working-directory handle inside a component being replaced.
  const workingDirectory = resolve(updateDirectory)
  const directory = join(updateDirectory, `launcher-${randomUUID()}`)
  await mkdir(directory, { recursive: true })
  const paths = Object.fromEntries(['stdout', 'stderr', 'bootstrap.stdout', 'bootstrap.stderr'].map(name => [name, join(directory, `${name}.log`)]))
  const readyPath = join(directory, 'ready.json'), resultPath = join(directory, 'result.json'), handoffPath = join(directory, 'handoff.confirmed')
  const scriptPath = join(directory, 'bootstrap.ps1'), configPath = join(directory, 'config.json')
  const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', launcherPath, ...launcherArguments, '-ReadyPath', readyPath, '-HandoffPath', handoffPath]
  const config = { executable, argumentLine: args.map(quoteWindowsArgument).join(' '), cwd: workingDirectory, stdoutPath: paths.stdout, stderrPath: paths.stderr, readyPath, resultPath, readyTimeoutMs }
  await writeFile(scriptPath, '\uFEFF' + bootstrapScript, { flag: 'wx' })
  await writeFile(configPath, JSON.stringify(config), { flag: 'wx' })
  // Pre-create all files. Only ordinary file handles are inherited, never Electron pipes.
  const descriptors = []
  let bootstrap
  try {
    for (const name of Object.keys(paths)) descriptors.push(openSync(paths[name], 'wx', 0o600))
    const bootstrapArgs = ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-ConfigPath', configPath]
    await logEvent('powershell-launch-requested', { executable, args, bootstrapArgs, cwd: config.cwd, detached: false, windowsHide: true, diagnosticDirectory: directory })
    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('PowerShell bootstrap не підтвердив завершення. Electron залишається відкритим; Setup не авторизовано.')), readyTimeoutMs + 10000)
      const fail = error => { clearTimeout(timeout); reject(error) }
      try {
        // detached:true gives Windows PowerShell 5.1 no console and can exit 0 before -File.
        // This short bootstrap stays with Electron; Start-Process creates the independent launcher.
        bootstrap = spawnProcess(executable, bootstrapArgs, { cwd: workingDirectory, detached: false, windowsHide: true, stdio: ['ignore', descriptors[2], descriptors[3]] })
        bootstrap.once('spawn', () => { void logEvent('powershell-process-created', { processId: bootstrap.pid ?? null, role: 'bootstrap' }).catch(() => {}) })
        bootstrap.once('error', fail)
        bootstrap.once('exit', (code, signal) => { clearTimeout(timeout); resolve({ code, signal }) })
      } catch (error) { fail(error) }
    })
    await logEvent('powershell-bootstrap-exited', result)
    const handoff = JSON.parse(await readFile(resultPath, 'utf8'))
    await logEvent('powershell-handoff-result', { ...handoff, diagnosticDirectory: directory })
    if (result.code !== 0 || handoff.status !== 'ready') {
      throw new Error(`Launcher не підтвердив готовність (${handoff.status}; exit ${handoff.exitCode ?? result.code}). Діагностика: ${directory}. Якщо launcher ще працює, дочекайтеся його завершення перед повтором.`)
    }
    await writeFile(handoffPath, 'confirmed\n', { flag: 'wx' })
    return { ...handoff, diagnosticDirectory: directory }
  } catch (error) {
    await logEvent('powershell-process-error', { error: error.message, code: error.code ?? null, diagnosticDirectory: directory }).catch(() => {})
    throw error
  } finally {
    for (const descriptor of descriptors) closeSync(descriptor)
  }
}
