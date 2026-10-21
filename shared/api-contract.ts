import type { AddressParts } from './address.js'
import type { AssignmentStatus } from './assignment-model.js'
export type { AssignmentStatus } from './assignment-model.js'

export type ReportPdfKind = 'month' | 'quarter' | 'annual' | 'cumulative'
export type HealthResponse = { status: 'ok'; service: 'hromada-aid-api' }
export type BankDetailInput = { id?: string; mfo: string; edrpou: string }
export type BankInput = { name: string; details: BankDetailInput[] }
export type BankDetail = { id: string; bankId: string; mfo: string; edrpou: string; recipientCount: number }
export type BankRecord = { id: string; name: string; details: BankDetail[]; recipientCount: number }
export type BankSaveResult = { ok: true; bank: BankRecord } | { ok: false; message: string }
export type RecipientInput = { lastName: string; firstName: string; patronymic: string; rnokpp: string; sex: '' | 'Жінка' | 'Чоловік'; address: string; registeredAddress: string; addressParts: AddressParts | null; registeredAddressParts: AddressParts | null; phone: string; email: string; bankAccount: string; bankDetailsId: string; passport: string; isVpo: boolean | null }
export type RecipientSummary = { id: string; fullName: string; rnokpp: string | null; phone: string | null; registeredAddress: string | null; sex: 'Жінка' | 'Чоловік' | null; updatedAt: string; isDemo: boolean; isVpo: boolean | null }
export type RecipientRecord = RecipientSummary & { lastName: string; firstName: string; patronymic: string | null; sex: 'Жінка' | 'Чоловік' | null; isVpo: boolean | null; address: string | null; addressParts: AddressParts | null; registeredAddressParts: AddressParts | null; email: string | null; bankDetailsId: string | null; bankAccount: string | null; bankName: string | null; bankMfo: string | null; bankEdrpou: string | null; passport: string | null; createdAt: string }
export type DuplicateMatch = { id: string; fullName: string; rnokpp: string | null }
export type RecipientSaveResult = | { ok: true; recipient: RecipientRecord } | { ok: false; reason: 'name-match' | 'rnokpp-match' | 'not-found' | 'validation' | 'storage'; matches: DuplicateMatch[]; message: string }

export type ProgramApproval = { id: string; documentNumber: string; documentDate: string; title: string | null; programCount: number }
export type ProgramApprovalInput = { documentNumber: string; documentDate: string; title: string }
export type CatalogOrderInput = { kind: 'program' | 'aidType'; ids: string[]; programId?: string }
export type ProgramOption = { id: string; shortName: string; officialName: string; isActive: boolean; approvalId: string | null; approvalNumber: string | null; approvalDate: string | null; approvalTitle: string | null; assignmentCount: number }
export type AidTypeOption = { id: string; code: string; programId: string; shortName: string; officialName: string; direction: string | null; fundingSource: string | null; isActive: boolean; assignmentCount: number }
export type CatalogList = { programs: ProgramOption[]; aidTypes: AidTypeOption[] }

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const isNullableString = (value: unknown): value is string | null => typeof value === 'string' || value === null

export function isCatalogList(value: unknown): value is CatalogList {
  if (!isRecord(value) || !Array.isArray(value.programs) || !Array.isArray(value.aidTypes)) return false
  return value.programs.every((item) => isRecord(item) && typeof item.id === 'string' && typeof item.shortName === 'string' &&
    typeof item.officialName === 'string' && typeof item.isActive === 'boolean' && isNullableString(item.approvalId) &&
    isNullableString(item.approvalNumber) && isNullableString(item.approvalDate) && isNullableString(item.approvalTitle) &&
    typeof item.assignmentCount === 'number') &&
    value.aidTypes.every((item) => isRecord(item) && typeof item.id === 'string' && typeof item.code === 'string' &&
      typeof item.programId === 'string' && typeof item.shortName === 'string' && typeof item.officialName === 'string' &&
      isNullableString(item.direction) && isNullableString(item.fundingSource) && typeof item.isActive === 'boolean' &&
      typeof item.assignmentCount === 'number')
}
export type CatalogEditInput = { kind: 'program' | 'aidType'; id?: string; shortName: string; officialName: string; programId?: string; direction?: string; fundingSource?: string; isActive?: boolean; approvalId?: string | null; approvalNumber?: string; approvalDate?: string; approvalTitle?: string }
export type DecisionInput = { decisionNumber: string; decisionDate: string; title: string }
export type DecisionSummary = { id: string; decisionNumber: string; decisionDate: string; title: string | null; assignmentCount: number; assignedTotalMinor: number; createdAt: string; updatedAt: string }
export type AssignmentRecord = { id: string; createdAt: string; recipientId: string; recipientName: string; recipientIsDemo: boolean; recipientSex: 'Жінка' | 'Чоловік' | null; recipientIsVpo: boolean | null; decisionId: string; decisionNumber: string; decisionDate: string; programId: string; programName: string; aidTypeId: string; aidTypeName: string; amountMinor: number; status: AssignmentStatus; paidOn: string | null }
export type AssignmentInput = { recipientId: string; decisionId?: string; decisionNumber: string; decisionDate: string; aidTypeId: string; amountMinor: number; status: AssignmentStatus; paidOn?: string }
export type AssignmentListResult = { assignments: AssignmentRecord[]; years: number[] }
export type AssignmentStatusBatchInput = { assignmentIds: string[]; year: number; status: AssignmentStatus; paidOn?: string }
export type AssignmentStatusBatchResult = | { ok: true; updatedCount: number; unchangedCount: number } | { ok: false; reason: 'validation' | 'not-found' | 'conflict' | 'storage'; message: string }
export type AssignmentChangeResult = { ok: true; assignment: AssignmentRecord } | { ok: false; reason: 'validation' | 'not-found' | 'conflict' | 'storage'; message: string }
export type DashboardData = { year: number; assignmentCount: number; totalMinor: number; paidCount: number; paidTotalMinor: number; monthlyAmountMinor: number[]; monthlyAssignmentCount: number[]; statusCounts: { status: AssignmentStatus; count: number }[]; paidBySex: { male: number; female: number; unknown: number }; paidVpo: { count: number; amountMinor: number }; programExecution: { programId?: string; programName: string; plannedMinor: number | null; amountMinor: number; paidMinor: number }[]; aidTypeDistribution: { aidTypeId?: string; programId?: string; aidTypeName: string; amountMinor: number; count: number }[]; demo: boolean }
export type ReportSheet = 'ПЛАН' | 'ФАКТ (МІСЯЦЬ)' | 'ФАКТ (КВАРТАЛ)' | 'ПЛАН-ФАКТ (РІК)'
export type ReportSourceRow = { rowNumber: number; label: string; values: (string | number | null)[]; formulas: (string | null)[]; asOf: string | null }
export type ReportPeriod = { kind: 'year-to-date'; endDate: string } | { kind: 'annual' } | { kind: 'year-to-month'; value: number } | { kind: 'month'; value: number } | { kind: 'quarter'; value: number }
export type AnnualAidPlan = { year: number; aidTypeId: string; plannedRecipientCount: number | null; plannedAmountMinor: number }
export type AnnualAidPlanInput = { year: number; aidTypeId: string; plannedRecipientCount: number; plannedAmountMinor: number }
export type AnnualPlanEntry = { id: string; year: number; aidTypeId: string; aidTypeName: string; aidTypeOfficialName: string; programName: string; programOfficialName: string; referenceLabel: string; plannedRecipientCount: number | null; plannedAmountMinor: number }
export type AnnualPlanInput = { year: number; aidTypeId: string; referenceLabel: string; plannedRecipientCount: number | null; plannedAmountMinor: number }
export type ReportSummaryRow = { programId?: string; plannedRecipientCount?: number; plannedAmountMinor?: number; aidTypeId: string; officialName: string; programOfficialName: string; assignmentCount: number; amountMinor: number; paidCount: number; paidAmountMinor: number }
export type ReportSummary = { programs?: { id: string; shortName: string; officialName: string }[]; year: number; periodLabel: string; rows: ReportSummaryRow[] }
export type ReportExportSnapshot = { kind: ReportPdfKind; period: ReportPeriod; periodRange: string; summary: ReportSummary }
export type PreparedReport = { id: string; pdfBase64: string; title: string; periodRange: string }
export type ReportExportResult = { ok: boolean; canceled?: boolean; message?: string }
export type DecisionRecord = DecisionSummary & { assignments: AssignmentRecord[] }
export type AssignmentDraft = { recipientId: string; aidTypeId: string; amountMinor: number; status: AssignmentStatus; paidOn?: string }
export type DecisionSaveResult = | { ok: true; decision: DecisionSummary } | { ok: false; reason: 'validation' | 'conflict' | 'not-found' | 'storage'; message: string }
export type AssignmentSaveResult = | { ok: true; assignments: AssignmentRecord[] } | { ok: false; reason: 'validation' | 'not-found' | 'storage'; message: string }
export type DeleteEntity = 'assignment' | 'recipient' | 'decision' | 'program' | 'aidType'
export type DeletePreview = { entity: DeleteEntity; id: string; name: string; dependencies: { label: string; count: number }[] }
export type StatementKind = 'personal' | 'summary'
export type StatementParameters = { aidTypeId: string; partIndex: number; documentNumber: string; documentDate: string; periodStart: string; periodEnd: string }
export type GeneratedStatement = { id: string; fileName: string; aidTypeName: string; recordCount: number; totalMinor: number; pdfBase64: string; documentNumber: string; documentDate: string }
export type GeneratedBankStatement = { id: string; fileName: string; recordCount: number; totalMinor: number }

export type HromadaAidApi = {
  appName: string; platform: string
  recipients: { list: (includeArchived?: boolean) => Promise<RecipientSummary[]>; get: (id: string) => Promise<RecipientRecord | null>; save: (input: RecipientInput, id?: string, confirmSameName?: boolean) => Promise<RecipientSaveResult>; assignmentHistory: (id: string) => Promise<AssignmentRecord[]> }
  banks: { list: (query?: string) => Promise<BankRecord[]>; get: (id: string) => Promise<BankRecord | null>; details: (bankId: string) => Promise<BankDetail[]>; save: (input: BankInput, id?: string) => Promise<BankSaveResult>; remove: (id: string) => Promise<{ ok: boolean; message?: string }> }
  catalogs: { list: (includeInactive?: boolean) => Promise<CatalogList>; save: (input: CatalogEditInput) => Promise<{ ok: boolean; message?: string }>; reorder: (input: CatalogOrderInput) => Promise<{ ok: boolean; message?: string }> }
  programApprovals: { list: () => Promise<ProgramApproval[]>; save: (input: ProgramApprovalInput, id?: string) => Promise<{ ok: boolean; approval?: ProgramApproval; message?: string }> }
  decisions: { list: () => Promise<DecisionSummary[]>; get: (id: string) => Promise<DecisionRecord | null>; save: (input: DecisionInput, id?: string) => Promise<DecisionSaveResult>; addAssignments: (decisionId: string, assignments: AssignmentDraft[]) => Promise<AssignmentSaveResult> }
  assignments: { list: (year: number) => Promise<AssignmentListResult>; save: (input: AssignmentInput, id?: string) => Promise<AssignmentChangeResult>; changeStatuses: (input: AssignmentStatusBatchInput) => Promise<AssignmentStatusBatchResult> }
  dashboard: { get: (year: number) => Promise<DashboardData> }
  reports: { get: (sheet: ReportSheet) => Promise<ReportSourceRow[]>; summary: (year: number, period: ReportPeriod) => Promise<ReportSummary>; annualPlanList: (year: number) => Promise<AnnualAidPlan[]>; annualPlanSave: (input: AnnualAidPlanInput) => Promise<{ ok: boolean; message?: string }>; generate: (snapshot: ReportExportSnapshot) => Promise<{ ok: true; document: PreparedReport } | { ok: false; message: string }>; savePdf: (documentId: string) => Promise<ReportExportResult>; saveExcel: (documentId: string) => Promise<ReportExportResult>; release: (documentId: string) => Promise<void>; planList: (year: number) => Promise<AnnualPlanEntry[]>; planSave: (input: AnnualPlanInput, id?: string) => Promise<{ ok: boolean; message?: string }>; planRemove: (id: string) => Promise<{ ok: boolean; message?: string }> }
  deletion: { preview: (entity: DeleteEntity, id: string) => Promise<DeletePreview | null>; execute: (entity: DeleteEntity, id: string) => Promise<{ ok: boolean; message?: string }> }
  statements: { list: (year: number) => Promise<AssignmentListResult>; generate: (kind: StatementKind, assignmentIds: string[], year: number, parameters: StatementParameters[]) => Promise<{ ok: true; documents: GeneratedStatement[] } | { ok: false; message: string }>; generateBank: (assignmentIds: string[], year: number) => Promise<{ ok: true; document: GeneratedBankStatement } | { ok: false; message: string }>; save: (documentId: string) => Promise<{ ok: boolean; message?: string }>; savePdf: (documentId: string) => Promise<{ ok: boolean; message?: string }> }
}
