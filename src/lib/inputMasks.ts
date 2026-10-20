import { normalizeField } from '../../electron/field-formats.js'

/** Preserve incomplete drafts, but cap each passport format independently. */
export function cleanPassportInput(value: string): string {
  const text = value.toLocaleUpperCase('uk').replace(/[^А-ЩЬЮЯЄІЇҐ0-9]/gu, '')
  if (/^\d/.test(text)) return text.replace(/\D/g, '').slice(0, 9)
  let letters = '', digits = ''
  for (const character of text) {
    if (/\d/.test(character)) {
      if (digits.length < 6) digits += character
    } else if (!digits && letters.length < 2) letters += character
  }
  return letters + digits
}

export type MaskKind = 'phone' | 'bankAccount'
export const maskPrefix = (kind: MaskKind) => kind === 'phone' ? '+380' : 'UA'
export const maskLength = (kind: MaskKind) => kind === 'phone' ? 9 : 27
export function formatMask(kind: MaskKind, digits: string): string {
  const groups = kind === 'phone' ? [2, 3, 2, 2] : [2, 6, 19]
  let offset = 0
  return maskPrefix(kind) + groups.map(length => {
    const part = digits.slice(offset, offset + length)
    offset += length
    return part ? ' ' + part : ''
  }).join('')
}
export function maskDigits(kind: MaskKind, value: string): string {
  const prefix = maskPrefix(kind)
  return (value.startsWith(prefix) ? value.slice(prefix.length) : value).replace(/\D/g, '').slice(0, maskLength(kind))
}
export function displayMask(kind: MaskKind, value: string): string {
  const normalized = normalizeField(kind, value)
  if (!normalized) return maskPrefix(kind)
  // Preserve invalid legacy data visibly until the user explicitly edits it.
  return normalized.startsWith(maskPrefix(kind)) && /^\d*$/.test(normalized.slice(maskPrefix(kind).length))
    && normalized.length <= maskPrefix(kind).length + maskLength(kind)
    ? formatMask(kind, maskDigits(kind, normalized)) : value
}
export function digitOffset(kind: MaskKind, display: string, caret: number): number {
  return display.slice(maskPrefix(kind).length, Math.max(maskPrefix(kind).length, caret)).replace(/\D/g, '').length
}
export function caretForDigit(kind: MaskKind, display: string, offset: number): number {
  if (!offset) return display.length > maskPrefix(kind).length ? maskPrefix(kind).length + 1 : maskPrefix(kind).length
  let count = 0
  for (let index = maskPrefix(kind).length; index < display.length; index++) {
    if (/\d/.test(display[index]) && ++count === offset) return index + 1
  }
  return display.length
}
export function editMask(kind: MaskKind, display: string, start: number, end: number, inserted: string, deletion?: 'backward' | 'forward') {
  const digits = maskDigits(kind, display)
  let from = digitOffset(kind, display, start), to = digitOffset(kind, display, end)
  if (start === end && deletion === 'backward') from = Math.max(0, from - 1)
  if (start === end && deletion === 'forward') to = Math.min(digits.length, to + 1)
  const clean = inserted.replace(/\D/g, '').slice(0, Math.max(0, maskLength(kind) - (digits.length - (to - from))))
  const next = digits.slice(0, from) + clean + digits.slice(to)
  const text = formatMask(kind, next)
  return { value: next ? maskPrefix(kind) + next : '', text, caret: caretForDigit(kind, text, from + clean.length) }
}
