import { lstatSync } from 'node:fs'
import { resolve } from 'node:path'
import { stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { DatabaseSync } from 'node:sqlite'
import { createFirstAdministrator } from './auth.js'
import { openInstalledServerDatabase } from './database.js'
import { maximumSupportedSchemaVersion } from '../../electron/database.js'

type AdminInput = { displayName: string; username: string; password: string; confirmation: string }

function readArguments(args: string[]): { databasePath: string; mode: 'interactive' | 'installer' | 'status' } {
  if (args[0] === '--') args = args.slice(1)
  const databaseIndex = args.indexOf('--database')
  const databaseValue = databaseIndex >= 0 ? args[databaseIndex + 1] : undefined
  const modes = args.filter(value => value === '--installer-stdin' || value === '--status')
  if (!databaseValue || databaseValue.startsWith('-') || modes.length > 1 || args.length !== 2 + modes.length || databaseIndex !== 0) {
    throw new Error('Некоректні параметри створення початкового адміністратора.')
  }
  const databasePath = resolve(databaseValue)
  const appData = process.env.APPDATA
  const localDatabase = appData ? resolve(appData, 'hromada-aid', 'hromada-aid.sqlite') : undefined
  if (localDatabase && databasePath.toLocaleLowerCase('uk-UA') === localDatabase.toLocaleLowerCase('uk-UA')) {
    throw new Error('Створення адміністратора у локальній SQLite Electron заборонено. Вкажіть серверну SQLite.')
  }
  return { databasePath, mode: modes[0] === '--installer-stdin' ? 'installer' : modes[0] === '--status' ? 'status' : 'interactive' }
}

async function readInstallerInput(): Promise<AdminInput> {
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    length += buffer.length
    if (length > 8192) { buffer.fill(0); for (const item of chunks) item.fill(0); throw new Error('Введені дані завеликі.') }
    chunks.push(buffer)
    if (buffer.includes(0x0a)) break
  }
  const inputBytes = Buffer.concat(chunks)
  for (const chunk of chunks) chunk.fill(0)
  let value: Partial<AdminInput> | undefined
  try {
    const line = inputBytes.toString('utf8').split(/\r?\n/, 1)[0]
    value = JSON.parse(line) as Partial<AdminInput>
    if (typeof value.displayName !== 'string' || !value.displayName.trim() || value.displayName.trim().length > 150) throw new Error('Вкажіть ім’я користувача (до 150 символів).')
    if (typeof value.username !== 'string' || typeof value.password !== 'string' || typeof value.confirmation !== 'string') throw new Error('Заповніть логін, пароль і підтвердження пароля.')
    if (value.password !== value.confirmation) throw new Error('Паролі не збігаються.')
    return { displayName: value.displayName.trim(), username: value.username, password: value.password, confirmation: value.confirmation }
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Не вдалося прочитати введені дані адміністратора.')
    throw error
  } finally {
    if (value) { value.password = ''; value.confirmation = ''; value.username = ''; value.displayName = '' }
    inputBytes.fill(0)
  }
}

function reportDatabaseUsers(databasePath: string): void {
  if (!lstatSync(databasePath).isFile()) throw new Error('Шлях до SQLite не є звичайним файлом.')
  const database = new DatabaseSync(databasePath, { readOnly: true })
  try {
    const hasUsers = database.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='users'").get()
    if (!hasUsers) throw new Error('База не має сумісної таблиці користувачів.')
    const result = database.prepare('SELECT COUNT(*) AS value FROM users').get() as { value: number }
    const schemaVersion = Number((database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
    stdout.write(JSON.stringify({ users: Number(result.value) === 0 ? 0 : 'present', schemaVersion, maximumSupportedSchemaVersion }) + '\n')
  } finally { database.close() }
}

async function main(): Promise<void> {
  const { databasePath, mode } = readArguments(process.argv.slice(2))
  if (mode === 'status') { reportDatabaseUsers(databasePath); return }
  if (mode === 'installer') {
    let input: AdminInput | undefined
    try {
      input = await readInstallerInput()
      const database = openInstalledServerDatabase(databasePath)
      try {
        const result = await createFirstAdministrator(database, { displayName: input.displayName, username: input.username, password: input.password })
        if (!result.ok) throw new Error(result.message)
      } finally { database.close() }
      stdout.write('admin-created\n')
    } finally {
      if (input) { input.password = ''; input.confirmation = ''; input.username = ''; input.displayName = '' }
    }
    return
  }

  const readline = createInterface({ input: stdin, output: stdout })
  let password = ''
  let repeatPassword = ''
  let displayName = ''
  try {
    displayName = await readline.question('Ім’я першого адміністратора: ')
    const username = await readline.question('Логін першого адміністратора: ')
    readline.close()
    if (!displayName.trim() || displayName.trim().length > 150) throw new Error('Вкажіть ім’я адміністратора (до 150 символів).')
    password = await readHiddenPassword('Пароль (від 8 до 256 символів): ')
    repeatPassword = await readHiddenPassword('Повторіть пароль: ')
    if (password !== repeatPassword) throw new Error('Паролі не збігаються.')
    const database = openInstalledServerDatabase(databasePath)
    try {
      const result = await createFirstAdministrator(database, { displayName, username, password })
      if (!result.ok) throw new Error(result.message)
    } finally { database.close() }
    stdout.write('Початкового адміністратора створено.\n')
  } finally {
    password = ''
    repeatPassword = ''
    displayName = ''
    readline.close()
  }
}

async function readHiddenPassword(prompt: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY) throw new Error('Для безпечного введення пароля потрібен інтерактивний термінал.')
  stdout.write(prompt)
  stdin.setRawMode(true)
  stdin.resume()
  stdin.setEncoding('utf8')
  return await new Promise<string>((resolvePassword, rejectPassword) => {
    let password = ''
    const restore = () => { stdin.off('data', onData); stdin.setRawMode(false); stdout.write('\n') }
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === '\r' || character === '\n') { restore(); resolvePassword(password); return }
        if (character === '\u0003') { restore(); rejectPassword(new Error('Операцію скасовано.')); return }
        if (character === '\u007f' || character === '\b') { password = Array.from(password).slice(0, -1).join(''); continue }
        password += character
      }
    }
    stdin.on('data', onData)
  })
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Не вдалося створити початкового адміністратора.'
  stdout.write(`${message}\n`)
  process.exitCode = 1
})
