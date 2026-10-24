import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const manifestName = 'package-manifest.json'
const apiContractId = 'hromadaaid-rest'
const bannedFile = /(?:^|[/\\])(?:tests?|__tests__|fixtures?|\.git)(?:[/\\]|$)|\.(?:test\.[cm]?[jt]sx?|spec\.[cm]?[jt]sx?|sqlite3?|db3?|hraid(?:\.|$)|dpapi(?:\.|$)|pem|p12|key)$/i
const secretText = /(?:BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|(?:client_secret|refresh_token|access_token|recovery_key|dpapi_key)\s*[:=])/i
const serverRequiredFiles = [
  'runtime/node.exe', 'service/HromadaAIDService.exe', 'service/HromadaAIDService.xml.template',
  'app/dist/server/src/installed.js', 'app/node_modules/argon2/package.json',
  'app/node_modules/@phc/format/package.json', 'app/node_modules/fastify/package.json',
  'installer/prepare-server-install.mjs', 'installer/install-server-service.ps1',
]

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex') }

export async function packageFiles(rootDirectory) {
  const root = resolve(rootDirectory)
  const files = []
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const info = await lstat(path)
      if (info.isSymbolicLink()) throw new Error('Пакет містить символічне посилання: ' + path)
      if (info.isDirectory()) { await walk(path); continue }
      if (!info.isFile()) throw new Error('Пакет містить непідтримуваний файловий об’єкт: ' + path)
      const relative = path.slice(root.length + 1).split(sep).join('/')
      if (relative !== manifestName && bannedFile.test(relative)) throw new Error('До пакета потрапив заборонений тестовий, користувацький або секретний файл: ' + relative)
      const bytes = await readFile(path)
      if (relative !== manifestName && /\.(?:json|[cm]?js|html|css|txt|ya?ml|xml|svg)$/i.test(relative) && secretText.test(bytes.toString('utf8'))) {
        throw new Error('У пакеті виявлено файл із ознаками вбудованого секрету: ' + relative)
      }
      files.push({ path: relative, sizeBytes: info.size, sha256: sha256(bytes) })
    }
  }
  await walk(root)
  return files.sort((left, right) => left.path.localeCompare(right.path, 'en'))
}

function loadAsar() {
  const require = createRequire(import.meta.url)
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const pnpmStore = join(projectRoot, 'node_modules', '.pnpm')
  if (!existsSync(pnpmStore)) throw new Error('Не знайдено build-залежність для перевірки Electron ASAR.')
  const candidates = []
  for (const entry of readdirSync(pnpmStore)) {
    if (!entry.startsWith('@electron+asar@')) continue
    const candidate = join(pnpmStore, entry, 'node_modules', '@electron', 'asar', 'lib', 'asar.js')
    if (existsSync(candidate)) candidates.push(candidate)
  }
  if (candidates.length !== 1) throw new Error('Потрібна рівно одна закріплена build-залежність @electron/asar для перевірки клієнта.')
  return require(candidates[0])
}

function validateClientContents(root, files) {
  for (const file of files) {
    if (/(?:^|\/)(?:server|service|installer|runtime)\//i.test(file.path) || /(?:^|\/)(?:node\.exe|HromadaAIDService\.exe|server\.json)$/i.test(file.path)) {
      throw new Error('Клієнтський пакет містить серверний компонент: ' + file.path)
    }
  }
  if (!files.some(file => file.path === 'HromadaAID.exe') || !files.some(file => file.path === 'resources/app.asar')) {
    throw new Error('Клієнтський пакет не містить виконуваний файл Electron або app.asar.')
  }
  const archive = join(root, 'resources', 'app.asar')
  const asar = loadAsar()
  const entries = asar.listPackage(archive, { isPack: false }).map(value => value.replace(/^[/\\]+/, '').replaceAll('\\', '/'))
  const forbidden = entries.find(path => bannedFile.test(path) || /(?:^|\/)(?:server\/src|create-admin\.js|HromadaAIDService\.exe|node\.exe|argon2|fastify)(?:\/|$)/i.test(path))
  if (forbidden) throw new Error('Electron ASAR містить тестовий або серверний ресурс: ' + forbidden)
  const application = JSON.parse(asar.extractFile(archive, 'package.json'.split('/').join(sep)).toString('utf8'))
  if (Object.keys(application.devDependencies ?? {}).length || ['argon2', 'fastify'].some(name => Object.hasOwn(application.dependencies ?? {}, name))) throw new Error('Electron ASAR містить серверні або development-залежності.')
  for (const path of entries) {
    if (!/\.(?:json|[cm]?js|html|css|txt|ya?ml|xml|svg)$/i.test(path)) continue
    if (secretText.test(asar.extractFile(archive, path.split('/').join(sep)).toString('utf8'))) throw new Error('Electron ASAR містить файл із ознаками вбудованого секрету: ' + path)
  }
}

export async function writeComponentManifest(rootDirectory, metadata) {
  const root = resolve(rootDirectory)
  const files = await packageFiles(root)
  if (metadata.component === 'client') validateClientContents(root, files)
  if (metadata.component === 'server') for (const path of serverRequiredFiles) if (!files.some(file => file.path === path)) throw new Error('Серверний пакет неповний: відсутній ' + path)
  const manifest = { formatVersion: 1, packageSchemaVersion: 1, authenticity: { method: 'sha256-manifest', detachedSignature: null }, ...metadata, files }
  await writeFile(join(root, manifestName), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  return manifest
}

export async function verifyComponentPackage(rootDirectory, expectedComponent) {
  const root = resolve(rootDirectory)
  const manifest = JSON.parse(await readFile(join(root, manifestName), 'utf8'))
  if (manifest.formatVersion !== 1 || manifest.packageSchemaVersion !== 1 || manifest.component !== expectedComponent || typeof manifest.name !== 'string' || typeof manifest.version !== 'string' || manifest.platform !== 'win32' || manifest.architecture !== 'x64') {
    throw new Error('Маніфест пакета несумісний із форматом, компонентом або платформою.')
  }
  if (manifest.authenticity?.method !== 'sha256-manifest' || (manifest.authenticity.detachedSignature !== null && typeof manifest.authenticity.detachedSignature !== 'string')) throw new Error('Метадані перевірки автентичності пакета некоректні.')
  if (expectedComponent === 'client') {
    const range = manifest.compatibility?.serverApi
    if (range?.contract !== apiContractId || !Number.isInteger(range.minimum) || !Number.isInteger(range.maximum) || range.minimum < 1 || range.minimum > range.maximum) throw new Error('Метадані сумісності API клієнта некоректні.')
  } else if (expectedComponent === 'server') {
    const api = manifest.compatibility?.serverApi
    const schema = manifest.compatibility?.sqliteSchema
    if (api?.contract !== apiContractId || !Number.isInteger(api.version) || api.version < 1 || !Number.isInteger(schema?.minimum) || !Number.isInteger(schema?.maximum) || schema.minimum < 1 || schema.minimum > schema.maximum) throw new Error('Метадані сумісності сервера некоректні.')
  }
  const expected = new Map(manifest.files.map(file => [file.path, file]))
  if (expected.size !== manifest.files.length) throw new Error('Маніфест містить дублікати шляхів.')
  const actual = await packageFiles(root)
  const actualPayload = actual.filter(file => file.path !== manifestName)
  if (actualPayload.length !== expected.size) throw new Error('Фактичний склад пакета не відповідає маніфесту.')
  for (const file of actualPayload) {
    const entry = expected.get(file.path)
    if (!entry || entry.sizeBytes !== file.sizeBytes || entry.sha256 !== file.sha256) throw new Error('Файл пакета не відповідає маніфесту: ' + file.path)
  }
  if (expectedComponent === 'client') validateClientContents(root, actualPayload)
  if (expectedComponent === 'server') for (const path of serverRequiredFiles) if (!expected.has(path)) throw new Error('Серверний пакет неповний за маніфестом: відсутній ' + path)
  return manifest
}
