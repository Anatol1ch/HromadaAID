export type DecisionAssignmentTarget = { decisionId: string; year: number }

/** Builds a context route only when the caller may open the assignment registry. */
export function decisionAssignmentTarget(
  decisionId: string,
  decisionDate: string,
  canReadAssignments: boolean,
): DecisionAssignmentTarget | null {
  const year = Number(decisionDate.slice(0, 4))
  const parsed = new Date(`${decisionDate}T00:00:00.000Z`)
  if (!canReadAssignments || !decisionId || !/^\d{4}-\d{2}-\d{2}$/.test(decisionDate) || !Number.isInteger(year) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== decisionDate) return null
  return { decisionId, year }
}
