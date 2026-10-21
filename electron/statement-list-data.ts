import type { DatabaseSync } from 'node:sqlite'
import { isStatementEligible } from './assignment-model.js'
import { listAssignments } from './assignment-data.js'
import type { AssignmentListResult } from '../shared/api-contract.js'

/** Read model for statement formation; document generation stays in Electron. */
export function listStatementAssignments(database: DatabaseSync, yearValue: unknown): AssignmentListResult {
  const result = listAssignments(database, yearValue)
  return { ...result, assignments: result.assignments.filter((assignment) => isStatementEligible(assignment.status)) }
}
