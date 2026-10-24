import { cp, lstat, mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageRoot = join(root, 'dist-package')
const finalTarget = join(packageRoot, 'server')
await mkdir(packageRoot, { recursive: true })
const temporaryRoot = await mkdtemp(join(packageRoot, '.server-deploy-'))
const workspace = join(temporaryRoot, 'workspace')
const deployed = join(temporaryRoot, 'deployed')
const previous = join(temporaryRoot, 'previous')
let publishedOld = false
let preserveTemporary = false

async function copyRequired(source, target) {
  await cp(source, target, { recursive: true, errorOnExist: true, force: false })
}

async function assertNoLinks(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const info = await lstat(path)
    if (info.isSymbolicLink()) throw new Error('У production-залежностях залишилося зовнішнє посилання: ' + path)
    if (info.isDirectory()) await assertNoLinks(path)
  }
}

try {
  await mkdir(join(workspace, 'server'), { recursive: true })
  for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
    await copyRequired(join(root, file), join(workspace, file))
  }
  await copyRequired(join(root, 'server', 'package.json'), join(workspace, 'server', 'package.json'))
  await copyRequired(join(root, 'server', 'dist'), join(workspace, 'server', 'dist'))

  // Install only server production dependencies in the disposable workspace.
  // The hoisted linker creates a self-contained physical tree suitable for NSIS;
  // frozen-lockfile keeps its transitive versions reproducible.
  if (process.platform === 'win32') {
    const script = "$ErrorActionPreference='Stop'; $pnpm=(Get-Command pnpm.cmd -ErrorAction Stop).Source; & $pnpm 'install' '--filter' '@hromadaaid/server' '--prod' '--config.node-linker=hoisted' '--frozen-lockfile'; exit $LASTEXITCODE"
    execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      cwd: workspace,
      stdio: 'inherit',
    })
  } else {
    execFileSync('pnpm', ['install', '--filter', '@hromadaaid/server', '--prod', '--config.node-linker=hoisted', '--frozen-lockfile'], { cwd: workspace, stdio: 'inherit' })
  }

  const workspaceModules = join(workspace, 'node_modules')
  for (const entry of ['.bin', '.modules.yaml', '.package-map.json', '.pnpm', '.pnpm-workspace-state-v1.json']) {
    await rm(join(workspaceModules, entry), { recursive: true, force: true })
  }
  await copyRequired(join(workspace, 'server'), deployed)
  await copyRequired(workspaceModules, join(deployed, 'node_modules'))
  await assertNoLinks(deployed)
  for (const modulePath of ['argon2/package.json', '@phc/format/package.json', 'fastify/package.json']) {
    try { await lstat(join(deployed, 'node_modules', ...modulePath.split('/'))) }
    catch { throw new Error('У production-пакеті відсутня обов’язкова залежність: ' + modulePath) }
  }

  await mkdir(packageRoot, { recursive: true })
  try { await rename(finalTarget, previous); publishedOld = true }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  try { await rename(deployed, finalTarget) }
  catch (error) {
    if (publishedOld) {
      try { await rename(previous, finalTarget); publishedOld = false }
      catch { preserveTemporary = true; throw new Error(`Не вдалося опублікувати пакет; попередній production-пакет збережено в ${previous}.`) }
    }
    throw error
  }
  if (publishedOld) {
    await rm(previous, { recursive: true, force: true }).catch(() => { preserveTemporary = true })
    if (preserveTemporary) console.warn(`Новий пакет готовий; попередню копію залишено для ручного очищення: ${previous}`)
  }
  console.log('Production-залежності сервера підготовлено в окремому staging-каталозі.')
} catch (error) {
  if (publishedOld) {
    try { await rename(previous, finalTarget); publishedOld = false }
    catch { preserveTemporary = true }
  }
  throw error
} finally {
  if (!preserveTemporary) await rm(temporaryRoot, { recursive: true, force: true })
}
