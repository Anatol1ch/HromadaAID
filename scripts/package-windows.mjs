import { createHash } from 'node:crypto'
import { copyFile, cp, lstat, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const release = join(root, 'release')
const payloadRoot = join(release, 'installer-payload')
const nodeVersion = '24.22.1'
const nodeZipSha256 = 'd2046d28c2c3dcd211ac5145c0bf30e2047ef9dfb306693c8c6e2eccd8b95fa5'
const winswVersion = '2.12.0'
const winswSha256 = '05b82d46ad331cc16bdc00de5c6332c1ef818df8ceefcd49c726553209b3a0da'
const bannedPath = /(?:^|[/\\])(?:tests?|__tests__|fixtures?|\.git)(?:[/\\]|$)|\.(?:test\.[cm]?js|sqlite3?|db3?|hraid(?:\.|$)|dpapi(?:\.|$)|pem|p12|key)$/i
const secretMarker = /(?:refresh_token|access_token|client_secret|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|recovery_key\s*[:=])/i

function hash(bytes) { return createHash('sha256').update(bytes).digest('hex') }

async function downloadVerified(url, expectedHash, destination) {
  const response = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'HromadaAID reproducible Windows packaging' } })
  if (!response.ok) throw new Error('Завантаження офіційного build-компонента не вдалося (HTTP ' + response.status + ').')
  const bytes = Buffer.from(await response.arrayBuffer())
  const actual = hash(bytes)
  if (actual !== expectedHash) throw new Error('SHA-256 build-компонента не збігається: ' + actual)
  await writeFile(destination, bytes, { flag: 'wx' })
}

async function assertPackage(rootPath) {
  const files = []
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const relativePath = path.slice(rootPath.length + 1).replaceAll('\\', '/')
      if (bannedPath.test(relativePath)) throw new Error('У пакет потрапив заборонений test/data/secret файл: ' + relativePath)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile()) {
        const info = await stat(path)
        if (info.size < 8 * 1024 * 1024 && /\.(?:json|js|mjs|cjs|xml|txt|ya?ml)$/i.test(entry.name)) {
          const content = await readFile(path, 'utf8')
          if (secretMarker.test(content)) throw new Error('У текстових файлах пакета виявлено схожий на секрет маркер: ' + relativePath)
        }
        files.push(relativePath)
      } else if (entry.isSymbolicLink()) {
        const target = await stat(path).catch(() => undefined)
        if (!target) throw new Error('Пошкоджене посилання в payload: ' + relativePath)
        files.push(relativePath)
      }
    }
  }
  await walk(rootPath)
  return files.sort()
}

async function stripNonRuntimeTestFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (/^(?:test|tests|__tests__|fixtures|fixture)$/i.test(entry.name)) await rm(path, { recursive: true, force: true })
      else await stripNonRuntimeTestFiles(path)
    } else if (entry.isFile() && /\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(entry.name)) {
      await rm(path, { force: true })
    }
  }
}

async function removePnpmRootLinks(appDirectory) {
  const modules = join(appDirectory, 'node_modules')
  // Keep runtime links into .pnpm: NSIS expands them into the installed tree.
  // Remove only the workspace link, which points back into the source tree.
  const workspaceLink = join(modules, '.pnpm', 'node_modules', '@hromadaaid', 'server')
  const workspaceMetadata = await lstat(workspaceLink).catch(() => undefined)
  if (workspaceMetadata?.isSymbolicLink()) await rm(workspaceLink, { force: true })
  for (const item of ['.bin', '.modules.yaml', '.package-map.json']) {
    await rm(join(modules, item), { recursive: true, force: true })
  }
}

async function main() {
  const clientSource = join(release, 'win-unpacked')
  const serverSource = join(root, 'dist-package', 'server')
  const clientTarget = join(payloadRoot, 'Client')
  const serverTarget = join(payloadRoot, 'Server')
  if (!(await stat(clientSource).catch(() => undefined))?.isDirectory()) throw new Error('Не знайдено electron-builder payload: виконайте windows:package build pipeline.')
  if (!(await stat(join(serverSource, 'node_modules', 'argon2')).catch(() => undefined))?.isDirectory()) throw new Error('Production-пакет сервера не містить argon2.')
  if (!(await stat(join(serverSource, 'node_modules', 'fastify')).catch(() => undefined))?.isDirectory()) throw new Error('Production-пакет сервера не містить Fastify.')
  if (await stat(join(serverSource, 'node_modules', 'typescript')).catch(() => undefined)) throw new Error('До production-пакета сервера потрапив TypeScript.')

  await rm(payloadRoot, { recursive: true, force: true })
  await mkdir(clientTarget, { recursive: true })
  await mkdir(join(serverTarget, 'app'), { recursive: true })
  await mkdir(join(serverTarget, 'runtime'), { recursive: true })
  await mkdir(join(serverTarget, 'service'), { recursive: true })
  await mkdir(join(serverTarget, 'installer'), { recursive: true })
  await cp(clientSource, clientTarget, { recursive: true })
  await cp(serverSource, join(serverTarget, 'app'), { recursive: true })
  await removePnpmRootLinks(join(serverTarget, 'app'))

  const temporary = join(release, '.toolchain-' + process.pid)
  await mkdir(temporary, { recursive: false })
  try {
    const nodeZip = join(temporary, 'node-v' + nodeVersion + '-win-x64.zip')
    const winswExe = join(temporary, 'WinSW-x64.exe')
    await downloadVerified('https://nodejs.org/dist/v' + nodeVersion + '/node-v' + nodeVersion + '-win-x64.zip', nodeZipSha256, nodeZip)
    await downloadVerified('https://github.com/winsw/winsw/releases/download/v' + winswVersion + '/WinSW-x64.exe', winswSha256, winswExe)
    const extracted = join(temporary, 'node')
    await mkdir(extracted)
    execFileSync('tar.exe', ['-xf', nodeZip, '-C', extracted], { stdio: 'ignore' })
    await copyFile(join(extracted, 'node-v' + nodeVersion + '-win-x64', 'node.exe'), join(serverTarget, 'runtime', 'node.exe'))
    await copyFile(winswExe, join(serverTarget, 'service', 'HromadaAIDService.exe'))
    const nodeExe = join(serverTarget, 'runtime', 'node.exe')
    const version = execFileSync(nodeExe, ['--version'], { encoding: 'utf8' }).trim()
    if (version !== 'v' + nodeVersion) throw new Error('Версія запакованого Node.js не збігається із закріпленою.')
    execFileSync(nodeExe, ['-e', "const {DatabaseSync}=require('node:sqlite');new DatabaseSync(':memory:').close()"], { stdio: 'ignore' })
    execFileSync(nodeExe, ['-e', "const a=require('argon2');a.hash('synthetic-package-check').then(h=>a.verify(h,'synthetic-package-check')).then(ok=>{if(!ok)process.exit(1)})"], { cwd: join(serverTarget, 'app'), stdio: 'ignore' })
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }

  await copyFile(join(root, 'server', 'windows-service', 'HromadaAIDService.xml.template'), join(serverTarget, 'service', 'HromadaAIDService.xml.template'))
  await copyFile(join(root, 'packaging', 'prepare-server-install.mjs'), join(serverTarget, 'installer', 'prepare-server-install.mjs'))
  await copyFile(join(root, 'packaging', 'windows-installer-config.mjs'), join(serverTarget, 'installer', 'windows-installer-config.mjs'))
  await copyFile(join(root, 'packaging', 'windows-installer-paths.ps1'), join(serverTarget, 'installer', 'windows-installer-paths.ps1'))
  await stripNonRuntimeTestFiles(join(serverTarget, 'app', 'node_modules', '.pnpm'))

  const clientFiles = await assertPackage(clientTarget)
  const serverFiles = await assertPackage(serverTarget)
  if (!serverFiles.includes('runtime/node.exe') || !serverFiles.includes('service/HromadaAIDService.exe') || !serverFiles.includes('service/HromadaAIDService.xml.template') || !serverFiles.includes('app/node_modules/.pnpm/argon2@0.45.1/node_modules/argon2/package.json')) {
    throw new Error('Серверний пакет не має повного runtime/WinSW набору.')
  }
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const manifest = {
    formatVersion: 1,
    appVersion: packageJson.version,
    client: { source: 'electron-builder win-unpacked', files: clientFiles },
    server: {
      nodeVersion: nodeVersion, nodeArchiveSha256: nodeZipSha256,
      winswVersion: winswVersion, winswSha256: winswSha256,
      entrypoint: 'app/dist/server/src/installed.js',
      files: serverFiles
    },
    installModes: ['Клієнт', 'Сервер', 'Сервер + клієнт'],
    installerSource: 'packaging/windows-installer.nsi',
    serviceRegistration: 'not performed by this installer foundation'
  }
  await writeFile(join(payloadRoot, 'package-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  console.log('Підготовлено окремі payload клієнта й сервера: ' + payloadRoot)
  console.log('Файлів клієнта: ' + clientFiles.length + '; файлів сервера: ' + serverFiles.length)
}

main().catch(error => {
  console.error('Не вдалося зібрати Windows payload: ' + (error instanceof Error ? error.message : 'невідома помилка'))
  process.exitCode = 1
})
