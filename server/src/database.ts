import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { openInitializedDatabase } from '../../electron/database.js'

export function openServerDatabase(databasePath: string): DatabaseSync {
  mkdirSync(dirname(databasePath), { recursive: true })
  return openInitializedDatabase(databasePath)
}
