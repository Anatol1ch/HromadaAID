import { useEffect, useId, useRef, useState } from 'react'
import { advanceAfterSelection, tabFromPopup } from '../lib/keyboardNavigation'
import { CalendarDays, ChevronDown } from 'lucide-react'
import { availableAccountingYears } from '../../electron/accounting-year'

type YearPickerProps = {
  value: number
  onChange: (year: number) => void
  label?: string
}

export default function YearPicker({ value, onChange, label = 'Рік' }: YearPickerProps) {
  const [calendarYear, setCalendarYear] = useState(() => new Date().getFullYear())
  const yearOptions = availableAccountingYears(calendarYear)
  useEffect(() => {
    const refresh = () => setCalendarYear(new Date().getFullYear())
    const timer = window.setInterval(refresh, 60000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [])
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | undefined>(undefined)
  const close = () => {
    window.clearTimeout(closeTimer.current)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setOpen(false); setClosing(false); return }
    setClosing(true)
    closeTimer.current = window.setTimeout(() => { setOpen(false); setClosing(false) }, 120)
  }
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (open && !root.current?.contains(event.target as Node)) close() }
    document.addEventListener('pointerdown', outside)
    return () => { document.removeEventListener('pointerdown', outside); window.clearTimeout(closeTimer.current) }
  }, [open])
  return <div className="year-picker" ref={root} onKeyDown={event => {
    if (event.ctrlKey || event.altKey || event.metaKey) return
    if (open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); trigger.current?.focus(); return }
    if (open && event.key === 'Tab') {
      close(); trigger.current?.focus()
      if (trigger.current && tabFromPopup(trigger.current, event.shiftKey)) { event.preventDefault(); event.stopPropagation() }
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) { window.clearTimeout(closeTimer.current); setClosing(false); setOpen(true); requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus()); return }
      const options = [...root.current!.querySelectorAll<HTMLButtonElement>('[role="option"]')]
      const index = options.indexOf(document.activeElement as HTMLButtonElement)
      options[(index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus()
    }
  }}>
    <button ref={trigger} id={id} type="button" role="combobox" aria-controls={`${id}-options`} className="year-picker-trigger" aria-haspopup="listbox" aria-expanded={open} aria-label={`Звітний рік: ${value}`} onClick={() => { if (open) close(); else { window.clearTimeout(closeTimer.current); setClosing(false); setOpen(true); requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus()) } }}>
      <CalendarDays size={19}/><span className="year-picker-label">{label}</span><strong>{value}</strong><ChevronDown size={17} className={open ? 'year-picker-chevron open' : 'year-picker-chevron'}/>
    </button>
    {open && <div className={`year-picker-menu ${closing ? 'closing' : ''}`} id={`${id}-options`} data-keyboard-popup={id} role="listbox" aria-label="Оберіть рік">{yearOptions.map((year) => <button type="button" role="option" aria-selected={year === value} className={year === value ? 'selected' : ''} key={year} onClick={event => { onChange(year); close(); trigger.current?.focus(); if (event.detail === 0) advanceAfterSelection(trigger.current) }}>{year}</button>)}</div>}
  </div>
}
