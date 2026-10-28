import { existsSync, lstatSync, realpathSync, rmSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = realpathSync(fileURLToPath(new URL('..', import.meta.url)))
const output = resolve(root, 'dist-server')
if (relative(root, output) !== 'dist-server') throw new Error('Unexpected Server build directory')
if (existsSync(output) && lstatSync(output).isSymbolicLink()) throw new Error('Server build directory must not be a link')
rmSync(output, { recursive: true, force: true })
