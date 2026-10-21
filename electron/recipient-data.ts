import type { DatabaseSync } from 'node:sqlite'
import { addressFromRow, storedAddressText } from './address.js'
import type { RecipientRecord, RecipientSummary } from '../shared/api-contract.js'

export type RecipientRow = Record<string, string | number | null>

function fullNameOf(row: RecipientRow) {
  return [row.last_name, row.first_name, row.patronymic].filter((part) => typeof part === 'string' && part.trim()).join(' ')
}

export function recipientSummaryFromRow(row: RecipientRow): RecipientSummary {
  return {
    id: String(row.id),
    fullName: fullNameOf(row),
    rnokpp: typeof row.rnokpp === 'string' ? row.rnokpp : null,
    phone: typeof row.phone === 'string' ? row.phone : null,
    registeredAddress: storedAddressText(row, 'registration'),
    sex: row.sex === 'Жінка' || row.sex === 'Чоловік' ? row.sex : null,
    updatedAt: String(row.updated_at),
    isDemo: Number(row.is_demo) === 1,
    isVpo: row.is_vpo === 0 || row.is_vpo === 1 ? Number(row.is_vpo) === 1 : null,
  }
}

export function recipientRecordFromRow(row: RecipientRow): RecipientRecord {
  return {
    ...recipientSummaryFromRow(row),
    lastName: String(row.last_name),
    firstName: String(row.first_name),
    patronymic: typeof row.patronymic === 'string' ? row.patronymic : null,
    sex: row.sex === 'Жінка' || row.sex === 'Чоловік' ? row.sex : null,
    isVpo: row.is_vpo === 0 || row.is_vpo === 1 ? Number(row.is_vpo) === 1 : null,
    address: storedAddressText(row, 'residence'),
    registeredAddressParts: addressFromRow(row, 'registration'),
    addressParts: addressFromRow(row, 'residence'),
    email: typeof row.email === 'string' ? row.email : null,
    bankDetailsId: typeof row.bank_details_id === 'string' ? row.bank_details_id : null,
    bankAccount: typeof row.bank_account === 'string' ? row.bank_account : null,
    bankName: typeof row.bank_name === 'string' ? row.bank_name : null,
    bankMfo: typeof row.bank_mfo === 'string' ? row.bank_mfo : null,
    bankEdrpou: typeof row.bank_edrpou === 'string' ? row.bank_edrpou : null,
    passport: typeof row.passport === 'string' ? row.passport : null,
    createdAt: String(row.created_at),
  }
}

export const recipientSelectFields = 'r.*, b.name AS bank_name, bd.mfo AS bank_mfo, bd.edrpou AS bank_edrpou'
export const recipientSource = 'recipients r LEFT JOIN bank_details bd ON bd.id=r.bank_details_id LEFT JOIN banks b ON b.id=bd.bank_id'

export function listRecipients(database: DatabaseSync): RecipientSummary[] {
  const rows = database.prepare(`SELECT ${recipientSelectFields} FROM ${recipientSource}`).all() as RecipientRow[]
  return rows.map(recipientSummaryFromRow).sort((a, b) => a.fullName.localeCompare(b.fullName, 'uk'))
}

export function getRecipient(database: DatabaseSync, id: string): RecipientRecord | null {
  const row = database.prepare(`SELECT ${recipientSelectFields} FROM ${recipientSource} WHERE r.id = ?`).get(id) as RecipientRow | undefined
  return row ? recipientRecordFromRow(row) : null
}

export function recipientFullName(row: RecipientRow) {
  return fullNameOf(row)
}
