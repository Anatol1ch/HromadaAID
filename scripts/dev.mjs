import { createHash } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import waitOn from 'wait-on'

const root = realpathSync(fileURLToPath(new URL('..', import.meta.url)))
const require = createRequire(import.meta.url)
const port = 5175 // Keep in sync with vite.config.ts and electron/main.ts.
const host = '127.0.0.1'
const url = `http://${host}:${port}`
const viteCli = realpathSync(join(dirname(require.resolve('vite/package.json')), 'bin/vite.js'))
const viteArgs = [viteCli, root, '--host', host, '--port', String(port), '--strictPort']
const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const portScript = fileURLToPath(new URL('./dev-port.ps1', import.meta.url))
const execute = promisify(execFile)
const children = new Set()
const guard = createServer((socket) => socket.end())
let locked = false
let stopping = false
let shuttingDown

// Match full arguments, not a substring of a project name or an arbitrary node.exe.
const normalize = (value) => value.replaceAll('\\', '/').toLowerCase()
function argumentPattern(value) {
  const text = normalize(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return /\s/.test(value) ? `"${text}"` : `(?:"${text}"|${text})`
}
function isOurVite(owner) {
  if (!owner.executablePath || basename(owner.executablePath).toLowerCase() !== 'node.exe' || !owner.commandLine) return false
  const pattern = [owner.executablePath, ...viteArgs].map(argumentPattern).join('\\s+')
  return new RegExp(`^\\s*${pattern}\\s*$`, 'i').test(normalize(owner.commandLine))
}

async function portCommand(args) {
  return execute(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', portScript, '-Port', String(port), ...args], { windowsHide: true, encoding: 'utf8', timeout: 15_000 })
}
async function inspectPort() {
  try { return JSON.parse((await portCommand(['-Action', 'Inspect'])).stdout.trim()) }
  catch { throw new Error(`Не вдалося надійно перевірити власника порту ${port}. Жоден процес не завершено. Перевірте доступність Get-NetTCPConnection та Win32_Process у PowerShell.`) }
}
async function preparePort() {
  const owners = await inspectPort()
  const blockers = owners.map((owner) => {
    if (owner.inspectionError) return `PID ${owner.pid}: Windows не надала інформацію про процес або його батьківський процес.`
    if (!isOurVite(owner)) return `PID ${owner.pid}: це стороння програма або немає точного підтвердження Vite та кореня цього проєкту.`
    if (!owner.createdAtTicks || !owner.parentPid) return `PID ${owner.pid}: неможливо підтвердити час створення або батьківський процес.`
    if (owner.parentCreatedAtTicks && BigInt(owner.parentCreatedAtTicks) <= BigInt(owner.createdAtTicks)) {
      return `PID ${owner.pid}: батьківський процес ще працює; цей dev-запуск може бути активним.`
    }
    return null
  }).filter(Boolean)
  // Inspect every listener before taking any action.
  if (blockers.length) throw new Error(`Порт ${port} зайнятий. Нічого не завершено.\n${blockers.join('\n')}\nЗакрийте відповідний запуск у його терміналі та повторіть pnpm dev.`)
  for (const owner of owners) {
    if (stopping) return
    console.log(`[HromadaAid] Завершуємо залишений Vite цього проєкту (PID ${owner.pid}).`)
    try {
      const commandHash = createHash('sha256').update(owner.commandLine).digest('hex')
      await portCommand(['-Action', 'Stop', '-OwnerId', String(owner.pid), '-ExpectedCreation', owner.createdAtTicks, '-ExpectedCommandHash', commandHash])
    } catch { throw new Error(`Не вдалося безпечно звільнити порт ${port} від PID ${owner.pid}: власник або його стан змінився, чи Windows відмовила в доступі. Інші процеси не завершувалися.`) }
  }
  if (owners.length) {
    const remaining = await inspectPort()
    if (remaining.length) throw new Error(`Порт ${port} ще зайнятий (PID: ${remaining.map((owner) => owner.pid).join(', ')}). Повторного примусового завершення не буде.`)
  }
}

function start(executable, args, label, watch = false, { windowsHide = true, env = process.env } = {}) {
  if (stopping) throw new Error('Запуск скасовано.')
  const child = spawn(executable, args, { cwd: root, stdio: 'inherit', windowsHide, env })
  children.add(child)
  const completed = new Promise((resolve, reject) => {
    child.once('error', (error) => { children.delete(child); reject(new Error(`${label}: ${error.message}`)) })
    child.once('exit', (code, signal) => {
      children.delete(child)
      if (code === 0) resolve()
      else reject(new Error(`${label} завершився (${signal ?? code}).`))
    })
  })
  if (watch) {
    completed.then(() => shutdown(0), (error) => { if (!stopping) console.error(error.message); return shutdown(1) })
  }
  return completed
}
function shutdown(code) {
  if (shuttingDown) return shuttingDown
  stopping = true
  shuttingDown = (async () => {
    // Only trees started and still tracked by this supervisor; never kill by image name.
    await Promise.all([...children].map(async (child) => {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
      try { await execute('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10_000 }) }
      catch {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill()
          console.error(`[HromadaAid] Windows не підтвердила завершення дерева PID ${child.pid}. Якщо порт залишиться зайнятим, наступний запуск перевірить його власника.`)
        }
      }
    }))
    if (locked) await new Promise((resolve) => guard.close(resolve))
    process.exit(code)
  })()
  return shuttingDown
}

process.on('SIGINT', () => { void shutdown(0) })
process.on('SIGTERM', () => { void shutdown(0) })
process.on('SIGHUP', () => { void shutdown(0) })
process.on('SIGBREAK', () => { void shutdown(0) })

try {
  if (process.platform !== 'win32') throw new Error('Цей сценарій dev-запуску призначений для Windows 10/11.')
  // A Windows named pipe is exclusive and disappears automatically after a crash.
  const key = createHash('sha256').update(normalize(root)).digest('hex').slice(0, 24)
  await new Promise((resolve, reject) => {
    guard.once('error', () => reject(new Error('Інший dev-запуск HromadaAid уже працює або Windows блокує доступ до його блокування. Закрийте попередній запуск; жодні процеси не завершено.')))
    guard.listen(`\\\\.\\pipe\\hromadaaid-dev-${key}`, () => { locked = true; resolve() })
  })
  await preparePort()
  console.log('[HromadaAid] Підготовка Electron…')
  await start(process.execPath, [join(root, 'scripts', 'clean-electron-build.mjs')], 'Очищення клієнтської збірки')
  await start(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', join(root, 'tsconfig.electron.json')], 'TypeScript')
  await start(process.execPath, [join(root, 'electron', 'copy-assets.mjs')], 'Копіювання ресурсів')
  // Resolve the installed executable without invoking Electron's automatic downloader.
  const electronDirectory = dirname(require.resolve('electron/package.json'))
  const electronPath = join(electronDirectory, 'dist', readFileSync(join(electronDirectory, 'path.txt'), 'utf8').trim())
  if (!existsSync(electronPath)) throw new Error('Локальний Electron не знайдено. Автоматичне встановлення не виконувалося.')
  start(process.execPath, viteArgs, 'Vite', true)
  await waitOn({ resources: [`http-get://${host}:${port}/`], timeout: 30_000, interval: 250, httpTimeout: 1000, proxy: false })
  console.log(`[HromadaAid] Dev-сервер: ${url}. Ctrl+C або закриття Electron завершує dev-сеанс.`)
  // Electron is the visible application, unlike the console helpers above.
  const electronEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'ELECTRON_RUN_AS_NODE'))
  start(electronPath, [root], 'Electron', true, { windowsHide: false, env: electronEnv })
} catch (error) {
  if (!stopping) console.error(`[HromadaAid] ${error instanceof Error ? error.message : String(error)}`)
  await shutdown(1)
}
