import { createHash, timingSafeEqual } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { BackupInstallation } from '../../shared/backup-contract.js'
import { nextRecordRevision } from '../../shared/record-revision.js'
import type { BackupArchives } from './backup-archives.js'

type InstallationRow = { id: string; credential_hash: string; computer_name: string; backup_allowed: number; last_seen_at: string; last_backup_at: string | null; updated_at: string }
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
function publicInstallation(row: InstallationRow): BackupInstallation {
  return { id: row.id, computerName: row.computer_name, allowed: row.backup_allowed === 1, lastSeenAt: row.last_seen_at, lastBackupAt: row.last_backup_at, updatedAt: row.updated_at }
}

export function registerBackupRoutes(app: FastifyInstance, database: DatabaseSync, archives?: BackupArchives): void {
  const credentials = (request: FastifyRequest) => {
    const id = request.headers['x-hromada-installation-id'], secret = request.headers['x-hromada-installation-key']
    return typeof id === 'string' && idPattern.test(id) && typeof secret === 'string' && /^[A-Za-z0-9_-]{43}$/.test(secret) ? { id, hash: digest(secret) } : null
  }
  const authorizedDevice = (request: FastifyRequest, reply: FastifyReply): InstallationRow | undefined => {
    const credential = credentials(request)
    const row = credential ? database.prepare('SELECT * FROM backup_installations WHERE id=?').get(credential.id) as InstallationRow | undefined : undefined
    if (!row || !credential || !timingSafeEqual(Buffer.from(row.credential_hash, 'hex'), Buffer.from(credential.hash, 'hex')) || row.backup_allowed !== 1) {
      void reply.status(403).send({ message: 'Резервування для цього комп’ютера не дозволено.' }); return
    }
    database.prepare('UPDATE backup_installations SET last_seen_at=? WHERE id=?').run(new Date().toISOString(), row.id)
    return row
  }
  app.post('/api/backups/installations/register', async (request, reply) => {
    const credential = credentials(request), name = record(request.body).computerName
    if (!credential || typeof name !== 'string' || !name.trim() || name.trim().length > 100 || /[\u0000-\u001f\u007f]/.test(name)) return reply.status(400).send({ message: 'Некоректна реєстрація комп’ютера.' })
    database.exec('BEGIN IMMEDIATE')
    try {
      const existing = database.prepare('SELECT * FROM backup_installations WHERE id=?').get(credential.id) as InstallationRow | undefined
      if (existing && !timingSafeEqual(Buffer.from(existing.credential_hash, 'hex'), Buffer.from(credential.hash, 'hex'))) {
        database.exec('ROLLBACK'); return reply.status(403).send({ message: 'Не вдалося підтвердити інсталяцію комп’ютера.' })
      }
      const now = new Date().toISOString()
      if (existing) database.prepare('UPDATE backup_installations SET computer_name=?,last_seen_at=? WHERE id=?').run(name.trim(), now, credential.id)
      else database.prepare('INSERT INTO backup_installations(id,credential_hash,computer_name,created_at,updated_at,last_seen_at) VALUES(?,?,?,?,?,?)').run(credential.id, credential.hash, name.trim(), now, now, now)
      database.exec('COMMIT')
      return publicInstallation(database.prepare('SELECT * FROM backup_installations WHERE id=?').get(credential.id) as InstallationRow)
    } catch { database.exec('ROLLBACK'); return reply.status(500).send({ message: 'Не вдалося зареєструвати комп’ютер.' }) }
  })
  app.get('/api/backup-clients', async () => (database.prepare('SELECT * FROM backup_installations ORDER BY computer_name,id').all() as InstallationRow[]).map(publicInstallation))
  app.put<{ Params: { id: string } }>('/api/backup-clients/:id', async (request, reply) => {
    const body = record(request.body)
    if (!idPattern.test(request.params.id) || typeof body.allowed !== 'boolean' || typeof body.expectedUpdatedAt !== 'string') return reply.status(400).send({ message: 'Некоректна зміна дозволу.' })
    database.exec('BEGIN IMMEDIATE')
    try {
      const row = database.prepare('SELECT * FROM backup_installations WHERE id=?').get(request.params.id) as InstallationRow | undefined
      if (!row) { database.exec('ROLLBACK'); return reply.status(404).send({ message: 'Комп’ютер не знайдено.' }) }
      if (row.updated_at !== body.expectedUpdatedAt) { database.exec('ROLLBACK'); return reply.status(409).send({ message: 'Дозвіл уже змінено. Оновіть список.' }) }
      database.prepare('UPDATE backup_installations SET backup_allowed=?,updated_at=? WHERE id=?').run(body.allowed ? 1 : 0, nextRecordRevision(row.updated_at), row.id)
      database.exec('COMMIT')
      return publicInstallation(database.prepare('SELECT * FROM backup_installations WHERE id=?').get(row.id) as InstallationRow)
    } catch { database.exec('ROLLBACK'); return reply.status(500).send({ message: 'Не вдалося змінити дозвіл комп’ютера.' }) }
  })
  const available = async (reply: FastifyReply) => {
    try { if (archives) return await archives.list() } catch { /* No paths or key material in HTTP errors. */ }
    void reply.status(503).send({ message: 'Зашифровані резервні копії поки недоступні. Перевірте серверний ключ резервування.' })
    return undefined
  }
  app.get('/api/backups/archives', async (request, reply) => {
    if (!authorizedDevice(request, reply)) return reply
    return await available(reply) ?? reply
  })
  app.get<{ Params: { id: string } }>('/api/backups/archives/:id', async (request, reply) => {
    if (!authorizedDevice(request, reply)) return reply
    const list = await available(reply); if (!list) return reply
    const archive = list.find(item => item.id === request.params.id)
    if (!archive || !archives) return reply.status(404).send({ message: 'Архів недоступний або вже вийшов за строк зберігання.' })
    return reply.header('Cache-Control', 'no-store').header('Content-Type', 'application/octet-stream').header('Content-Length', archive.size).header('X-Backup-Sha256', archive.sha256).send(createReadStream(join(archives.directory, archive.fileName)))
  })
  app.post<{ Params: { id: string } }>('/api/backups/archives/:id/received', async (request, reply) => {
    const device = authorizedDevice(request, reply); if (!device) return reply
    const list = await available(reply); if (!list) return reply
    if (!list.some(item => item.id === request.params.id)) return reply.status(404).send({ message: 'Архів не знайдено.' })
    database.prepare('UPDATE backup_installations SET last_backup_at=? WHERE id=?').run(new Date().toISOString(), device.id)
    return { ok: true }
  })
}
