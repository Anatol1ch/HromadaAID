import { RestoreError } from './restore-diagnostics.js'

export function parseRestoreArguments(input: string[]): { database: string; backupDirectory: string; archive?: string; recoveryKey: boolean } {
  const args = [...input]
  if (args[0] === '--') args.shift() // pnpm run may forward its separator to Node.
  const values = new Map<string, string>()
  let recoveryKey = false
  for (let index = 0; index < args.length; index++) {
    const name = args[index]
    if (name === '--recovery-key' && !recoveryKey) { recoveryKey = true; continue }
    if (!['--database', '--backup-dir', '--archive'].includes(name) || values.has(name)) throw new RestoreError('RESTORE_ARGUMENTS', 'arguments', 'Невідомий або повторний параметр. Використайте --database <SQLite> --backup-dir <каталог>; для зовнішнього архіву — --archive <.hraid> [--recovery-key].')
    const value = args[++index]
    if (!value || value.startsWith('--')) throw new RestoreError('RESTORE_ARGUMENT_VALUE', 'arguments', 'Після --database, --backup-dir та --archive потрібно вказати значення. Шляхи з пробілами беріть у лапки.')
    values.set(name, value)
  }
  const database = values.get('--database'), backupDirectory = values.get('--backup-dir'), archive = values.get('--archive')
  if (!database || !backupDirectory) throw new RestoreError('RESTORE_ARGUMENTS_REQUIRED', 'arguments', 'Вкажіть --database <серверна SQLite> та --backup-dir <каталог підтвердженої копії>. Автоматичний вибір шляхів не виконується.')
  if (recoveryKey && !archive) throw new RestoreError('RESTORE_ARGUMENTS', 'arguments', '--recovery-key використовується лише разом із --archive; ключ вводиться приховано, а не в аргументах.')
  return { database, backupDirectory, archive, recoveryKey }
}
