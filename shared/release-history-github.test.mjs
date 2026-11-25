import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchStableReleaseNotes } from './release-updates.mjs'

test('GitHub release history filters drafts and prereleases and follows all pages', async () => {
  const calls = []
  const pages = [
    [
      { tag_name: 'v1.10.0', name: 'Stable ten', published_at: '2026-01-02T03:04:05Z', body: '# Stable ten\n\nNotes <script>alert(1)</script>', draft: false, prerelease: false },
      { tag_name: 'v2.0.0-rc.1', name: 'Candidate', published_at: '2026-01-03T00:00:00Z', body: 'candidate', draft: false, prerelease: true },
    ],
    [
      { tag_name: 'v2.0.0', name: 'Draft', body: 'draft', draft: true, prerelease: false },
      { tag_name: 'release-next', name: 'Invalid', body: 'invalid', draft: false, prerelease: false },
    ],
  ]
  const fetchImpl = async url => {
    calls.push(String(url))
    const page = Number(new URL(String(url)).searchParams.get('page'))
    return { ok: true, status: 200, url: String(url), text: async () => JSON.stringify(pages[page - 1] ?? []) }
  }
  const entries = await fetchStableReleaseNotes({ repository: 'owner/repo', fetchImpl, pageSize: 2 })
  assert.deepEqual(calls.map(url => new URL(url).searchParams.get('page')), ['1', '2', '3'])
  assert.deepEqual(entries, [{ version: '1.10.0', name: 'Stable ten', publishedAt: '2026-01-02T03:04:05Z', body: '# Stable ten\n\nNotes alert(1)' }])
})

test('release history rejects an incomplete paginated response', async () => {
  const fetchImpl = async url => ({ ok: true, status: 200, url: String(url), text: async () => JSON.stringify([{ tag_name: '1.0.0', draft: false, prerelease: false }]) })
  await assert.rejects(fetchStableReleaseNotes({ repository: 'owner/repo', fetchImpl, pageSize: 1, maxPages: 2 }), /не вважається повним/)
})
