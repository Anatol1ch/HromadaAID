import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const release = join(root, 'release')
const source = join(release, 'win-unpacked')
const output = join(release, 'HromadaAID-Client-portable')
const archive = join(release, 'HromadaAID-Client-portable.zip')
const appAsar = join(source, 'resources', 'app.asar')

function assert(condition, message) { if (!condition) throw new Error(message) }

async function locateAsarCli() {
  const store = join(root, 'node_modules', '.pnpm')
  const entries = await readdir(store)
  const packageDirectory = entries.find(entry => entry.startsWith('@electron+asar@'))
  if (!packageDirectory) throw new Error('Не знайдено локальний інструмент перевірки app.asar.')
  return join(store, packageDirectory, 'node_modules', '@electron', 'asar', 'bin', 'asar.js')
}

async function verifyRendererPayload(directory) {
  const asarPath = join(directory, 'resources', 'app.asar')
  assert((await stat(asarPath).catch(() => undefined))?.isFile(), 'У portable Client відсутній resources/app.asar.')
  const tempRoot = await mkdtemp(join(tmpdir(), 'hromada-client-asar-'))
  try {
    execFileSync(process.execPath, [await locateAsarCli(), 'extract', asarPath, tempRoot], { stdio: 'ignore' })
    const htmlPath = join(tempRoot, 'dist', 'index.html')
    const html = await readFile(htmlPath, 'utf8')
    const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1])
      .filter(value => /\.(?:js|css)(?:\?|$)/i.test(value))
    assert(references.length >= 2, 'index.html не містить очікуваних локальних JS/CSS ресурсів.')
    for (const reference of references) {
      assert(!reference.startsWith('/') && !/^[a-z]+:/i.test(reference), `Renderer має абсолютний або зовнішній asset URL: ${reference}`)
      const resourcePath = resolve(join(tempRoot, 'dist'), decodeURIComponent(reference.split('?')[0]))
      const distRoot = resolve(join(tempRoot, 'dist'))
      assert(resourcePath.startsWith(`${distRoot}${sep}`), `Renderer asset виходить за межі dist: ${reference}`)
      assert((await stat(resourcePath).catch(() => undefined))?.isFile(), `У app.asar відсутній renderer asset: ${reference}`)
    }
    assert(!(await stat(join(directory, 'resources', 'server-payload')).catch(() => undefined)), 'Client portable містить серверний payload.')
    return references
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

try {
  assert((await stat(source).catch(() => undefined))?.isDirectory(), 'Не знайдено electron-builder win-unpacked. Спочатку виконайте client:portable.')
  const references = await verifyRendererPayload(source)
  await rm(output, { recursive: true, force: true })
  await rm(archive, { force: true })
  await mkdir(output, { recursive: true })
  await cp(source, output, { recursive: true })
  await verifyRendererPayload(output)
  execFileSync('tar.exe', ['-a', '-c', '-f', archive, '-C', output, '.'], { stdio: 'ignore' })
  console.log(`Portable Client: ${output}`)
  console.log(`Архів для перенесення: ${archive}`)
  console.log(`Перевірено renderer assets у app.asar: ${references.join(', ')}`)
} catch (error) {
  console.error('Не вдалося підготувати portable Client: ' + (error instanceof Error ? error.message : 'невідома помилка'))
  process.exitCode = 1
}
