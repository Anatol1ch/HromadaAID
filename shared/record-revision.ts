/**
 * Produces an ISO revision newer than the stored one.  SQLite transactions
 * provide atomicity; this helper also prevents two successful edits in the
 * same millisecond from publishing an identical revision token.
 */
export function nextRecordRevision(previous: string | null | undefined, now = Date.now()): string {
  const previousMs = previous ? Date.parse(previous) : Number.NaN
  return new Date(Number.isFinite(previousMs) ? Math.max(now, previousMs + 1) : now).toISOString()
}
