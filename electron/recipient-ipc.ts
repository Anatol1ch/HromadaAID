import { addressColumns, addressFromRow, addressKeys, addressValues, storedAddressText } from './address.js'
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { trustedIpcMain as ipcMain } from './ipc-security.js'
import type { DuplicateMatch, RecipientRecord, RecipientSaveResult, RecipientSummary } from './api-contract.js'
import { validateRecipientInput } from './recipient-validation.js'

type RecipientRow = Record<string, string | number | null>

function fullNameOf(row: RecipientRow) {
  return [row.last_name, row.first_name, row.patronymic].filter((part) => typeof part === 'string' && part.trim()).join(' ')
}

function toSummary(row: RecipientRow): RecipientSummary {
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

function toRecord(row: RecipientRow): RecipientRecord {
  return {
    ...toSummary(row),
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

const selectFields = 'r.*, b.name AS bank_name, bd.mfo AS bank_mfo, bd.edrpou AS bank_edrpou'
const recipientSource = 'recipients r LEFT JOIN bank_details bd ON bd.id=r.bank_details_id LEFT JOIN banks b ON b.id=bd.bank_id'

export function registerRecipientIpc(database: DatabaseSync) {
  ipcMain.handle('recipients:list', (_event, _includeArchived: unknown) => {
    const rows = database.prepare(`SELECT ${selectFields} FROM ${recipientSource}`).all() as RecipientRow[]
    return rows.map(toSummary).sort((a, b) => a.fullName.localeCompare(b.fullName, 'uk'))
  })

  ipcMain.handle('recipients:get', (_event, id: unknown) => {
    if (typeof id !== 'string' || !id) return null
    const row = database.prepare(`SELECT ${selectFields} FROM ${recipientSource} WHERE r.id = ?`).get(id) as RecipientRow | undefined
    return row ? toRecord(row) : null
  })

  ipcMain.handle('recipients:save', (_event, value: unknown, idValue?: unknown, confirmSameName?: unknown): RecipientSaveResult => {
    const validation = validateRecipientInput(value)
    if (!validation.ok) return { ok: false, reason: 'validation', matches: [], message: validation.message }
    const input = validation.input
    const id = typeof idValue === 'string' && idValue ? idValue : null
    const confirmName = confirmSameName === true
    const now = new Date().toISOString()

    try {
      database.exec('BEGIN IMMEDIATE')
      if (!database.prepare('SELECT 1 FROM bank_details WHERE id=?').get(input.bankDetailsId)) {
        database.exec('ROLLBACK')
        return { ok: false, reason: 'validation', matches: [], message: 'Оберіть наявний банк і набір банківських реквізитів. Оновіть список банків.' }
      }
      const existing = database.prepare(`SELECT id, last_name, first_name, patronymic, rnokpp FROM recipients`).all() as RecipientRow[]
      const others = existing.filter((row) => row.id !== id)
      const identifierMatches = input.rnokpp
        ? others.filter((row) => typeof row.rnokpp === 'string' && row.rnokpp.trim().toLocaleLowerCase('uk') === input.rnokpp.toLocaleLowerCase('uk'))
        : []
      if (identifierMatches.length) {
        database.exec('ROLLBACK')
        return { ok: false, reason: 'rnokpp-match', matches: identifierMatches.map(toDuplicateMatch), message: 'Цей РНОКПП уже є в іншій картці. Перевірте наявний запис; картки не об’єднувалися.' }
      }

      const normalizedName = normalizeName([input.lastName, input.firstName, input.patronymic].join(' '))
      const nameMatches = others.filter((row) => normalizeName(fullNameOf(row)) === normalizedName)
      if (nameMatches.length && !confirmName) {
        database.exec('ROLLBACK')
        return { ok: false, reason: 'name-match', matches: nameMatches.map(toDuplicateMatch), message: 'Збіг ПІБ потребує перевірки. Це може бути інша людина; автоматичного об’єднання немає.' }
      }

      const values = [
        input.lastName, input.firstName, nullable(input.patronymic), nullable(input.rnokpp), nullable(input.sex),
        null, null, nullable(input.phone), nullable(input.email),
        nullable(input.bankAccount), input.bankDetailsId, nullable(input.passport),
      ]

      let savedId = id
      if (id) {
        const result = database.prepare(`UPDATE recipients SET
          last_name=?, first_name=?, patronymic=?, rnokpp=?, sex=?, address=?, registered_address=?,
          phone=?, email=?, bank_account=?, bank_details_id=?, passport=?,
          is_vpo=?, is_demo=0, updated_at=? WHERE id=?`).run(...values, input.isVpo ? 1 : 0, now, id)
        if (Number(result.changes) === 0) {
          database.exec('ROLLBACK')
          return { ok: false, reason: 'not-found', matches: [], message: 'Картку не знайдено. Оновіть список і спробуйте ще раз.' }
        }
      } else {
        savedId = randomUUID()
        database.prepare(`INSERT INTO recipients (
          id, last_name, first_name, patronymic, rnokpp, sex, address, registered_address,
          phone, email, bank_account, bank_details_id, passport, is_demo, created_at, updated_at, is_vpo
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`)
          .run(savedId, ...values, now, now, input.isVpo ? 1 : 0)
      }
      const columns = ['registration', 'residence'].flatMap(prefix => addressKeys.map(key => prefix + '_' + addressColumns[key]))
      database.prepare('UPDATE recipients SET ' + columns.map(column => column + '=?').join(',') + ' WHERE id=?')
        .run(...addressValues(input.registeredAddressParts), ...addressValues(input.addressParts), savedId)
      const row = database.prepare(`SELECT ${selectFields} FROM ${recipientSource} WHERE r.id = ?`).get(savedId) as RecipientRow | undefined
      if (!row) {
        database.exec('ROLLBACK')
        return { ok: false, reason: 'storage', matches: [], message: 'Не вдалося прочитати картку перед збереженням; зміни скасовано.' }
      }
      const response: RecipientSaveResult = { ok: true, recipient: toRecord(row) }
      database.exec('COMMIT')
      return response
    } catch {
      try { database.exec('ROLLBACK') } catch { /* Transaction may already be closed. */ }
      return { ok: false, reason: 'storage', matches: [], message: 'Не вдалося зберегти картку. Дані у формі збережено — спробуйте ще раз.' }
    }
  })
}

function normalizeName(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('uk')
}

function nullable(value: string) {
  return value || null
}

function toDuplicateMatch(row: RecipientRow): DuplicateMatch {
  return {
    id: String(row.id),
    fullName: fullNameOf(row),
    rnokpp: typeof row.rnokpp === 'string' ? row.rnokpp : null,
  }
}
