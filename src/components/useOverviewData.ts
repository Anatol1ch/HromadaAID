import { overviewDataEvent } from '../services/overviewUpdates'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DashboardData } from '../../electron/api-contract'
import { catalogRepository, useCatalogUpdates } from '../services/catalogRepository'

export function useOverviewData(year: number, includeCatalogs = true) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [catalogs, setCatalogs] = useState<Awaited<ReturnType<typeof catalogRepository.list>>>({ programs: [], aidTypes: [], programOrderRevision: '', aidTypeOrderRevisions: {} })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const sequence = useRef(0)
  const refresh = useCallback(async () => {
    const request = ++sequence.current
    setLoading(true); setError('')
    try {
      const [next, catalog] = await Promise.all([
        window.hromadaAid.dashboard.get(year),
        includeCatalogs ? catalogRepository.list(true) : Promise.resolve(null),
      ])
      if (sequence.current !== request) return
      setData(next)
      if (catalog) setCatalogs(catalog)
    } catch { if (sequence.current === request) { setData(null); setError('Не вдалося завантажити показники.') } }
    finally { if (sequence.current === request) setLoading(false) }
  }, [includeCatalogs, year])
  useEffect(() => {
    setData(null); void refresh()
    return () => { ++sequence.current }
  }, [refresh])
  useCatalogUpdates(() => { void refresh() })
  useEffect(() => {
    const update = () => { void refresh() }
    window.addEventListener(overviewDataEvent, update)
    return () => window.removeEventListener(overviewDataEvent, update)
  }, [refresh])
  // Never display a previous year's data while a new request is in flight.
  return { data: data?.year === year ? data : null, catalogs, error, loading, refresh }
}
