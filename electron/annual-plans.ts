import type { DatabaseSync } from 'node:sqlite'
import { nextRecordRevision } from '../shared/record-revision.js'
import type { AnnualAidPlan, AnnualAidPlanInput } from './api-contract.js'

export function listAnnualPlans(db: DatabaseSync, year: number): AnnualAidPlan[] {
  return db.prepare(`SELECT year,aid_type_id AS aidTypeId,planned_recipient_count AS plannedRecipientCount,
    planned_amount_minor AS plannedAmountMinor,updated_at AS updatedAt
    FROM annual_aid_plans WHERE year=?`).all(year) as AnnualAidPlan[]
}

export function saveAnnualPlan(db: DatabaseSync, value: unknown, expectedUpdatedAt?: unknown) {
  if (!value || typeof value !== 'object') return { ok: false, message: 'Перевірте планові показники.' }
  const input = value as AnnualAidPlanInput
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2200 || typeof input.aidTypeId !== 'string' || !input.aidTypeId ||
    ![input.plannedRecipientCount, input.plannedAmountMinor].every(number => Number.isSafeInteger(number) && number >= 0)) return { ok: false, message: 'Заповніть всі показники невід’ємними значеннями. Кількість має бути цілим числом.' }
  try {
    if (!db.prepare('SELECT 1 FROM aid_types WHERE id=?').get(input.aidTypeId)) return { ok: false, message: 'Вид допомоги не знайдено. Оновіть довідник.' }
    // One UPSERT atomically writes both indicators; zero is distinct from an absent row.
    // Omit the retired budget column on INSERT and UPDATE, preserving any historical value.
    db.prepare(`INSERT INTO annual_aid_plans(year,aid_type_id,planned_recipient_count,planned_amount_minor,updated_at)
      VALUES(?,?,?,?,?) ON CONFLICT(year,aid_type_id) DO UPDATE SET
      planned_recipient_count=excluded.planned_recipient_count,planned_amount_minor=excluded.planned_amount_minor,updated_at=excluded.updated_at`)
      .run(input.year, input.aidTypeId, input.plannedRecipientCount, input.plannedAmountMinor, new Date().toISOString())
    return { ok: true }
  } catch { return { ok: false, message: 'Не вдалося зберегти планові показники. Введені дані залишено у формі.' } }
}

/** Compatibility for the original row-based plan API. Called inside its write transaction. */
export function syncLegacyPlan(db: DatabaseSync, year: number, aidTypeId: string) {
  const total = db.prepare(`SELECT COUNT(*) AS n,SUM(planned_recipient_count) AS recipients,SUM(planned_amount_minor) AS amount
    FROM annual_plan_entries WHERE year=? AND aid_type_id=?`).get(year, aidTypeId) as { n: number; recipients: number | null; amount: number | null }
  if (!total.n) { db.prepare('DELETE FROM annual_aid_plans WHERE year=? AND aid_type_id=?').run(year, aidTypeId); return }
  db.prepare(`INSERT INTO annual_aid_plans(year,aid_type_id,planned_recipient_count,planned_amount_minor,updated_at)
    VALUES(?,?,?,?,?) ON CONFLICT(year,aid_type_id) DO UPDATE SET planned_recipient_count=excluded.planned_recipient_count,
    planned_amount_minor=excluded.planned_amount_minor,updated_at=excluded.updated_at`)
    .run(year, aidTypeId, total.recipients, total.amount, new Date().toISOString())
}
