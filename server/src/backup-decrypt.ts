import { DatabaseSync } from 'node:sqlite'
import { resolve, dirname } from 'node:path'
import { existsSync, unlinkSync } from 'node:fs'
import { decryptBackupFile, decodeRecoveryKey } from './backup-crypto.js'
import { secureBackupDirectory } from './backup.js'

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function readRecoveryKeyHidden(): Promise<string> {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') throw new Error('Для безпечного введення ключа запустіть команду в інтерактивному терміналі.')
  return new Promise((resolveKey, rejectKey) => {
    const input = process.stdin
    const output = process.stdout
    let value = ''
    const onData = (chunk: Buffer | string) => {
      for (const character of chunk.toString()) {
        if (character === '\u0003') { cleanup(); rejectKey(new Error('Операцію скасовано.')); return }
        if (character === '\r' || character === '\n') { output.write('\n'); cleanup(); resolveKey(value); return }
        if (character === '\u007f' || character === '\b') { value = value.slice(0, -1); continue }
        if (character >= ' ' && character <= '~') value += character
      }
    }
    const cleanup = () => { input.off('data', onData); input.setRawMode(false); input.pause() }
    output.write('Введіть офлайн-ключ відновлення (введення приховано): ')
    input.setEncoding('utf8')
    input.setRawMode(true)
    input.resume()
    input.on('data', onData)
  })
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

