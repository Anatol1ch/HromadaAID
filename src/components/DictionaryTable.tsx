import type { ReactNode } from 'react'
import SearchField from './SearchField'
import Alert from './Alert'
import DataState from './DataState'
import { TableSkeleton } from './Skeleton'

export function DictionaryToolbar({ title, count, loading = false, unavailable = false, children }: { title: string; count: string; loading?: boolean; unavailable?: boolean; children?: ReactNode }) {
  return <header className="dictionary-toolbar"><div className="dictionary-toolbar-heading"><h2>{title}</h2><p aria-live="polite">{loading ? 'Завантаження…' : unavailable ? 'Дані недоступні' : count}</p></div><div className="dictionary-toolbar-actions">{children}</div></header>
}

export function DictionarySearch({ value, onChange, label, placeholder }: { value: string; onChange: (value: string) => void; label: string; placeholder: string }) {
  return <SearchField className="dictionary-search" value={value} onChange={onChange} label={label} placeholder={placeholder}/>
}

export default function DictionaryTable({ label, className = '', columns, children, empty, loading = false, filtered = false, error, onRetry }: {
  label: string; className?: string; columns: { label: string; width?: string; className?: string }[]; children?: ReactNode; empty?: string; loading?: boolean; filtered?: boolean; error?: string; onRetry?: () => void
}) {
  if (loading && Boolean(empty)) return <TableSkeleton columns={columns.length} label="Завантажуємо записи…"/>
  return <div className="dictionary-table-wrap" role="region" aria-label={label} tabIndex={0}>
    <table className={`dictionary-table ${className}`} aria-label={label} aria-busy={loading}>
      <colgroup>{columns.map((column, index) => <col key={index} style={column.width ? { width: column.width } : undefined}/>)}</colgroup>
      <thead><tr>{columns.map((column, index) => <th key={index} scope="col" className={column.className}>{column.label}</th>)}</tr></thead>
      <tbody>{empty || error ? <tr><td colSpan={columns.length}>{error ? <Alert variant="error" action={onRetry && <button type="button" onClick={onRetry}>Повторити завантаження</button>}>{error}</Alert> : <DataState kind={filtered ? 'search' : 'empty'} message={empty} description={filtered ? 'Змініть або очистіть пошуковий запит.' : undefined}/>}</td></tr> : children}</tbody>
    </table>
  </div>
}
