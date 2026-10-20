import type { ReactNode } from 'react'
import { LoaderCircle, SearchX, TableProperties } from 'lucide-react'

/** Shared presentation of successful empty responses and real pending requests. */
export default function DataState({ kind, message, description, compact = false, className = '', icon }: {
  kind: 'loading' | 'empty' | 'search'; message: ReactNode; description?: ReactNode
  compact?: boolean; className?: string; icon?: ReactNode
}) {
  const Icon = kind === 'loading' ? LoaderCircle : kind === 'search' ? SearchX : TableProperties
  return <div className={`ui-data-state${compact ? ' ui-data-state-compact' : ''}${className ? ` ${className}` : ''}`} role="status" aria-atomic="true" aria-busy={kind === 'loading' || undefined}>
    {icon ?? <Icon size={compact ? 16 : 22} className={kind === 'loading' ? 'formation-spinner' : undefined} aria-hidden="true"/>}
    <div><strong>{message}</strong>{description && <span>{description}</span>}</div>
  </div>
}
