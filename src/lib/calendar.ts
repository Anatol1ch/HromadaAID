import { daysInMonth, isIsoCalendarDate } from './dates'

export const monthNames = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень']
export const weekdays = ['Понеділок', 'Вівторок', 'Середа', 'Четвер', 'П’ятниця', 'Субота', 'Неділя']
export const shortWeekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд']

export function calendarDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function utcDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number)
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(0, 0, 0, 0)
  return date
}

export function shiftDays(iso: string, delta: number): string {
  const date = utcDate(iso)
  date.setUTCDate(date.getUTCDate() + delta)
  if (date.getUTCFullYear() < 1) return '0001-01-01'
  if (date.getUTCFullYear() > 9999) return '9999-12-31'
  return calendarDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

export function shiftMonths(iso: string, delta: number): string {
  const [year, month, day] = iso.split('-').map(Number)
  const index = Math.max(12, Math.min(9999 * 12 + 11, year * 12 + month - 1 + delta))
  const nextYear = Math.floor(index / 12), nextMonth = index % 12 + 1
  return calendarDate(nextYear, nextMonth, Math.min(day, daysInMonth(nextYear, nextMonth)))
}

export function mondayIndex(iso: string): number { return (utcDate(iso).getUTCDay() + 6) % 7 }

export function monthGrid(year: number, month: number): string[][] {
  const first = calendarDate(year, month, 1)
  const offset = mondayIndex(first)
  return Array.from({ length: 6 }, (_, week) => Array.from({ length: 7 }, (_, day) => {
    const date = utcDate(first)
    date.setUTCDate(1 - offset + week * 7 + day)
    const iso = calendarDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
    return isIsoCalendarDate(iso) ? iso : ''
  }))
}
