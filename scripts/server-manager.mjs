import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import waitOn from 'wait-on'
import { createServer } from 'node:net'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const mode = process.argv[2]
if (!['dev', 'start', 'smoke', 'smoke-dev', 'smoke-status'].includes(mode)) throw new Error('Expected dev, start, smoke or smoke-dev')
const electronDirectory = dirname(require.resolve('electron/package.json'))
const electron = join(electronDirectory, 'dist', readFileSync(join(electronDirectory, 'path.txt'), 'utf8').trim())
const children = new Set()
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'ELECTRON_RUN_AS_NODE'))
let stopping = false

function run(executable, args, electronProcess = false) {
  const child = spawn(executable, args, { cwd: root, stdio: 'inherit', windowsHide: !electronProcess, env })
  children.add(child)
  const completion = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', code => {
      children.delete(child)
      if (code === 0 || stopping) resolve()
      else reject(new Error(`Server Manager process exited with code ${code}`))
    })
  })
  return { child, completion }
}
function stop() {
  stopping = true
  for (const child of children) child.kill()
}
process.once('SIGINT', stop)
process.once('SIGTERM', stop)

try {
  if (mode === 'dev' || mode === 'smoke-dev') {
    await run(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', join(root, 'server-manager/tsconfig.electron.json')]).completion
    const probe = createServer()
    await new Promise((resolve, reject) => {
      probe.once('error', () => reject(new Error('Порт Server Manager 5176 зайнятий. Закрийте попередній dev-сеанс і повторіть запуск.')))
      probe.listen(5176, '127.0.0.1', resolve)
    })
    await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()))
    const vite = run(process.execPath, [join(dirname(require.resolve('vite/package.json')), 'bin/vite.js'), '--config', join(root, 'server-manager/vite.config.ts')])
    // A busy port fails without touching another process. Never reuse a client dev session.
    const ready = waitOn({ resources: ['http-get://127.0.0.1:5176/'], timeout: 30_000, proxy: false })
    await Promise.race([ready, vite.completion.then(() => { throw new Error('Vite stopped before manager launch') })])
    void vite.completion.catch(error => { console.error(error.message); process.exitCode = 1; stop() })
    const entry = mode === 'smoke-dev' ? 'server-manager/tests/electron-smoke.mjs' : 'dist-server-manager/main/main.js'
    await run(electron, [join(root, entry), '--manager-dev'], mode === 'dev').completion
  } else {
    const entry = mode === 'smoke-status' ? 'server-manager/tests/status-refresh-smoke.mjs' : mode === 'smoke' ? 'server-manager/tests/electron-smoke.mjs' : 'dist-server-manager/main/main.js'
    await run(electron, [join(root, entry)], mode !== 'smoke').completion
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally { stop() }
