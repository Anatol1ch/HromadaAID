export type ReleaseHistoryEntry = { version: string; name: string; publishedAt?: string; body: string }
export function normalizeReleaseHistoryEntry(value: unknown): ReleaseHistoryEntry | null
export function sortReleaseHistory(entries: ReleaseHistoryEntry[]): ReleaseHistoryEntry[]
export function mergeReleaseHistory(options?: { embedded?: ReleaseHistoryEntry[]; cached?: ReleaseHistoryEntry[]; remote?: ReleaseHistoryEntry[] }): ReleaseHistoryEntry[]
