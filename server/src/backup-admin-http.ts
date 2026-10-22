import { createReadStream, createWriteStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { FastifyInstance } from 'fastify'
import { BackupAdministration, maximumRestoreSize } from './backup-admin.js'

export function registerBackupAdministration(app: FastifyInstance, administration: BackupAdministration): void {
  const archives = administration.archives
  const list = async () => ({ archives: await archives.listAll(), schedule: 'Щодня о 12:00 за часом сервера; останні 14 автоматичних копій. Ручні копії зберігаються окремо.' })
  app.addContentTypeParser('application/octet-stream', (_request, payload, done) => done(null, payload))
  app.get('/api/backups/server', async (_request, reply) => {
    try { return await list() } catch { return reply.status(503).send({ message: 'Серверні архіви недоступні. Перевірте ключ резервування на сервері.' }) }
  })
  app.post('/api/backups/server', async (_request, reply) => {
    try {
      // Fail before creating plaintext manual copies if encryption isn't configured.
      void archives.encryptionKey
      const result = await administration.service.createManualBackup()
      if (result.status === 'busy') return reply.status(409).send({ message: 'Резервування вже триває. Дочекайтеся завершення.' })
      await archives.stop()
      return await list()
    } catch { return reply.status(503).send({ message: 'Не вдалося створити перевірений зашифрований архів.' }) }
  })
  app.get<{ Params: { id: string } }>('/api/backups/server/:id/download', async (request, reply) => {
    const item = (await archives.listAll()).find(item => item.id === request.params.id)
    if (!item) return reply.status(404).send({ message: 'Архів не знайдено.' })
    return reply.header('Cache-Control', 'no-store').header('Content-Type', 'application/octet-stream').header('Content-Length', item.size).header('X-Backup-Sha256', item.sha256).send(createReadStream(join(archives.directory, item.fileName)))
  })
  app.post<{ Params: { id: string } }>('/api/backups/server/:id/prepare', async (request, reply) => {
    try {
      const item = (await archives.listAll()).find(item => item.id === request.params.id)
      if (!item) return reply.status(404).send({ message: 'Архів не знайдено.' })
      return await administration.prepare(join(archives.directory, item.fileName))
    } catch { return reply.status(400).send({ message: 'Архів не пройшов перевірку формату, ключа, сумісності або цілісності. Відновлення не підготовлено.' }) }
  })
  app.post('/api/backups/restore/upload', { bodyLimit: maximumRestoreSize }, async (request, reply) => {
    if (request.headers['content-type'] !== 'application/octet-stream' || !(request.body as Readable)?.pipe) return reply.status(400).send({ message: 'Очікується файл .hraid.' })
    if (Number(request.headers['content-length']) > maximumRestoreSize) return reply.status(413).send({ message: 'Максимальний розмір архіву — 2 ГіБ.' })
    const path = join(archives.directory, `${randomUUID()}.upload.partial`)
    let bytes = 0
    try {
      await pipeline(request.body as Readable, new Transform({ transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length
        callback(bytes > maximumRestoreSize ? new Error('Archive too large') : null, chunk)
      } }), createWriteStream(path, { flags: 'wx', mode: 0o600 }), { signal: AbortSignal.timeout(300_000) })
      return await administration.prepare(path)
    } catch { return reply.status(bytes > maximumRestoreSize ? 413 : 400).send({ message: 'Архів завеликий, пошкоджений, несумісний або потребує іншого аварійного ключа. Для окремого ключа скористайтеся серверною CLI-командою.' }) }
    finally { await rm(path, { force: true }) }
  })
  app.post<{ Body: { id?: unknown; confirmationToken?: unknown } }>('/api/backups/restore/confirm', async (request, reply) => {
    const { id, confirmationToken } = request.body ?? {}
    if (typeof id !== 'string' || typeof confirmationToken !== 'string') return reply.status(400).send({ message: 'Потрібне явне підтвердження.' })
    try { return await administration.confirm(id, confirmationToken) }
    catch { return reply.status(409).send({ message: 'Не вдалося підтвердити відновлення: інші запити ще тривають або перевірка втратила чинність. Повторіть перевірку архіву.' }) }
  })
}
