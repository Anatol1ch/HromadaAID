import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react'
import Select from './Select'
import { daysInMonth, formatDateInput, isIsoCalendarDate, parseDateInput, todayIsoDate } from '../lib/dates'
import { calendarDate, mondayIndex, monthGrid, monthNames, shiftDays, shiftMonths, shortWeekdays, weekdays } from '../lib/calendar'

type DatePickerProps = {
  value: string
  onChange: (value: string) => void
  required?: boolean
  disabled?: boolean
  error?: string
  'aria-describedby'?: string
  autoFocus?: boolean
  id?: string
  list?: string
  min?: string
  max?: string
}

export default function DatePicker({ value, onChange, required = false, disabled = false, error, 'aria-describedby': describedBy, autoFocus = false, id, list, min = '0001-01-01', max = '9999-12-31' }: DatePickerProps) {
  const calendarId = useId()
  const inputId = id ?? `${calendarId}-input`
  const root = useRef<HTMLSpanElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const popup = useRef<HTMLSpanElement>(null)
  const focusCalendar = useRef(false)
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [text, setText] = useState(formatDateInput(value))
  const [open, setOpen] = useState(false)
  const [touched, setTouched] = useState(false)
  const [yearsOpen, setYearsOpen] = useState(false)
  const [cursor, setCursor] = useState(isIsoCalendarDate(value) ? value : todayIsoDate())
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const lower = isIsoCalendarDate(min) ? min : '0001-01-01'
  const upper = isIsoCalendarDate(max) ? max : '9999-12-31'
  const clamp = (iso: string) => iso < lower ? lower : iso > upper ? upper : iso
  const selected = parseDateInput(text)
  const [year, month] = cursor.split('-').map(Number)
  const firstYear = Math.floor((year - 1) / 12) * 12 + 1
  const yearOptions = Array.from({ length: Math.min(12, 10000 - firstYear) }, (_, index) => firstYear + index)
  const today = todayIsoDate()
  const validationMessage = (display: string) => {
    if (!display) return required ? 'Вкажіть дату.' : ''
    const iso = parseDateInput(display)
    if (!iso) return 'Введіть коректну дату у форматі ДД.ММ.РРРР.'
    if (iso < lower || iso > upper) return `Оберіть дату від ${formatDateInput(lower)} до ${formatDateInput(upper)}.`
    return ''
  }
  const shownError = error || (touched ? validationMessage(text) : '')
  const errorId = `${inputId}-error`
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])

  useEffect(() => {
    const display = formatDateInput(value)
    setText(display)
    input.current?.setCustomValidity(validationMessage(display))
  }, [value, required, lower, upper])

  const close = (restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) input.current?.focus({ preventScroll: true })
  }
  const show = (focus = false) => {
    if (disabled || input.current?.matches(':disabled')) return
    if (open && focus) {
      popup.current?.querySelector<HTMLButtonElement>(`[data-date="${cursor}"]`)?.focus({ preventScroll: true })
      return
    }
    setHost(root.current?.closest<HTMLElement>('.app-modal') ?? document.body)
    setCursor(clamp(selected ?? (isIsoCalendarDate(value) ? value : today)))
    setYearsOpen(false)
    focusCalendar.current = focus
    setOpen(true)
  }
  const commit = (iso: string) => {
    if (disabled || input.current?.matches(':disabled')) return
    const display = formatDateInput(iso)
    const message = validationMessage(display)
    input.current?.setCustomValidity(message)
    if (message) { input.current?.reportValidity(); return }
    setText(display)
    onChange(parseDateInput(display)!)
    close(true)
  }

  useLayoutEffect(() => {
    if (!open || !popup.current) return
    const panel = popup.current
    // Top-layer rendering escapes overflow clipping. The portal stays inside the
    // current modal so its existing focus trap still includes the calendar.
    panel.showPopover()
    const place = () => {
      if (!root.current) return
      const anchor = root.current.getBoundingClientRect()
      const bounds = panel.getBoundingClientRect()
      const margin = 10
      const below = anchor.bottom + 7
      const top = below + bounds.height <= window.innerHeight - margin ? below : anchor.top - bounds.height - 7
      setPosition({
        left: Math.max(margin, Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - margin)),
        top: Math.max(margin, Math.min(top, window.innerHeight - bounds.height - margin)),
      })
    }
    const outside = (event: PointerEvent) => {
      const target = event.target as Node
      if (!root.current?.contains(target) && !panel.contains(target)) setOpen(false)
    }
    const focusOutside = (event: FocusEvent) => {
      const target = event.target as Node
      if (!root.current?.contains(target) && !panel.contains(target)) setOpen(false)
    }
    const observer = new ResizeObserver(place)
    observer.observe(panel)
    if (root.current) observer.observe(root.current)
    place()
    window.addEventListener('resize', place)
    document.addEventListener('scroll', place, true)
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('focusin', focusOutside)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
      document.removeEventListener('scroll', place, true)
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('focusin', focusOutside)
      if (panel.matches(':popover-open')) panel.hidePopover()
    }
  }, [open, host])

  useLayoutEffect(() => {
    if (open && focusCalendar.current) {
      popup.current?.querySelector<HTMLButtonElement>(yearsOpen ? `[data-year="${year}"]` : `[data-date="${cursor}"]`)?.focus({ preventScroll: true })
      focusCalendar.current = false
    }
  }, [open, cursor, yearsOpen, year, host])

  const move = (iso: string, focus = true) => {
    focusCalendar.current = focus
    setCursor(clamp(iso))
  }
  const changeYear = (nextYear: number, focus = true) => {
    const next = Math.max(1, Math.min(9999, nextYear))
    move(calendarDate(next, month, Math.min(Number(cursor.slice(8)), daysInMonth(next, month))), focus)
  }
  const dayKeys = (event: KeyboardEvent<HTMLButtonElement>) => {
    let next: string | undefined
    if (event.key === 'ArrowLeft') next = shiftDays(cursor, -1)
    if (event.key === 'ArrowRight') next = shiftDays(cursor, 1)
    if (event.key === 'ArrowUp') next = shiftDays(cursor, -7)
    if (event.key === 'ArrowDown') next = shiftDays(cursor, 7)
    if (event.key === 'Home') next = shiftDays(cursor, -mondayIndex(cursor))
    if (event.key === 'End') next = shiftDays(cursor, 6 - mondayIndex(cursor))
    if (event.key === 'PageUp') next = shiftMonths(cursor, event.shiftKey ? -12 : -1)
    if (event.key === 'PageDown') next = shiftMonths(cursor, event.shiftKey ? 12 : 1)
    if (next) { event.preventDefault(); move(next) }
  }
  const escape = (event: KeyboardEvent) => {
    if (open && event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); close(true)
    }
  }

  return <><span className="date-field-control" ref={root} onKeyDown={escape}>
    <input ref={input} id={inputId} list={list} type="text" inputMode="numeric" autoComplete="off" autoFocus={autoFocus} required={required} disabled={disabled}
      pattern="\d{2}\.\d{2}\.\d{4}" placeholder="ДД.ММ.РРРР" value={text}
      aria-invalid={Boolean(shownError)} aria-describedby={[describedBy, shownError ? errorId : ''].filter(Boolean).join(' ') || undefined} aria-haspopup="dialog" aria-expanded={open && !disabled} aria-controls={open && !disabled ? calendarId : undefined}
      onClick={() => { if (!open) show() }}
      onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); show(true) } }}
      onInvalid={(event) => { event.preventDefault(); setTouched(true); event.currentTarget.setCustomValidity(validationMessage(text)); event.currentTarget.focus() }}
      onChange={(event) => {
        const next = event.target.value
        setText(next)
        event.currentTarget.setCustomValidity(validationMessage(next))
        if (!next) onChange('')
        else {
          const iso = parseDateInput(next)
          if (iso && !validationMessage(next)) { onChange(iso); move(iso, false) }
        }
      }}
      onBlur={() => { if (!disabled) setTouched(true); if (selected) setText(formatDateInput(selected)) }}
    />
    <button type="button" className="date-picker-button" disabled={disabled} aria-label="Відкрити календар" title="Відкрити календар" aria-haspopup="dialog" aria-expanded={open && !disabled} aria-controls={open && !disabled ? calendarId : undefined} onClick={() => open ? close(true) : show(true)}><CalendarDays size={18}/></button>
    {open && !disabled && host && createPortal(<span ref={popup} id={calendarId} data-keyboard-popup={inputId} popover="manual" role="dialog" aria-label="Календар вибору дати" className="calendar-popover" style={position} onKeyDown={escape}>
      <span className="calendar-heading">
        <button type="button" className="calendar-icon" aria-label={yearsOpen ? 'Попередні 12 років' : 'Попередній місяць'} disabled={yearsOpen ? firstYear === 1 : cursor.slice(0, 7) <= lower.slice(0, 7)} onClick={() => yearsOpen ? changeYear(year - 12, false) : move(shiftMonths(cursor, -1), false)}><ChevronLeft size={18}/></button>
        {yearsOpen ? <span className="calendar-year-range" aria-live="polite">{firstYear}–{yearOptions.at(-1)}</span> : <span className="calendar-month"><Select label="Місяць" searchable={false} advanceOnSelect={false} value={String(month)} options={monthNames.map((name, index) => ({ value: String(index + 1), label: name }))} onChange={value => move(shiftMonths(cursor, Number(value) - month), false)}/></span>}
        <button type="button" className="calendar-year" aria-label={yearsOpen ? 'Повернутися до днів' : `Вибрати рік, зараз ${year}`} aria-expanded={yearsOpen} onClick={() => { focusCalendar.current = true; setYearsOpen(!yearsOpen) }}>{year}</button>
        <button type="button" className="calendar-icon" aria-label={yearsOpen ? 'Наступні 12 років' : 'Наступний місяць'} disabled={yearsOpen ? firstYear + 12 > 9999 : cursor.slice(0, 7) >= upper.slice(0, 7)} onClick={() => yearsOpen ? changeYear(year + 12, false) : move(shiftMonths(cursor, 1), false)}><ChevronRight size={18}/></button>
      </span>
      <span className="visually-hidden" aria-live="polite">{monthNames[month - 1]} {year} року</span>
      {yearsOpen ? <span className="calendar-years" role="grid" aria-label="Роки">{Array.from({ length: Math.ceil(yearOptions.length / 3) }, (_, row) => <span role="row" key={row}>{yearOptions.slice(row * 3, row * 3 + 3).map((item) => <span role="gridcell" key={item} aria-selected={item === year}><button type="button" data-year={item} tabIndex={item === year ? 0 : -1} disabled={item < Number(lower.slice(0, 4)) || item > Number(upper.slice(0, 4))} className={item === year ? 'selected' : ''} onClick={() => { changeYear(item); setYearsOpen(false) }} onKeyDown={(event) => {
        const offset = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3, PageUp: -12, PageDown: 12 } as Record<string, number>)[event.key]
        if (offset) { event.preventDefault(); changeYear(year + offset) }
      }}>{item}</button></span>)}</span>)}</span> : <span className="calendar-grid" role="grid" aria-label={`${monthNames[month - 1]} ${year}`}>
        <span className="calendar-weekdays" role="row">{weekdays.map((name, index) => <span role="columnheader" aria-label={name} key={name}>{shortWeekdays[index]}</span>)}</span>
        {monthGrid(year, month).map((week, index) => <span className="calendar-week" role="row" key={index}>{week.map((iso, day) => <span role="gridcell" aria-selected={Boolean(iso && iso === selected)} key={iso || `empty-${day}`}>
          {iso && <button type="button" data-date={iso} tabIndex={iso === cursor ? 0 : -1} disabled={iso < lower || iso > upper} aria-label={formatDateInput(iso)} aria-current={iso === today ? 'date' : undefined}
            className={[iso === selected ? 'selected' : '', iso === today ? 'today' : '', Number(iso.slice(5, 7)) !== month ? 'adjacent-month' : ''].join(' ')}
            onFocus={() => { if (iso !== cursor && Number(iso.slice(5, 7)) === month) setCursor(iso) }} onKeyDown={dayKeys} onClick={() => commit(iso)}>{Number(iso.slice(8))}</button>}
        </span>)}</span>)}
      </span>}
      <span className="calendar-footer"><button type="button" disabled={today < lower || today > upper} onClick={() => commit(today)}>Сьогодні</button><button type="button" className="calendar-close" onClick={() => close(true)}><X size={15}/>Закрити</button></span>
    </span>, host)}
  </span>{shownError && <span className="recipient-field-error" id={errorId} role="alert">{shownError}</span>}</>
}
