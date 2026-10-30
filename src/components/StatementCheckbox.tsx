import { useEffect, useRef } from 'react'
import { Check, Minus } from 'lucide-react'

export default function StatementCheckbox({ checked, indeterminate = false, disabled = false, label, onChange }: { checked: boolean; indeterminate?: boolean; disabled?: boolean; label: string; onChange: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (input.current) input.current.indeterminate = indeterminate }, [indeterminate])
  return <span className="formation-checkbox"><input ref={input} type="checkbox" checked={checked} disabled={disabled} aria-label={label} aria-checked={indeterminate ? 'mixed' : checked} onChange={onChange}/><span className="custom-checkbox" aria-hidden="true">{indeterminate ? <Minus size={14}/> : checked ? <Check size={14}/> : null}</span></span>
}
