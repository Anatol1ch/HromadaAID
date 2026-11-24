export type AidRegistrySummaryRow = { id: string; amountMinor: number }

export function summarizeAidRegistry(rows: readonly AidRegistrySummaryRow[]) {
  const seenIds = new Set<string>()
  let totalMinor = 0
  for (const row of rows) {
    if (seenIds.has(row.id)) continue
    seenIds.add(row.id)
    totalMinor += row.amountMinor
  }
  return { count: seenIds.size, totalMinor }
}
