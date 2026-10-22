import { resolve } from 'node:path'
import { BackupKeyStore, createRecoveryKey } from './backup-crypto.js'

try {
  if (!process.stdout.isTTY || !process.stdin.isTTY) throw new Error('Створюйте аварійний ключ в інтерактивному терміналі; не спрямовуйте його в журнали.')
  const index = process.argv.indexOf('--backup-dir')
  const directory = index >= 0 ? process.argv[index + 1] : undefined
  if (!directory || /\.sqlite(?:3)?$/i.test(directory)) throw new Error('Вкажіть --backup-dir <каталог серверних резервних копій>.')
  const store = new BackupKeyStore(resolve(directory))
  if (store.exists()) throw new Error('Ключ резервування вже створений. Його не було змінено.')
  const key = createRecoveryKey()
  store.create({ version: 1, encryptionKey: key.encoded })
  console.log('Збережіть аварійний ключ офлайн, окремо від сервера та архівів. Для розшифрування потрібен саме цей ключ:')
  console.log(key.encoded)
  console.log('Ключ захищено Windows DPAPI та ACL. Повторний запуск не замінює ключ.')
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Не вдалося створити ключ резервування.')
  process.exitCode = 1
}
