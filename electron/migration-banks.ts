import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

export class BankMigrationError extends Error {}

/** Runs inside the database initialization transaction, never against another profile. */
export function migrateBanks(database: DatabaseSync) {
  // Do not silently discard unexpected partial legacy values.
  const partial = database.prepare(`SELECT 1 FROM recipients WHERE
    (trim(coalesce(bank_name,''))<>'' OR trim(coalesce(bank_mfo,''))<>'' OR trim(coalesce(bank_edrpou,''))<>'')
    AND (trim(coalesce(bank_name,''))='' OR trim(coalesce(bank_mfo,''))='' OR trim(coalesce(bank_edrpou,''))='') LIMIT 1`).get()
  if (partial) throw new BankMigrationError('Перенесення банківських реквізитів зупинено: є неповні старі реквізити. Дані не змінено; потрібна перевірка карток у попередній версії застосунку.')
  database.exec(`
    CREATE TABLE banks (id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(trim(name))>0));
    CREATE TABLE bank_details (
      id TEXT PRIMARY KEY,
      bank_id TEXT NOT NULL REFERENCES banks(id) ON DELETE RESTRICT,
      mfo TEXT NOT NULL CHECK(length(trim(mfo))>0),
      edrpou TEXT NOT NULL CHECK(length(trim(edrpou))>0),
      UNIQUE(bank_id,mfo,edrpou)
    );
    CREATE INDEX idx_banks_name ON banks(name);
    CREATE INDEX idx_bank_details_mfo ON bank_details(mfo);
    CREATE INDEX idx_bank_details_edrpou ON bank_details(edrpou);
    ALTER TABLE recipients ADD COLUMN bank_details_id TEXT REFERENCES bank_details(id) ON DELETE RESTRICT;
    CREATE INDEX idx_recipients_bank_details ON recipients(bank_details_id);
  `)
  // A small lossless transfer for any complete pre-existing sets; fresh databases stay empty.
  const legacy = database.prepare(`SELECT DISTINCT bank_name,bank_mfo,bank_edrpou FROM recipients
    WHERE trim(coalesce(bank_name,''))<>''`).all()
  const banks = new Map<string, string>()
  for (const row of legacy) {
    const name = String(row.bank_name)
    let bankId = banks.get(name)
    if (!bankId) {
      bankId = randomUUID(); banks.set(name, bankId)
      database.prepare('INSERT INTO banks(id,name) VALUES(?,?)').run(bankId, name)
    }
    const detailId = randomUUID()
    database.prepare('INSERT INTO bank_details(id,bank_id,mfo,edrpou) VALUES(?,?,?,?)').run(detailId, bankId, String(row.bank_mfo), String(row.bank_edrpou))
    database.prepare('UPDATE recipients SET bank_details_id=? WHERE bank_name=? AND bank_mfo=? AND bank_edrpou=?')
      .run(detailId, name, String(row.bank_mfo), String(row.bank_edrpou))
  }
  database.exec(`ALTER TABLE recipients DROP COLUMN bank_name;
    ALTER TABLE recipients DROP COLUMN bank_mfo;
    ALTER TABLE recipients DROP COLUMN bank_edrpou;`)
}
