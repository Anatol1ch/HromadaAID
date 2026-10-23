import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const release = join(root, 'release')
const payload = join(release, 'installer-payload')
const client = join(payload, 'Client')
const server = join(payload, 'Server')
const script = join(root, 'packaging', 'windows-installer.nsi')

function findFile(directory, name, depth = 8) {
  if (depth < 0 || !existsSync(directory)) return undefined
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) return path
    if (entry.isDirectory()) {
      const match = findFile(path, name, depth - 1)
      if (match) return match
    }
  }
}

function findNsisHome(makensis) {
  let current = dirname(makensis)
  for (let index = 0; index < 6; index++) {
    if (existsSync(join(current, 'Include', 'MUI2.nsh'))) return current
    current = dirname(current)
  }
  throw new Error('У комплекті makensis.exe не знайдено NSIS Include/MUI2.nsh.')
}

function nsisDefine(name, value) {
  if (/[\r\n"]/.test(value)) throw new Error('Шлях містить символ, який не можна передати до NSIS.')
  return '/D' + name + '=' + value
}

function main() {
  if (process.platform !== 'win32') throw new Error('Єдиний Windows installer збирається на Windows.')
  if (!existsSync(client) || !existsSync(server)) throw new Error('Спочатку виконайте pnpm windows:package для підготовки обох компонентів.')
  const manifest = JSON.parse(readFileSync(join(payload, 'package-manifest.json'), 'utf8'))
  const cache = join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache')
  let makensis = process.env.MAKENSIS_PATH
  if (!makensis) makensis = findFile(cache, 'makensis.exe')
  if (!makensis) {
    const probe = mkdtempSync(join(tmpdir(), 'hromada-e-builder-nsis-'))
    try {
      const cli = join(root, 'node_modules', 'electron-builder', 'cli.js')
      execFileSync(process.execPath, [cli, '--win', 'nsis', '--x64', '--publish', 'never', '--config.directories.output=' + probe], { cwd: root, stdio: 'inherit' })
      makensis = findFile(cache, 'makensis.exe')
    } finally {
      rmSync(probe, { recursive: true, force: true })
    }
  }
  if (!makensis || !existsSync(makensis)) throw new Error('Не знайдено NSIS compiler. Використайте electron-builder NSIS target або задайте MAKENSIS_PATH.')
  const nsisHome = findNsisHome(makensis)
  const output = join(release, 'HromadaAID-Setup-' + manifest.appVersion + '.exe')
  execFileSync(makensis, [
    '/V2',
    nsisDefine('CLIENT_PAYLOAD', client),
    nsisDefine('SERVER_PAYLOAD', server),
    nsisDefine('PROJECT_DIR', root),
    nsisDefine('OUTPUT_FILE', output),
    script,
  ], { cwd: root, env: { ...process.env, NSISDIR: nsisHome }, stdio: 'inherit' })
  const result = statSync(output)
  if (result.size < 1024 * 1024) throw new Error('Зібраний інсталятор має неочікувано малий розмір.')
  console.log('Тестовий інсталятор зібрано, але НЕ запущено: ' + output)
}

try { main() }
catch (error) {
  console.error('Не вдалося зібрати Windows installer: ' + (error instanceof Error ? error.message : 'невідома помилка'))
  process.exitCode = 1
}
