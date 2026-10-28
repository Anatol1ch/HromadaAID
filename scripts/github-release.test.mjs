import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { compareStable, releaseEligibility, publishRelease, releaseNotesOptions } from './github-release.mjs'
import { writeReleaseManifest } from '../packaging/release-manifest.mjs'

const context = { eventName: 'push', ref: 'refs/heads/main', sha: 'a'.repeat(40), repo: { owner: 'fixture', repo: 'fixture' } }
const missing = () => Object.assign(new Error('Not found'), { status: 404 })

test('versioned Ukrainian notes override generation; missing notes fall back and empty notes fail', async () => {
  const notesDirectory = await mkdtemp(join(tmpdir(), 'hromada-notes-test-'))
  try {
    assert.deepEqual(await releaseNotesOptions('1.2.3', notesDirectory), { generate_release_notes: true })
    const body = '# Український опис\n\nПеревірений реліз.\n'
    await writeFile(join(notesDirectory, '1.2.3.md'), body)
    assert.deepEqual(await releaseNotesOptions('1.2.3', notesDirectory), { body, generate_release_notes: false })
    await writeFile(join(notesDirectory, '1.2.3.md'), '  ')
    await assert.rejects(releaseNotesOptions('1.2.3', notesDirectory), /empty/)
    await assert.rejects(releaseNotesOptions('../1.2.3', notesDirectory), /SemVer/)
  } finally { await rm(notesDirectory, { recursive: true, force: true }) }
})
function api({ releases = [], tags = [], uploadFailure = false, wrongSize = false, missingAsset = false, wrongSha = false } = {}) {
  const calls = [], refs = new Map(tags.map(tag => [tag, context.sha])), assets = []
  const repos = {
    listReleases() {}, listReleaseAssets() {},
    async getLatestRelease() {
      const latest = releases.find(r => !r.draft && !r.prerelease)
      if (!latest) throw missing()
      return { data: latest }
    },
    async createRelease(input) { calls.push(['draft', input]); releases.push({ ...input, id: 12 }); return { data: { id: 12 } } },
    async uploadReleaseAsset(input) {
      calls.push(['upload', input.name])
      if (uploadFailure) throw new Error('Upload failed')
      if (!missingAsset) assets.push({ name: input.name, size: input.data.length + (wrongSize ? 1 : 0), state: 'uploaded' })
    },
    async updateRelease(input) { calls.push(['publish', input]) },
  }
  const github = { rest: { repos, git: {
    async getRef({ ref }) {
      const tag = ref.replace(/^tags\//, '')
      if (!refs.has(tag)) throw missing()
      return { data: { object: { type: 'commit', sha: wrongSha ? 'b'.repeat(40) : refs.get(tag) } } }
    },
    async createRef(input) {
      const tag = input.ref.replace(/^refs\/tags\//, '')
      if (refs.has(tag)) throw Object.assign(new Error('Already exists'), { status: 422 })
      refs.set(tag, input.sha); calls.push(['tag', input])
    },
  } }, async paginate(method) { return method === repos.listReleases ? [...releases] : [...assets] } }
  return { github, calls }
}

test('Stable SemVer compares numerically without precision loss and rejects invalid versions', () => {
  assert.equal(compareStable('1.10.0', '1.9.9'), 1)
  assert.equal(compareStable('2.0.0', '10.0.0'), -1)
  assert.equal(compareStable('9007199254740993.0.0', '9007199254740992.0.0'), 1)
  assert.equal(compareStable('1.2.3', '1.2.3'), 0)
  for (const version of ['v1.2.3', '01.2.3', '1.2', '1.2.3-beta', '1.2.3+build', '1.2.3\n']) assert.throws(() => compareStable(version, '1.2.3'))
})

test('eligibility skips published, draft, both tag conventions and older versions before build', async () => {
  for (const options of [
    { releases: [{ tag_name: '0.2.1' }] }, { releases: [{ tag_name: 'v0.2.1', draft: true }] },
    { tags: ['0.2.1'] }, { tags: ['v0.2.1'] }, { releases: [{ tag_name: 'v0.3.0' }] },
  ]) {
    const { github, calls } = api(options)
    assert.equal((await releaseEligibility({ github, context, version: '0.2.1' })).build, false)
    assert.deepEqual(calls, [])
  }
  const { github } = api({ releases: [{ tag_name: '0.2.1' }, { tag_name: 'v99.0.0', prerelease: true }] })
  assert.equal((await releaseEligibility({ github, context, version: '0.3.0' })).publish, true)
})

test('manual events build only; pull requests and other branches cannot publish', async () => {
  for (const event of [{ eventName: 'workflow_dispatch' }, { eventName: 'pull_request' }, { ref: 'refs/heads/other' }]) {
    const { github, calls } = api()
    const result = await publishRelease({ github, context: { ...context, ...event }, version: '1.2.3', directory: 'must-not-read' })
    assert.equal(result.publish, false)
    assert.equal(result.build, event.eventName === 'workflow_dispatch')
    assert.deepEqual(calls, [])
  }
})

test('API errors fail closed rather than treating an inaccessible tag as absent', async () => {
  const { github } = api()
  github.rest.git.getRef = async () => { throw Object.assign(new Error('Forbidden'), { status: 403 }) }
  await assert.rejects(releaseEligibility({ github, context, version: '1.2.3' }), /Forbidden/)
})

for (const failure of [null, 'uploadFailure', 'wrongSize', 'missingAsset', 'wrongSha', 'corrupt']) {
  test(`publication uses verified artifacts and retains Draft on failure: ${failure ?? 'success'}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hromada-publication-test-'))
    try {
      const version = '1.2.3'
      await writeFile(join(directory, `HromadaAID-Setup-${version}.exe`), 'synthetic setup')
      const zip = join(directory, `HromadaAID-Server-v${version}-win-x64.zip`)
      await writeFile(zip, 'synthetic zip')
      await writeReleaseManifest(directory, version)
      if (failure === 'corrupt') await writeFile(zip, 'corruption')
      const { github, calls } = api(failure ? { [failure]: true } : {})
      const run = () => publishRelease({ github, context, version, directory })
      if (failure) {
        await assert.rejects(run())
        assert.ok(!calls.some(([kind]) => kind === 'publish'))
        assert.equal(calls.some(([kind]) => kind === 'draft'), failure !== 'corrupt')
      } else {
        await run()
        assert.deepEqual(calls.map(([kind]) => kind), ['tag', 'draft', 'upload', 'upload', 'upload', 'publish'])
        assert.equal(calls[0][1].sha, context.sha)
        assert.equal(calls[0][1].ref, 'refs/tags/v1.2.3')
        assert.equal(calls[1][1].draft, true)
        assert.equal(calls[1][1].generate_release_notes, true)
        assert.equal(calls[1][1].target_commitish, context.sha)
        assert.equal(calls.at(-1)[1].draft, false)
        assert.equal(calls.at(-1)[1].prerelease, false)
        assert.equal(calls.at(-1)[1].make_latest, 'true')
        const count = calls.length
        assert.equal((await run()).publish, false)
        assert.equal(calls.length, count, 'rerun must not upload, overwrite or republish')
      }
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
}
