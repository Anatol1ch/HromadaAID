import { copyFileSync, mkdirSync } from 'node:fs'
const destination = new URL('../dist-server-manager/main/shared/', import.meta.url)
mkdirSync(destination, { recursive: true })
copyFileSync(new URL('../shared/server-base-url.mjs', import.meta.url), new URL('server-base-url.mjs', destination))
