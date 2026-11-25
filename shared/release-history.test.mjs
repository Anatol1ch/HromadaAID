import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeReleaseHistory, normalizeReleaseHistoryEntry, sortReleaseHistory } from './release-history.mjs'

test('release history normalizes versions, rejects drafts and sorts by SemVer', () => {
  const entries = sortReleaseHistory([
    { version: 'v1.9.0', name: 'Nine', body: 'old' },
    { version: '1.10.0', name: 'Ten', body: 'new' },
    { version: '1.10.0-rc.1', name: 'Candidate', body: 'draft' },
  ].map(normalizeReleaseHistoryEntry).filter(Boolean))
  assert.deepEqual(entries.map(item => item.version), ['1.10.0', '1.9.0'])
})

test('remote original body takes precedence without discarding local historical releases', () => {
  const merged = mergeReleaseHistory({
    embedded: [{ version: '1.0.0', name: 'Embedded', body: 'embedded notes' }],
    cached: [{ version: 'v1.1.0', name: 'Cached title', publishedAt: '2026-01-01T00:00:00Z', body: 'cached notes' }],
    remote: [{ version: '1.1.0', name: 'GitHub title', publishedAt: '2026-02-01T00:00:00Z', body: 'Original **release** notes <b>safe</b>' }],
  })
  assert.deepEqual(merged.map(item => item.version), ['1.1.0', '1.0.0'])
  assert.equal(merged[0].name, 'GitHub title')
  assert.equal(merged[0].body, 'Original **release** notes safe')
  assert.equal(merged[1].publishedAt, undefined)
})

test('history normalization omits invalid publication date and never invents missing release notes', () => {
  assert.deepEqual(normalizeReleaseHistoryEntry({ version: 'v2.0.0', name: '', publishedAt: 'unknown', body: '' }), { version: '2.0.0', name: '', body: '' })
  assert.equal(normalizeReleaseHistoryEntry({ version: '2.0.0-beta.1', body: 'draft' }), null)
})
