export const overviewDataEvent = 'hromada:overview-data-changed'
export const notifyOverviewChanged = () => window.dispatchEvent(new Event(overviewDataEvent))

/** Notify only after a committed change; keep the original IPC result and errors. */
export async function withOverviewRefresh<T extends { ok: boolean }>(operation: Promise<T>): Promise<T> {
  const result = await operation
  if (result.ok) notifyOverviewChanged()
  return result
}
