export const FIRST_ACCOUNTING_YEAR = 2026

export function availableAccountingYears(calendarYear = new Date().getFullYear()): number[] {
  const last = Math.max(FIRST_ACCOUNTING_YEAR, calendarYear) + 1
  return Array.from({ length: last - FIRST_ACCOUNTING_YEAR + 1 }, (_, index) => FIRST_ACCOUNTING_YEAR + index)
}

/** Keep historical read compatibility; only the old hard-coded fallback changes. */
export function resolveAccountingYear(value: unknown): number {
  return Number.isInteger(value) && Number(value) >= 2000 && Number(value) <= 2200 ? Number(value) : new Date().getFullYear()
}

export function paymentYearError(paidOn: string | undefined, decisionDateOrYear: string | number): string {
  const year = String(decisionDateOrYear).slice(0, 4)
  return paidOn?.slice(0, 4) === year ? ''
    : `Дата фактичної виплати має належати року рішення — ${year}. Перенесення виплат між роками не допускається.`
}
