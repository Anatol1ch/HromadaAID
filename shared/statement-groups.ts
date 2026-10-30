export type StatementGroupRow = { id: string; aidTypeId: string; aidTypeName: string; bankId: string | null; bankName: string | null; amountMinor: number; decisionDate?: string; createdAt?: string }
export type StatementSelection = { id: string; aidTypeId: string; bankId: string }
export type DocumentKind = 'personal' | 'summary' | 'bank'
export const changedStatementPlan = 'Банк, вид допомоги або склад призначень змінилися. Оновіть список і відкрийте параметри формування повторно.'
export function sumStatementMinor(rows: { amountMinor: number }[]): number {
  let total = 0
  for (const row of rows) {
    if (!Number.isSafeInteger(row.amountMinor) || row.amountMinor < 0 || !Number.isSafeInteger(total + row.amountMinor)) throw new Error('Суми призначень некоректні або перевищують допустимий розмір.')
    total += row.amountMinor
  }
  return total
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
export function groupStatements<T extends StatementGroupRow>(kind: DocumentKind, input: T[]) {
  const unique = new Map<string, T>()
  for (const row of input) {
    if (!row.id || !row.aidTypeId) throw new Error('Некоректний склад призначень.')
    if (!row.bankId || !row.bankName?.trim()) throw new Error('У вибраних призначеннях є отримувачі без визначеного банку. Доповніть їхні картки й оновіть список.')
    const previous = unique.get(row.id)
    if (previous && (previous.aidTypeId !== row.aidTypeId || previous.bankId !== row.bankId || previous.amountMinor !== row.amountMinor)) throw new Error('Повторний ID призначення має суперечливі дані.')
    unique.set(row.id, row)
  }
  sumStatementMinor([...unique.values()])
  const grouped = new Map<string, T[]>()
  // ID ordering also keeps personal part membership stable when descriptive dates change.
  const ordered = [...unique.values()].sort((a, b) => compare(a.id, b.id))
  for (const row of ordered) {
    const key = JSON.stringify(kind === 'bank' ? [row.bankId] : [row.aidTypeId, row.bankId])
    const group = grouped.get(key) ?? []; group.push(row); grouped.set(key, group)
  }
  return [...grouped].sort(([a], [b]) => compare(a, b)).flatMap(([, rows]) => {
    const size = kind === 'personal' ? 12 : rows.length
    return Array.from({ length: Math.ceil(rows.length / size) }, (_, partIndex) => {
      const batch = rows.slice(partIndex * size, (partIndex + 1) * size)
      return { aidTypeId: kind === 'bank' ? '' : batch[0].aidTypeId, aidTypeName: kind === 'bank' ? '' : batch[0].aidTypeName, bankId: batch[0].bankId!, bankName: batch[0].bankName!, partIndex, recordCount: batch.length, totalMinor: sumStatementMinor(batch), rows: batch }
    })
  })
}

export function assertStatementSelection(rows: StatementGroupRow[], ids: string[], value: unknown) {
  if (!Array.isArray(value) || value.length !== ids.length || rows.length !== ids.length) throw new Error(changedStatementPlan)
  const expected = new Map<string, StatementSelection>()
  for (const item of value) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || typeof item.aidTypeId !== 'string' || typeof item.bankId !== 'string' || expected.has(item.id)) throw new Error(changedStatementPlan)
    expected.set(item.id, item)
  }
  const available = new Set(ids)
  for (const row of rows) {
    const item = expected.get(row.id)
    if (!available.delete(row.id) || !item || item.bankId !== row.bankId || item.aidTypeId !== row.aidTypeId) throw new Error(changedStatementPlan)
  }
  if (available.size) throw new Error(changedStatementPlan)
}
