export function todayIsoDate(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  return match ? `${match[3]}.${match[2]}.${match[1]}` : '—'
}

export function parseDateInput(value: string): string | null {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value.trim())
  if (!match) return null
  const [, dayText, monthText, yearText] = match
  const day = Number(dayText), month = Number(monthText), year = Number(yearText)
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null
  return `${yearText}-${monthText}-${dayText}`
}

export function formatDateInput(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return match ? `${match[3]}.${match[2]}.${match[1]}` : ''
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

export function isIsoCalendarDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && parseDateInput(formatDateInput(value)) === value
}
