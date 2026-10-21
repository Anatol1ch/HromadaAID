import type { DatabaseSync } from 'node:sqlite'
import type { DeleteEntity, DeletePreview } from './api-contract.js'
import { orderScope, touchOrderRevision } from './catalog-order.js'

type Row = Record<string, string | number | null>
const entities = ['assignment', 'recipient', 'decision', 'program', 'aidType'] as const
export function isDeleteEntity(value: unknown): value is DeleteEntity { return typeof value === 'string' && entities.includes(value as DeleteEntity) }

function assignmentLabel(database: DatabaseSync, id: string) {
  const row = database.prepare(`SELECT r.last_name||' '||r.first_name||COALESCE(' '||r.patronymic,'') AS name,d.decision_number,d.decision_date
    FROM assignments a JOIN recipients r ON r.id=a.recipient_id JOIN decisions d ON d.id=a.decision_id WHERE a.id=?`).get(id) as Row | undefined
  return row ? `${String(row.name)} — рішення № ${String(row.decision_number)} від ${String(row.decision_date)}` : null
}
function assignmentCounts(database: DatabaseSync, where: string, value: string) {
  const count = Number((database.prepare(`SELECT COUNT(*) AS count FROM assignments a WHERE ${where}`).get(value) as Row | undefined)?.count ?? 0)
  // Retain dependency cleanup for historical data; payouts no longer participate in accounting.
  const payouts = Number((database.prepare(`SELECT COUNT(*) AS count FROM payouts p JOIN assignments a ON a.id=p.assignment_id WHERE ${where}`).get(value) as Row | undefined)?.count ?? 0)
  const imported = Number((database.prepare(`SELECT COUNT(*) AS count FROM imported_source_rows s JOIN assignments a ON a.id=s.assignment_id WHERE ${where}`).get(value) as Row | undefined)?.count ?? 0)
  return [{ label: 'Пов’язані призначення', count }, { label: 'Історичні записи попередньої моделі', count: payouts }, { label: 'Рядки історії імпорту', count: imported }].filter((item) => item.count > 0)
}
export function previewDeletion(database: DatabaseSync, entity: DeleteEntity, id: string): DeletePreview | null {
  let row: Row | undefined
  let name: string | null = null
  let dependencies: DeletePreview['dependencies'] = []
  if (entity === 'assignment') {
    name = assignmentLabel(database, id)
    if (name) dependencies = assignmentCounts(database, 'a.id=?', id)
  } else if (entity === 'recipient') {
    row = database.prepare(`SELECT last_name||' '||first_name||COALESCE(' '||patronymic,'') AS name FROM recipients WHERE id=?`).get(id) as Row | undefined
    name = row ? String(row.name) : null
    if (name) {
      dependencies = assignmentCounts(database, 'a.recipient_id=?', id)
      const snapshots = Number((database.prepare('SELECT COUNT(*) AS count FROM document_recipient_snapshots WHERE recipient_id=?').get(id) as Row).count)
      if (snapshots) dependencies.push({ label: 'Знімки реквізитів у сформованих документах', count: snapshots })
    }
  } else if (entity === 'decision') {
    row = database.prepare(`SELECT 'Рішення № '||decision_number||' від '||decision_date AS name FROM decisions WHERE id=?`).get(id) as Row | undefined
    name = row ? String(row.name) : null
    if (name) dependencies = assignmentCounts(database, 'a.decision_id=?', id)
  } else if (entity === 'aidType') {
    row = database.prepare('SELECT short_name AS name FROM aid_types WHERE id=?').get(id) as Row | undefined
    name = row ? String(row.name) : null
    if (name) {
      dependencies = assignmentCounts(database, 'a.aid_type_id=?', id)
      const plans = Number((database.prepare('SELECT COUNT(*) AS count FROM annual_plan_entries WHERE aid_type_id=?').get(id) as Row).count)
      const annual = Number((database.prepare('SELECT COUNT(*) AS count FROM annual_aid_plans WHERE aid_type_id=?').get(id) as Row).count)
      if (annual) dependencies.push({ label: 'Річні планові показники', count: annual })
      if (plans) dependencies.push({ label: 'Рядки плану', count: plans })
    }
  } else {
    row = database.prepare('SELECT short_name AS name FROM programs WHERE id=?').get(id) as Row | undefined
    name = row ? String(row.name) : null
    if (name) {
      const types = Number((database.prepare('SELECT COUNT(*) AS count FROM aid_types WHERE program_id=?').get(id) as Row).count)
      const typeIds = database.prepare('SELECT id FROM aid_types WHERE program_id=?').all(id) as Row[]
      let assignments = 0, payouts = 0, imported = 0, plans = 0, annual = 0
      for (const type of typeIds) {
        const typeId = String(type.id)
        const counts = assignmentCounts(database, 'a.aid_type_id=?', typeId)
        assignments += counts.find((item) => item.label === 'Пов’язані призначення')?.count ?? 0
        payouts += counts.find((item) => item.label === 'Історичні записи попередньої моделі')?.count ?? 0
        imported += counts.find((item) => item.label === 'Рядки історії імпорту')?.count ?? 0
        annual += Number((database.prepare('SELECT COUNT(*) AS count FROM annual_aid_plans WHERE aid_type_id=?').get(typeId) as Row).count)
        plans += Number((database.prepare('SELECT COUNT(*) AS count FROM annual_plan_entries WHERE aid_type_id=?').get(typeId) as Row).count)
      }
      dependencies = [{ label: 'Види допомоги', count: types }, { label: 'Пов’язані призначення', count: assignments }, { label: 'Історичні записи попередньої моделі', count: payouts }, { label: 'Рядки історії імпорту', count: imported }, { label: 'Рядки плану', count: plans }, { label: 'Річні планові показники', count: annual }].filter((item) => item.count > 0)
      const orphanApprovals = Number((database.prepare(`SELECT COUNT(*) AS count FROM program_approvals pa WHERE EXISTS(SELECT 1 FROM programs p WHERE p.id=? AND p.approval_id=pa.id) AND (SELECT COUNT(*) FROM programs p2 WHERE p2.approval_id=pa.id)=1`).get(id) as Row).count)
      if (orphanApprovals) dependencies.push({ label: 'Реквізити затвердження, пов’язані лише з цією програмою', count: orphanApprovals })
    }
  }
  return name === null ? null : { entity, id, name, dependencies }
}

function removeAssignments(database: DatabaseSync, where: string, value: string) {
  const ids = database.prepare(`SELECT id FROM assignments WHERE ${where}`).all(value) as Row[]
  for (const item of ids) {
    const id = String(item.id)
    database.prepare('DELETE FROM import_review_items WHERE import_source_row_id IN (SELECT id FROM imported_source_rows WHERE assignment_id=?)').run(id)
    database.prepare('DELETE FROM imported_source_rows WHERE assignment_id=?').run(id)
    database.prepare('DELETE FROM payouts WHERE assignment_id=?').run(id)
    database.prepare('DELETE FROM assignments WHERE id=?').run(id)
  }
}

export function executeDeletion(database: DatabaseSync, entity: DeleteEntity, id: string) {
  try {
    database.exec('BEGIN IMMEDIATE')
    if (!previewDeletion(database, entity, id)) { database.exec('ROLLBACK'); return { ok: false, message: 'Запис уже видалено або його не знайдено. Оновіть список.' } }
    if (entity === 'assignment') removeAssignments(database, 'id=?', id)
    if (entity === 'recipient') {
      removeAssignments(database, 'recipient_id=?', id)
      database.prepare('DELETE FROM document_recipient_snapshots WHERE recipient_id=?').run(id)
      database.prepare('DELETE FROM recipients WHERE id=?').run(id)
    }
    if (entity === 'decision') { removeAssignments(database, 'decision_id=?', id); database.prepare('DELETE FROM decisions WHERE id=?').run(id) }
    if (entity === 'aidType') {
      const aidType = database.prepare('SELECT program_id FROM aid_types WHERE id=?').get(id) as { program_id: string } | undefined
      removeAssignments(database, 'aid_type_id=?', id)
      database.prepare('DELETE FROM annual_aid_plans WHERE aid_type_id=?').run(id)
      database.prepare('DELETE FROM annual_plan_entries WHERE aid_type_id=?').run(id)
      database.prepare('DELETE FROM aid_types WHERE id=?').run(id)
      if (aidType) touchOrderRevision(database, orderScope('aidType', aidType.program_id))
    }
    if (entity === 'program') {
      const approvals = database.prepare(`SELECT pa.id FROM program_approvals pa WHERE EXISTS(SELECT 1 FROM programs p WHERE p.id=? AND p.approval_id=pa.id) AND (SELECT COUNT(*) FROM programs p2 WHERE p2.approval_id=pa.id)=1`).all(id) as Row[]
      const types = database.prepare('SELECT id FROM aid_types WHERE program_id=?').all(id) as Row[]
      for (const item of types) {
        const typeId = String(item.id)
        removeAssignments(database, 'aid_type_id=?', typeId)
        database.prepare('DELETE FROM annual_aid_plans WHERE aid_type_id=?').run(typeId)
        database.prepare('DELETE FROM annual_plan_entries WHERE aid_type_id=?').run(typeId)
      }
      database.prepare('DELETE FROM aid_types WHERE program_id=?').run(id)
      database.prepare('DELETE FROM programs WHERE id=?').run(id)
      database.prepare('DELETE FROM catalog_order_revisions WHERE scope=?').run(orderScope('aidType', id))
      touchOrderRevision(database, orderScope('program'))
      for (const approval of approvals) database.prepare('DELETE FROM program_approvals WHERE id=?').run(String(approval.id))
    }
    database.exec('COMMIT')
    return { ok: true }
  } catch {
    try { database.exec('ROLLBACK') } catch { /* transaction already closed */ }
    return { ok: false, message: 'Не вдалося видалити запис; усі зміни транзакції скасовано.' }
  }
}

