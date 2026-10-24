import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageRoot = resolve(root, 'dist-server-manager/package')
const outputRoot = resolve(root, 'release/server-manager')
const unpacked = resolve(outputRoot, 'win-unpacked')
const packageManifestPath = resolve(root, 'package.json')

function assertGeneratedPath(target, expected) {
  if (target !== resolve(root, expected) || !target.startsWith(`${root}${sep}`)) {
    throw new Error(`Refusing to modify unexpected build path: ${target}`)
  }
}

assertGeneratedPath(packageRoot, 'dist-server-manager/package')
assertGeneratedPath(outputRoot, 'release/server-manager')

const rootManifest = JSON.parse(await readFile(packageManifestPath, 'utf8'))
for (const target of [packageRoot, outputRoot]) await rm(target, { recursive: true, force: true })
await mkdir(packageRoot, { recursive: true })
await cp(resolve(root, 'dist-server-manager/main'), resolve(packageRoot, 'main'), { recursive: true })
await cp(resolve(root, 'dist-server-manager/renderer'), resolve(packageRoot, 'renderer'), { recursive: true })
await writeFile(resolve(packageRoot, 'package.json'), `${JSON.stringify({
  name: 'hromadaaid-server-manager',
  productName: 'HromadaAID Server Manager',
  version: rootManifest.version,
  description: 'Окремий менеджер серверного середовища HromadaAID',
  author: 'HromadaAID',
  private: true,
  type: 'module',
  main: 'main/main.js',
}, null, 2)}\n`, 'utf8')

const builderCli = resolve(root, 'node_modules/electron-builder/cli.js')
const build = spawnSync(process.execPath, [builderCli, '--config', 'server-manager/electron-builder.yml', '--win', '--x64', '--dir', '--publish', 'never'], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
  env: process.env,
})
if (build.error) throw build.error
if (build.status !== 0) throw new Error(`electron-builder exited with code ${build.status ?? 'unknown'}`)

const executable = join(unpacked, 'HromadaAID Server Manager.exe')
const asarPath = join(unpacked, 'resources', 'app.asar')
if (!(await stat(executable).catch(() => undefined))?.isFile()) throw new Error('Portable Server Manager executable was not produced.')
if (!(await stat(asarPath).catch(() => undefined))?.isFile()) throw new Error('Packaged application archive is missing.')

const requireFromBuilder = createRequire(builderCli)
let asar
try {
  asar = requireFromBuilder('@electron/asar')
} catch {
  const store = join(root, 'node_modules', '.pnpm')
  const candidates = (await readdir(store)).filter(name => name.startsWith('@electron+asar@')).sort()
  for (const candidate of candidates) {
    const manifest = join(store, candidate, 'node_modules', '@electron', 'asar', 'package.json')
    if ((await stat(manifest).catch(() => undefined))?.isFile()) {
      asar = createRequire(manifest)('@electron/asar')
      break
    }
  }
}
if (!asar) throw new Error('Cannot inspect app.asar using electron-builder’s bundled @electron/asar.')
const archiveEntries = asar.listPackage(asarPath).map(path => path.replace(/\\/g, '/').replace(/^\/+/, ''))
for (const expected of ['main/main.js', 'main/preload.cjs', 'main/inspection-engine.js', 'renderer/index.html']) {
  if (!archiveEntries.includes(expected)) throw new Error(`Packaged Server Manager is missing ${expected}.`)
}
if (archiveEntries.some(path => /(^|[\\/])(server|node_modules|client|electron|fixtures|tests)([\\/]|$)|\.sqlite(?:3)?$|\.hraid$|\.dpapi/i.test(path))) {
  throw new Error('Portable app archive contains an unexpected server, test or user-data payload.')
}

const forbiddenNames = /(^|[\\/])(Server|Server\.next|server|node_modules|release|.*\.sqlite(?:3)?|.*\.hraid|.*\.dpapi)([\\/]|$)/i
const packagedFiles = []
async function collect(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const absolute = join(path, entry.name)
    const name = relative(unpacked, absolute)
    if (forbiddenNames.test(name)) throw new Error(`Unexpected server or data payload in portable package: ${name}`)
    if (entry.isDirectory()) await collect(absolute)
    else if (entry.isFile()) packagedFiles.push({ path: name, size: (await stat(absolute)).size })
  }
}
await collect(unpacked)

const readme = [
  'HromadaAID Server Manager — portable x64',
  '',
  'Запустіть файл HromadaAID Server Manager.exe. Встановлення не потрібне.',
  'Пакет працює без Node.js, pnpm, Vite та підключення до інтернету.',
  'Для першого запуску сервер не потрібен. Реальна діагностика виконується лише після натискання «Перевірити зараз».',
  'Цей пакет не встановлює службу та не змінює системні параметри.',
  '',
  `Версія: ${rootManifest.version}`,
  'Платформа: Windows x64',
].join('\r\n') + '\r\n'
await writeFile(join(unpacked, 'README-portable.txt'), readme, 'utf8')

const totalBytes = packagedFiles.reduce((sum, file) => sum + file.size, 0) + Buffer.byteLength(readme)
const sha256 = createHash('sha256').update(await readFile(executable)).digest('hex')
const result = {
  product: 'HromadaAID Server Manager',
  version: rootManifest.version,
  platform: 'win32-x64',
  directory: relative(root, unpacked),
  executable: relative(root, executable),
  archiveEntries,
  files: packagedFiles.length + 1,
  totalBytes,
  executableSha256: sha256,
}
await writeFile(join(outputRoot, 'package-summary.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(result, null, 2))
