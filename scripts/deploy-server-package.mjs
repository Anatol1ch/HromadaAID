import { cp, mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
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

try {
  await mkdir(join(workspace, 'server'), { recursive: true })
  for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
    await copyRequired(join(root, file), join(workspace, file))
  }
  await copyRequired(join(root, 'server', 'package.json'), join(workspace, 'server', 'package.json'))
  await copyRequired(join(root, 'server', 'dist'), join(workspace, 'server', 'dist'))

  // `deploy` runs only inside a disposable workspace. It can create a production
  // node_modules tree there, but never installs/removes dependencies in the repo.
  if (process.platform === 'win32') {
    const script = "$ErrorActionPreference='Stop'; $pnpm=(Get-Command pnpm.cmd -ErrorAction Stop).Source; & $pnpm '--filter' '@hromadaaid/server' 'deploy' '--prod' '--legacy' $env:HROMADAAID_SERVER_DEPLOY_TARGET; exit $LASTEXITCODE"
    execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      cwd: workspace,
      env: { ...process.env, HROMADAAID_SERVER_DEPLOY_TARGET: deployed },
      stdio: 'inherit',
    })
  } else {
    execFileSync('pnpm', ['--filter', '@hromadaaid/server', 'deploy', '--prod', '--legacy', deployed], { cwd: workspace, stdio: 'inherit' })
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
