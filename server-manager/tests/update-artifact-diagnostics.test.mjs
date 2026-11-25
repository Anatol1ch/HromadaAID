import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import test from 'node:test'
import { inspectUpdateArtifacts, validateUpdateArtifactsDirectory } from '../electron/update-artifact-diagnostics.mjs'

async function withFixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'hromadaaid-update-artifacts-'))
  const program = join(root, 'program'), data = join(root, 'data')
  await mkdir(program); await mkdir(data)
  try { await run({ root, program, data }) }
  finally {
    const tempRoot = resolve(tmpdir()) + sep
    assert.ok(resolve(root).startsWith(tempRoot), 'fixture cleanup must remain under the operating-system temp directory')
    assert.ok(basename(root).startsWith('hromadaaid-update-artifacts-'))
    await rm(root, { recursive: true, force: true })
  }
}

test('diagnostics list only the three expected transaction objects and capture top-level mtime', async () => {
  await withFixture(async ({ program, data }) => {
    const previous = join(program, 'Server.previous')
    await mkdir(previous)
    await mkdir(join(program, 'unrelated-large-folder'))
    await utimes(previous, new Date('2026-01-02T03:04:00Z'), new Date('2026-01-02T03:04:00Z'))

    const result = await inspectUpdateArtifacts(program, data)
    assert.equal(result.journal.exists, false)
    assert.equal(result.journal.path, join(data, '.hromadaaid-update-state.json'))
    assert.deepEqual(result.artifacts.map(item => item.name), ['Server.previous'])
    assert.equal(result.artifacts[0].kind, 'directory')
    assert.equal(result.artifacts[0].modifiedAt, '2026-01-02T03:04:00.000Z')
    assert.equal(await validateUpdateArtifactsDirectory(program), program)
  })
})

test('opening is rejected unless a known update artifact directory exists', async () => {
  await withFixture(async ({ program, data }) => {
    await assert.rejects(validateUpdateArtifactsDirectory(program), /Не знайдено службового каталогу/)
    await mkdir(join(program, 'Server.failed'))
    const result = await inspectUpdateArtifacts(program, data)
    assert.deepEqual(result.artifacts.map(item => item.name), ['Server.failed'])
    assert.equal(await validateUpdateArtifactsDirectory(program), program)
  })
})

test('opening rejects a symbolic-link installation root', async () => {
  const symlink = { isSymbolicLink: () => true, isDirectory: () => false, isFile: () => false, mtimeMs: 0 }
  await assert.rejects(validateUpdateArtifactsDirectory('linked-install-root', async () => symlink), /Каталог інсталяції не підтверджено/)
})
