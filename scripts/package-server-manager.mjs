import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { verifyServerPackage } from '../packaging/verify-server-package.mjs'

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
const serverSource = resolve(root, 'release/installer-payload/Server')
const serverManifest = await verifyServerPackage(serverSource, { verifyRuntime: true })
for (const required of [
  'runtime/node.exe', 'service/HromadaAIDService.exe', 'installer/prepare-server-install.mjs',
  'installer/windows-installer-paths.ps1', 'installer/install-server-service.ps1',
  'installer/verify-server-package.mjs', 'installer/server-runtime-check.mjs', 'installer/server-package-transaction.mjs',
  'installer/write-installation-locator.ps1', 'app/dist/server/src/installer-initialization.js',
  'app/dist/server/src/create-admin.js',
]) if (!serverManifest.files.some(entry => entry.path === required)) throw new Error(`Bundled server payload is missing ${required}.`)
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
for (const expected of ['main/main.js', 'main/preload.cjs', 'main/inspection-engine.js', 'main/installation-recovery.js', 'renderer/index.html']) {
  if (!archiveEntries.includes(expected)) throw new Error(`Packaged Server Manager is missing ${expected}.`)
}
if (archiveEntries.some(path => /(^|[\\/])(server|node_modules|client|electron|fixtures|tests)([\\/]|$)|\.sqlite(?:3)?$|\.hraid$|\.dpapi/i.test(path))) {
  throw new Error('Portable app archive contains an unexpected server, test or user-data payload.')
}

const payloadDirectory = join(unpacked, 'resources', 'server-payload')
const packagedServerManifest = await verifyServerPackage(payloadDirectory, { verifyRuntime: true })
const requiredPayload = new Set(serverManifest.files.map(entry => entry.path))
const actualPayload = new Set()
async function collectPayload(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) await collectPayload(path, relativePath)
    else if (entry.isFile()) actualPayload.add(relativePath)
  }
}
await collectPayload(payloadDirectory)
actualPayload.delete('package-integrity.json')
if (actualPayload.size !== requiredPayload.size || [...requiredPayload].some(path => !actualPayload.has(path))) throw new Error('Bundled server payload differs from its verified file manifest.')
if (packagedServerManifest.files.length !== serverManifest.files.length) throw new Error('Bundled server payload manifest changed during packaging.')
// Validate the verifier from inside the actual extraResources payload with the
// bundled Node runtime. Importing the repository copy cannot catch missing
// sibling modules in electron-builder's output.
const packagedNode = join(payloadDirectory, 'runtime', 'node.exe')
const packagedVerifier = join(payloadDirectory, 'installer', 'verify-server-package.mjs')
const packagedVerifierRun = spawnSync(packagedNode, [packagedVerifier, payloadDirectory], {
  cwd: join(payloadDirectory, 'app'), encoding: 'utf8', windowsHide: true, timeout: 120_000,
})
if (packagedVerifierRun.error || packagedVerifierRun.status !== 0) {
  const diagnostic = [packagedVerifierRun.stderr, packagedVerifierRun.stdout].filter(Boolean).join('\n').trim().slice(0, 4_000)
  throw new Error(`Packaged server verifier could not load and validate its local module graph (exit ${packagedVerifierRun.status ?? 'unknown'}): ${diagnostic || packagedVerifierRun.error?.message || 'no diagnostic'}`)
}
const installerPowerShellFiles = [
  'windows-installer-paths.ps1', 'install-server-service.ps1', 'admin-setup.ps1',
  'windows-service-control.ps1', 'write-installation-locator.ps1',
].map(name => join(payloadDirectory, 'installer', name))
if (process.platform === 'win32') {
  const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const paths = Buffer.from(JSON.stringify(installerPowerShellFiles), 'utf8').toString('base64')
  const parserScript = `$ErrorActionPreference='Stop';$paths=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${paths}')) | ConvertFrom-Json;$failures=@();foreach($path in $paths){$tokens=$null;$errors=$null;[void][Management.Automation.Language.Parser]::ParseFile([string]$path,[ref]$tokens,[ref]$errors);foreach($errorRecord in $errors){$failures+=('{0}:{1}: {2}' -f $path,$errorRecord.Extent.StartLineNumber,$errorRecord.Message)}};if($failures.Count){[Console]::Error.WriteLine(($failures -join [Environment]::NewLine));exit 1};[Console]::Out.WriteLine('Packaged PowerShell 5.1 scripts parsed successfully.')`
  const parsed = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(parserScript, 'utf16le').toString('base64')], {
    cwd: join(payloadDirectory, 'installer'), encoding: 'utf8', windowsHide: true, timeout: 60_000,
  })
  if (parsed.error || parsed.status !== 0) throw new Error(`Packaged PowerShell scripts failed Windows PowerShell 5.1 parsing: ${(parsed.stderr || parsed.stdout || parsed.error?.message || 'no diagnostic').slice(0, 4_000)}`)
}
if ([...actualPayload].some(path => /(?:^|[\\/])(?:tests?|__tests__|fixtures?|\.git)(?:[\\/]|$)|\.(?:sqlite3?|db3?|hraid(?:\.|$)|dpapi(?:\.|$)|pem|p12|key)$/i.test(path))) throw new Error('Server payload contains test files or sensitive user data.')
const forbiddenNames = /(^|[\\/])(Server|Server\.next|server|node_modules|release|.*\.sqlite(?:3)?|.*\.hraid|.*\.dpapi)([\\/]|$)/i
const packagedFiles = []
async function collect(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const absolute = join(path, entry.name)
    const name = relative(unpacked, absolute)
    const expectedPayload = name.replaceAll('\\', '/').startsWith('resources/server-payload/')
    if (!expectedPayload && forbiddenNames.test(name)) throw new Error(`Unexpected server or data payload in portable package: ${name}`)
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
  'Для встановлення сервера потрібне підтвердження UAC. Системні зміни починаються лише після явного підтвердження у майстрі.',
  'Перевірка середовища доступна окремо; база SQLite та службові дані створюються лише після натискання «Встановити сервер».',
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
