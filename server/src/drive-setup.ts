import { createHash, randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { DriveSecretsStore, createRecoveryKey } from './backup-crypto.js'

const scope = 'https://www.googleapis.com/auth/drive.file'
const tokenEndpoint = 'https://oauth2.googleapis.com/token'
const folderEndpoint = 'https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType,appProperties'
const driveFilesEndpoint = 'https://www.googleapis.com/drive/v3/files'

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function openBrowser(url: string): void {
  execFile('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true }, () => undefined)
}

async function readOAuthCode(clientId: string): Promise<{ code: string; verifier: string; redirectUri: string }> {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = randomBytes(24).toString('base64url')
  const server = createServer()
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Не вдалося відкрити локальний порт для первинного підключення Google Drive.')
  const redirectUri = `http://127.0.0.1:${address.port}/oauth2/callback`
  const authorization = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authorization.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope,
    access_type: 'offline',
    prompt: 'consent',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString()
  openBrowser(authorization.toString())
  console.log('Завершіть авторизацію Google у браузері. Якщо браузер не відкрився, відкрийте посилання вручну:')
  console.log(authorization.toString())
  try {
    const code = await new Promise<string>((resolveCode, rejectCode) => {
      const timeout = setTimeout(() => rejectCode(new Error('Час очікування авторизації Google вичерпано.')), 5 * 60_000)
      server.on('request', (request, response) => {
        const requestUrl = new URL(request.url ?? '/', `http://127.0.0.1:${address.port}`)
        if (requestUrl.pathname !== '/oauth2/callback') { response.writeHead(404).end(); return }
        if (requestUrl.searchParams.get('state') !== state) { response.writeHead(400).end('Некоректний стан авторизації.'); clearTimeout(timeout); rejectCode(new Error('Перевірка стану OAuth не пройдена.')); return }
        const error = requestUrl.searchParams.get('error')
        const authorizationCode = requestUrl.searchParams.get('code')
        if (error || !authorizationCode) { response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Не вдалося підключити Google Drive. Поверніться до вікна налаштування.'); clearTimeout(timeout); rejectCode(new Error('Google відхилив авторизацію.')); return }
        response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Google Drive підключено. Можна закрити це вікно та повернутися до HromadaAID.')
        clearTimeout(timeout)
        resolveCode(authorizationCode)
      })
    })
    return { code, verifier, redirectUri }
  } finally {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
  }
}

async function main(): Promise<void> {
  const directoryArg = argument('--backup-dir')
  if (!directoryArg) throw new Error('Вкажіть явний каталог копій параметром --backup-dir <шлях>.')
  const directory = resolve(directoryArg)
  if (/\.sqlite(?:3)?$/i.test(directory) || /[\\/]AppData[\\/]Roaming[\\/]hromada-aid[\\/]hromada-aid\.sqlite$/i.test(directory)) {
    throw new Error('Параметр --backup-dir має вказувати на каталог резервних копій, а не на файл SQLite.')
  }
  const store = new DriveSecretsStore(directory)
  const reconnect = process.argv.includes('--reconnect')
  const existingSecrets = store.exists() ? store.load() : null
  if (existingSecrets && !reconnect) throw new Error('Google Drive вже налаштований. Для повторного OAuth-підключення запустіть команду з --reconnect.')
  if (reconnect && !existingSecrets) throw new Error('Для повторного підключення не знайдено чинних локальних параметрів резервування.')
  const clientId = process.env.HROMADA_AID_GOOGLE_CLIENT_ID?.trim()
  const clientSecret = process.env.HROMADA_AID_GOOGLE_CLIENT_SECRET
  if (!clientId) throw new Error('Задайте HROMADA_AID_GOOGLE_CLIENT_ID для OAuth Desktop-клієнта Google.')

  const { code, verifier, redirectUri } = await readOAuthCode(clientId)
  const tokenBody = new URLSearchParams({ client_id: clientId, code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirectUri })
  if (clientSecret) tokenBody.set('client_secret', clientSecret)
  const tokenResponse = await fetch(tokenEndpoint, { method: 'POST', signal: AbortSignal.timeout(60_000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: tokenBody })
  if (!tokenResponse.ok) throw new Error('Не вдалося обміняти код авторизації Google. Перевірте OAuth-клієнт і спробуйте ще раз.')
  const tokens = await tokenResponse.json() as { refresh_token?: string; access_token?: string }
  if (!tokens.refresh_token || !tokens.access_token) throw new Error('Google не надав потрібні дані авторизації. Повторіть підключення з доступом до Google Drive.')

  let folderId = existingSecrets?.google.folderId
  if (folderId) {
    const folderCheck = await fetch(`${driveFilesEndpoint}/${encodeURIComponent(folderId)}?fields=id,name,mimeType`, { signal: AbortSignal.timeout(60_000), headers: { Authorization: `Bearer ${tokens.access_token}` } })
    if (folderCheck.status === 404) folderId = undefined
    else if (!folderCheck.ok) throw new Error('Не вдалося перевірити попередню папку Google Drive. Авторизуйте той самий обліковий запис установи.')
    else {
      const previousFolder = await folderCheck.json() as { id?: string; mimeType?: string }
      if (!previousFolder.id || previousFolder.mimeType !== 'application/vnd.google-apps.folder') throw new Error('Збережена папка Google Drive недоступна для повторного підключення.')
      folderId = previousFolder.id
    }
  }
  if (!folderId) {
    const folderResponse = await fetch(folderEndpoint, {
      signal: AbortSignal.timeout(60_000),
      method: 'POST',
      headers: { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'HromadaAID Backups', mimeType: 'application/vnd.google-apps.folder', appProperties: { hromadaAidBackupFolder: 'true' } }),
    })
    if (!folderResponse.ok) throw new Error('Не вдалося створити окрему папку резервних копій у Google Drive.')
    const folder = await folderResponse.json() as { id?: string }
    if (!folder.id) throw new Error('Google Drive не повернув ідентифікатор папки резервних копій.')
    folderId = folder.id
  }

  const recoveryKey = existingSecrets ? undefined : createRecoveryKey()
  const secrets = { version: 1 as const, encryptionKey: existingSecrets?.encryptionKey ?? recoveryKey!.encoded, google: { refreshToken: tokens.refresh_token, folderId } }
  if (existingSecrets) store.save(secrets)
  else store.create(secrets)
  if (recoveryKey) {
    console.log('Google Drive підключено. Збережіть ключ відновлення офлайн у захищеному місці; він не зберігається разом із резервними копіями:')
    console.log(recoveryKey.encoded)
    console.log('Каталог локального стану захищено ACL Windows. Не надсилайте ключ разом із файлами резервних копій.')
  } else console.log('Google Drive повторно підключено; локальний ключ шифрування збережено без змін.')
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Не вдалося налаштувати Google Drive.')
  process.exitCode = 1
})

