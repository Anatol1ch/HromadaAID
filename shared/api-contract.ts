import type { AddressParts } from './address.js'
import type { AuthActionResult, ClientAuthState } from './auth-contract.js'
import type { UserRole } from './authorization.js'
import { ASSIGNMENT_STATUSES, type AssignmentStatus } from './assignment-model.js'
export type { AssignmentStatus } from './assignment-model.js'

export type ReportPdfKind = 'month' | 'quarter' | 'annual' | 'cumulative'
export type HealthResponse = { status: 'ok'; service: 'hromada-aid-api' }
export type BankDetailInput = { id?: string; mfo: string; edrpou: string }
export type BankInput = { name: string; details: BankDetailInput[] }
export type BankDetail = { id: string; bankId: string; mfo: string; edrpou: string; recipientCount: number }
export type BankRecord = { id: string; name: string; details: BankDetail[]; recipientCount: number; updatedAt: string }
export type BankSaveResult = { ok: true; bank: BankRecord } | { ok: false; reason: 'validation' | 'not-found' | 'conflict' | 'storage'; message: string }
export type RecipientInput = { lastName: string; firstName: string; patronymic: string; rnokpp: string; sex: '' | 'Жінка' | 'Чоловік'; address: string; registeredAddress: string; addressParts: AddressParts | null; registeredAddressParts: AddressParts | null; phone: string; email: string; bankAccount: string; bankDetailsId: string; passport: string; isVpo: boolean | null }
export type RecipientSummary = { id: string; fullName: string; rnokpp: string | null; phone: string | null; registeredAddress: string | null; sex: 'Жінка' | 'Чоловік' | null; updatedAt: string; isDemo: boolean; isVpo: boolean | null }
export type RecipientRecord = RecipientSummary & { lastName: string; firstName: string; patronymic: string | null; sex: 'Жінка' | 'Чоловік' | null; isVpo: boolean | null; address: string | null; addressParts: AddressParts | null; registeredAddressParts: AddressParts | null; email: string | null; bankDetailsId: string | null; bankAccount: string | null; bankName: string | null; bankMfo: string | null; bankEdrpou: string | null; passport: string | null; createdAt: string }
export type DuplicateMatch = { id: string; fullName: string; rnokpp: string | null }
export type RecipientSaveResult = | { ok: true; recipient: RecipientRecord } | { ok: false; reason: 'name-match' | 'rnokpp-match' | 'not-found' | 'conflict' | 'validation' | 'storage'; matches: DuplicateMatch[]; message: string }

export type ProgramApproval = { id: string; documentNumber: string; documentDate: string; title: string | null; programCount: number; updatedAt: string }
export type ProgramApprovalInput = { documentNumber: string; documentDate: string; title: string }
export type CatalogOrderInput = { kind: 'program' | 'aidType'; ids: string[]; programId?: string; expectedOrderRevision?: string }
export type CatalogSaveResult = { ok: true } | { ok: false; reason: 'validation' | 'not-found' | 'conflict' | 'storage'; message: string }
export type CatalogOrderResult = { ok: true } | { ok: false; reason: 'validation' | 'conflict' | 'storage'; message: string }
export type ProgramApprovalSaveResult = { ok: true; approval: ProgramApproval } | { ok: false; reason: 'validation' | 'not-found' | 'conflict' | 'storage'; message: string }
export type ProgramOption = { id: string; shortName: string; officialName: string; isActive: boolean; approvalId: string | null; approvalNumber: string | null; approvalDate: string | null; approvalTitle: string | null; assignmentCount: number; updatedAt: string }
export type AidTypeOption = { id: string; code: string; programId: string; shortName: string; officialName: string; direction: string | null; fundingSource: string | null; isActive: boolean; assignmentCount: number; updatedAt: string }
export type CatalogList = { programs: ProgramOption[]; aidTypes: AidTypeOption[]; programOrderRevision: string; aidTypeOrderRevisions: Record<string, string> }

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const isNullableString = (value: unknown): value is string | null => typeof value === 'string' || value === null

export function isCatalogList(value: unknown): value is CatalogList {
  if (!isRecord(value) || !Array.isArray(value.programs) || !Array.isArray(value.aidTypes) || typeof value.programOrderRevision !== 'string' || !isRecord(value.aidTypeOrderRevisions) || !Object.values(value.aidTypeOrderRevisions).every((revision) => typeof revision === 'string')) return false
  return value.programs.every((item) => isRecord(item) && typeof item.id === 'string' && typeof item.shortName === 'string' &&
    typeof item.officialName === 'string' && typeof item.isActive === 'boolean' && typeof item.updatedAt === 'string' && isNullableString(item.approvalId) &&
    isNullableString(item.approvalNumber) && isNullableString(item.approvalDate) && isNullableString(item.approvalTitle) &&
    typeof item.assignmentCount === 'number') &&
    value.aidTypes.every((item) => isRecord(item) && typeof item.id === 'string' && typeof item.code === 'string' &&
      typeof item.programId === 'string' && typeof item.shortName === 'string' && typeof item.officialName === 'string' && typeof item.updatedAt === 'string' &&
      isNullableString(item.direction) && isNullableString(item.fundingSource) && typeof item.isActive === 'boolean' &&
      typeof item.assignmentCount === 'number')
}

const isSex = (value: unknown): value is 'Жінка' | 'Чоловік' | null => value === 'Жінка' || value === 'Чоловік' || value === null
const isNullableBoolean = (value: unknown): value is boolean | null => typeof value === 'boolean' || value === null
const isAddressParts = (value: unknown): boolean => value === null || (isRecord(value) &&
  ['postalCode', 'region', 'district', 'settlementType', 'settlementName', 'streetType', 'customStreetType', 'streetName', 'building', 'apartment']
    .every((key) => typeof value[key] === 'string'))

export function isRecipientSummary(value: unknown): value is RecipientSummary {
  return isRecord(value) && typeof value.id === 'string' && typeof value.fullName === 'string' &&
    isNullableString(value.rnokpp) && isNullableString(value.phone) && isNullableString(value.registeredAddress) &&
    isSex(value.sex) && typeof value.updatedAt === 'string' && typeof value.isDemo === 'boolean' && isNullableBoolean(value.isVpo)
}

export function isRecipientSummaryList(value: unknown): value is RecipientSummary[] {
  return Array.isArray(value) && value.every(isRecipientSummary)
}

export function isRecipientRecord(value: unknown): value is RecipientRecord {
  if (!isRecipientSummary(value) || !isRecord(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.lastName === 'string' && typeof record.firstName === 'string' &&
    isNullableString(record.patronymic) && isNullableString(record.address) && isAddressParts(record.addressParts) &&
    isAddressParts(record.registeredAddressParts) && isNullableString(record.email) && isNullableString(record.bankDetailsId) &&
    isNullableString(record.bankAccount) && isNullableString(record.bankName) && isNullableString(record.bankMfo) &&
    isNullableString(record.bankEdrpou) && isNullableString(record.passport) && typeof record.createdAt === 'string'
}

export function isNullableRecipientRecord(value: unknown): value is RecipientRecord | null {
  return value === null || isRecipientRecord(value)
}

export function isBankDetail(value: unknown): value is BankDetail {
  return isRecord(value) && typeof value.id === 'string' && typeof value.bankId === 'string' &&
    typeof value.mfo === 'string' && typeof value.edrpou === 'string' && typeof value.recipientCount === 'number'
}

export function isBankDetailList(value: unknown): value is BankDetail[] {
  return Array.isArray(value) && value.every(isBankDetail)
}

export function isBankRecord(value: unknown): value is BankRecord {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string' &&
    typeof value.recipientCount === 'number' && typeof value.updatedAt === 'string' && isBankDetailList(value.details)
}

export function isBankRecordList(value: unknown): value is BankRecord[] {
  return Array.isArray(value) && value.every(isBankRecord)
}

export function isNullableBankRecord(value: unknown): value is BankRecord | null {
  return value === null || isBankRecord(value)
}

export function isBankSaveResult(value: unknown): value is BankSaveResult {
  return isRecord(value) && typeof value.ok === 'boolean' && (value.ok
    ? isBankRecord(value.bank)
    : (value.reason === 'validation' || value.reason === 'not-found' || value.reason === 'conflict' || value.reason === 'storage') && typeof value.message === 'string')
}

export function isCatalogSaveResult(value: unknown): value is CatalogSaveResult {
  return isRecord(value) && typeof value.ok === 'boolean' && (value.ok ||
    (value.reason === 'validation' || value.reason === 'not-found' || value.reason === 'conflict' || value.reason === 'storage') && typeof value.message === 'string')
}

export function isCatalogOrderResult(value: unknown): value is CatalogOrderResult {
  return isRecord(value) && typeof value.ok === 'boolean' && (value.ok ||
    (value.reason === 'validation' || value.reason === 'conflict' || value.reason === 'storage') && typeof value.message === 'string')
}

export function isRecipientSaveResult(value: unknown): value is RecipientSaveResult {
  return isRecord(value) && typeof value.ok === 'boolean' && (value.ok
    ? isRecipientRecord(value.recipient)
    : (value.reason === 'name-match' || value.reason === 'rnokpp-match' || value.reason === 'not-found' || value.reason === 'conflict' || value.reason === 'validation' || value.reason === 'storage') &&
      Array.isArray(value.matches) && value.matches.every((match) => isRecord(match) && typeof match.id === 'string' && typeof match.fullName === 'string' && isNullableString(match.rnokpp)) && typeof value.message === 'string')
}
export type CatalogEditInput = { kind: 'program' | 'aidType'; id?: string; expectedUpdatedAt?: string; shortName: string; officialName: string; programId?: string; direction?: string; fundingSource?: string; isActive?: boolean; approvalId?: string | null; approvalNumber?: string; approvalDate?: string; approvalTitle?: string }
export type DecisionInput = { decisionNumber: string; decisionDate: string; title: string }
export type DecisionSummary = { id: string; decisionNumber: string; decisionDate: string; title: string | null; assignmentCount: number; assignedTotalMinor: number; createdAt: string; updatedAt: string }
export type AssignmentRecord = { id: string; createdAt: string; updatedAt: string; recipientId: string; recipientName: string; recipientIsDemo: boolean; recipientSex: 'Жінка' | 'Чоловік' | null; recipientIsVpo: boolean | null; decisionId: string; decisionNumber: string; decisionDate: string; programId: string; programName: string; aidTypeId: string; aidTypeName: string; amountMinor: number; status: AssignmentStatus; paidOn: string | null }
export type AssignmentInput = { recipientId: string; decisionId?: string; decisionNumber: string; decisionDate: string; aidTypeId: string; amountMinor: number; status: AssignmentStatus; paidOn?: string }
export type AssignmentListResult = { assignments: AssignmentRecord[]; years: number[] }
export type AssignmentStatusBatchInput = { assignmentIds: string[]; year: number; status: AssignmentStatus; paidOn?: string }
export type AssignmentStatusBatchResult = | { ok: true; updatedCount: number; unchangedCount: number } | { ok: false; reason: 'validation' | 'not-found' | 'conflict' | 'storage'; message: string }
export type AssignmentChangeResult = { ok: true; assignment: AssignmentRecord } | { ok: false; reason: 'validation' | 'not-found' | 'conflict' | 'storage'; message: string }

const isAssignmentStatus = (value: unknown): value is AssignmentStatus => typeof value === 'string' && (ASSIGNMENT_STATUSES as readonly string[]).includes(value)

export function isAssignmentRecord(value: unknown): value is AssignmentRecord {
  return isRecord(value) && typeof value.id === 'string' && typeof value.createdAt === 'string' && typeof value.updatedAt === 'string' &&
    typeof value.recipientId === 'string' && typeof value.recipientName === 'string' && typeof value.recipientIsDemo === 'boolean' &&
    isSex(value.recipientSex) && isNullableBoolean(value.recipientIsVpo) && typeof value.decisionId === 'string' &&
    typeof value.decisionNumber === 'string' && typeof value.decisionDate === 'string' && typeof value.programId === 'string' &&
    typeof value.programName === 'string' && typeof value.aidTypeId === 'string' && typeof value.aidTypeName === 'string' &&
    typeof value.amountMinor === 'number' && isAssignmentStatus(value.status) && isNullableString(value.paidOn)
}

export function isAssignmentRecordList(value: unknown): value is AssignmentRecord[] {
  return Array.isArray(value) && value.every(isAssignmentRecord)
}

export function isAssignmentListResult(value: unknown): value is AssignmentListResult {
  return isRecord(value) && Array.isArray(value.years) && value.years.every((year) => typeof year === 'number') &&
    isAssignmentRecordList(value.assignments)
}

export function isStatementListResult(value: unknown): value is AssignmentListResult {
  return isAssignmentListResult(value)
}

export function isDecisionSummary(value: unknown): value is DecisionSummary {
  return isRecord(value) && typeof value.id === 'string' && typeof value.decisionNumber === 'string' &&
    typeof value.decisionDate === 'string' && isNullableString(value.title) && typeof value.assignmentCount === 'number' &&
    typeof value.assignedTotalMinor === 'number' && typeof value.createdAt === 'string' && typeof value.updatedAt === 'string'
}

export function isDecisionSummaryList(value: unknown): value is DecisionSummary[] {
  return Array.isArray(value) && value.every(isDecisionSummary)
}

export function isDecisionRecord(value: unknown): value is DecisionRecord {
  return isDecisionSummary(value) && isRecord(value) && isAssignmentRecordList((value as Record<string, unknown>).assignments)
}

export function isNullableDecisionRecord(value: unknown): value is DecisionRecord | null {
  return value === null || isDecisionRecord(value)
}

export function isDecisionSaveResult(value: unknown): value is DecisionSaveResult {
  return isRecord(value) && typeof value.ok === 'boolean' && (value.ok
    ? isDecisionSummary(value.decision)
    : (value.reason === 'validation' || value.reason === 'conflict' || value.reason === 'not-found' || value.reason === 'storage') && typeof value.message === 'string')
}

export function isAssignmentSaveResult(value: unknown): value is AssignmentSaveResult {
  return isRecord(value) && typeof value.ok === 'boolean' && (value.ok
    ? isAssignmentRecordList(value.assignments)
    : (value.reason === 'validation' || value.reason === 'not-found' || value.reason === 'conflict' || value.reason === 'storage') && typeof value.message === 'string')
}

export function isAssignmentChangeResult(value: unknown): value is AssignmentChangeResult {
  return isRecord(value) && typeof value.ok === 'boolean' && (value.ok
    ? isAssignmentRecord(value.assignment)
    : (value.reason === 'validation' || value.reason === 'not-found' || value.reason === 'conflict' || value.reason === 'storage') && typeof value.message === 'string')
}

export function isProgramApproval(value: unknown): value is ProgramApproval {
  return isRecord(value) && typeof value.id === 'string' && typeof value.documentNumber === 'string' &&
    typeof value.documentDate === 'string' && isNullableString(value.title) && typeof value.programCount === 'number' && typeof value.updatedAt === 'string'
}

export function isProgramApprovalSaveResult(value: unknown): value is ProgramApprovalSaveResult {
  return isRecord(value) && typeof value.ok === 'boolean' && (value.ok
    ? isProgramApproval(value.approval)
    : (value.reason === 'validation' || value.reason === 'not-found' || value.reason === 'conflict' || value.reason === 'storage') && typeof value.message === 'string')
}

export function isProgramApprovalList(value: unknown): value is ProgramApproval[] {
  return Array.isArray(value) && value.every(isProgramApproval)
}

export function isAnnualAidPlan(value: unknown): value is AnnualAidPlan {
  return isRecord(value) && typeof value.year === 'number' && typeof value.aidTypeId === 'string' &&
    (typeof value.plannedRecipientCount === 'number' || value.plannedRecipientCount === null) && typeof value.plannedAmountMinor === 'number' && typeof value.updatedAt === 'string'
}

export function isAnnualAidPlanList(value: unknown): value is AnnualAidPlan[] {
  return Array.isArray(value) && value.every(isAnnualAidPlan)
}

export function isAnnualPlanEntry(value: unknown): value is AnnualPlanEntry {
  return isRecord(value) && typeof value.id === 'string' && typeof value.year === 'number' && typeof value.aidTypeId === 'string' &&
    typeof value.aidTypeName === 'string' && typeof value.aidTypeOfficialName === 'string' && typeof value.programName === 'string' &&
    typeof value.programOfficialName === 'string' && typeof value.referenceLabel === 'string' &&
    (typeof value.plannedRecipientCount === 'number' || value.plannedRecipientCount === null) && typeof value.plannedAmountMinor === 'number'
}

export function isAnnualPlanEntryList(value: unknown): value is AnnualPlanEntry[] {
  return Array.isArray(value) && value.every(isAnnualPlanEntry)
}

export function isReportSourceRow(value: unknown): value is ReportSourceRow {
  return isRecord(value) && typeof value.rowNumber === 'number' && typeof value.label === 'string' && isNullableString(value.asOf) &&
    Array.isArray(value.values) && value.values.every((item) => typeof item === 'string' || typeof item === 'number' || item === null) &&
    Array.isArray(value.formulas) && value.formulas.every(isNullableString)
}

export function isReportSourceRowList(value: unknown): value is ReportSourceRow[] {
  return Array.isArray(value) && value.every(isReportSourceRow)
}

export function isReportSummary(value: unknown): value is ReportSummary {
  if (!isRecord(value) || typeof value.year !== 'number' || typeof value.periodLabel !== 'string' || !Array.isArray(value.rows)) return false
  if (value.programs !== undefined && (!Array.isArray(value.programs) || !value.programs.every((program) =>
    isRecord(program) && typeof program.id === 'string' && typeof program.shortName === 'string' && typeof program.officialName === 'string'))) return false
  return value.rows.every((row) => isRecord(row) && (typeof row.programId === 'string' || row.programId === undefined) &&
    (typeof row.plannedRecipientCount === 'number' || row.plannedRecipientCount === undefined) &&
    (typeof row.plannedAmountMinor === 'number' || row.plannedAmountMinor === undefined) && typeof row.aidTypeId === 'string' &&
    typeof row.officialName === 'string' && typeof row.programOfficialName === 'string' && typeof row.assignmentCount === 'number' &&
    typeof row.amountMinor === 'number' && typeof row.paidCount === 'number' && typeof row.paidAmountMinor === 'number')
}

export function isDashboardData(value: unknown): value is DashboardData {
  if (!isRecord(value) || typeof value.year !== 'number' || typeof value.assignmentCount !== 'number' || typeof value.totalMinor !== 'number' ||
    typeof value.paidCount !== 'number' || typeof value.paidTotalMinor !== 'number' || typeof value.demo !== 'boolean' ||
    !Array.isArray(value.monthlyAmountMinor) || !value.monthlyAmountMinor.every((item) => typeof item === 'number') ||
    !Array.isArray(value.monthlyAssignmentCount) || !value.monthlyAssignmentCount.every((item) => typeof item === 'number') ||
    !Array.isArray(value.statusCounts) || !Array.isArray(value.programExecution) || !Array.isArray(value.aidTypeDistribution) || !isRecord(value.paidBySex) || !isRecord(value.paidVpo)) return false
  const paidBySex = value.paidBySex
  const paidVpo = value.paidVpo
  return typeof paidBySex.male === 'number' && typeof paidBySex.female === 'number' && typeof paidBySex.unknown === 'number' &&
    typeof paidVpo.count === 'number' && typeof paidVpo.amountMinor === 'number' &&
    value.statusCounts.every((item) => isRecord(item) && isAssignmentStatus(item.status) && typeof item.count === 'number') &&
    value.programExecution.every((item) => isRecord(item) && (typeof item.programId === 'string' || item.programId === undefined) &&
      typeof item.programName === 'string' && (typeof item.plannedMinor === 'number' || item.plannedMinor === null) &&
      typeof item.amountMinor === 'number' && typeof item.paidMinor === 'number') &&
    value.aidTypeDistribution.every((item) => isRecord(item) && (typeof item.aidTypeId === 'string' || item.aidTypeId === undefined) &&
      (typeof item.programId === 'string' || item.programId === undefined) && typeof item.aidTypeName === 'string' &&
      typeof item.amountMinor === 'number' && typeof item.count === 'number')
}
export type DashboardData = { year: number; assignmentCount: number; totalMinor: number; paidCount: number; paidTotalMinor: number; monthlyAmountMinor: number[]; monthlyAssignmentCount: number[]; statusCounts: { status: AssignmentStatus; count: number }[]; paidBySex: { male: number; female: number; unknown: number }; paidVpo: { count: number; amountMinor: number }; programExecution: { programId?: string; programName: string; plannedMinor: number | null; amountMinor: number; paidMinor: number }[]; aidTypeDistribution: { aidTypeId?: string; programId?: string; aidTypeName: string; amountMinor: number; count: number }[]; demo: boolean }
export type ReportSheet = 'ПЛАН' | 'ФАКТ (МІСЯЦЬ)' | 'ФАКТ (КВАРТАЛ)' | 'ПЛАН-ФАКТ (РІК)'
export type ReportSourceRow = { rowNumber: number; label: string; values: (string | number | null)[]; formulas: (string | null)[]; asOf: string | null }
export type ReportPeriod = { kind: 'year-to-date'; endDate: string } | { kind: 'annual' } | { kind: 'year-to-month'; value: number } | { kind: 'month'; value: number } | { kind: 'quarter'; value: number }
export type AnnualAidPlan = { year: number; aidTypeId: string; plannedRecipientCount: number | null; plannedAmountMinor: number; updatedAt: string }
export type AnnualAidPlanInput = { year: number; aidTypeId: string; plannedRecipientCount: number; plannedAmountMinor: number }
export type AnnualPlanEntry = { id: string; year: number; aidTypeId: string; aidTypeName: string; aidTypeOfficialName: string; programName: string; programOfficialName: string; referenceLabel: string; plannedRecipientCount: number | null; plannedAmountMinor: number }
export type AnnualPlanInput = { year: number; aidTypeId: string; referenceLabel: string; plannedRecipientCount: number | null; plannedAmountMinor: number; updatedAt: string }
export type ReportSummaryRow = { programId?: string; plannedRecipientCount?: number; plannedAmountMinor?: number; aidTypeId: string; officialName: string; programOfficialName: string; assignmentCount: number; amountMinor: number; paidCount: number; paidAmountMinor: number }
export type ReportSummary = { programs?: { id: string; shortName: string; officialName: string }[]; year: number; periodLabel: string; rows: ReportSummaryRow[] }
export type ReportExportSnapshot = { kind: ReportPdfKind; period: ReportPeriod; periodRange: string; summary: ReportSummary }
export type PreparedReport = { id: string; pdfBase64: string; title: string; periodRange: string }
export type ReportExportResult = { ok: boolean; canceled?: boolean; message?: string }
export type DecisionRecord = DecisionSummary & { assignments: AssignmentRecord[] }
export type AssignmentDraft = { recipientId: string; aidTypeId: string; amountMinor: number; status: AssignmentStatus; paidOn?: string }
export type DecisionSaveResult = | { ok: true; decision: DecisionSummary } | { ok: false; reason: 'validation' | 'conflict' | 'not-found' | 'storage'; message: string }
export type AssignmentSaveResult = | { ok: true; assignments: AssignmentRecord[] } | { ok: false; reason: 'validation' | 'not-found' | 'conflict' | 'storage'; message: string }
export type DeleteEntity = 'assignment' | 'recipient' | 'decision' | 'program' | 'aidType'
export type DeletePreview = { entity: DeleteEntity; id: string; name: string; dependencies: { label: string; count: number }[]; confirmationToken: string }
export type StatementKind = 'personal' | 'summary'
export type StatementParameters = { aidTypeId: string; partIndex: number; documentNumber: string; documentDate: string; periodStart: string; periodEnd: string }
export type GeneratedStatement = { id: string; fileName: string; aidTypeName: string; recordCount: number; totalMinor: number; pdfBase64: string; documentNumber: string; documentDate: string }
export type GeneratedBankStatement = { id: string; fileName: string; recordCount: number; totalMinor: number }
export type ManagedUser = { id: string; username: string; displayName: string | null; firstName: string | null; lastName: string | null; roles: UserRole[]; status: 'active' | 'inactive' | 'blocked'; mustChangePassword: boolean; createdAt: string; updatedAt: string }
export type ManagedUserInput = { username: string; firstName: string | null; lastName: string | null; roles: UserRole[]; password?: string }
export type ManagedUserSaveResult = { ok: true; user: ManagedUser } | { ok: false; reason: 'validation' | 'conflict' | 'not-found'; message: string }
export type ManagedUserRemoveResult = { ok: true } | { ok: false; reason: 'conflict' | 'not-found'; message: string }

export type ServerConnectionState = {
  mode: 'local' | 'remote'
  apiUrl: string | null
  active: boolean
  source: 'environment' | 'saved' | 'none' | 'invalid'
  editable: boolean
  lockedReason?: string
  status: 'unknown' | 'checking' | 'available' | 'unavailable'
  message?: string
}
export type ServerConnectionCheckResult = { ok: true; apiUrl: string; message: string } | { ok: false; apiUrl?: string; message: string }
export type ServerConnectionSaveResult = { ok: true; state: ServerConnectionState; message?: string } | { ok: false; state: ServerConnectionState; message: string }

export type HromadaAidApi = {
  appName: string; platform: string
  appInfo: { getVersion: () => Promise<string> }
  auth: {
    getState: () => Promise<ClientAuthState>
    login: (username: string, password: string) => Promise<AuthActionResult>
    logout: () => Promise<AuthActionResult>
    changePassword: (currentPassword: string, newPassword: string) => Promise<AuthActionResult>
    onStateChange: (listener: (state: ClientAuthState) => void) => () => void
  }
  connection: {
    getState: () => Promise<ServerConnectionState>
    check: (apiUrl: string) => Promise<ServerConnectionCheckResult>
    save: (apiUrl: string) => Promise<ServerConnectionSaveResult>
    onStateChange: (listener: (state: ServerConnectionState) => void) => () => void
  }
  users: {
    list: () => Promise<ManagedUser[]>
    get: (id: string) => Promise<ManagedUser | null>
    create: (input: ManagedUserInput) => Promise<ManagedUserSaveResult>
    update: (id: string, input: ManagedUserInput, expectedUpdatedAt: string) => Promise<ManagedUserSaveResult>
    setStatus: (id: string, status: 'active' | 'inactive' | 'blocked', expectedUpdatedAt: string) => Promise<ManagedUserSaveResult>
    resetPassword: (id: string, newPassword: string, expectedUpdatedAt: string) => Promise<ManagedUserSaveResult>
    remove: (id: string, expectedUpdatedAt: string) => Promise<ManagedUserRemoveResult>
  }
  recipients: { list: (includeArchived?: boolean) => Promise<RecipientSummary[]>; get: (id: string) => Promise<RecipientRecord | null>; save: (input: RecipientInput, id?: string, confirmSameName?: boolean, expectedUpdatedAt?: string) => Promise<RecipientSaveResult>; assignmentHistory: (id: string) => Promise<AssignmentRecord[]> }
  banks: { list: (query?: string) => Promise<BankRecord[]>; get: (id: string) => Promise<BankRecord | null>; details: (bankId: string) => Promise<BankDetail[]>; save: (input: BankInput, id?: string, expectedUpdatedAt?: string) => Promise<BankSaveResult>; remove: (id: string, expectedUpdatedAt?: string) => Promise<{ ok: boolean; message?: string }> }
  catalogs: { list: (includeInactive?: boolean) => Promise<CatalogList>; save: (input: CatalogEditInput) => Promise<CatalogSaveResult>; reorder: (input: CatalogOrderInput) => Promise<CatalogOrderResult> }
  programApprovals: { list: () => Promise<ProgramApproval[]>; save: (input: ProgramApprovalInput, id?: string, expectedUpdatedAt?: string) => Promise<ProgramApprovalSaveResult> }
  decisions: { list: () => Promise<DecisionSummary[]>; get: (id: string) => Promise<DecisionRecord | null>; save: (input: DecisionInput, id?: string, expectedUpdatedAt?: string) => Promise<DecisionSaveResult>; addAssignments: (decisionId: string, assignments: AssignmentDraft[], requestId: string) => Promise<AssignmentSaveResult> }
  assignments: { list: (year: number) => Promise<AssignmentListResult>; save: (input: AssignmentInput, id?: string, expectedUpdatedAt?: string, requestId?: string) => Promise<AssignmentChangeResult>; changeStatuses: (input: AssignmentStatusBatchInput, requestId?: string) => Promise<AssignmentStatusBatchResult> }
  dashboard: { get: (year: number) => Promise<DashboardData> }
  reports: { get: (sheet: ReportSheet) => Promise<ReportSourceRow[]>; summary: (year: number, period: ReportPeriod) => Promise<ReportSummary>; annualPlanList: (year: number) => Promise<AnnualAidPlan[]>; annualPlanSave: (input: AnnualAidPlanInput, expectedUpdatedAt?: string) => Promise<{ ok: boolean; message?: string }>; generate: (snapshot: ReportExportSnapshot) => Promise<{ ok: true; document: PreparedReport } | { ok: false; message: string }>; savePdf: (documentId: string) => Promise<ReportExportResult>; saveExcel: (documentId: string) => Promise<ReportExportResult>; release: (documentId: string) => Promise<void>; planList: (year: number) => Promise<AnnualPlanEntry[]>; planSave: (input: AnnualPlanInput, id?: string) => Promise<{ ok: boolean; message?: string }>; planRemove: (id: string) => Promise<{ ok: boolean; message?: string }> }
  deletion: { preview: (entity: DeleteEntity, id: string) => Promise<DeletePreview | null>; execute: (entity: DeleteEntity, id: string, confirmationToken?: string) => Promise<{ ok: boolean; message?: string }> }
  statements: { list: (year: number) => Promise<AssignmentListResult>; generate: (kind: StatementKind, assignmentIds: string[], year: number, parameters: StatementParameters[]) => Promise<{ ok: true; documents: GeneratedStatement[] } | { ok: false; message: string }>; generateBank: (assignmentIds: string[], year: number) => Promise<{ ok: true; document: GeneratedBankStatement } | { ok: false; message: string }>; save: (documentId: string) => Promise<{ ok: boolean; message?: string }>; savePdf: (documentId: string) => Promise<{ ok: boolean; message?: string }> }
}
