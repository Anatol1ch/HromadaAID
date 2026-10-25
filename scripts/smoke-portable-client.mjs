import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const appDirectory = join(root, 'release', 'HromadaAID-Client-portable')
const executable = join(appDirectory, 'HromadaAID.exe')
const profile = await mkdtemp(join(tmpdir(), 'hromada-client-portable-smoke-'))
const portServer = createServer()
await new Promise((resolvePromise, reject) => portServer.once('error', reject).listen(0, '127.0.0.1', resolvePromise))
const port = portServer.address().port
await new Promise(resolvePromise => portServer.close(resolvePromise))

function delay(ms) { return new Promise(resolvePromise => setTimeout(resolvePromise, ms)) }

async function getPageTarget() {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`).catch(() => undefined)
  if (!response?.ok) return undefined
  const targets = await response.json().catch(() => [])
  return targets.find(target => target.type === 'page' && target.url.startsWith('file:'))
}

function connectCdp(url) {
  const socket = new WebSocket(url)
  let nextId = 0
  const pending = new Map()
  const events = []
  socket.addEventListener('message', event => {
    let message
    try { message = JSON.parse(event.data) } catch { return }
    if (message.id && pending.has(message.id)) {
      const { resolve: resolvePromise, reject } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) reject(new Error(message.error.message))
      else resolvePromise(message.result)
    } else if (message.method) events.push(message)
  })
  return {
    socket,
    events,
    async ready() {
      if (socket.readyState === WebSocket.OPEN) return
      await new Promise((resolvePromise, reject) => {
        socket.addEventListener('open', resolvePromise, { once: true })
        socket.addEventListener('error', reject, { once: true })
      })
    },
    send(method, params = {}) {
      const id = ++nextId
      socket.send(JSON.stringify({ id, method, params }))
      return new Promise((resolvePromise, reject) => pending.set(id, { resolve: resolvePromise, reject }))
    },
  }
}

let child
try {
  const resolvedAppDirectory = resolve(appDirectory)
  if (dirname(resolve(executable)) !== resolvedAppDirectory || !resolve(executable).startsWith(`${resolvedAppDirectory}${sep}`)) throw new Error('Unexpected Client portable executable path.')
  child = spawn(executable, [`--remote-debugging-port=${port}`, '--remote-allow-origins=*'], {
    cwd: appDirectory,
    windowsHide: false,
    stdio: 'ignore',
    env: { ...process.env, APPDATA: join(profile, 'Roaming'), LOCALAPPDATA: join(profile, 'Local') },
  })
  let exitCode
  let spawnError
  child.once('error', error => { spawnError = error })
  child.once('exit', code => { exitCode = code })
  const deadline = Date.now() + 25_000
  let target
  while (Date.now() < deadline && !target && !spawnError && exitCode === undefined) {
    target = await getPageTarget()
    if (!target) await delay(250)
  }
  if (spawnError) throw spawnError
  if (exitCode !== undefined) throw new Error(`Packaged Client exited during startup with code ${exitCode}.`)
  if (!target) throw new Error('Packaged Client did not expose its page for the isolated smoke check.')

  const cdp = connectCdp(target.webSocketDebuggerUrl)
  await cdp.ready()
  await Promise.all([cdp.send('Runtime.enable'), cdp.send('Page.enable')])
  const initialLoadDeadline = Date.now() + 10_000
  let initialRendererReady = false
  while (Date.now() < initialLoadDeadline && !initialRendererReady) {
    const initial = await cdp.send('Runtime.evaluate', {
      expression: `document.readyState === 'complete' && Boolean(document.querySelector('#root')?.innerText.trim())`,
      returnByValue: true,
    })
    initialRendererReady = initial.result.value === true
    if (!initialRendererReady) await delay(250)
  }
  if (!initialRendererReady) throw new Error('Packaged Client renderer did not finish its initial load.')
  await cdp.send('Network.enable')
  await cdp.send('Page.reload', { ignoreCache: true })
  await delay(2_000)
  const evaluated = await cdp.send('Runtime.evaluate', { expression: `JSON.stringify({url:location.href,title:document.title,rootText:document.querySelector('#root')?.innerText ?? '',resources:performance.getEntriesByType('resource').map(x=>x.name),styles:[...document.querySelectorAll('link[rel=stylesheet]')].map(x=>({href:x.href,loaded:Boolean(x.sheet)}))})`, returnByValue: true })
  const snapshot = JSON.parse(evaluated.result.value)
  const requestedUrls = new Map(cdp.events.filter(event => event.method === 'Network.requestWillBeSent').map(event => [event.params.requestId, event.params.request.url]))
  const failedRequests = cdp.events.filter(event => event.method === 'Network.loadingFailed' && /^file:.*\/assets\//i.test(requestedUrls.get(event.params.requestId) ?? ''))
  if (!snapshot.url.startsWith('file:') || !snapshot.rootText.trim()) throw new Error('React інтерфейс не відобразив вміст у packaged Electron.')
  if (!snapshot.styles.length || snapshot.styles.some(style => !style.loaded)) throw new Error('CSS renderer не завантажився у packaged Electron: ' + JSON.stringify(snapshot.styles))
  if (failedRequests.length) throw new Error('Chromium повідомив про помилку завантаження renderer asset.')
  if (exitCode !== undefined) throw new Error(`Packaged Client завершився під час smoke-перевірки з кодом ${exitCode}.`)
  console.log('Packaged Client запустився з file://, React renderer відобразився, локальні JS/CSS ресурси завантажено.')
  console.log('Використано чистий тимчасовий профіль без адреси API; smoke не виконував авторизацію чи бізнес-запити.')
  cdp.socket.close()
} finally {
  if (child && child.exitCode === null) {
    child.kill()
    await Promise.race([new Promise(resolvePromise => child.once('exit', resolvePromise)), delay(5_000)])
  }
  const tempRoot = resolve(tmpdir())
  if (!profile.startsWith(`${tempRoot}${sep}`) || !profile.includes('hromada-client-portable-smoke-')) throw new Error('Refusing to remove an unexpected temporary profile.')
  await rm(profile, { recursive: true, force: true })
}
