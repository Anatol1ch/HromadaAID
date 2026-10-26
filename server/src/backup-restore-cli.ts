import { existsSync } from 'node:fs'
import { mkdir, rm, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { randomUUID } from 'node:crypto'
import { BackupKeyStore, decodeRecoveryKey, decryptBackupFile, hashFile, readArchiveMetadata } from './backup-crypto.js'
import { readRecoveryKeyHidden } from './backup-terminal.js'
import { restoreOffline } from './backup-restore.js'
import { acquireDatabaseOwnership, assertServerDatabasePath, durableJson, upgradeRestoreCandidate } from './restore-safety.js'
import { maintenancePath, maximumRestoreSize, restoreCandidatePath, restoreDirectory, restorePlanPath } from './backup-admin.js'
import { secureBackupDirectory } from './backup.js'
import { parseRestoreArguments } from './backup-restore-arguments.js'
import { formatRestoreError, RestoreError, restoreError } from './restore-diagnostics.js'
import { acknowledgeRestore, inspectRestoreRecovery, preparePreviousDatabaseReturn } from './restore-recovery.js'

let cliStage = 'arguments'
async function main(): Promise<void> {
  const { database, backupDirectory: directory, archive, recoveryKey, managerConfirmed, verifyOnly, recovery } = parseRestoreArguments(process.argv.slice(2))
  const databasePath = resolve(database), backupDirectory = resolve(directory)
  cliStage = 'validate-path'
  assertServerDatabasePath(databasePath)
  if (recovery === 'status') { console.log(JSON.stringify(inspectRestoreRecovery(databasePath, backupDirectory))); return }
  if (recovery === 'acknowledge') { acknowledgeRestore(databasePath); return }
  if (recovery === 'return') await preparePreviousDatabaseReturn(databasePath, backupDirectory)
  if (recovery === 'resume' && !existsSync(maintenancePath(databasePath)) && !existsSync(`${databasePath}.restore-journal.json`)) throw new RestoreError('RESTORE_PENDING_MISSING', 'load-marker', 'Незавершене відновлення не знайдено; нову операцію не розпочато.')
  if (archive) {
    if (!process.stdin.isTTY && !managerConfirmed && !verifyOnly) throw new RestoreError('RESTORE_TTY_REQUIRED', 'external-confirmation', 'Для зовнішнього архіву потрібне підтвердження через Server Manager або інтерактивний термінал.')
    if (verifyOnly) {
      cliStage = 'verify-archive'
      if (existsSync(maintenancePath(databasePath)) || existsSync(`${databasePath}.restore-journal.json`)) throw new RestoreError('RESTORE_PENDING', 'verify-archive', 'Спочатку завершіть раніше підтверджене відновлення.')
      if (!existsSync(archive) || (await stat(archive)).size > maximumRestoreSize) throw new RestoreError('RESTORE_ARCHIVE_SIZE', 'verify-archive', 'Архів перевищує обмеження 2 ГіБ або недоступний.')
      const key = recoveryKey ? decodeRecoveryKey(await readManagerRecoveryKey()) : decodeRecoveryKey(new BackupKeyStore(backupDirectory).load()?.encryptionKey ?? '')
      const id = randomUUID(), target = restoreCandidatePath(backupDirectory, id)
      try {
        await mkdir(restoreDirectory(backupDirectory), { recursive: true }); secureBackupDirectory(restoreDirectory(backupDirectory))
        await decryptBackupFile(resolve(archive), target, key)
        upgradeRestoreCandidate(target)
        const metadata = await readArchiveMetadata(resolve(archive)).catch(() => null)
        console.log(JSON.stringify({ valid: true, createdAt: metadata?.createdAt ?? null, archiveSize: (await stat(archive)).size }))
      } finally { key.fill(0); for (const suffix of ['', '-wal', '-shm']) await rm(`${target}${suffix}`, { force: true }) }
      return
    }
    if (managerConfirmed && process.stdin.isTTY) throw new RestoreError('RESTORE_CONFIRMATION_MODE', 'external-confirmation', 'Server Manager запускає підтверджений режим лише без інтерактивного термінала.')
    cliStage = 'ownership'
    const release = acquireDatabaseOwnership(databasePath)
    try {
      if (existsSync(maintenancePath(databasePath)) || existsSync(`${databasePath}.restore-journal.json`)) throw new RestoreError('RESTORE_PENDING', 'load-marker', 'Спочатку завершіть раніше підтверджене відновлення без --archive.')
      cliStage = 'external-key'
      const key = recoveryKey ? decodeRecoveryKey(managerConfirmed ? await readManagerRecoveryKey() : await readRecoveryKeyHidden()) : decodeRecoveryKey(new BackupKeyStore(backupDirectory).load()?.encryptionKey ?? '')
      const id = randomUUID(), target = restoreCandidatePath(backupDirectory, id)
      await mkdir(restoreDirectory(backupDirectory), { recursive: true }); secureBackupDirectory(restoreDirectory(backupDirectory))
      try {
        cliStage = 'decrypt-archive'
        await decryptBackupFile(resolve(archive), target, key)
        cliStage = 'validate-candidate'
        upgradeRestoreCandidate(target)
        let createdAt = 'Невідома (архів формату 1)'
        try { createdAt = (await readArchiveMetadata(resolve(archive))).createdAt } catch { /* v1 has no authenticated date */ }
        console.log(`Дата копії: ${createdAt}. Зміни після цієї дати буде втрачено.`)
        if (!managerConfirmed) {
          const reader = createInterface({ input: process.stdin, output: process.stdout })
          let answer: string
          try { answer = await reader.question('Для підтвердження введіть ВІДНОВИТИ: ') } finally { reader.close() }
          if (answer !== 'ВІДНОВИТИ') throw new RestoreError('RESTORE_CANCELLED', 'external-confirmation', 'Відновлення скасовано.')
        }
        cliStage = 'publish-confirmation'
        durableJson(restorePlanPath(backupDirectory, id), { version: 1, id, hash: (await hashFile(target)).sha256, tokenHash: '', createdAt, expiresAt: '', confirmed: true })
        durableJson(maintenancePath(databasePath), { version: 1, id })
      } catch (error) { await rm(target, { force: true }); throw error }
      finally { key.fill(0) }
    } finally { release() }
  }
  if (!existsSync(databasePath) && !existsSync(`${databasePath}.restore-journal.json`)) throw new RestoreError('RESTORE_TARGET_MISSING', 'validate-path', 'Цільову серверну базу не знайдено. Перевірте --database. На новому сервері спочатку ініціалізуйте окрему базу й першого адміністратора, потім зупиніть сервер.')
  const safety = await restoreOffline(databasePath, backupDirectory)
  console.log(`Відновлення завершено. Страхова копія: ${safety}. Запустіть Fastify; усім користувачам потрібно ввійти повторно.`)
}
async function readManagerRecoveryKey(): Promise<string> {
  if (process.stdin.isTTY) throw new RestoreError('RESTORE_CONFIRMATION_MODE', 'external-key', 'Ключ Server Manager передається лише через закритий канал вводу.')
  let value = ''
  for await (const chunk of process.stdin) value += chunk.toString()
  const key = value.trim()
  if (key.length > 512) throw new RestoreError('RESTORE_KEY_INVALID', 'external-key', 'Неправильний аварійний ключ.')
  return key
}
void main().catch(error => { console.error(formatRestoreError(restoreError(cliStage, error))); process.exitCode = 1 })
