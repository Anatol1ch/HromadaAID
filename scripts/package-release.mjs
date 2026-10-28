import { execFileSync } from 'node:child_process'
import { cp, copyFile, lstat, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { writeComponentManifest, verifyComponentPackage } from '../packaging/component-package.mjs'
import { verifyServerPackage } from '../packaging/verify-server-package.mjs'
import { verifyServerRuntime } from '../packaging/server-runtime-check.mjs'
import { isStableReleaseVersion, writeReleaseManifest, verifyReleaseManifest } from '../packaging/release-manifest.mjs'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Explicit entry names avoid Windows PowerShell/.NET Framework backslashes,
// which the existing Manager correctly rejects as unsafe ZIP paths.
export function createServerZip(source, archive) {
  const encode = value => Buffer.from(resolve(value), 'utf8').toString('base64')
  const script = `$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$source=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(source)}'))
$archive=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(archive)}'))
$zip=[IO.Compression.ZipFile]::Open($archive,[IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($file in [IO.Directory]::GetFiles($source,'*',[IO.SearchOption]::AllDirectories)) {
    $name=$file.Substring($source.Length+1).Replace([char]92,[char]47)
    [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$file,$name,[IO.Compression.CompressionLevel]::Optimal)
  }
} finally { $zip.Dispose() }`
  execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { stdio: 'inherit', windowsHide: true })
}

export async function packageRelease(root = projectRoot) {
  if (process.platform !== 'win32') throw new Error('Release packaging requires Windows x64.')
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  if (!isStableReleaseVersion(version)) throw new Error('Release version must be stable SemVer X.Y.Z.')
  const release = join(root, 'release')
  const output = join(release, version)
  // Never overwrite an existing local release (including the published Stable).
  if (await lstat(output).catch(error => { if (error.code !== 'ENOENT') throw error })) throw new Error(`Release directory already exists: ${output}`)
  const payload = join(release, 'installer-payload', 'Server')
  const payloadManifest = JSON.parse(await readFile(join(release, 'installer-payload', 'package-manifest.json'), 'utf8'))
  const serverVersion = JSON.parse(await readFile(join(payload, 'app', 'package.json'), 'utf8')).version
  const managerVersion = await readFile(join(release, 'installer-payload', 'ServerManager', 'resources', 'manager-version.ini'), 'utf8')
  if (payloadManifest.appVersion !== version || serverVersion !== version || !managerVersion.split(/\r?\n/).includes(`version=${version}`)) throw new Error('Client/Server/Manager payload versions do not match package.json.')
  const { verifyUpdatePackage } = await import(pathToFileURL(join(projectRoot, 'dist-server-manager/main/server-update.js')).href)
  const { createWindowsServerUpdateAdapters } = await import(pathToFileURL(join(projectRoot, 'dist-server-manager/main/windows-server-update.js')).href)
  await verifyServerPackage(payload, { verifyRuntime: true })
  const work = await mkdtemp(join(release, '.release-package-'))
  try {
    const staged = join(work, 'artifacts')
    const server = join(work, 'server')
    await mkdir(staged)
    await cp(payload, server, { recursive: true })
    const runtime = verifyServerRuntime(server)
    const apiSource = await readFile(join(server, 'app/dist/shared/api-compatibility.js'), 'utf8')
    const apiVersion = Number(/HROMADAAID_API_CONTRACT_VERSION\s*=\s*(\d+)/.exec(apiSource)?.[1])
    await writeComponentManifest(server, {
      component: 'server', name: 'HromadaAID Server', version, platform: 'win32', architecture: 'x64',
      compatibility: { serverApi: { contract: 'hromadaaid-rest', version: apiVersion }, sqliteSchema: { minimum: 1, maximum: runtime.maximumSupportedSchemaVersion } },
    })
    await verifyComponentPackage(server, 'server')
    await verifyUpdatePackage(server)
    const zip = join(staged, `HromadaAID-Server-v${version}-win-x64.zip`)
    createServerZip(server, zip)
    // Use the actual updater's safe extraction, including its ZIP size/path limits.
    const extracted = join(work, 'extracted')
    await createWindowsServerUpdateAdapters().extract(zip, extracted)
    await verifyComponentPackage(extracted, 'server')
    await verifyServerPackage(extracted, { verifyRuntime: true })
    const identity = await verifyUpdatePackage(extracted)
    if (identity.version !== version) throw new Error('Extracted ZIP version does not match release version.')
    const setupName = `HromadaAID-Setup-${version}.exe`
    await copyFile(join(release, setupName), join(staged, setupName))
    const manifest = await writeReleaseManifest(staged, version)
    await verifyReleaseManifest(staged, manifest)
    await rename(staged, output)
    console.log(`Verified release package: ${output}`)
    return output
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  packageRelease().catch(error => { console.error(error.message); process.exitCode = 1 })
}
