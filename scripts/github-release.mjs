import { readFile, readdir, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { isStableReleaseVersion, verifyReleaseManifest } from '../packaging/release-manifest.mjs'

const versionOfTag = tag => typeof tag === 'string' ? tag.replace(/^v/, '') : ''
export function compareStable(left, right) {
  if (![left, right].every(isStableReleaseVersion)) throw new Error('Expected stable SemVer X.Y.Z.')
  const a = left.split('.').map(BigInt), b = right.split('.').map(BigInt)
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1
  return 0
}

export async function releaseEligibility({ github, context, version }) {
  if (!isStableReleaseVersion(version)) throw new Error('package.json must contain stable SemVer X.Y.Z.')
  if (context.eventName !== 'push' || context.ref !== 'refs/heads/main') return { build: context.eventName === 'workflow_dispatch', publish: false, reason: 'Build-only event.' }
  const releases = await github.paginate(github.rest.repos.listReleases, { ...context.repo, per_page: 100 })
  if (releases.some(r => versionOfTag(r.tag_name) === version)) return { build: false, publish: false, reason: 'Release already exists (including drafts).' }
  // Historical releases use X.Y.Z; new releases use vX.Y.Z. Reserve both names.
  for (const tag of [version, `v${version}`]) {
    try {
      await github.rest.git.getRef({ ...context.repo, ref: `tags/${tag}` })
      return { build: false, publish: false, reason: `Tag ${tag} already exists.` }
    } catch (error) { if (error.status !== 404) throw error }
  }
  const stable = releases.filter(r => !r.draft && !r.prerelease).map(r => versionOfTag(r.tag_name)).filter(isStableReleaseVersion)
  // Also respect the provider's explicit latest Stable, even if pagination order differs.
  try {
    const { data: latest } = await github.rest.repos.getLatestRelease(context.repo)
    const latestVersion = versionOfTag(latest.tag_name)
    if (latest.draft || latest.prerelease || !isStableReleaseVersion(latestVersion)) throw new Error('Latest Stable release has an invalid version.')
    stable.push(latestVersion)
  } catch (error) { if (error.status !== 404) throw error }
  if (stable.some(v => compareStable(version, v) <= 0)) return { build: false, publish: false, reason: 'Version is not newer than published Stable.' }
  return { build: true, publish: true, reason: 'New Stable version.' }
}

export async function releaseNotesOptions(version, notesDirectory = fileURLToPath(new URL('../docs/release-notes/', import.meta.url))) {
  if (!isStableReleaseVersion(version)) throw new Error('Expected stable SemVer X.Y.Z.')
  let body
  try { body = await readFile(join(notesDirectory, `${version}.md`), 'utf8') }
  catch (error) {
    if (error.code === 'ENOENT') return { generate_release_notes: true }
    throw error
  }
  if (!body.trim()) throw new Error('Release notes file is empty.')
  return { body, generate_release_notes: false }
}

export async function publishRelease({ github, context, version, directory, notesDirectory }) {
  // Defense in depth: this function must remain read-only for manual/other events.
  const eligibility = await releaseEligibility({ github, context, version })
  if (!eligibility.publish) return eligibility
  if (!/^[a-f0-9]{40}$/i.test(context.sha)) throw new Error('Missing triggering commit SHA.')
  const manifest = JSON.parse(await readFile(join(directory, 'release-manifest.json'), 'utf8'))
  if (manifest.version !== version) throw new Error('Artifact version differs from package.json.')
  await verifyReleaseManifest(directory, manifest)
  const names = [...manifest.artifacts.map(a => a.name), 'release-manifest.json']
  const actual = await readdir(directory)
  if (actual.length !== 3 || names.some(n => !actual.includes(n))) throw new Error('Expected exactly three release artifacts.')
  const assets = []
  for (const name of names) {
    const path = join(directory, name)
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Release asset must be a regular file.')
    const data = await readFile(path)
    assets.push({ name, data, size: data.length, digest: `sha256:${createHash('sha256').update(data).digest('hex')}` })
  }
  const tag = `v${version}`
  const notes = await releaseNotesOptions(version, notesDirectory)
  // createRef fails on existing refs; never update/force an existing tag.
  await github.rest.git.createRef({ ...context.repo, ref: `refs/tags/${tag}`, sha: context.sha })
  const { data: draft } = await github.rest.repos.createRelease({ ...context.repo, tag_name: tag, target_commitish: context.sha, name: `HromadaAID ${version}`, draft: true, prerelease: false, ...notes, make_latest: 'false' })
  // Any error below intentionally leaves this release Draft; no automatic deletion/replacement.
  for (const asset of assets) {
    await github.rest.repos.uploadReleaseAsset({ ...context.repo, release_id: draft.id, name: asset.name, data: asset.data, headers: { 'content-type': 'application/octet-stream', 'content-length': asset.size } })
  }
  const uploaded = await github.paginate(github.rest.repos.listReleaseAssets, { ...context.repo, release_id: draft.id, per_page: 100 })
  if (uploaded.length !== assets.length || assets.some(expected => {
    const matches = uploaded.filter(a => a.name === expected.name)
    return matches.length !== 1 || matches[0].state !== 'uploaded' || matches[0].size !== expected.size || (matches[0].digest && matches[0].digest !== expected.digest)
  })) throw new Error('Uploaded release assets do not match the verified package; release remains Draft.')
  const { data: ref } = await github.rest.git.getRef({ ...context.repo, ref: `tags/${tag}` })
  if (ref.object.type !== 'commit' || ref.object.sha !== context.sha) throw new Error('Release tag no longer points to the triggering commit; release remains Draft.')
  await github.rest.repos.updateRelease({ ...context.repo, release_id: draft.id, draft: false, prerelease: false, make_latest: 'true' })
  return { ...eligibility, reason: `Published ${tag}.` }
}
