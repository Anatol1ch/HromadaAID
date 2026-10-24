import { rmSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, 'dist-server-manager', 'main')
const expected = resolve(root, 'dist-server-manager', 'main')
if (output !== expected || !output.startsWith(root + sep)) throw new Error('Refusing to remove an unexpected Server Manager build path.')
rmSync(output, { recursive: true, force: true })
