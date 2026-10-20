import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { advanceAfterSelection, tabFromPopup } from '../lib/keyboardNavigation'
import { Check, ChevronDown, Search } from 'lucide-react'

export type SelectOption = { value: string; label: string; description?: string; searchText?: string; disabled?: boolean }
type Props = {
  label: string; value: string; options: SelectOption[]; onChange: (value: string) => void
  placeholder?: string; required?: boolean; disabled?: boolean; searchable?: boolean; error?: string
  advanceOnSelect?: boolean
}

/** Controlled values and native form validity are shared by searchable and short lists. */
export default function Select({ label, value, options, onChange, placeholder = 'Оберіть значення', required = false, disabled = false, searchable, error, advanceOnSelect = true }: Props) {
  const id = useId()
  const root = useRef<HTMLSpanElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const validity = useRef<HTMLInputElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState('')
  const [invalid, setInvalid] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0, width: 240, maxHeight: 320 })
  const selected = options.find((option) => option.value === value && !option.disabled)
  const canSearch = searchable ?? options.length > 7
  const visible = options.filter((option) => `${option.label} ${option.searchText ?? ''}`.toLocaleLowerCase('uk').includes(query.trim().toLocaleLowerCase('uk')))
  const enabled = visible.filter((option) => !option.disabled)
  const activeValue = enabled.some((option) => option.value === active) ? active : enabled[0]?.value
  const message = error || (value && !selected ? 'Оберіть доступне значення зі списку.' : required && !value ? `Заповніть поле «${label}».` : '')

  useEffect(() => { validity.current?.setCustomValidity(message); setInvalid(false) }, [message, value])
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])
  const close = (restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) trigger.current?.focus({ preventScroll: true })
  }
  const show = () => {
    if (disabled) return
    setHost(root.current?.closest<HTMLElement>('.calendar-popover, .app-modal') ?? document.body)
    setQuery(''); setActive(selected?.value ?? options.find((option) => !option.disabled)?.value ?? ''); setOpen(true)
  }
  const choose = (option: SelectOption, advance = false) => {
    if (disabled || trigger.current?.matches(':disabled') || option.disabled) return
    onChange(option.value); setInvalid(false); close(true)
    if (advance && advanceOnSelect) advanceAfterSelection(trigger.current)
  }
  const keyboard = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.altKey || event.metaKey || event.nativeEvent.isComposing) return
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(true); return }
    if (event.key === 'Tab' && open) {
      // Search lives in a portal at the end of the modal. Continue from the
      // original field rather than jumping to the end of the dialog.
      close(true)
      if (trigger.current && tabFromPopup(trigger.current, event.shiftKey)) {
        event.preventDefault(); event.stopPropagation()
      }
      return
    }
    if (!open && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); show(); return }
    if (!open) return
    const index = enabled.findIndex((option) => option.value === activeValue)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setActive(enabled[(index + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length]?.value ?? '')
    } else if ((event.key === 'Home' || event.key === 'End') && event.target !== search.current) {
      event.preventDefault(); setActive((event.key === 'Home' ? enabled[0] : enabled.at(-1))?.value ?? '')
    } else if (event.key === 'Enter' || (event.key === ' ' && event.target !== search.current)) {
      event.preventDefault()
      const option = enabled.find((item) => item.value === activeValue)
      if (option && !event.repeat) choose(option, event.key === 'Enter')
    } else if (!canSearch && event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
      const match = enabled.find((option) => option.label.toLocaleLowerCase('uk').startsWith(event.key.toLocaleLowerCase('uk')))
      if (match) setActive(match.value)
    }
  }

  useLayoutEffect(() => {
    if (!open || !popup.current) return
    const panel = popup.current
    panel.showPopover()
    const place = () => {
      if (!root.current) return
      const anchor = root.current.getBoundingClientRect()
      const margin = 10, gap = 6
      const below = window.innerHeight - anchor.bottom - margin - gap
      const above = anchor.top - margin - gap
      const up = below < 280 && above > below
      const maxHeight = Math.max(60, Math.min(340, up ? above : below))
      const width = Math.min(Math.max(anchor.width, 240), window.innerWidth - margin * 2)
      panel.style.width = `${width}px`; panel.style.maxHeight = `${maxHeight}px`
      const height = panel.getBoundingClientRect().height
      setPosition({ width, maxHeight, left: Math.max(margin, Math.min(anchor.left, window.innerWidth - width - margin)), top: Math.max(margin, Math.min(up ? anchor.top - gap - height : anchor.bottom + gap, window.innerHeight - height - margin)) })
    }
    const outside = (event: Event) => {
      if (!root.current?.contains(event.target as Node) && !panel.contains(event.target as Node)) close()
    }
    const observer = new ResizeObserver(place)
    observer.observe(panel)
    if (root.current) observer.observe(root.current)
    place()
    if (canSearch) search.current?.focus({ preventScroll: true })
    else trigger.current?.focus({ preventScroll: true })
    window.addEventListener('resize', place)
    document.addEventListener('scroll', place, true)
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('focusin', outside)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
      document.removeEventListener('scroll', place, true)
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('focusin', outside)
      if (panel.matches(':popover-open')) panel.hidePopover()
    }
  }, [open, host, canSearch])
  useEffect(() => {
    if (open) popup.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [open, activeValue])
  const optionId = (option: SelectOption) => `${id}-option-${options.indexOf(option)}`
  const activeOption = enabled.find((option) => option.value === activeValue)
  const listId = `${id}-list`
  return <span ref={root} className={`app-select${invalid || error ? ' app-select-invalid' : ''}`}>
    <button ref={trigger} id={id} type="button" className="app-select-trigger" role="combobox" aria-label={label} aria-expanded={open} aria-controls={listId} aria-haspopup="listbox" aria-required={required} aria-invalid={invalid || !!error} aria-describedby={invalid || error ? `${id}-error` : undefined} aria-activedescendant={open && !canSearch && activeOption ? optionId(activeOption) : undefined} disabled={disabled} onClick={() => open ? close() : show()} onKeyDown={keyboard}>
      <span className={!selected ? 'app-select-placeholder' : undefined}>{selected?.label ?? placeholder}</span><ChevronDown size={17} aria-hidden="true"/>
    </button>
    <input ref={validity} className="app-select-validity" tabIndex={-1} aria-hidden="true" value={selected?.value ?? ''} onChange={() => {}} required={required} disabled={disabled} onInvalid={(event) => { event.preventDefault(); setInvalid(true); trigger.current?.focus() }}/>
    {(invalid || error) && <span className="app-select-error" id={`${id}-error`} role="alert">{message}</span>}
    {open && !disabled && host && createPortal(<div ref={popup} data-keyboard-popup={id} className="app-select-popup" popover="manual" style={position} onKeyDown={keyboard} onClick={(event) => event.stopPropagation()}>
      {canSearch && <div className="app-select-search"><Search size={16} aria-hidden="true"/><input ref={search} role="combobox" aria-label={`Пошук: ${label}`} aria-expanded="true" aria-controls={listId} aria-autocomplete="list" aria-activedescendant={activeOption ? optionId(activeOption) : undefined} placeholder="Пошук…" value={query} onChange={(event) => { setQuery(event.target.value); setActive('') }}/></div>}
      <div id={listId} role="listbox" aria-label={label} className="app-select-options">
        {visible.map((option) => <div key={option.value} id={optionId(option)} role="option" aria-selected={option.value === value} aria-disabled={option.disabled || undefined} data-active={option.value === activeValue} className="app-select-option" onPointerMove={() => { if (!option.disabled) setActive(option.value) }} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(option)}><span>{option.label}{option.description && <small className="app-select-description">{option.description}</small>}</span>{option.value === value && <Check size={16} aria-hidden="true"/>}</div>)}
        {!visible.length && <div className="app-select-empty" role="status">Нічого не знайдено</div>}
      </div>
    </div>, host)}
  </span>
}
