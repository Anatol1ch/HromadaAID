import type { DatabaseSync } from 'node:sqlite'
import { availableAccountingYears, resolveAccountingYear } from './accounting-year.js'
import { ASSIGNMENT_STATUSES } from './assignment-model.js'
import type { AssignmentListResult, AssignmentRecord, AssignmentStatus, DecisionRecord, DecisionSummary } from '../shared/api-contract.js'

export type AssignmentRow = Record<string, string | number | null>

const assignmentStatusValues: readonly AssignmentStatus[] = ASSIGNMENT_STATUSES

export const assignmentSelect = `a.id, a.created_at, a.updated_at, a.recipient_id, r.last_name, r.first_name, r.patronymic, r.is_demo AS recipient_is_demo, r.sex AS recipient_sex, r.is_vpo AS recipient_is_vpo,
  d.id AS decision_id, d.decision_number, d.decision_date,
  p.id AS program_id, p.short_name AS program_name,
  t.id AS aid_type_id, t.short_name AS aid_type_name, a.amount_minor, a.status, a.paid_on`
export const assignmentFrom = `FROM assignments a
  JOIN recipients r ON r.id = a.recipient_id
  JOIN decisions d ON d.id = a.decision_id
  JOIN aid_types t ON t.id = a.aid_type_id
  JOIN programs p ON p.id = t.program_id`

export function assignmentFromRow(row: AssignmentRow): AssignmentRecord {
  return {
    id: String(row.id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at ?? row.created_at),
    recipientId: String(row.recipient_id),
    recipientName: [row.last_name, row.first_name, row.patronymic].filter((part) => typeof part === 'string' && part.trim()).join(' '),
    recipientIsDemo: Number(row.recipient_is_demo) === 1,
    recipientSex: row.recipient_sex === 'Жінка' || row.recipient_sex === 'Чоловік' ? row.recipient_sex : null,
    recipientIsVpo: row.recipient_is_vpo === 0 || row.recipient_is_vpo === 1 ? Number(row.recipient_is_vpo) === 1 : null,
    decisionId: String(row.decision_id),
    decisionNumber: String(row.decision_number),
    decisionDate: String(row.decision_date),
    programId: String(row.program_id),
    programName: String(row.program_name),
    aidTypeId: String(row.aid_type_id),
    aidTypeName: String(row.aid_type_name),
    amountMinor: Number(row.amount_minor),
    status: assignmentStatusValues.includes(row.status as AssignmentStatus) ? row.status as AssignmentStatus : 'Призначено',
    paidOn: row.status === 'Виплачено' && typeof row.paid_on === 'string' ? row.paid_on : null,
  }
}

export function decisionFromRow(row: AssignmentRow): DecisionSummary {
  return {
    id: String(row.id),
    decisionNumber: String(row.decision_number),
    decisionDate: String(row.decision_date),
    title: typeof row.title === 'string' ? row.title : null,
    assignmentCount: Number(row.assignment_count ?? 0),
    assignedTotalMinor: Number(row.assigned_total_minor ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at ?? row.created_at),
  }
}

function decisionSummaryById(database: DatabaseSync, id: string): DecisionSummary | null {
  const row = database.prepare(`SELECT d.id, d.decision_number, d.decision_date, d.title, d.created_at, d.updated_at,
    COUNT(CASE WHEN a.status <> 'Очікує рішення' THEN a.id END) AS assignment_count, COALESCE(SUM(CASE WHEN a.status <> 'Очікує рішення' THEN a.amount_minor ELSE 0 END), 0) AS assigned_total_minor
    FROM decisions d LEFT JOIN assignments a ON a.decision_id = d.id WHERE d.id = ? GROUP BY d.id`).get(id) as AssignmentRow | undefined
  return row ? decisionFromRow(row) : null
}

export function listDecisionAssignments(database: DatabaseSync, decisionId: string): AssignmentRecord[] {
  const rows = database.prepare(`SELECT ${assignmentSelect} ${assignmentFrom} WHERE a.decision_id = ? ORDER BY r.last_name, r.first_name, r.patronymic, a.created_at`).all(decisionId) as AssignmentRow[]
  return rows.map(assignmentFromRow)
}

export function listDecisions(database: DatabaseSync): DecisionSummary[] {
  const rows = database.prepare(`SELECT d.id, d.decision_number, d.decision_date, d.title, d.created_at, d.updated_at,
    COUNT(CASE WHEN a.status <> 'Очікує рішення' THEN a.id END) AS assignment_count, COALESCE(SUM(CASE WHEN a.status <> 'Очікує рішення' THEN a.amount_minor ELSE 0 END), 0) AS assigned_total_minor
    FROM decisions d LEFT JOIN assignments a ON a.decision_id = d.id
    GROUP BY d.id ORDER BY d.decision_date DESC, d.decision_number DESC`).all() as AssignmentRow[]
  return rows.map(decisionFromRow)
}

export function getDecision(database: DatabaseSync, id: string): DecisionRecord | null {
  const decision = decisionSummaryById(database, id)
  return decision ? { ...decision, assignments: listDecisionAssignments(database, id) } : null
}

export function listRecipientAssignmentHistory(database: DatabaseSync, recipientId: string): AssignmentRecord[] {
  const rows = database.prepare(`SELECT ${assignmentSelect} ${assignmentFrom} WHERE a.recipient_id = ? ORDER BY d.decision_date DESC, d.decision_number DESC, a.created_at DESC`).all(recipientId) as AssignmentRow[]
  return rows.map(assignmentFromRow)
}

export function listAssignments(database: DatabaseSync, yearValue: unknown): AssignmentListResult {
  const year = resolveAccountingYear(yearValue)
  const rows = database.prepare(`SELECT ${assignmentSelect} ${assignmentFrom}
    WHERE substr(d.decision_date, 1, 4)=?
    ORDER BY a.created_at DESC, a.id DESC`).all(String(year)) as AssignmentRow[]
  return { assignments: rows.map(assignmentFromRow), years: availableAccountingYears() }
}
