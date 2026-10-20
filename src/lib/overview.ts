import type { AidTypeOption, DashboardData, ProgramOption } from '../../electron/api-contract'

export const overviewMoney = (minor: number) => `${new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100)} ₴`

/** Presentation order only: preserve financial aggregates; follow the dictionary order. */
export function overviewRows(data: DashboardData, catalogs: { programs: ProgramOption[]; aidTypes: AidTypeOption[] }) {
  const programRank = new Map(catalogs.programs.map((program, index) => [program.id, index]))
  const programNames = new Map(catalogs.programs.map((program, index) => [program.shortName, index]))
  const programs = [...data.programExecution].sort((a, b) =>
    (programRank.get(a.programId ?? '') ?? programNames.get(a.programName) ?? Number.MAX_SAFE_INTEGER) -
    (programRank.get(b.programId ?? '') ?? programNames.get(b.programName) ?? Number.MAX_SAFE_INTEGER))
  const byId = new Map(data.aidTypeDistribution.filter(type => type.aidTypeId).map(type => [type.aidTypeId!, type]))
  const legacyByName = new Map(data.aidTypeDistribution.filter(type => !type.aidTypeId).map(type => [type.aidTypeName, type]))
  const used = new Set<DashboardData['aidTypeDistribution'][number]>()
  const types: DashboardData['aidTypeDistribution'] = catalogs.aidTypes.map(type => {
    const value = byId.get(type.id) ?? legacyByName.get(type.shortName)
    if (value) used.add(value)
    return { aidTypeId: type.id, programId: type.programId, aidTypeName: type.shortName, amountMinor: value?.amountMinor ?? 0, count: value?.count ?? 0 }
  })
  // Keep every catalog row, including zero/inactive types, in manual catalog order.
  types.push(...data.aidTypeDistribution.filter(type => !used.has(type)))
  return { programs, types }
}

/** Group existing aggregates once; unrecognised legacy labels remain visible. */
export function overviewTypeGroups(types: ReturnType<typeof overviewRows>['types'], catalogs: { programs: ProgramOption[]; aidTypes: AidTypeOption[] }) {
  const groups = catalogs.programs.map(program => ({ id: program.id, name: program.shortName, types: [] as typeof types }))
  const ungrouped = { id: 'unmatched', name: 'Інші види допомоги', types: [] as typeof types }
  for (const type of types) {
    const owner = type.programId ?? catalogs.aidTypes.find(item => item.id === type.aidTypeId || item.shortName === type.aidTypeName)?.programId
    const group = groups.find(item => item.id === owner) ?? ungrouped
    group.types.push(type)
  }
  return [...groups, ungrouped].filter(group => group.id !== 'unmatched' || group.types.length).map(group => ({ ...group, amountMinor: group.types.reduce((sum, type) => sum + type.amountMinor, 0) }))
}

export function overviewPercent(part: number, total: number): string {
  const value = total > 0 ? part / total * 100 : 0
  return `${new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1 }).format(value)}%`
}
