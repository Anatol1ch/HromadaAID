import type { DatabaseSync } from 'node:sqlite'
import { isStatementEligible } from './assignment-model.js'
import { listAssignments } from './assignment-data.js'
import type { StatementListResult } from '../shared/api-contract.js'

/** Read model for statement formation; document generation stays in Electron. */
export function listStatementAssignments(database: DatabaseSync, yearValue: unknown): StatementListResult {
  const result = listAssignments(database, yearValue)
  const banks = new Map(database.prepare('SELECT r.id, b.id AS bank_id, b.name AS bank_name FROM recipients r LEFT JOIN bank_details bd ON bd.id=r.bank_details_id LEFT JOIN banks b ON b.id=bd.bank_id').all().map(row => [String(row.id), row]))
  return { ...result, assignments: result.assignments.filter(assignment => isStatementEligible(assignment.status)).map(assignment => {
    const bank = banks.get(assignment.recipientId)
    return { ...assignment, bankId: typeof bank?.bank_id === 'string' ? bank.bank_id : null, bankName: typeof bank?.bank_name === 'string' ? bank.bank_name : null }
  }) }
}
