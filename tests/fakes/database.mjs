import { mkdirSync } from 'node:fs'
import { join, relative, resolve, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import { openInitializedDatabase } from '../../electron/database.ts'

/** Synthetic server fixtures only. Never chooses or opens an Electron profile. */
export function openTestDatabase(directory) {
  const target = resolve(directory)
  const within = relative(resolve(tmpdir()), target)
  if (!within || within.startsWith('..') || isAbsolute(within)) throw new Error('Test database must be inside a disposable temporary directory')
  mkdirSync(target, { recursive: true })
  return openInitializedDatabase(join(target, 'hromada-aid.sqlite'))
}
