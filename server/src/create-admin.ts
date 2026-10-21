import { resolve } from 'node:path'
import { stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { createFirstAdministrator } from './auth.js'
import { openServerDatabase } from './database.js'

function readDatabasePath(argumentsList: string[]): string {
  if (argumentsList[0] === '--') argumentsList = argumentsList.slice(1)
  if (argumentsList.length !== 2 || argumentsList[0] !== '--database' || !argumentsList[1] || argumentsList[1].startsWith('-')) {
    throw new Error('Використання: pnpm server:create-admin -- --database <шлях-до-серверної-sqlite>')
  }
  const databasePath = resolve(argumentsList[1])
  const appData = process.env.APPDATA
  const localDatabase = appData ? resolve(appData, 'hromada-aid', 'hromada-aid.sqlite') : undefined
  if (localDatabase && databasePath.toLocaleLowerCase('uk-UA') === localDatabase.toLocaleLowerCase('uk-UA')) {
    throw new Error('Створення адміністратора у локальній SQLite Electron заборонено. Вкажіть серверну SQLite.')
  }
  return databasePath
}

async function readHiddenPassword(prompt: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY) throw new Error('Для безпечного введення пароля потрібен інтерактивний термінал.')
  stdout.write(prompt)
  stdin.setRawMode(true)
  stdin.resume()
  stdin.setEncoding('utf8')
  return await new Promise<string>((resolvePassword, rejectPassword) => {
    let password = ''
    const restore = () => {
      stdin.off('data', onData)
      stdin.setRawMode(false)
      stdout.write('\n')
    }
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === '\r' || character === '\n') {
          restore()
          resolvePassword(password)
          return
        }
        if (character === '\u0003') {
          restore()
          rejectPassword(new Error('Операцію скасовано.'))
          return
        }
        if (character === '\u007f' || character === '\b') {
          password = password.slice(0, -1)
          continue
        }
        password += character
      }
    }
    stdin.on('data', onData)
  })
}

async function main(): Promise<void> {
  const databasePath = readDatabasePath(process.argv.slice(2))
  const readline = createInterface({ input: stdin, output: stdout })
  try {
    const username = await readline.question('Логін першого адміністратора: ')
    readline.close()
    const password = await readHiddenPassword('Пароль (щонайменше 12 символів): ')
    const repeatPassword = await readHiddenPassword('Повторіть пароль: ')
    if (password !== repeatPassword) throw new Error('Паролі не збігаються.')
    const database = openServerDatabase(databasePath)
    try {
      const result = await createFirstAdministrator(database, { username, password })
      if (!result.ok) throw new Error(result.message)
    } finally {
      database.close()
    }
    stdout.write('Початкового адміністратора створено.\n')
  } finally {
    readline.close()
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Не вдалося створити початкового адміністратора.'
  stdout.write(`${message}\n`)
  process.exitCode = 1
})
