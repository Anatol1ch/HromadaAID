import { cpSync } from 'node:fs'
import { join } from 'node:path'

export function copyManagerSetupPayload(source, destination) {
  // The active/staged Server supplies runtime and application files. Manager
  // still owns update/recovery orchestration and its sibling module graph.
  cpSync(source, destination, {
    recursive: true,
    filter: path => !path.replaceAll('\\', '/').includes('/resources/server-payload'),
  })
  cpSync(join(source, 'resources', 'server-payload', 'installer'),
    join(destination, 'resources', 'server-payload', 'installer'), { recursive: true })
}
