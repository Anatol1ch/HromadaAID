import { useRef } from 'react'
import { Search, X } from 'lucide-react'

type Props = {
  value: string
  onChange: (value: string) => void
  label: string
  placeholder: string
  disabled?: boolean
  className?: string
}

/** Presentation only: each caller keeps its existing search/filter rules. */
export default function SearchField({ value, onChange, label, placeholder, disabled = false, className = '' }: Props) {
  const input = useRef<HTMLInputElement>(null)
  return <div className={`ui-search registry-search ${className}`}>
    <Search size={19} aria-hidden="true"/>
    <input ref={input} type="search" value={value} disabled={disabled} onChange={event => onChange(event.target.value)} aria-label={label} placeholder={placeholder}/>
    {value && <button type="button" className="ui-search-clear" disabled={disabled} aria-label={`Очистити: ${label}`} title="Очистити пошук" onClick={() => { onChange(''); input.current?.focus() }}><X size={16} aria-hidden="true"/></button>}
  </div>
}
