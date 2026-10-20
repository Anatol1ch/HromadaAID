import { useEffect, useState, type CSSProperties } from 'react'

type DelayedProps = { loading: boolean; delay?: number }

export function useDelayedLoading({ loading, delay = 180 }: DelayedProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!loading) {
      setVisible(false)
      return
    }
    const timer = window.setTimeout(() => setVisible(true), delay)
    return () => window.clearTimeout(timer)
  }, [delay, loading])

  return visible
}

export function Skeleton({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return <span className={`ui-skeleton ${className}`.trim()} style={style} aria-hidden="true" />
}

export function TableSkeleton({ columns = 6, rows = 6, label = 'Завантажуємо записи…' }: { columns?: number; rows?: number; label?: string }) {
  const visible = useDelayedLoading({ loading: true })
  if (!visible) return null
  const columnsStyle = { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }
  return <div className="ui-skeleton-table" role="status" aria-live="polite" aria-label={label}>
    <div className="ui-skeleton-table-head" style={columnsStyle}>{Array.from({ length: columns }, (_, index) => <Skeleton key={index} />)}</div>
    {Array.from({ length: rows }, (_, rowIndex) => <div className="ui-skeleton-table-row" style={columnsStyle} key={rowIndex}>
      {Array.from({ length: columns }, (_, columnIndex) => <Skeleton key={columnIndex} className={columnIndex === 0 ? 'ui-skeleton-text-wide' : ''} />)}
    </div>)}
  </div>
}

export function MetricSkeleton({ count = 4 }: { count?: number }) {
  const visible = useDelayedLoading({ loading: true })
  if (!visible) return null
  return <div className="ui-skeleton-metrics" role="status" aria-live="polite" aria-label="Завантажуємо показники…">
    {Array.from({ length: count }, (_, index) => <article className="ui-skeleton-card" key={index}><Skeleton className="ui-skeleton-label"/><Skeleton className="ui-skeleton-value"/><Skeleton className="ui-skeleton-note"/></article>)}
  </div>
}

export function ContentSkeleton({ label = 'Завантажуємо дані…', lines = 4 }: { label?: string; lines?: number }) {
  const visible = useDelayedLoading({ loading: true })
  if (!visible) return null
  return <div className="ui-skeleton-content" role="status" aria-live="polite" aria-label={label}>
    {Array.from({ length: lines }, (_, index) => <Skeleton key={index} className={index === lines - 1 ? 'ui-skeleton-text-short' : 'ui-skeleton-text'} />)}
  </div>
}
