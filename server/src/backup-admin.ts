import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import type { RestorePreview } from '../../shared/backup-contract.js'
import { decryptBackupFile, hashFile, readArchiveMetadata } from './backup-crypto.js'
import { type SqliteBackupService, secureBackupDirectory } from './backup.js'
import type { BackupArchives } from './backup-archives.js'
import { durableJson, upgradeRestoreCandidate } from './restore-safety.js'

export const maximumRestoreSize = 2 * 1024 * 1024 * 1024
export type RestorePlan = { version: 1; id: string; hash: string; tokenHash: string; createdAt: string | null; expiresAt: string; confirmed: boolean; expectedCurrentFingerprint?: string; returnOf?: string }
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
export const restoreDirectory = (backupDirectory: string) => join(backupDirectory, 'restore-staging')
export const restorePlanPath = (backupDirectory: string, id: string) => join(restoreDirectory(backupDirectory), `${id}.json`)
export const restoreCandidatePath = (backupDirectory: string, id: string) => join(restoreDirectory(backupDirectory), `${id}.sqlite`)
export const maintenancePath = (databasePath: string) => `${databasePath}.maintenance.json`

export class BackupAdministration {
  maintenance = false
  private active = new Set<string>()
  private preparing = false
  constructor(readonly databasePath: string, readonly archives: BackupArchives, readonly service: SqliteBackupService, private readonly stopScheduler: () => Promise<void>, private readonly secureStagingDirectory = true) {}

  install(app: FastifyInstance): void {
    app.addHook('onRequest', async (request, reply) => {
      if (this.maintenance) return reply.status(503).header('Retry-After', '60').send({ code: 'RESTORE_MAINTENANCE', message: 'Сервер у режимі відновлення. Після завершення увійдіть повторно.' })
      this.active.add(request.id)
    })
    app.addHook('onResponse', async request => { this.active.delete(request.id) })
  }

  async prepare(path: string): Promise<RestorePreview> {
    if (this.preparing) throw new Error('Інша перевірка архіву ще триває.')
    this.preparing = true
    const id = randomUUID(), directory = restoreDirectory(this.archives.directory)
    const target = restoreCandidatePath(this.archives.directory, id)
    try {
      await mkdir(directory, { recursive: true })
      if (this.secureStagingDirectory) secureBackupDirectory(directory)
      else if (lstatSync(directory).isSymbolicLink()) throw new Error('Каталог підготовки відновлення не може бути символічним посиланням.')
      for (const file of await readdir(directory)) {
        const match = /^([a-f0-9-]{36})\.json$/.exec(file)
        if (!match) continue
        const previous = JSON.parse(readFileSync(join(directory, file), 'utf8')) as RestorePlan
        if (previous.id === match[1] && !previous.confirmed && Date.parse(previous.expiresAt) < Date.now()) {
          for (const suffix of ['', '-wal', '-shm']) await rm(`${restoreCandidatePath(this.archives.directory, previous.id)}${suffix}`, { force: true })
          await rm(join(directory, file), { force: true })
        }
      }
      if (statSync(path).size > maximumRestoreSize) throw new Error('Архів перевищує обмеження 2 ГіБ.')
      const metadata = await readArchiveMetadata(path).catch(() => undefined) // v1 has no authenticated date
      await decryptBackupFile(path, target, this.archives.encryptionKey)
      if (metadata && (await hashFile(target)).sha256 !== metadata.sourceSha256) throw new Error('Контрольна сума бази не збігається.')
      upgradeRestoreCandidate(target)
      const hash = (await hashFile(target)).sha256
      const token = randomBytes(32).toString('base64url')
      const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString()
      const plan: RestorePlan = { version: 1, id, hash, tokenHash: digest(token), createdAt: metadata?.createdAt ?? null, expiresAt, confirmed: false }
      durableJson(restorePlanPath(this.archives.directory, id), plan)
      return { id, confirmationToken: token, createdAt: plan.createdAt, expiresAt, message: 'Усі зміни після дати копії буде втрачено. Після підтвердження сервер перейде в режим обслуговування. Зупиніть Fastify та виконайте server:backup-restore у серверному терміналі.' }
    } catch (error) { await rm(target, { force: true }); throw error }
    finally { this.preparing = false }
  }

  async confirm(id: string, token: string): Promise<{ message: string }> {
    if (!/^[a-f0-9-]{36}$/.test(id) || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Некоректне підтвердження.')
    const path = restorePlanPath(this.archives.directory, id)
    const plan = JSON.parse(readFileSync(path, 'utf8')) as RestorePlan
    if (plan.confirmed || Date.parse(plan.expiresAt) < Date.now() || !timingSafeEqual(Buffer.from(plan.tokenHash, 'hex'), Buffer.from(digest(token), 'hex'))) throw new Error('Підтвердження втратило чинність. Перевірте архів повторно.')
    if (this.preparing || this.active.size > 1) throw new Error('Сервер виконує інші запити. Повторіть підтвердження після їх завершення.')
    this.maintenance = true
    try {
      if ((await hashFile(restoreCandidatePath(this.archives.directory, id))).sha256 !== plan.hash) throw new Error('Підготовлена база змінилася. Повторіть перевірку.')
      plan.confirmed = true
      durableJson(path, plan)
      durableJson(maintenancePath(this.databasePath), { version: 1, id })
      await this.stopScheduler()
      await this.archives.stop()
      return { message: 'Режим обслуговування ввімкнено. Зупиніть Fastify й виконайте серверну команду відновлення. Не запускайте сервер до завершення процедури.' }
    } catch (error) { this.maintenance = existsSync(maintenancePath(this.databasePath)); throw error }
  }
}

export function assertNoPendingRestore(databasePath: string): void {
  if (existsSync(maintenancePath(databasePath)) || existsSync(`${databasePath}.restore-journal.json`)) throw new Error('Є незавершене відновлення. Виконайте server:backup-restore перед запуском Fastify.')
}

export function clearMaintenance(databasePath: string): void { if (existsSync(maintenancePath(databasePath))) unlinkSync(maintenancePath(databasePath)) }
