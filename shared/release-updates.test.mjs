import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { compareVersions, checkLatestRelease, downloadVerifiedArtifact, parseStableVersion, validateReleaseManifest } from './release-updates.mjs'

const digest = value => createHash('sha256').update(value).digest('hex')
const manifest = (version = '1.2.0') => ({ formatVersion: 1, version, platform: 'win32', architecture: 'x64', compatibility: { installer: 'hromadaaid-universal-nsis-v1', installModes: ['Client-only', 'Server-only', 'Combined'], api: { contract: 'hromadaaid-rest', version: 1 }, manager: { versionPolicy: 'same-release-version', apiContract: 'hromadaaid-rest', apiContractVersion: 1 } }, artifacts: [
  { component: 'installer', name: `HromadaAID-Setup-${version}.exe`, sha256: 'a'.repeat(64), sizeBytes: 100 },
  { component: 'server', name: `HromadaAID-Server-v${version}-win-x64.zip`, sha256: 'b'.repeat(64), sizeBytes: 200, packageIntegrity: 'embedded-package-integrity-v1' },
] })

test('SemVer accepts stable/prerelease identifiers and orders prereleases correctly', () => {
  assert.ok(parseStableVersion('1.2.3-rc.1'))
  assert.equal(parseStableVersion('01.2.3'), null)
  assert.equal(compareVersions('1.2.3-rc.2', '1.2.3-rc.10'), -1)
  assert.equal(compareVersions('1.2.3', '1.2.3-rc.10'), 1)
})

test('release metadata rejects prereleases, wrong platform, stale versions, and missing integrity metadata', () => {
  const release = { tag_name: 'v1.2.0', prerelease: false, draft: false, body: 'Новий випуск' }
  assert.equal(validateReleaseManifest(manifest('1.2.0'), release, '1.1.9').version, '1.2.0')
  assert.equal(validateReleaseManifest(manifest('1.1.9'), { ...release, tag_name: 'v1.1.9' }, '1.1.9'), null)
  assert.throws(() => validateReleaseManifest(manifest('1.2.0-rc.1'), { ...release, tag_name: 'v1.2.0-rc.1', prerelease: true }, '1.1.9'))
  assert.throws(() => validateReleaseManifest({ ...manifest(), architecture: 'arm64' }, release, '1.1.9'))
  const broken = manifest(); broken.artifacts[1].packageIntegrity = 'duplicate-manifest'
  assert.throws(() => validateReleaseManifest(broken, release, '1.1.9'))
})

test('GitHub latest stable contract downloads manifest and resolves only its named setup asset', async () => {
  const release = { tag_name: 'v1.2.0', prerelease: false, draft: false, body: 'Оновлення', assets: [
    { name: 'release-manifest.json', browser_download_url: 'https://github.com/example/app/releases/download/v1.2.0/release-manifest.json' },
    { name: 'HromadaAID-Setup-1.2.0.exe', browser_download_url: 'https://github.com/example/app/releases/download/v1.2.0/HromadaAID-Setup-1.2.0.exe' },
    { name: 'HromadaAID-Server-v1.2.0-win-x64.zip', browser_download_url: 'https://github.com/example/app/releases/download/v1.2.0/HromadaAID-Server-v1.2.0-win-x64.zip' },
  ] }
  const fetchImpl = async url => { const value = String(url).endsWith('releases/latest') ? release : manifest('1.2.0'); return { ok: true, status: 200, url: String(url), text: async () => JSON.stringify(value) } }
  const result = await checkLatestRelease({ repository: 'example/app', currentVersion: '1.1.9', fetchImpl })
  assert.equal(result.available, true)
  assert.equal(result.version, '1.2.0')
  assert.equal(result.artifact.name, 'HromadaAID-Setup-1.2.0.exe')
  assert.equal((await checkLatestRelease({ repository: 'example/app', currentVersion: '1.2.0', fetchImpl })).available, false)
  await assert.rejects(checkLatestRelease({ repository: 'example/app', currentVersion: '1.1.9', fetchImpl: async () => ({ ok: false, status: 503, url: 'https://api.github.com/repos/example/app/releases/latest' }) }), /HTTP 503/)
  await assert.rejects(checkLatestRelease({ repository: 'example/app', currentVersion: '1.1.9', timeoutMs: 5, fetchImpl: (_url, options) => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))) }), /час очікування/)
})

test('download verifies SHA-256 and exact size, removes partial and corrupt files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hromada-release-update-'))
  const bytes = Buffer.from('verified setup fixture')
  const artifact = { component: 'installer', name: 'setup.exe', sha256: digest(bytes), sizeBytes: bytes.length }
  const fetchImpl = async () => ({ ok: true, status: 200, url: 'https://github.com/a/b/releases/download/setup.exe', body: Readable.from([bytes]) })
  const { Readable } = await import('node:stream')
  try {
    const path = await downloadVerifiedArtifact({ url: 'https://github.com/a/b/releases/download/setup.exe', artifact, directory, fetchImpl })
    assert.deepEqual(await readFile(path), bytes)
    await assert.rejects(downloadVerifiedArtifact({ url: 'https://github.com/a/b/releases/download/setup.exe', artifact: { ...artifact, sizeBytes: Number.MAX_SAFE_INTEGER }, directory, fetchImpl }), /Недостатньо вільного місця/)
    await assert.rejects(downloadVerifiedArtifact({ url: 'https://github.com/a/b/releases/download/setup.exe', artifact: { ...artifact, sha256: 'f'.repeat(64) }, directory, fetchImpl }), /SHA-256/)
    await assert.rejects(downloadVerifiedArtifact({ url: 'https://github.com/a/b/releases/download/setup.exe', artifact, directory, fetchImpl: async () => ({ ok: true, status: 200, url: 'https://github.com/a/b/releases/download/setup.exe', body: Readable.from([bytes.subarray(0, 2)]) }) }), /перервано/)
    await assert.rejects(downloadVerifiedArtifact({ url: 'https://evil.example/setup.exe', artifact, directory, fetchImpl }), /GitHub Releases/)
    assert.deepEqual((await readdir(directory)).filter(name => name.endsWith('.part')), [])
  } finally { await rm(directory, { recursive: true, force: true }) }
})
