import { addressColumns, storedAddressText } from './address.js'
import type { DatabaseSync } from 'node:sqlite'

export type StatementRow = Record<string, number | string | null>

/** Preserve the generator's field names while resolving the live bank reference. */
export function readStatementRows(database: DatabaseSync, ids: string[], year: string): StatementRow[] {
  if (!ids.length) return []
  const rows = database.prepare(`SELECT a.id,a.amount_minor,a.created_at,d.decision_date,
    t.id AS aid_type_id,t.short_name AS aid_type_name,
    r.last_name,r.first_name,r.patronymic,r.rnokpp,r.passport,r.registered_address,r.address,r.bank_account,
    ${Object.values(addressColumns).map(column => 'r.registration_' + column).join(',')},
    ${Object.values(addressColumns).map(column => 'r.residence_' + column).join(',')},
    b.id AS bank_id,b.name AS bank_name,bd.mfo AS bank_mfo,bd.edrpou AS bank_edrpou
    FROM assignments a JOIN recipients r ON r.id=a.recipient_id JOIN decisions d ON d.id=a.decision_id
    JOIN aid_types t ON t.id=a.aid_type_id
    LEFT JOIN bank_details bd ON bd.id=r.bank_details_id LEFT JOIN banks b ON b.id=bd.bank_id
    WHERE a.id IN (${ids.map(() => '?').join(',')}) AND substr(d.decision_date,1,4)=?
      AND a.status IN ('Призначено','В роботі','Передано до казначейства')
    ORDER BY d.decision_date,a.created_at,a.id`).all(...ids, year) as StatementRow[]
  return rows.map(row => ({
    ...row,
    registered_address: storedAddressText(row, 'registration'),
    residence_address: storedAddressText(row, 'residence'),
  }))
}

/** Keep bank snapshots limited to the fields used by that export and its grouping checks. */
export function readBankStatementRows(database: DatabaseSync, ids: string[], year: string): StatementRow[] {
  const fields = ['id', 'aid_type_id', 'aid_type_name', 'bank_id', 'bank_name', 'amount_minor', 'decision_date', 'created_at', 'last_name', 'first_name', 'patronymic', 'rnokpp', 'bank_account']
  return readStatementRows(database, ids, year).map(row => Object.fromEntries(fields.map(field => [field, row[field]])))
}
