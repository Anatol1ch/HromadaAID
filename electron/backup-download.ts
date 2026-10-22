import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { open, rename, rm } from 'node:fs/promises'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { BackupArchive } from '../shared/backup-contract.js'

export async function archiveMatches(path: string, archive: BackupArchive, signal?: AbortSignal): Promise<boolean> {
  try {
    const hash = createHash('sha256'); let size = 0
    for await (const chunk of createReadStream(path, { signal })) { hash.update(chunk); size += chunk.length }
    return size === archive.size && hash.digest('hex') === archive.sha256
  } catch { return false }
}

export async function saveBackupResponse(response: Response, target: string, archive: BackupArchive, confirmCurrent: () => void, signal?: AbortSignal): Promise<void> {
  if (!response.body || Number(response.headers.get('content-length')) !== archive.size || response.headers.get('x-backup-sha256') !== archive.sha256) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error('Сервер повернув некоректні метадані резервної копії.')
  }
  const partial = `${target}.${randomUUID()}.partial`
  const hash = createHash('sha256'); let size = 0
  const inspect = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    size += chunk.length
    if (size > archive.size) { callback(new Error('Розмір резервної копії перевищено.')); return }
    hash.update(chunk); callback(null, chunk)
  } })
  try {
    await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), inspect, createWriteStream(partial, { flags: 'wx', mode: 0o600 }), { signal })
    if (size !== archive.size || hash.digest('hex') !== archive.sha256) throw new Error('Перевірка контрольної суми резервної копії не пройдена.')
    const file = await open(partial, 'r+')
    try {
      const prefix = Buffer.alloc(13)
      if ((await file.read(prefix, 0, 13, 0)).bytesRead !== 13 || prefix.subarray(0, 8).toString('ascii') !== 'HRAIDBKP' || prefix[8] !== 2) throw new Error('Непідтримуваний формат резервної копії.')
      const length = prefix.readUInt32BE(9)
      if (length < 2 || length > 4096) throw new Error('Некоректний заголовок архіву.')
      const json = Buffer.alloc(length)
      if ((await file.read(json, 0, length, 13)).bytesRead !== length) throw new Error('Неповний заголовок архіву.')
      const metadata = JSON.parse(json.toString('utf8')) as { id?: unknown; createdAt?: unknown }
      if (metadata.id !== archive.id || metadata.createdAt !== archive.createdAt) throw new Error('Завантажено інший резервний архів.')
      await file.sync()
    } finally { await file.close() }
    signal?.throwIfAborted()
    confirmCurrent()
    await rename(partial, target)
  } finally { await rm(partial, { force: true }) }
}
