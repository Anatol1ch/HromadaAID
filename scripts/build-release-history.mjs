import { execFileSync } from 'node:child_process'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseStableVersion, sanitizeReleaseNotes } from '../shared/release-updates.mjs'
import { sortReleaseHistory } from '../shared/release-history.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function stableVersion(value) {
  if (typeof value !== 'string') return null
  const version = value.replace(/^v/i, '')
  const parsed = parseStableVersion(version)
  return parsed && parsed.prerelease.length === 0 ? version : null
}

export async function buildEmbeddedReleaseHistory({ notesDirectory = join(root, 'docs', 'release-notes'), outputPath = join(root, 'dist-electron', 'electron', 'release-history.json'), tags, currentReleaseVersion } = {}) {
  const publishedVersions = new Set((tags ?? execFileSync('git', ['tag', '--list'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/)).map(stableVersion).filter(Boolean))
  if (currentReleaseVersion && stableVersion(currentReleaseVersion)) publishedVersions.add(stableVersion(currentReleaseVersion))
  const entries = []
  for (const item of await readdir(notesDirectory, { withFileTypes: true })) {
    if (!item.isFile() || !item.name.endsWith('.md')) continue
    const version = stableVersion(item.name.slice(0, -3))
    if (!version || !publishedVersions.has(version)) continue
    const body = sanitizeReleaseNotes(await readFile(join(notesDirectory, item.name), 'utf8'))
    if (!body) continue
    const firstHeading = /^#{1,4}\s+(.+?)\s*#*\s*$/m.exec(body)?.[1]?.trim() ?? ''
    entries.push({ version, name: firstHeading, body })
  }
  const payload = { entries: sortReleaseHistory(entries) }
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return payload
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  buildEmbeddedReleaseHistory().then(({ entries }) => console.log(`Embedded published Release Notes: ${entries.length}`)).catch(error => {
    console.error(`Не вдалося сформувати вбудовану історію Release Notes: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
