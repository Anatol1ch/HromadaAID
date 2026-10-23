import { existsSync, lstatSync, realpathSync, rmSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Only the generated client output is removed. Never inspect userData or SQLite.
const root = realpathSync(fileURLToPath(new URL('..', import.meta.url)))
const output = resolve(root, 'dist-electron')
if (relative(root, output) !== 'dist-electron') throw new Error('Unexpected Electron build directory')
if (existsSync(output) && lstatSync(output).isSymbolicLink()) throw new Error('Electron build directory must not be a link')
rmSync(output, { recursive: true, force: true })
