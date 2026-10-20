import type { AssignmentStatus } from '../../electron/api-contract'

type SelectableAssignment = { id: string; status: AssignmentStatus }

export function eligibleAssignmentIds(rows: readonly SelectableAssignment[]): string[] {
  return rows.filter((row) => row.status !== 'Виплачено').map((row) => row.id)
}

export function selectionState(eligibleIds: readonly string[], selectedIds: ReadonlySet<string>) {
  const count = eligibleIds.filter((id) => selectedIds.has(id)).length
  return { checked: eligibleIds.length > 0 && count === eligibleIds.length, indeterminate: count > 0 && count < eligibleIds.length }
}

export function keepEligibleSelection(selectedIds: ReadonlySet<string>, eligibleIds: readonly string[]): Set<string> {
  const eligible = new Set(eligibleIds)
  return new Set([...selectedIds].filter((id) => eligible.has(id)))
}

export function selectionForYear(selection: { year: number; ids: ReadonlySet<string> }, year: number, eligibleIds: readonly string[]): Set<string> {
  return selection.year === year ? keepEligibleSelection(selection.ids, eligibleIds) : new Set()
}

export function toggleEligibleSelection(eligibleIds: readonly string[], selectedIds: ReadonlySet<string>): Set<string> {
  return selectionState(eligibleIds, selectedIds).checked ? new Set() : new Set(eligibleIds)
}
