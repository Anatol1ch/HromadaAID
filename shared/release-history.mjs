import { compareVersions, parseStableVersion, sanitizeReleaseNotes } from './release-updates.mjs'

export function normalizeReleaseHistoryEntry(value) {
  if (!value || typeof value !== 'object' || typeof value.version !== 'string') return null
  const version = value.version.replace(/^v/i, '')
  const parsed = parseStableVersion(version)
  if (!parsed || parsed.prerelease.length) return null
  const publishedAt = typeof value.publishedAt === 'string' && Number.isFinite(Date.parse(value.publishedAt)) ? value.publishedAt : undefined
  return {
    version,
    name: typeof value.name === 'string' ? value.name.trim() : '',
    ...(publishedAt ? { publishedAt } : {}),
    body: sanitizeReleaseNotes(value.body),
  }
}

export function sortReleaseHistory(entries) {
  return [...entries].sort((left, right) => compareVersions(right.version, left.version))
}

export function mergeReleaseHistory({ embedded = [], cached = [], remote = [] } = {}) {
  const byVersion = new Map()
  for (const source of [embedded, cached, remote]) {
    for (const raw of source) {
      const entry = normalizeReleaseHistoryEntry(raw)
      if (entry) byVersion.set(entry.version, entry)
    }
  }
  return sortReleaseHistory([...byVersion.values()])
}
