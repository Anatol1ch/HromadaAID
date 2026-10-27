import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchUpdatePowerShell, windowsPowerShellPath, quoteWindowsArgument } from './windows-update-launcher.mjs'

test('PowerShell uses a fixed system path and Windows argv quoting', () => {
  assert.equal(windowsPowerShellPath('C:\\Windows'), 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
  assert.throws(() => windowsPowerShellPath('relative'), /системний каталог/)
  assert.equal(quoteWindowsArgument('C:\\two words\\'), '"C:\\two words\\\\"')
  assert.equal(quoteWindowsArgument('a"b'), '"a\\"b"')
})

const harmlessScript = `param([string]$ReadyPath, [string]$HandoffPath)
[Console]::Out.WriteLine('stdout-before-ready')
[Console]::Error.WriteLine('stderr-before-ready')
[IO.File]::WriteAllText($ReadyPath, (@{launcherProcessId=$PID} | ConvertTo-Json -Compress))
while (!(Test-Path -LiteralPath $HandoffPath)) { Start-Sleep -Milliseconds 50 }
Start-Sleep -Milliseconds 1200
[Console]::Out.WriteLine('stdout-after-parent-exit')
[Console]::Error.WriteLine('stderr-after-parent-exit')
[IO.File]::WriteAllText(($ReadyPath + '.completed'), 'completed')
`
const waitForFile = async path => {
  const until = Date.now() + 10000
  while (Date.now() < until) {
    try { return await readFile(path, 'utf8') } catch {}
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.fail(`File not produced: ${path}`)
}
const waitForProcessExit = async pid => {
  const until = Date.now() + 10000
  while (Date.now() < until) {
    try { process.kill(pid, 0) } catch (error) {
      if (error.code === 'ESRCH') return
      throw error
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.fail(`Synthetic launcher ${pid} has not exited; timeout is not completion`)
}

for (const runtime of ['Node', 'Electron']) test(`independent PowerShell and redirected files survive ${runtime} parent exit`, { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'hromada-handoff-І-'))
  try {
    const source = join(root, 'synthetic & (script).ps1')
    await writeFile(source, harmlessScript)
    const parentPath = join(root, 'parent.mjs')
    await writeFile(parentPath, `import {launchUpdatePowerShell} from ${JSON.stringify(new URL('./windows-update-launcher.mjs', import.meta.url).href)};
await launchUpdatePowerShell({updateDirectory:${JSON.stringify(root)},launcherPath:${JSON.stringify(source)},launcherArguments:[],logEvent:async()=>{}}); process.exit(0);`)
    const result = await new Promise((resolve, reject) => {
      const child = spawn(runtime === 'Electron' ? createRequire(import.meta.url)('electron') : process.execPath, [parentPath], { env: runtime === 'Electron' ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      let stderr = ''; child.stderr.on('data', bytes => { stderr += bytes })
      child.once('error', reject); child.once('exit', code => resolve({ code, stderr }))
    })
    assert.equal(result.code, 0, result.stderr)
    const directory = join(root, (await readdir(root)).find(name => name.startsWith('launcher-')))
    await waitForFile(join(directory, 'ready.json.completed'))
    assert.match(await readFile(join(directory, 'stdout.log'), 'utf8'), /stdout-after-parent-exit/)
    assert.match(await readFile(join(directory, 'stderr.log'), 'utf8'), /stderr-after-parent-exit/)
    const metadata = JSON.parse(await readFile(join(directory, 'result.json'), 'utf8'))
    assert.equal(metadata.status, 'ready'); assert.ok(metadata.launcherProcessId > 0)
    await waitForProcessExit(metadata.launcherProcessId)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('pre-body failure, zero exit without readiness, and timeout never authorize handoff', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'hromada-launch-errors-'))
  try {
    for (const [name, body, expected] of [
      ['binding', 'param([ValidateSet("allowed")][string]$ReadyPath,[string]$HandoffPath)', 'exited-before-ready'],
      ['zero', 'param([string]$ReadyPath,[string]$HandoffPath)\nexit 0', 'exited-before-ready'],
      ['timeout', 'param([string]$ReadyPath,[string]$HandoffPath)\nStart-Sleep -Seconds 2', 'readiness-timeout'],
    ]) {
      const dir = join(root, name); await mkdir(dir)
      const source = join(dir, 'probe.ps1'); await writeFile(source, body)
      const events = []
      await assert.rejects(launchUpdatePowerShell({ updateDirectory: dir, launcherPath: source, launcherArguments: [], readyTimeoutMs: name === 'timeout' ? 250 : 5000, logEvent: async (stage, details) => { events.push({ stage, details }) } }))
      const attempt = join(dir, (await readdir(dir)).find(name => name.startsWith('launcher-')))
      const metadata = JSON.parse(await readFile(join(attempt, 'result.json'), 'utf8'))
      assert.equal(metadata.status, expected)
      await assert.rejects(readFile(join(attempt, 'handoff.confirmed')))
      if (name === 'binding') assert.ok((await readFile(join(attempt, 'stderr.log'))).length > 0)
      if (name === 'zero') assert.equal(metadata.exitCode, 0)
      assert.ok(events.some(event => event.stage === 'powershell-process-error'))
    }
  } finally {
    // The timeout child is deliberately not killed; let its synthetic sleep complete.
    await new Promise(resolve => setTimeout(resolve, 2200))
    await rm(root, { recursive: true, force: true })
  }
})

test('spawn failure retains diagnostic files and closes parent descriptors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hromada-launch-spawn-'))
  try {
    const events = []
    await assert.rejects(launchUpdatePowerShell({ updateDirectory: root, launcherPath: 'unused', launcherArguments: [], logEvent: async (stage, details) => events.push({ stage, details }), spawnProcess() { throw new Error('synthetic spawn failure') } }), /synthetic spawn failure/)
    assert.ok(events.some(event => event.stage === 'powershell-process-error'))
    const directory = join(root, (await readdir(root))[0])
    for (const name of ['stdout.log', 'stderr.log', 'bootstrap.stdout.log', 'bootstrap.stderr.log']) {
      assert.equal((await readFile(join(directory, name))).length, 0)
    }
    await rm(root, { recursive: true })
  } finally { await rm(root, { recursive: true, force: true }) }
})
