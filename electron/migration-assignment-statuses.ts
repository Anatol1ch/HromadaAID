import type { DatabaseSync } from 'node:sqlite'

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`

/** Called only inside the existing initialization transaction (migration 15). */
export function migrateAssignmentStatuses(database: DatabaseSync) {
  const schema = database.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name='assignments'").get()
  if (typeof schema?.sql !== 'string') throw new Error('Не вдалося прочитати структуру призначень.')
  const oldCheck = /CHECK\s*\(\s*status\s+IN\s*\(\s*'Призначено'\s*,\s*'В роботі'\s*,\s*'Виплачено'\s*\)\s*\)/i
  if (!oldCheck.test(schema.sql)) throw new Error('Обмеження статусів має непідтримуваний формат. Міграцію скасовано.')
  // DROP under deferred foreign keys must never cascade into child tables.
  for (const table of database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
    for (const key of database.prepare(`PRAGMA foreign_key_list(${quote(String(table.name))})`).all()) {
      if (key.table === 'assignments' && key.on_delete !== 'NO ACTION') throw new Error('Непідтримуване правило залежностей призначень. Міграцію скасовано.')
    }
  }
  const objects = database.prepare("SELECT sql FROM sqlite_schema WHERE tbl_name='assignments' AND type IN ('index','trigger') AND sql IS NOT NULL").all()
  const columns = database.prepare('PRAGMA table_info(assignments)').all().map((column) => quote(String(column.name))).join(', ')
  const create = schema.sql.replace(/^CREATE TABLE\s+(?:"assignments"|assignments)/i, 'CREATE TABLE _assignments_status_v15')
    .replace(oldCheck, "CHECK (status IN ('Очікує рішення', 'Призначено', 'В роботі', 'Передано до казначейства', 'Виплачено'))")
  if (create === schema.sql || !create.startsWith('CREATE TABLE _assignments_status_v15')) throw new Error('Не вдалося підготувати міграцію призначень.')
  database.exec('PRAGMA defer_foreign_keys = ON')
  database.exec(create)
  database.exec(`INSERT INTO _assignments_status_v15 (rowid, ${columns}) SELECT rowid, ${columns} FROM assignments`)
  database.exec('DROP TABLE assignments; ALTER TABLE _assignments_status_v15 RENAME TO assignments;')
  for (const object of objects) database.exec(String(object.sql))
  // Rebuilding a parent table leaves deferred counters even when its original
  // keys are restored. Validate every real link before clearing those counters.
  if (database.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Перевірка зв’язків після міграції не пройдена.')
  database.exec('PRAGMA defer_foreign_keys = OFF')
}
