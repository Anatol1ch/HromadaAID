import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { SqliteBackupService, listDailyBackups } from './backup.js'
import { createRecoveryKey, decryptBackupFile, DriveSecretsStore, encryptBackupFile } from './backup-crypto.js'
import { DriveSyncStateStore, GoogleDriveBackupSync, GoogleDriveClient, GoogleDriveError } from './google-drive.js'

const syntheticMarker = Buffer.from('SYNTHETIC DATA WITHOUT PERSONAL INFORMATION')

async function temporaryDirectory(): Promise<string> { return mkdtemp(join(tmpdir(), 'hromada-drive-test-')) }
async function createSyntheticDatabase(path: string): Promise<Buffer> {
  const database = new DatabaseSync(path)
  database.exec("CREATE TABLE synthetic(value TEXT); INSERT INTO synthetic VALUES ('SYNTHETIC DATA WITHOUT PERSONAL INFORMATION');")
  database.close()
  return readFile(path)
}
async function removeTemporaryDirectory(directory: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try { await rm(directory, { recursive: true, force: true }); return }
    catch { await new Promise((resolveDelay) => setTimeout(resolveDelay, 100)) }
  }
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
}

test('AES-256-GCM recovery key decrypts an archive and rejects tampering', async () => {
  const directory = await temporaryDirectory()
  try {
    const input = join(directory, 'synthetic.sqlite')
    const encrypted = join(directory, 'synthetic.sqlite.hraid')
    const restored = join(directory, 'restored.sqlite')
    const sourceDatabase = new DatabaseSync(input)
    sourceDatabase.exec("CREATE TABLE synthetic(value TEXT); INSERT INTO synthetic VALUES ('no personal data');")
    sourceDatabase.close()
    const recovery = createRecoveryKey()
    await encryptBackupFile(input, encrypted, recovery.bytes)
    await decryptBackupFile(encrypted, restored, Buffer.from(recovery.encoded, 'base64url'))
    const restoredDatabase = new DatabaseSync(restored, { readOnly: true })
    assert.equal((restoredDatabase.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check, 'ok')
    restoredDatabase.close()
    const bytes = await readFile(encrypted)
    bytes[Math.floor(bytes.length / 2)] ^= 0x01
    await writeFile(encrypted, bytes)
    await assert.rejects(decryptBackupFile(encrypted, join(directory, 'tampered.sqlite'), recovery.bytes))
  } finally { await removeTemporaryDirectory(directory) }
})

test('OAuth secrets are stored protected by Windows DPAPI, while the recovery key remains exportable', async (context) => {
  if (process.platform !== 'win32') { context.skip('Windows DPAPI перевіряється лише на Windows.'); return }
  const directory = await temporaryDirectory()
  try {
    const recovery = createRecoveryKey()
    const store = new DriveSecretsStore(directory)
    store.create({ version: 1, encryptionKey: recovery.encoded, google: { refreshToken: 'synthetic-refresh-token', folderId: 'synthetic-folder-id' } })
    const protectedBytes = await readFile(store.path)
    assert.equal(protectedBytes.includes(Buffer.from(recovery.encoded)), false)
    assert.equal(protectedBytes.includes(Buffer.from('synthetic-refresh-token')), false)
    assert.equal(store.load()?.encryptionKey, recovery.encoded)
  } finally { await removeTemporaryDirectory(directory) }
})

test('Drive retries after lost upload response without duplicate and uploads encrypted bytes only', async () => {
  const directory = await temporaryDirectory()
  const remote = new Map<string, { id: string; name: string; size: number; md5Checksum: string; appProperties: Record<string, string>; createdTime: string; content?: Buffer }>()
  let creates = 0
  let deletes = 0
  let uploadedBody: Buffer | undefined
  let loseFirstResponse = true
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input))
    if (url.hostname === 'oauth2.googleapis.com') return jsonResponse({ access_token: 'synthetic-access-token', expires_in: 3600 })
    if (url.pathname === '/drive/v3/files' && (!init.method || init.method === 'GET')) {
      const query = url.searchParams.get('q') ?? ''
      const files = [...remote.values()].filter((file) => query.includes(file.appProperties.hromadaAidBackupId ?? '') || (query.includes('hromadaAidBackup') && file.appProperties.hromadaAidBackup === 'true'))
      const queryValues = [...query.matchAll(/value='([^']+)'/g)].map((match) => match[1])
      const exactId = queryValues.length > 1 ? queryValues.at(-1) : undefined
      return jsonResponse({ files: exactId ? files.filter((file) => file.appProperties.hromadaAidBackupId === exactId) : files })
    }
    if (url.pathname === '/upload/drive/v3/files' && init.method === 'POST') {
      assert.equal(url.searchParams.get('uploadType'), 'multipart')
      assert.equal(url.searchParams.get('fields'), 'id,name,size,md5Checksum,appProperties,createdTime')
      const chunks: Buffer[] = []
      for await (const chunk of init.body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk))
      uploadedBody = Buffer.concat(chunks)
      const contentType = new Headers(init.headers).get('Content-Type') ?? ''
      const boundary = /boundary=([^;]+)/.exec(contentType)?.[1] ?? ''
      const multipart = uploadedBody.toString('latin1')
      const metadataPart = multipart.slice(multipart.indexOf('\r\n\r\n') + 4).split('\r\n')[0]
      const metadataStart = uploadedBody.indexOf(Buffer.from('{"name"'))
      const metadataEnd = uploadedBody.indexOf(Buffer.from('\r\n--'), metadataStart)
      const metadata = JSON.parse(uploadedBody.subarray(metadataStart, metadataEnd).toString('utf8')) as { name: string; appProperties: Record<string, string> }
      void metadataPart
      assert.ok(boundary)
      assert.equal(uploadedBody.includes(Buffer.from('SQLite format 3\0')), false)
      assert.equal(uploadedBody.includes(syntheticMarker), false)
      const mediaStart = uploadedBody.indexOf(Buffer.from('Content-Type: application/octet-stream\r\n\r\n')) + Buffer.byteLength('Content-Type: application/octet-stream\r\n\r\n')
      const mediaEnd = uploadedBody.lastIndexOf(Buffer.from(`\r\n--${boundary}--`))
      const encrypted = uploadedBody.subarray(mediaStart, mediaEnd)
      const id = `remote-${++creates}`
      const file = { id, name: metadata.name, size: encrypted.length, md5Checksum: createHash('md5').update(encrypted).digest('hex'), appProperties: metadata.appProperties, createdTime: new Date().toISOString(), content: Buffer.from(encrypted) }
      remote.set(id, file)
      if (loseFirstResponse) { loseFirstResponse = false; throw new Error('simulated response loss') }
      return jsonResponse(file)
    }
    const id = url.pathname.split('/').pop()!
    if (url.pathname.startsWith('/drive/v3/files/') && init.method === 'DELETE') { remote.delete(id); deletes++; return new Response(null, { status: 204 }) }
    if (url.pathname.startsWith('/drive/v3/files/')) {
      const file = remote.get(id)
      if (url.searchParams.get('alt') === 'media') return file?.content ? new Response(file.content as unknown as BodyInit) : jsonResponse({}, 404)
      return file ? jsonResponse(file) : jsonResponse({ error: 'not found' }, 404)
    }
    return jsonResponse({}, 404)
  }
  try {
    const backupName = 'hromada-aid-daily-2026-10-21-created-2026-10-22T12-00-00-000-12345678-1234-1234-1234-123456789abc.sqlite'
    const backupPath = join(directory, backupName)
    const plaintext = await createSyntheticDatabase(backupPath)
    const recovery = createRecoveryKey()
    const state = new DriveSyncStateStore(directory)
    state.load()
    const client = new GoogleDriveClient({ clientId: 'synthetic-client', refreshToken: 'synthetic-refresh-token', folderId: 'synthetic-folder' }, fetcher)
    const syncWarnings: string[] = []
    const sync = new GoogleDriveBackupSync(directory, { version: 1, encryptionKey: recovery.encoded, google: { refreshToken: 'synthetic-refresh-token', folderId: 'synthetic-folder' } }, client, state, { warn: (message) => syncWarnings.push(message), error: () => undefined }, { retryDelayMs: 1 })
    assert.equal(await sync.syncOne(), false)
    assert.equal(state.isUploaded(backupName), false)
    assert.equal(await sync.syncOne(), true, syncWarnings.join('; '))
    assert.equal(state.isUploaded(backupName), true)
    assert.equal(creates, 1)
    assert.equal(remote.size, 1)
    assert.ok(uploadedBody)
    assert.equal(uploadedBody.includes(plaintext), false)
    assert.equal((await readdir(directory)).some((name) => name.endsWith('.partial')), false)
  } finally { await removeTemporaryDirectory(directory) }
  void deletes
})

test('cloud retention deletes only managed files after a successful new upload', async () => {
  const directory = await temporaryDirectory()
  const remote = new Map<string, { id: string; name: string; size: number; md5Checksum: string; appProperties: Record<string, string>; createdTime: string }>()
  let sequence = 0
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input))
    if (url.hostname === 'oauth2.googleapis.com') return jsonResponse({ access_token: 'synthetic-access-token', expires_in: 3600 })
    if (url.pathname === '/drive/v3/files' && (!init.method || init.method === 'GET')) {
      const query = url.searchParams.get('q') ?? ''
      const queryValues = [...query.matchAll(/value='([^']+)'/g)].map((match) => match[1])
      const exactId = queryValues.length > 1 ? queryValues.at(-1) : undefined
      let files = [...remote.values()].filter((file) => file.appProperties.hromadaAidBackup === 'true')
      if (exactId) files = files.filter((file) => file.appProperties.hromadaAidBackupId === exactId)
      return jsonResponse({ files })
    }
    if (url.pathname === '/upload/drive/v3/files' && init.method === 'POST') {
      const chunks: Buffer[] = []
      for await (const chunk of init.body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk))
      const data = Buffer.concat(chunks)
      const metadataStart = data.indexOf(Buffer.from('{"name"'))
      const metadataEnd = data.indexOf(Buffer.from('\r\n--'), metadataStart)
      const metadata = JSON.parse(data.subarray(metadataStart, metadataEnd).toString('utf8')) as { name: string; appProperties: Record<string, string> }
      const boundary = /boundary=([^;]+)/.exec(new Headers(init.headers).get('Content-Type') ?? '')?.[1] ?? ''
      const mediaStart = data.indexOf(Buffer.from('Content-Type: application/octet-stream\r\n\r\n')) + Buffer.byteLength('Content-Type: application/octet-stream\r\n\r\n')
      const mediaEnd = data.lastIndexOf(Buffer.from(`\r\n--${boundary}--`))
      const media = data.subarray(mediaStart, mediaEnd)
      const file = { id: `new-${++sequence}`, name: metadata.name, size: media.length, md5Checksum: createHash('md5').update(media).digest('hex'), appProperties: metadata.appProperties, createdTime: new Date().toISOString() }
      remote.set(file.id, file)
      return jsonResponse(file)
    }
    const id = url.pathname.split('/').pop()!
    if (url.pathname.startsWith('/drive/v3/files/') && init.method === 'DELETE') { remote.delete(id); return new Response(null, { status: 204 }) }
    if (url.pathname.startsWith('/drive/v3/files/')) { const file = remote.get(id); return file ? jsonResponse(file) : jsonResponse({}, 404) }
    return jsonResponse({}, 404)
  }
  try {
    for (let day = 1; day <= 31; day++) {
      const date = `2026-09-${String(day).padStart(2, '0')}`
      const name = `hromada-aid-daily-${date}-created-${date}T12-00-00-000-${String(day).padStart(8, '0')}-1234-1234-1234-123456789abc.sqlite.hraid`
      remote.set(`old-${day}`, { id: `old-${day}`, name, size: 100, md5Checksum: '0'.repeat(32), appProperties: { hromadaAidBackup: 'true', hromadaAidBackupId: name.slice(0, -6) }, createdTime: `${date}T12:00:00.000Z` })
    }
    remote.set('unrelated', { id: 'unrelated', name: 'unrelated.txt', size: 10, md5Checksum: '1'.repeat(32), appProperties: { owner: 'other' }, createdTime: '2026-01-01T00:00:00Z' })
    const backupName = 'hromada-aid-daily-2026-10-21-created-2026-10-22T12-00-00-000-12345678-1234-1234-1234-123456789abc.sqlite'
    await createSyntheticDatabase(join(directory, backupName))
    const recovery = createRecoveryKey()
    const state = new DriveSyncStateStore(directory)
    const client = new GoogleDriveClient({ clientId: 'synthetic-client', refreshToken: 'synthetic-refresh-token', folderId: 'synthetic-folder' }, fetcher)
    const syncWarnings: string[] = []
    const sync = new GoogleDriveBackupSync(directory, { version: 1, encryptionKey: recovery.encoded, google: { refreshToken: 'synthetic-refresh-token', folderId: 'synthetic-folder' } }, client, state, { warn: (message) => syncWarnings.push(message), error: () => undefined })
    assert.equal(await sync.syncOne(), true, syncWarnings.join('; '))
    assert.equal([...remote.values()].filter((file) => file.appProperties.hromadaAidBackup === 'true').length, 30)
    assert.equal(remote.has('unrelated'), true)
  } finally { await removeTemporaryDirectory(directory) }
})

test('local SQLite backups retain pending uploads beyond the normal 14-copy window', async () => {
  const directory = await temporaryDirectory()
  const databasePath = join(directory, 'synthetic-test.sqlite')
  const database = new DatabaseSync(databasePath)
  database.exec("PRAGMA journal_mode=WAL; CREATE TABLE synthetic(value TEXT); INSERT INTO synthetic VALUES ('sample');")
  try {
    const pending = new Set<string>()
    const service = new SqliteBackupService(database, join(directory, 'backups'), { error: () => undefined, warn: () => undefined }, (file) => pending.has(file))
    for (let day = 1; day <= 16; day++) {
      const date = new Date(2026, 8, day, 12, 1, 0)
      if (day <= 2) {
        const pattern = `hromada-aid-daily-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
        pending.add(`${pattern}-created-placeholder`)
      }
      const slot = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      const result = await service.createDailyBackup(slot, date)
      assert.equal(result.status, 'created')
      if (day <= 2 && result.path) pending.add(result.path.split(/[\\/]/).pop()!)
    }
    assert.equal(listDailyBackups(join(directory, 'backups')).length, 16)
  } finally { database.close(); await removeTemporaryDirectory(directory) }
})

test('local SQLite backup succeeds independently when Google Drive is unavailable', async () => {
  const directory = await temporaryDirectory()
  const database = new DatabaseSync(join(directory, 'synthetic-test.sqlite'))
  database.exec("CREATE TABLE synthetic(value TEXT); INSERT INTO synthetic VALUES ('no personal data');")
  try {
    const backupDirectory = join(directory, 'backups')
    const service = new SqliteBackupService(database, backupDirectory, { error: () => undefined, warn: () => undefined }, () => true)
    const result = await service.createDailyBackup('2026-10-22', new Date(2026, 9, 22, 12, 1))
    assert.equal(result.status, 'created')

    const client = new GoogleDriveClient({ clientId: 'synthetic-client', refreshToken: 'synthetic-refresh-token', folderId: 'synthetic-folder' }, async () => { throw new Error('offline') })
    const state = new DriveSyncStateStore(backupDirectory)
    const sync = new GoogleDriveBackupSync(backupDirectory, { version: 1, encryptionKey: createRecoveryKey().encoded, google: { refreshToken: 'synthetic-refresh-token', folderId: 'synthetic-folder' } }, client, state, { warn: () => undefined, error: () => undefined })
    assert.equal(await sync.syncOne(), false)
    assert.equal(listDailyBackups(backupDirectory).length, 1)
    assert.equal(state.isUploaded(listDailyBackups(backupDirectory)[0]!.name), false)
  } finally { database.close(); await removeTemporaryDirectory(directory) }
})

test('WAL backup publishes a standalone database and leaves no temporary SQLite sidecars', async () => {
  const directory = await temporaryDirectory()
  const database = new DatabaseSync(join(directory, 'synthetic-test.sqlite'))
  database.exec("PRAGMA journal_mode=WAL; CREATE TABLE synthetic(value TEXT); INSERT INTO synthetic VALUES ('synthetic');")
  try {
    const backupDirectory = join(directory, 'backups')
    const service = new SqliteBackupService(database, backupDirectory, { error: () => undefined, warn: () => undefined })
    const result = await service.createDailyBackup('2026-10-22', new Date(2026, 9, 22, 12, 1))
    assert.equal(result.status, 'created')
    assert.ok(result.path)
    const entries = await readdir(backupDirectory)
    assert.equal(entries.some((name) => name.endsWith('.partial-wal') || name.endsWith('.partial-shm')), false)
    const copy = new DatabaseSync(result.path, { readOnly: true })
    try {
      assert.equal((copy.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check, 'ok')
      assert.equal((copy.prepare('SELECT value FROM synthetic').get() as { value: string }).value, 'synthetic')
    } finally { copy.close() }
  } finally { database.close(); await removeTemporaryDirectory(directory) }
})

test('Drive API errors identify the operation and safe Google reason without response text', async () => {
  const client = new GoogleDriveClient({ clientId: 'synthetic-client', refreshToken: 'synthetic-refresh-token', folderId: 'synthetic-folder' }, async (input) => {
    const url = new URL(String(input))
    if (url.hostname === 'oauth2.googleapis.com') return jsonResponse({ access_token: 'synthetic-access-token', expires_in: 3600 })
    return jsonResponse({ error: { code: 400, status: 'INVALID_ARGUMENT', errors: [{ reason: 'invalid', message: 'synthetic private response text' }] } }, 400)
  })
  await assert.rejects(client.findBackup('synthetic-backup-id'), (error: unknown) => {
    assert.ok(error instanceof GoogleDriveError)
    assert.equal(error.status, 400)
    assert.equal(error.operation, 'пошуку резервної копії')
    assert.equal(error.reason, 'invalid')
    assert.doesNotMatch(error.message, /synthetic private response text|synthetic-refresh-token/)
    return true
  })
})

test('Drive multipart upload uses the upload endpoint and reports a safe upload diagnostic', async () => {
  const directory = await temporaryDirectory()
  try {
    const encryptedPath = join(directory, 'synthetic.sqlite.hraid')
    const bytes = Buffer.from('synthetic ciphertext only')
    await writeFile(encryptedPath, bytes)
    const client = new GoogleDriveClient({ clientId: 'synthetic-client', refreshToken: 'synthetic-refresh-token', folderId: 'synthetic-folder' }, async (input) => {
      const url = new URL(String(input))
      if (url.hostname === 'oauth2.googleapis.com') return jsonResponse({ access_token: 'synthetic-access-token', expires_in: 3600 })
      assert.equal(url.pathname, '/upload/drive/v3/files')
      assert.equal(url.searchParams.get('uploadType'), 'multipart')
      return jsonResponse({ error: { code: 400, errors: [{ reason: 'invalid', message: 'synthetic private response text' }] } }, 400)
    })
    await assert.rejects(client.uploadBackup(encryptedPath, 'synthetic.sqlite.hraid', 'synthetic-backup-id', { size: bytes.length, md5: createHash('md5').update(bytes).digest('hex') }), (error: unknown) => {
      assert.ok(error instanceof GoogleDriveError)
      assert.equal(error.status, 400)
      assert.equal(error.operation, 'завантаження зашифрованої копії')
      assert.equal(error.reason, 'invalid')
      assert.doesNotMatch(error.message, /synthetic private response text|synthetic-access-token/)
      return true
    })
  } finally { await removeTemporaryDirectory(directory) }
})
