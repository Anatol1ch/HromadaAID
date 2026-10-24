import { win32 } from 'node:path'

/** Only the installer’s explicit first-install review journal can authorize a retry over Server/. */
export function isInitialInstallRetryJournal(value: unknown, programDirectory: string): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const journal = value as Record<string, unknown>
  return journal.formatVersion === 1 &&
    journal.phase === 'initial-install-needs-review' &&
    journal.hadPreviousPackage === false &&
    typeof journal.programDirectory === 'string' &&
    win32.resolve(journal.programDirectory).toLocaleLowerCase('en-US') === win32.resolve(programDirectory).toLocaleLowerCase('en-US')
}
