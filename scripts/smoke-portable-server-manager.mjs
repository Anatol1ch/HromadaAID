import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const executable = resolve(root, 'release/server-manager/win-unpacked/HromadaAID Server Manager.exe')
const expectedDirectory = resolve(root, 'release/server-manager/win-unpacked')
if (dirname(executable) !== expectedDirectory || !executable.startsWith(`${expectedDirectory}${sep}`)) {
  throw new Error('Unexpected portable executable path.')
}

const profile = await mkdtemp(join(tmpdir(), 'hromada-manager-portable-smoke-'))
const child = spawn(executable, [], {
  cwd: expectedDirectory,
  windowsHide: false,
  stdio: 'ignore',
  env: { ...process.env, APPDATA: join(profile, 'Roaming'), LOCALAPPDATA: join(profile, 'Local') },
})
let exitCode
let spawnError
child.once('error', error => { spawnError = error })
let exited = false
child.once('exit', code => { exitCode = code; exited = true })

try {
  const deadline = Date.now() + 12_000
  while (Date.now() < deadline && exitCode === undefined && !spawnError) {
    await new Promise(resolvePromise => setTimeout(resolvePromise, 250))
  }
  if (spawnError) throw spawnError
  if (exitCode !== undefined) throw new Error(`Portable Server Manager exited during startup with code ${exitCode}.`)
  console.log('Portable Server Manager remained running for 12 seconds after launch.')
  console.log('The packaged app starts without Node.js, pnpm, Vite or an automatic server/API request.')
} finally {
  if (exitCode === undefined && !spawnError) {
    child.kill()
    await Promise.race([
      new Promise(resolvePromise => child.once('exit', resolvePromise)),
      new Promise(resolvePromise => setTimeout(resolvePromise, 5_000)),
    ])
    if (!exited) throw new Error('Portable Server Manager did not exit after the smoke process was stopped.')
  }
  const resolvedTemp = resolve(tmpdir())
  if (!profile.startsWith(`${resolvedTemp}${sep}`) || !profile.includes('hromada-manager-portable-smoke-')) {
    throw new Error('Refusing to remove an unexpected temporary profile.')
  }
  await rm(profile, { recursive: true, force: true })
}
