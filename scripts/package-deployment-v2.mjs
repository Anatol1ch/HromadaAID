import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { verifyServerPackage } from '../packaging/verify-server-package.mjs'
import { verifyServerRuntime } from '../packaging/server-runtime-check.mjs'
import { verifyComponentPackage, writeComponentManifest } from '../packaging/component-package.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const release = join(root, 'release')
const clientSource = join(release, 'win-unpacked')
const serverSource = join(release, 'installer-payload', 'Server')
const packageOutput = join(release, 'deployment-v2')
const packageRoot = join(packageOutput, 'Пакети HromadaAID')
const clientTarget = join(packageRoot, 'Client')
const serverTarget = join(packageRoot, 'Server')
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const { HROMADAAID_API_CONTRACT_VERSION } = await import(pathToFileURL(join(root, 'dist-electron', 'shared', 'api-compatibility.js')).href)

async function copyDirectory(source, target) {
  if (!(await stat(source).catch(() => undefined))?.isDirectory()) throw new Error('Не знайдено готовий payload компонента: ' + source)
  await cp(source, target, { recursive: true })
}

try {
  const runtime = verifyServerRuntime(serverSource)
  await verifyServerPackage(serverSource)
  const serverVersion = JSON.parse(await readFile(join(serverSource, 'app', 'package.json'), 'utf8')).version
  if (serverVersion !== packageJson.version) throw new Error('Версії клієнтського та серверного пакета не збігаються.')
  await rm(packageOutput, { recursive: true, force: true })
  await mkdir(packageRoot, { recursive: true })
  await copyDirectory(clientSource, clientTarget)
  await copyDirectory(serverSource, serverTarget)

  const clientManifest = await writeComponentManifest(clientTarget, {
    component: 'client',
    name: 'HromadaAID Client',
    version: packageJson.version,
    platform: 'win32',
    architecture: 'x64',
    compatibility: { serverApi: { contract: 'hromadaaid-rest', minimum: HROMADAAID_API_CONTRACT_VERSION, maximum: HROMADAAID_API_CONTRACT_VERSION } },
  })
  const serverManifest = await writeComponentManifest(serverTarget, {
    component: 'server',
    name: 'HromadaAID Server',
    version: packageJson.version,
    platform: 'win32',
    architecture: 'x64',
    compatibility: {
      serverApi: { contract: 'hromadaaid-rest', version: HROMADAAID_API_CONTRACT_VERSION },
      sqliteSchema: { minimum: 1, maximum: runtime.maximumSupportedSchemaVersion },
    },
  })

  await verifyComponentPackage(clientTarget, 'client')
  await verifyComponentPackage(serverTarget, 'server')
  await verifyServerPackage(serverTarget, { verifyRuntime: true })

  const total = async (rootDirectory, manifest) => manifest.files.reduce((sum, file) => sum + file.sizeBytes, 0) + (await stat(join(rootDirectory, 'package-manifest.json'))).size
  console.log(`Client Package: ${clientTarget} (${await total(clientTarget, clientManifest)} байт, ${clientManifest.files.length + 1} файлів)`)
  console.log(`Server Package: ${serverTarget} (${await total(serverTarget, serverManifest)} байт, ${serverManifest.files.length + 1} файлів)`)
  console.log(`Сумісність: REST API ${serverManifest.compatibility.serverApi.version}; SQLite ${serverManifest.compatibility.sqliteSchema.minimum}–${serverManifest.compatibility.sqliteSchema.maximum}.`)
} catch (error) {
  await rm(packageOutput, { recursive: true, force: true })
  console.error('Не вдалося сформувати пакети Deployment 2.0: ' + (error instanceof Error ? error.message : 'невідома помилка'))
  process.exitCode = 1
}
