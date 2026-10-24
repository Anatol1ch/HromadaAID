import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyServerRuntime } from './server-runtime-check.mjs'

async function assertNoPackageLinks(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const info = await lstat(path)
    if (info.isSymbolicLink()) throw new Error('Серверний пакет містить посилання, що може виходити за його межі: ' + path.slice(directory.length))
    if (info.isDirectory()) await assertNoPackageLinks(path)
  }
}

export async function verifyServerPackage(packageRoot, { verifyRuntime = false } = {}) {
  const root = resolve(packageRoot)
  await assertNoPackageLinks(root)
  const manifestPath = join(root, 'package-integrity.json')
  let manifest
  try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')) }
  catch { throw new Error('Не знайдено коректний маніфест цілісності серверного пакета.') }
  if (manifest.formatVersion !== 1 || !Array.isArray(manifest.files) || manifest.files.length < 1) throw new Error('Маніфест серверного пакета несумісний.')
  for (const entry of manifest.files) {
    if (typeof entry.path !== 'string' || !entry.path || entry.path.includes('\\') || entry.path.split('/').some(part => part === '' || part === '.' || part === '..')) throw new Error('Маніфест серверного пакета містить некоректний шлях.')
    const path = resolve(root, ...entry.path.split('/'))
    const rel = relative(root, path)
    if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('Маніфест серверного пакета виходить за межі каталогу.')
    let bytes
    let info
    try { [bytes, info] = await Promise.all([readFile(path), stat(path)]) }
    catch { throw new Error('У серверному пакеті відсутній файл: ' + entry.path) }
    if (!info.isFile() || info.size !== entry.sizeBytes || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error('Файл серверного пакета не пройшов перевірку цілісності: ' + entry.path)
  }
  if (verifyRuntime) verifyServerRuntime(root)
  return manifest
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('Не задано каталог серверного пакета.')
    const manifest = await verifyServerPackage(process.argv[2], { verifyRuntime: true })
    console.log('Пакет сервера перевірено: ' + manifest.files.length + ' файлів; Node.js, production-залежності та create-admin.js --status працюють.')
  } catch (error) {
    console.error('Перевірка серверного пакета не пройшла: ' + (error instanceof Error ? error.message : 'невідома помилка'))
    process.exitCode = 1
  }
}
