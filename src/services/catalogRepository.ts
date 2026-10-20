import { useEffect, useRef } from 'react'
import type { CatalogEditInput, CatalogOrderInput } from '../../electron/api-contract'

const catalogEvent = 'hromada:catalogs-changed'
export const notifyCatalogsChanged = () => window.dispatchEvent(new Event(catalogEvent))

export const catalogRepository = {
  list: (includeInactive = false) => window.hromadaAid.catalogs.list(includeInactive),
  save: async (input: CatalogEditInput) => {
    const result = await window.hromadaAid.catalogs.save(input)
    if (result.ok) notifyCatalogsChanged()
    return result
  },
  reorder: async (input: CatalogOrderInput) => {
    const result = await window.hromadaAid.catalogs.reorder(input)
    if (result.ok) notifyCatalogsChanged()
    return result
  },
}

/** The app has one renderer. Refresh mounted selectors without resetting draft inputs. */
export function useCatalogUpdates(refresh: () => void) {
  const latest = useRef(refresh)
  latest.current = refresh
  useEffect(() => {
    const update = () => latest.current()
    window.addEventListener(catalogEvent, update)
    window.addEventListener('focus', update)
    return () => { window.removeEventListener(catalogEvent, update); window.removeEventListener('focus', update) }
  }, [])
}
