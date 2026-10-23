import { cp, mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'dist-server')
const target = join(root, 'server', 'dist')
const stagingRoot = await mkdtemp(join(root, 'server', '.hromada-server-build-'))
const stagedTarget = join(stagingRoot, 'dist')
await mkdir(stagedTarget, { recursive: true })
let preserveStaging = false

try {
  for (const folder of ['server', 'electron', 'shared']) {
    await cp(join(source, folder), join(stagedTarget, folder), {
      recursive: true,
      filter: path => !/\.test\.(?:js|mjs|cjs|map)$/.test(path) && !/\.(?:map|sqlite|sqlite3|db|hraid|dpapi|pem|key|crt|p12)$/i.test(path),
    })
  }
  await mkdir(join(stagedTarget, 'service'), { recursive: true })
  await cp(join(root, 'server', 'windows-service', 'HromadaAIDService.xml.template'), join(stagedTarget, 'service', 'HromadaAIDService.xml.template'))

  // Publish only a complete compiled tree; preserve the previous ignored output
  // if the final rename fails. Production dependency installation is a separate
  // disposable workspace and does not touch the root node_modules.
  const previous = join(stagingRoot, 'previous')
  let movedPrevious = false
  try {
    try { await rename(target, previous); movedPrevious = true } catch (error) { if (error.code !== 'ENOENT') throw error }
    await rename(stagedTarget, target)
    if (movedPrevious) await rm(previous, { recursive: true, force: true }).catch(() => { preserveStaging = true })
  } catch (error) {
    if (movedPrevious) {
      try { await rename(previous, target); movedPrevious = false }
      catch { preserveStaging = true; throw new Error(`Не вдалося оновити зібраний сервер; попередні файли збережено в ${previous}.`) }
    }
    throw error
  }
} finally {
  if (!preserveStaging) await rm(stagingRoot, { recursive: true, force: true })
}
