import { createHash } from 'node:crypto'
import { copyFile, cp, lstat, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { verifyServerRuntime } from '../packaging/server-runtime-check.mjs'

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
  const visitedDirectories = new Set()
  async function walk(directory) {
    const resolvedDirectory = await realpath(directory)
    if (visitedDirectories.has(resolvedDirectory)) return
    visitedDirectories.add(resolvedDirectory)
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
        if (target.isDirectory()) await walk(path)
        else if (target.isFile()) files.push(relativePath)
      }
    }
  }
  await walk(rootPath)
  return files.sort()
}

async function stripNonRuntimeTestFiles(directory) {
  const visitedDirectories = new Set()
  async function walk(currentDirectory) {
    const resolvedDirectory = await realpath(currentDirectory)
    if (visitedDirectories.has(resolvedDirectory)) return
    visitedDirectories.add(resolvedDirectory)
    for (const entry of await readdir(currentDirectory, { withFileTypes: true })) {
      const path = join(currentDirectory, entry.name)
      const info = entry.isSymbolicLink() ? await stat(path).catch(() => undefined) : undefined
      if (entry.isSymbolicLink() && !info) continue
      if (info?.isDirectory()) {
        if (/^(?:test|tests|__tests__|fixtures|fixture)$/i.test(entry.name)) await rm(path, { recursive: true, force: true })
        else await walk(path)
        continue
      }
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (/^(?:test|tests|__tests__|fixtures|fixture)$/i.test(entry.name)) await rm(path, { recursive: true, force: true })
        else await walk(path)
      } else if (entry.isFile() && /\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(entry.name)) {
        await rm(path, { force: true })
      }
    }
  }
  await walk(directory)
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
  await copyFile(join(root, 'packaging', 'install-server-service.ps1'), join(serverTarget, 'installer', 'install-server-service.ps1'))
  await copyFile(join(root, 'packaging', 'admin-setup.ps1'), join(serverTarget, 'installer', 'admin-setup.ps1'))
  await copyFile(join(root, 'packaging', 'verify-server-package.mjs'), join(serverTarget, 'installer', 'verify-server-package.mjs'))
  await copyFile(join(root, 'packaging', 'server-package-transaction.mjs'), join(serverTarget, 'installer', 'server-package-transaction.mjs'))
  await copyFile(join(root, 'packaging', 'windows-service-control.ps1'), join(serverTarget, 'installer', 'windows-service-control.ps1'))
  await copyFile(join(root, 'packaging', 'write-installation-locator.ps1'), join(serverTarget, 'installer', 'write-installation-locator.ps1'))
  await stripNonRuntimeTestFiles(join(serverTarget, 'app', 'node_modules'))

  const clientFiles = await assertPackage(clientTarget)
  const serverFiles = await assertPackage(serverTarget)
  if (!serverFiles.includes('runtime/node.exe') || !serverFiles.includes('service/HromadaAIDService.exe') || !serverFiles.includes('service/HromadaAIDService.xml.template') || !serverFiles.includes('app/node_modules/argon2/package.json') || !serverFiles.includes('app/node_modules/@phc/format/package.json')) {
    throw new Error('Серверний пакет не має повного runtime/WinSW набору.')
  }
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const integrityFiles = []
  for (const relativePath of serverFiles) {
    const bytes = await readFile(join(serverTarget, ...relativePath.split('/')))
    integrityFiles.push({ path: relativePath, sizeBytes: bytes.byteLength, sha256: hash(bytes) })
  }
  await writeFile(join(serverTarget, 'package-integrity.json'), JSON.stringify({ formatVersion: 1, files: integrityFiles }, null, 2) + '\n', 'utf8')
  const runtimeCheck = verifyServerRuntime(serverTarget)
  console.log('Production runtime перевірено: ' + runtimeCheck.nodeVersion + '; create-admin.js --status працює із синтетичною SQLite.')
  const completeServerFiles = await assertPackage(serverTarget)
  const sumBytes = async (directory, files) => (await Promise.all(files.map(path => stat(join(directory, ...path.split('/')))))).reduce((total, info) => total + info.size, 0)
  const clientBytes = await sumBytes(clientTarget, clientFiles)
  const serverBytes = await sumBytes(serverTarget, completeServerFiles)
  const installerSupportBytes = await Promise.all([
    'windows-installer-paths.ps1', 'windows-service-control.ps1', 'prepare-server-install.mjs',
    'windows-installer-config.mjs', 'install-server-service.ps1', 'admin-setup.ps1',
    'write-installation-locator.ps1',
  ].map(path => stat(join(root, 'packaging', path)).then(info => info.size)))
  const manifest = {
    formatVersion: 1,
    appVersion: packageJson.version,
    client: { source: 'electron-builder win-unpacked', sizeBytes: clientBytes, files: clientFiles },
    server: {
      sizeBytes: serverBytes,
      nodeVersion: nodeVersion, nodeArchiveSha256: nodeZipSha256,
      winswVersion: winswVersion, winswSha256: winswSha256,
      entrypoint: 'app/dist/server/src/installed.js',
      files: completeServerFiles
    },
    installer: { supportFilesBytes: installerSupportBytes.reduce((sum, value) => sum + value, 0) },
    installModes: ['Клієнт', 'Сервер', 'Сервер + клієнт'],
    installerSource: 'packaging/windows-installer.nsi',
    serviceRegistration: 'NSIS invokes the packaged service installer after path validation'
  }
  await writeFile(join(payloadRoot, 'package-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  console.log('Підготовлено окремі payload клієнта й сервера: ' + payloadRoot)
  console.log('Файлів клієнта: ' + clientFiles.length + '; файлів сервера: ' + serverFiles.length)
}

main().catch(error => {
  console.error('Не вдалося зібрати Windows payload: ' + (error instanceof Error ? error.message : 'невідома помилка'))
  process.exitCode = 1
})
