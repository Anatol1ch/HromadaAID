import { createHash } from 'node:crypto'
import { lstat, readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const isStableReleaseVersion = value => typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

export async function createReleaseManifest(directory, version) {
  if (!isStableReleaseVersion(version)) throw new Error('Release manifest потребує стабільної версії SemVer X.Y.Z.')
  const root = resolve(directory)
  const setupName = `HromadaAID-Setup-${version}.exe`
  const serverName = `HromadaAID-Server-v${version}-win-x64.zip`
  const artifacts = []
  for (const [component, name, extra] of [
    ['installer', setupName, {}],
    ['server', serverName, { packageIntegrity: 'embedded-package-integrity-v1' }],
  ]) {
    const path = join(root, name)
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Артефакт має бути звичайним файлом: ${name}`)
    const bytes = await readFile(path)
    artifacts.push({ component, name, sizeBytes: bytes.length, sha256: sha256(bytes), ...extra })
  }
  return { formatVersion: 1, version, platform: 'win32', architecture: 'x64', compatibility: {
    installer: 'hromadaaid-universal-nsis-v1', installModes: ['Client-only', 'Server-only', 'Combined'],
    api: { contract: 'hromadaaid-rest', version: 1 }, client: { versionPolicy: 'same-release-version' }, server: { integrity: 'embedded-package-integrity-v1' },
  }, artifacts }
}

export async function verifyReleaseManifest(directory, value) {
  if (!value || value.formatVersion !== 1 || !isStableReleaseVersion(value.version) || value.platform !== 'win32' || value.architecture !== 'x64') throw new Error('Метадані release-manifest.json некоректні.')
  if (value.compatibility?.installer !== 'hromadaaid-universal-nsis-v1' || !['Client-only', 'Server-only', 'Combined'].every(mode => value.compatibility?.installModes?.includes(mode)) || value.compatibility?.api?.contract !== 'hromadaaid-rest' || value.compatibility?.api?.version !== 1 || value.compatibility?.server?.integrity !== 'embedded-package-integrity-v1') throw new Error('Метадані сумісності release manifest некоректні.')
  const root = resolve(directory)
  const expected = [
    { component: 'installer', name: `HromadaAID-Setup-${value.version}.exe` },
    { component: 'server', name: `HromadaAID-Server-v${value.version}-win-x64.zip` },
  ]
  if (!Array.isArray(value.artifacts) || value.artifacts.length !== expected.length) throw new Error('Release manifest має містити рівно два основні артефакти.')
  for (const item of expected) {
    const entry = value.artifacts.find(artifact => artifact?.component === item.component && artifact.name === item.name)
    if (!entry || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes < 1) throw new Error(`Release manifest не має коректних метаданих для ${item.name}.`)
    if (item.component === 'server' && entry.packageIntegrity !== 'embedded-package-integrity-v1') throw new Error('Для Server ZIP потрібно повторно використати його внутрішній integrity manifest.')
    const path = join(root, item.name)
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Артефакт відсутній або має небезпечний тип: ${item.name}`)
    if (info.size !== entry.sizeBytes || sha256(await readFile(path)) !== entry.sha256) throw new Error(`Розмір або SHA-256 не збігається для ${item.name}.`)
  }
  return true
}

export async function writeReleaseManifest(directory, version) {
  const root = resolve(directory)
  const value = await createReleaseManifest(root, version)
  await verifyReleaseManifest(root, value)
  await writeFile(join(root, 'release-manifest.json'), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
  return value
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [mode, directory, version] = process.argv.slice(2)
    if (mode === '--create' && directory && version) {
      const value = await writeReleaseManifest(directory, version)
      console.log(`release-manifest.json створено та перевірено: ${value.artifacts.length} артефакти.`)
    } else if (mode === '--verify' && directory) {
      const value = JSON.parse(await readFile(join(directory, 'release-manifest.json'), 'utf8'))
      await verifyReleaseManifest(directory, value)
      console.log('Release manifest і SHA-256 усіх артефактів перевірено.')
    } else throw new Error('Використання: node packaging/release-manifest.mjs --create <directory> <version> або --verify <directory>')
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Не вдалося перевірити release metadata.')
    process.exitCode = 1
  }
}
