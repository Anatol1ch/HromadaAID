import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildEmbeddedReleaseHistory } from './build-release-history.mjs'

test('embedded Release Notes include only stable notes whose versions have published Git tags', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hromada-embedded-history-'))
  const notesDirectory = join(root, 'notes')
  const outputPath = join(root, 'dist', 'release-history.json')
  await mkdir(notesDirectory)
  await writeFile(join(notesDirectory, '1.0.0.md'), '# HromadaAID Stable 1.0.0\n\nPublished notes.')
  await writeFile(join(notesDirectory, '1.1.1.md'), '# Draft notes\n\nNot published yet.')
  await writeFile(join(notesDirectory, '1.2.0-rc.1.md'), '# Candidate')
  try {
    const result = await buildEmbeddedReleaseHistory({ notesDirectory, outputPath, tags: ['v1.0.0', '1.1.1-rc.1'] })
    assert.deepEqual(result.entries.map(entry => entry.version), ['1.0.0'])
    assert.equal(result.entries[0].name, 'HromadaAID Stable 1.0.0')
    assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), result)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('release workflow may embed the current version only when its publish gate opts it in', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hromada-current-release-history-'))
  const notesDirectory = join(root, 'notes')
  const outputPath = join(root, 'dist', 'release-history.json')
  await mkdir(notesDirectory)
  await writeFile(join(notesDirectory, '1.0.0.md'), '# Stable 1.0.0\n\nPublished.')
  await writeFile(join(notesDirectory, '1.1.1.md'), '# Stable 1.1.1\n\nCurrent release.')
  try {
    const staged = await buildEmbeddedReleaseHistory({ notesDirectory, outputPath, tags: ['v1.0.0'] })
    assert.deepEqual(staged.entries.map(entry => entry.version), ['1.0.0'])
    const publishing = await buildEmbeddedReleaseHistory({ notesDirectory, outputPath, tags: ['v1.0.0'], currentReleaseVersion: '1.1.1' })
    assert.deepEqual(publishing.entries.map(entry => entry.version), ['1.1.1', '1.0.0'])
  } finally { await rm(root, { recursive: true, force: true }) }
})
