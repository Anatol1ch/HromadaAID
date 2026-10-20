import type { DatabaseSync } from 'node:sqlite'
import { addressColumns } from './address.js'

/** Migration 17: retain legacy strings verbatim; never guess address components. */
export function migrateAddresses(database: DatabaseSync) {
  for (const prefix of ['registration', 'residence']) {
    for (const column of Object.values(addressColumns)) database.exec(`ALTER TABLE recipients ADD COLUMN ${prefix}_${column} TEXT`)
  }
}
