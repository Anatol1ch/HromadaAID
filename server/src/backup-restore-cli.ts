import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { randomUUID } from 'node:crypto'
import { BackupKeyStore, decodeRecoveryKey, decryptBackupFile, hashFile, readArchiveMetadata } from './backup-crypto.js'
import { readRecoveryKeyHidden } from './backup-terminal.js'
import { restoreOffline } from './backup-restore.js'
import { acquireDatabaseOwnership, assertServerDatabasePath, durableJson, upgradeRestoreCandidate } from './restore-safety.js'
import { maintenancePath, restoreCandidatePath, restoreDirectory, restorePlanPath } from './backup-admin.js'
import { secureBackupDirectory } from './backup.js'

const argument = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined }
async function main(): Promise<void> {
  const database = argument('--database'), directory = argument('--backup-dir')
  if (!database || !directory) throw new Error('Вкажіть --database <серверна SQLite> та --backup-dir <каталог копій>. Fastify має бути зупинений.')
  const databasePath = resolve(database), backupDirectory = resolve(directory)
  assertServerDatabasePath(databasePath)
  if (!process.stdin.isTTY) throw new Error('Потрібен інтерактивний серверний термінал.')
  const archive = argument('--archive')
  if (archive) {
    const release = acquireDatabaseOwnership(databasePath)
    try {
      if (existsSync(maintenancePath(databasePath)) || existsSync(`${databasePath}.restore-journal.json`)) throw new Error('Спочатку завершіть раніше підтверджене відновлення без --archive.')
      const key = process.argv.includes('--recovery-key') ? decodeRecoveryKey(await readRecoveryKeyHidden()) : decodeRecoveryKey(new BackupKeyStore(backupDirectory).load()?.encryptionKey ?? '')
      const id = randomUUID(), target = restoreCandidatePath(backupDirectory, id)
      await mkdir(restoreDirectory(backupDirectory), { recursive: true }); secureBackupDirectory(restoreDirectory(backupDirectory))
      try {
        await decryptBackupFile(resolve(archive), target, key)
        upgradeRestoreCandidate(target)
        let createdAt = 'Невідома (архів формату 1)'
        try { createdAt = (await readArchiveMetadata(resolve(archive))).createdAt } catch { /* v1 has no authenticated date */ }
        console.log(`Дата копії: ${createdAt}. Зміни після цієї дати буде втрачено.`)
        const reader = createInterface({ input: process.stdin, output: process.stdout })
        let answer: string
        try { answer = await reader.question('Для підтвердження введіть ВІДНОВИТИ: ') } finally { reader.close() }
        if (answer !== 'ВІДНОВИТИ') throw new Error('Відновлення скасовано.')
        durableJson(restorePlanPath(backupDirectory, id), { version: 1, id, hash: (await hashFile(target)).sha256, tokenHash: '', createdAt, expiresAt: '', confirmed: true })
        durableJson(maintenancePath(databasePath), { version: 1, id })
      } catch (error) { await rm(target, { force: true }); throw error }
      finally { key.fill(0) }
    } finally { release() }
  }
  if (!existsSync(databasePath) && !existsSync(`${databasePath}.restore-journal.json`)) throw new Error('Цільову серверну базу не знайдено. На новому сервері спочатку ініціалізуйте окрему базу й першого адміністратора, потім зупиніть сервер.')
  const safety = await restoreOffline(databasePath, backupDirectory)
  console.log(`Відновлення завершено. Страхова копія: ${safety}. Запустіть Fastify; усім користувачам потрібно ввійти повторно.`)
}
void main().catch(() => { console.error('Відновлення не завершено. Перевірте: Fastify зупинений, параметри шляхів правильні, ключ відповідає архіву, структура сумісна. Файли й стан процедури збережено; повторіть ту саму команду без --archive для підтвердженого відновлення.'); process.exitCode = 1 })
