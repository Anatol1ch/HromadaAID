import { useEffect, useRef } from 'react'

export const connectionRestoredEvent = 'hromada:connection-restored'

export function notifyConnectionRestored(): void {
  window.dispatchEvent(new Event(connectionRestoredEvent))
}

export function useConnectionRefresh(refresh: () => void): void {
  const currentRefresh = useRef(refresh)
  currentRefresh.current = refresh
  useEffect(() => {
    const update = () => currentRefresh.current()
    window.addEventListener(connectionRestoredEvent, update)
    return () => window.removeEventListener(connectionRestoredEvent, update)
  }, [])
}
