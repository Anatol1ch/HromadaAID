import { availableAccountingYears } from '../../electron/accounting-year.js'

const storageKey = 'hromadaAid.accountingYear'
export function initialAccountingYear(): number {
  const current = new Date().getFullYear()
  try {
    const stored = Number(localStorage.getItem(storageKey))
    if (availableAccountingYears(current).includes(stored)) return stored
  } catch { /* Storage may be unavailable; the working year still works in memory. */ }
  return current
}
export function rememberAccountingYear(year: number) {
  try { localStorage.setItem(storageKey, String(year)) } catch { /* Do not interrupt work. */ }
}
