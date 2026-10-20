import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { BankDetail, BankRecord, BankSaveResult } from './api-contract.js'
import { validateBankInput } from './bank-validation.js'

export function listBanks(database: DatabaseSync, query = ''): BankRecord[] {
  const rows = database.prepare(`SELECT b.id,b.name,d.id AS detail_id,d.mfo,d.edrpou,
    (SELECT count(*) FROM recipients r WHERE r.bank_details_id=d.id) AS recipient_count
    FROM banks b LEFT JOIN bank_details d ON d.bank_id=b.id ORDER BY b.rowid,d.rowid`).all()
  const banks = new Map<string, BankRecord>()
  for (const row of rows) {
    const id = String(row.id)
    let bank = banks.get(id)
    if (!bank) { bank = { id, name: String(row.name), details: [], recipientCount: 0 }; banks.set(id, bank) }
    if (row.detail_id !== null) {
      const recipientCount = Number(row.recipient_count)
      bank.details.push({ id: String(row.detail_id), bankId: id, mfo: String(row.mfo), edrpou: String(row.edrpou), recipientCount })
      bank.recipientCount += recipientCount
    }
  }
  const needle = query.trim().toLocaleLowerCase('uk')
  return [...banks.values()].filter(bank => !needle || bank.name.toLocaleLowerCase('uk').includes(needle) || bank.details.some(detail => detail.mfo.toLocaleLowerCase('uk').includes(needle) || detail.edrpou.toLocaleLowerCase('uk').includes(needle)))
    .sort((a, b) => a.name.localeCompare(b.name, 'uk') || a.id.localeCompare(b.id))
}
export function getBank(database: DatabaseSync, id: string) { return listBanks(database).find(bank => bank.id === id) ?? null }
export function bankDetails(database: DatabaseSync, bankId: string): BankDetail[] { return getBank(database, bankId)?.details ?? [] }

class BankConflict extends Error {}
export function saveBank(database: DatabaseSync, value: unknown, idValue?: unknown): BankSaveResult {
  const validation = validateBankInput(value)
  if (!validation.ok) return { ok: false, message: validation.message }
  if (idValue !== undefined && (typeof idValue !== 'string' || !idValue)) return { ok: false, message: 'Некоректний банк. Оновіть довідник.' }
  const id = typeof idValue === 'string' ? idValue : randomUUID()
  try {
    database.exec('BEGIN IMMEDIATE')
    const existing = getBank(database, id)
    if (idValue && !existing) throw new BankConflict('Банк не знайдено. Оновіть довідник.')
    const { name, details } = validation.input
    const oldIds = new Set(existing?.details.map(detail => detail.id) ?? [])
    if (details.some(detail => detail.id && !oldIds.has(detail.id))) throw new BankConflict('Набір реквізитів не належить цьому банку. Оновіть картку.')
    for (const old of existing?.details ?? []) {
      if (!details.some(detail => detail.id === old.id) && old.recipientCount) throw new BankConflict(`Набір МФО ${old.mfo} · ЄДРПОУ ${old.edrpou} використовується у ${old.recipientCount} картках отримувачів. Видалення заборонено.`)
    }
    if (existing) database.prepare('UPDATE banks SET name=? WHERE id=?').run(name, id)
    else database.prepare('INSERT INTO banks(id,name) VALUES(?,?)').run(id, name)
    // Remove unused omitted sets. Used sets always keep their IDs and recipient links.
    for (const old of existing?.details ?? []) if (!details.some(detail => detail.id === old.id)) database.prepare('DELETE FROM bank_details WHERE id=?').run(old.id)
    // Temporary unique values allow swapping two existing pairs atomically.
    for (const detail of details) if (detail.id) database.prepare('UPDATE bank_details SET mfo=?,edrpou=? WHERE id=? AND bank_id=?').run(randomUUID(), randomUUID(), detail.id, id)
    for (const detail of details) {
      if (detail.id) database.prepare('UPDATE bank_details SET mfo=?,edrpou=? WHERE id=? AND bank_id=?').run(detail.mfo, detail.edrpou, detail.id, id)
      else database.prepare('INSERT INTO bank_details(id,bank_id,mfo,edrpou) VALUES(?,?,?,?)').run(randomUUID(), id, detail.mfo, detail.edrpou)
    }
    const bank = getBank(database, id)
    if (!bank) throw new Error('Missing saved bank')
    const response: BankSaveResult = { ok: true, bank }
    database.exec('COMMIT')
    return response
  } catch (error) {
    try { database.exec('ROLLBACK') } catch { /* Retain the original error. */ }
    return { ok: false, message: error instanceof BankConflict ? error.message : 'Не вдалося зберегти банк. Жодні зміни не застосовано.' }
  }
}

export function removeBank(database: DatabaseSync, id: string): { ok: boolean; message?: string } {
  try {
    database.exec('BEGIN IMMEDIATE')
    const bank = getBank(database, id)
    if (!bank) throw new BankConflict('Банк не знайдено. Оновіть довідник.')
    if (bank.recipientCount) throw new BankConflict(`Банк використовується у ${bank.recipientCount} картках отримувачів. Спочатку змініть банк у цих картках. Видалення заборонено.`)
    database.prepare('DELETE FROM bank_details WHERE bank_id=?').run(id)
    database.prepare('DELETE FROM banks WHERE id=?').run(id)
    database.exec('COMMIT')
    return { ok: true }
  } catch (error) {
    try { database.exec('ROLLBACK') } catch { /* No partial deletion. */ }
    return { ok: false, message: error instanceof BankConflict ? error.message : 'Не вдалося видалити банк. Жодні зміни не застосовано.' }
  }
}
