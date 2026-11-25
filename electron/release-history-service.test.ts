import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const serviceModulePath: string = './release-history-service.ts'
type ReleaseHistoryServiceModule = typeof import('./release-history-service.js')
const { createReleaseHistoryService } = await import(serviceModulePath) as ReleaseHistoryServiceModule

function response(url: string, value: unknown) {
  return { ok: true, status: 200, url, text: async () => JSON.stringify(value) }
}

test('local history is available immediately and successful refresh merges, prefers GitHub, and persists cache', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hromada-release-history-'))
  const embeddedPath = join(root, 'release-history.json')
  const cachePath = join(root, 'userData', 'release-history-cache.json')
  await mkdir(join(root, 'userData'), { recursive: true })
  await writeFile(embeddedPath, JSON.stringify({ entries: [{ version: '1.0.0', name: 'Embedded', body: 'embedded' }, { version: '1.1.0', name: 'Embedded one', body: 'old body' }] }))
  await writeFile(cachePath, JSON.stringify({ formatVersion: 1, refreshedAt: '2026-01-01T00:00:00Z', entries: [{ version: '1.0.2', name: 'Cached', body: 'cached only' }] }))
  let calls = 0
  const fetchImpl = (async (url: Parameters<typeof fetch>[0]) => {
    calls++
    const release = [{ tag_name: 'v1.1.0', name: 'GitHub 1.1', published_at: '2026-02-01T00:00:00Z', body: 'Original notes', draft: false, prerelease: false }]
    return response(String(url), release)
  }) as typeof fetch
  const service = createReleaseHistoryService({ repository: 'owner/repo', embeddedHistoryPath: embeddedPath, cachePath, fetchImpl, now: () => new Date('2026-03-01T00:00:00Z') })
  try {
    const local = await service.getLocal()
    assert.equal(local.source, 'cache')
    assert.deepEqual(local.entries.map(entry => entry.version), ['1.1.0', '1.0.2', '1.0.0'])
    const refreshed = await service.refresh()
    assert.equal(refreshed.source, 'github')
    assert.equal(refreshed.entries[0].name, 'GitHub 1.1')
    assert.equal(refreshed.entries.find(entry => entry.version === '1.0.2')?.body, 'cached only')
    assert.equal(calls, 1)
    const saved = JSON.parse(await readFile(cachePath, 'utf8'))
    assert.equal(saved.refreshedAt, '2026-03-01T00:00:00.000Z')
    assert.equal(saved.entries.length, 3)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('GitHub failure returns cached and embedded history without replacing cache', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hromada-release-history-offline-'))
  const embeddedPath = join(root, 'release-history.json')
  const cachePath = join(root, 'release-history-cache.json')
  const originalCache = JSON.stringify({ formatVersion: 1, refreshedAt: '2026-01-01T00:00:00Z', entries: [{ version: '1.0.2', name: 'Cached', body: 'cached notes' }] })
  await writeFile(embeddedPath, JSON.stringify({ entries: [{ version: '1.0.0', name: 'Embedded', body: 'embedded notes' }] }))
  await writeFile(cachePath, originalCache)
  const service = createReleaseHistoryService({ repository: 'owner/repo', embeddedHistoryPath: embeddedPath, cachePath, fetchImpl: async () => { throw new Error('GitHub unavailable') } })
  try {
    const local = await service.getLocal()
    const offline = await service.refresh()
    assert.deepEqual(offline.entries.map(entry => entry.version), ['1.0.2', '1.0.0'])
    assert.match(offline.refreshError ?? '', /GitHub unavailable/)
    assert.equal(await readFile(cachePath, 'utf8'), originalCache)
    assert.equal(local.source, 'cache')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('concurrent history refresh requests share one GitHub pagination pass', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hromada-release-history-concurrent-'))
  let calls = 0
  const service = createReleaseHistoryService({
    repository: 'owner/repo', embeddedHistoryPath: join(root, 'absent.json'), cachePath: join(root, 'cache.json'),
    fetchImpl: (async (url: Parameters<typeof fetch>[0]) => { calls++; await new Promise(resolve => setTimeout(resolve, 15)); return response(String(url), []) }) as typeof fetch,
  })
  try {
    const [first, second] = await Promise.all([service.refresh(), service.refresh()])
    assert.equal(calls, 1)
    assert.equal(first.source, 'github')
    assert.equal(second.source, 'github')
  } finally { await rm(root, { recursive: true, force: true }) }
})
