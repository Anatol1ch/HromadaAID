import { readRecoveryKeyHidden } from './backup-terminal.js'
import { DatabaseSync } from 'node:sqlite'
import { resolve, dirname } from 'node:path'
import { existsSync, unlinkSync } from 'node:fs'
import { decryptBackupFile, decodeRecoveryKey } from './backup-crypto.js'
import { secureBackupDirectory } from './backup.js'

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}


async function main(): Promise<void> {
  const input = argument('--input')
  const output = argument('--output')
  if (!input || !output) throw new Error('Вкажіть --input <файл .hraid> і --output <новий файл .sqlite>.')
  const sourcePath = resolve(input)
  const targetPath = resolve(output)
  const normalizedOutput = targetPath.replaceAll('/', '\\').toLocaleLowerCase('en-US')
  if (sourcePath === targetPath || !sourcePath.toLocaleLowerCase('en-US').endsWith('.hraid') || !targetPath.toLocaleLowerCase('en-US').endsWith('.sqlite')) {
    throw new Error('Вхід має бути архівом .hraid, а вихід — окремим файлом .sqlite.')
  }
  if (normalizedOutput.endsWith('\\appdata\\roaming\\hromada-aid\\hromada-aid.sqlite') || existsSync(targetPath)) {
    throw new Error('Вихідний файл уже існує або вказує на робочу SQLite. Оберіть новий окремий файл.')
  }
  secureBackupDirectory(dirname(targetPath))
  const key = decodeRecoveryKey(await readRecoveryKeyHidden())
  await decryptBackupFile(sourcePath, targetPath, key)
  try {
    const database = new DatabaseSync(targetPath, { readOnly: true })
    try {
      const result = database.prepare('PRAGMA integrity_check').get() as { integrity_check?: string } | undefined
      if (result?.integrity_check !== 'ok') throw new Error('Розшифрований файл не пройшов перевірку цілісності SQLite.')
    } finally { database.close() }
  } catch (error) {
    try { unlinkSync(targetPath) } catch { /* preserve the diagnostic without leaving a questionable restore file */ }
    throw error
  }
  console.log('Архів розшифровано; перевірка цілісності SQLite успішна. Робочі дані не змінювалися.')
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Не вдалося розшифрувати резервну копію.')
  process.exitCode = 1
})

