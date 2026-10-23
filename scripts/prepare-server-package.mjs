import { cp, mkdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'dist-server')
const target = join(root, 'server', 'dist')
await rm(join(root, 'dist-package', 'server'), { recursive: true, force: true })
await rm(target, { recursive: true, force: true })
await mkdir(target, { recursive: true })

for (const folder of ['server', 'electron', 'shared']) {
  const from = join(source, folder)
  try {
    await cp(from, join(target, folder), {
      recursive: true,
      filter: path => !/\.test\.(?:js|mjs|cjs|map)$/.test(path) && !/\.(?:map|sqlite|sqlite3|db|hraid|dpapi|pem|key|crt|p12)$/i.test(path),
    })
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}
await mkdir(join(root, 'server', 'service'), { recursive: true })
await cp(join(root, 'server', 'windows-service', 'HromadaAIDService.xml.template'), join(root, 'server', 'service', 'HromadaAIDService.xml.template'))
