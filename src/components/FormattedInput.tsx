import { useLayoutEffect, useReducer, useRef, type InputHTMLAttributes } from 'react'
import { normalizeField, type FormattedField } from '../../electron/field-formats'
import { caretForDigit, cleanPassportInput, digitOffset, displayMask, editMask, formatMask, maskDigits, maskLength, maskPrefix } from '../lib/inputMasks'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  kind: FormattedField; value: string; onChange: (value: string) => void
}

/** Model values are unformatted; only this input owns separators and caret placement. */
export default function FormattedInput({ kind, value, onChange, ...props }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const caret = useRef<number | null>(null)
  const [revision, redraw] = useReducer(n => n + 1, 0)
  const masked = kind === 'phone' || kind === 'bankAccount' ? kind : null
  const display = masked ? displayMask(masked, value) : value
  useLayoutEffect(() => {
    if (caret.current !== null && input.current && input.current === document.activeElement) {
      input.current.setSelectionRange(caret.current, caret.current)
    }
    caret.current = null
  }, [value, revision])
  const change = (next: string, position: number) => {
    if (props.disabled || input.current?.matches(':disabled')) return
    caret.current = position
    onChange(next)
    redraw()
  }
  return <input {...props} ref={input} value={display}
    inputMode={masked || kind === 'rnokpp' ? 'numeric' : kind === 'email' ? 'email' : props.inputMode}
    onFocus={event => {
      if (masked && (event.currentTarget.selectionStart ?? 0) < maskPrefix(masked).length) {
        const position = caretForDigit(masked, display, 0)
        event.currentTarget.setSelectionRange(position, position)
      }
      props.onFocus?.(event)
    }}
    onKeyDown={event => {
      props.onKeyDown?.(event)
      if (event.defaultPrevented || !masked || event.nativeEvent.isComposing || event.altKey || event.metaKey) return
      if (!event.ctrlKey && event.key.length === 1) {
        event.preventDefault()
        if (/\d/.test(event.key)) {
          const edit = editMask(masked, display, event.currentTarget.selectionStart ?? display.length, event.currentTarget.selectionEnd ?? display.length, event.key)
          change(edit.value, edit.caret)
        }
        return
      }
      if (!['Backspace', 'Delete'].includes(event.key)) return
      event.preventDefault()
      const element = event.currentTarget
      let start = element.selectionStart ?? display.length, end = element.selectionEnd ?? start
      if (event.ctrlKey && start === end) {
        if (event.key === 'Backspace') start = maskPrefix(masked).length
        else end = display.length
      }
      const edit = editMask(masked, display, start, end, '', event.key === 'Backspace' ? 'backward' : 'forward')
      change(edit.value, edit.caret)
    }}
    onPaste={event => {
      if (kind === 'passport') {
        event.preventDefault()
        const pasted = event.clipboardData.getData('text')
        if (!pasted) return
        const start = event.currentTarget.selectionStart ?? value.length
        const end = event.currentTarget.selectionEnd ?? start
        const prefix = value.slice(0, start) + pasted
        change(cleanPassportInput(prefix + value.slice(end)), cleanPassportInput(prefix).length)
        return
      }
      if (!masked) return
      event.preventDefault()
      const pasted = event.clipboardData.getData('text').trim()
      if (!pasted) return
      const normalized = normalizeField(masked, pasted)
      const prefix = maskPrefix(masked)
      if (masked === 'phone' && (/[^\d+\s()-]/.test(pasted) || (pasted.includes('+') && !pasted.startsWith('+380')))) return
      if (masked === 'bankAccount' && !/^UA/i.test(pasted) && /[^\d\s]/.test(pasted)) return
      const fullNumber = masked === 'bankAccount' ? /^UA/i.test(pasted) : pasted.startsWith('+380') || /^(?:380|0)\d{9}$/.test(pasted.replace(/[\s()-]/g, ''))
      if (fullNumber) {
        if (masked === 'phone' && !normalized) { change('', prefix.length); return }
        if (!normalized.startsWith(prefix) || !/^\d*$/.test(normalized.slice(prefix.length)) || normalized.length > prefix.length + maskLength(masked)) return
        const digits = maskDigits(masked, normalized)
        change(digits ? prefix + digits : '', formatMask(masked, digits).length)
      } else {
        if (pasted.replace(/\D/g, '').length > maskLength(masked)) return
        const edit = editMask(masked, display, event.currentTarget.selectionStart ?? display.length, event.currentTarget.selectionEnd ?? display.length, pasted)
        change(edit.value, edit.caret)
      }
    }}
    onCut={event => {
      if (!masked) return
      event.preventDefault()
      const start = event.currentTarget.selectionStart ?? 0, end = event.currentTarget.selectionEnd ?? start
      event.clipboardData.setData('text/plain', display.slice(start, end))
      const edit = editMask(masked, display, start, end, '')
      change(edit.value, edit.caret)
    }}
    onChange={event => {
      const raw = event.currentTarget.value
      const position = event.currentTarget.selectionStart ?? raw.length
      if (masked) {
        const digits = maskDigits(masked, raw)
        const next = formatMask(masked, digits)
        const offset = raw.startsWith(maskPrefix(masked)) ? digitOffset(masked, raw, position) : raw.slice(0, position).replace(/\D/g, '').length
        change(digits ? maskPrefix(masked) + digits : '', caretForDigit(masked, next, offset))
      } else if (kind === 'passport' || kind === 'rnokpp') {
        const clean = (text: string) => kind === 'passport' ? cleanPassportInput(text) : text.replace(/\D/g, '').slice(0, 10)
        change(clean(raw), clean(raw.slice(0, position)).length)
      } else onChange(raw)
    }}/>
}
