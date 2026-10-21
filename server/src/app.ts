import Fastify, { type FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import { bankDetails, getBank, listBanks, saveBank } from '../../electron/bank-store.js'
import { getDecision, listAssignments, listDecisions, listRecipientAssignmentHistory } from '../../electron/assignment-data.js'
import { resolveAccountingYear } from '../../electron/accounting-year.js'
import { listCatalogs } from '../../electron/catalog-data.js'
import { reorderCatalog } from '../../electron/catalog-order.js'
import { saveCatalog } from '../../electron/catalog-store.js'
import { dashboardSummary, reportSummary } from '../../electron/financial-summary.js'
import { getRecipient, listRecipients } from '../../electron/recipient-data.js'
import { saveRecipient } from '../../electron/recipient-store.js'
import { listAnnualPlans } from '../../electron/annual-plans.js'
import { listAnnualPlanEntries, listProgramApprovals, listReportSourceRows } from '../../electron/report-read-data.js'
import { saveProgramApproval } from '../../electron/program-approval-store.js'
import { addDecisionAssignments, saveDecision } from '../../electron/decision-store.js'
import { listStatementAssignments } from '../../electron/statement-list-data.js'
import type { AnnualAidPlan, AnnualPlanEntry, AssignmentListResult, AssignmentRecord, BankDetail, BankRecord, BankSaveResult, CatalogList, DashboardData, DecisionRecord, DecisionSummary, HealthResponse, ProgramApproval, RecipientRecord, RecipientSaveResult, RecipientSummary, ReportPeriod, ReportSourceRow, ReportSummary } from '../../shared/api-contract.js'

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const saveStatus = (result: { ok: boolean; reason?: string }) => result.ok ? 200 : result.reason === 'conflict' ? 409 : result.reason === 'storage' ? 500 : 400

function readJsonQuery(value: string | undefined): unknown {
  if (value === undefined) return undefined
  try { return JSON.parse(value) }
  catch { return undefined }
}

export function createApp(database: DatabaseSync): FastifyInstance {
  const app = Fastify({ logger: true })

  app.get('/health', async (): Promise<HealthResponse> => {
    database.prepare('SELECT 1 AS ready').get()
    return { status: 'ok', service: 'hromada-aid-api' }
  })

  app.get<{ Querystring: { includeInactive?: string } }>('/api/catalogs', async (request): Promise<CatalogList> =>
    listCatalogs(database, request.query.includeInactive === 'true'))
  app.post<{ Body: unknown }>('/api/catalogs/save', async (request, reply) => {
    const result = isRecord(request.body) && 'input' in request.body ? saveCatalog(database, request.body.input) : { ok: false as const, reason: 'validation' as const, message: 'Некоректні дані довідника.' }
    return reply.status(saveStatus(result)).send(result)
  })
  app.post<{ Body: unknown }>('/api/catalogs/reorder', async (request, reply) => {
    const result = isRecord(request.body) && 'input' in request.body ? reorderCatalog(database, request.body.input) : { ok: false as const, reason: 'validation' as const, message: 'Некоректний порядок довідника.' }
    return reply.status(saveStatus(result)).send(result)
  })

  app.get('/api/recipients', async (): Promise<RecipientSummary[]> => listRecipients(database))

  app.get<{ Params: { id: string } }>('/api/recipients/:id', async (request): Promise<RecipientRecord | null> =>
    getRecipient(database, request.params.id))

  app.get<{ Params: { id: string } }>('/api/recipients/:id/assignment-history', async (request): Promise<AssignmentRecord[]> =>
    listRecipientAssignmentHistory(database, request.params.id))

  app.post<{ Body: unknown }>('/api/recipients', async (request, reply) => {
    if (!isRecord(request.body) || !('input' in request.body)) return reply.status(400).send({ message: 'Некоректні дані картки отримувача.' })
    const result = saveRecipient(database, request.body.input)
    return reply.status(saveStatus(result)).send(result satisfies RecipientSaveResult)
  })

  app.put<{ Params: { id: string; }; Body: unknown }>('/api/recipients/:id', async (request, reply) => {
    if (!isRecord(request.body) || !('input' in request.body) || typeof request.body.expectedUpdatedAt !== 'string' || !request.body.expectedUpdatedAt) {
      return reply.status(400).send({ message: 'Для редагування потрібна початкова версія картки отримувача.' })
    }
    const result = saveRecipient(database, request.body.input, request.params.id, request.body.confirmSameName, request.body.expectedUpdatedAt)
    return reply.status(saveStatus(result)).send(result satisfies RecipientSaveResult)
  })

  app.get<{ Querystring: { query?: string } }>('/api/banks', async (request): Promise<BankRecord[]> =>
    listBanks(database, request.query.query ?? ''))

  app.get<{ Params: { id: string } }>('/api/banks/:id', async (request): Promise<BankRecord | null> =>
    getBank(database, request.params.id))

  app.get<{ Params: { id: string } }>('/api/banks/:id/details', async (request): Promise<BankDetail[]> =>
    bankDetails(database, request.params.id))

  app.post<{ Body: unknown }>('/api/banks', async (request, reply) => {
    if (!isRecord(request.body) || !('input' in request.body)) return reply.status(400).send({ message: 'Некоректні дані банку.' })
    const result = saveBank(database, request.body.input)
    return reply.status(saveStatus(result)).send(result satisfies BankSaveResult)
  })

  app.put<{ Params: { id: string }; Body: unknown }>('/api/banks/:id', async (request, reply) => {
    if (!isRecord(request.body) || !('input' in request.body) || typeof request.body.expectedUpdatedAt !== 'string' || !request.body.expectedUpdatedAt) {
      return reply.status(400).send({ message: 'Для редагування потрібна початкова версія картки банку.' })
    }
    const result = saveBank(database, request.body.input, request.params.id, request.body.expectedUpdatedAt)
    return reply.status(saveStatus(result)).send(result satisfies BankSaveResult)
  })

  app.get('/api/decisions', async (): Promise<DecisionSummary[]> => listDecisions(database))

  app.get<{ Params: { id: string } }>('/api/decisions/:id', async (request): Promise<DecisionRecord | null> =>
    getDecision(database, request.params.id))

  app.post<{ Body: unknown }>('/api/decisions', async (request, reply) => {
    const result = isRecord(request.body) && 'input' in request.body
      ? saveDecision(database, request.body.input)
      : { ok: false as const, reason: 'validation' as const, message: 'Некоректні дані рішення.' }
    return reply.status(saveStatus(result)).send(result)
  })

  app.put<{ Params: { id: string }; Body: unknown }>('/api/decisions/:id', async (request, reply) => {
    const result = isRecord(request.body) && 'input' in request.body && typeof request.body.expectedUpdatedAt === 'string' && request.body.expectedUpdatedAt
      ? saveDecision(database, request.body.input, request.params.id, request.body.expectedUpdatedAt)
      : { ok: false as const, reason: 'validation' as const, message: 'Для редагування потрібна початкова версія рішення.' }
    return reply.status(saveStatus(result)).send(result)
  })

  app.post<{ Params: { id: string }; Body: unknown }>('/api/decisions/:id/assignments', async (request, reply) => {
    const result = isRecord(request.body) && Array.isArray(request.body.assignments) && typeof request.body.requestId === 'string'
      ? addDecisionAssignments(database, request.params.id, request.body.assignments, request.body.requestId)
      : { ok: false as const, reason: 'validation' as const, message: 'Некоректний пакет призначень.' }
    return reply.status(saveStatus(result)).send(result)
  })

  app.get<{ Querystring: { year?: string } }>('/api/assignments', async (request): Promise<AssignmentListResult> =>
    listAssignments(database, request.query.year === undefined ? undefined : Number(request.query.year)))

  app.get<{ Querystring: { year?: string } }>('/api/statements', async (request): Promise<AssignmentListResult> =>
    listStatementAssignments(database, request.query.year === undefined ? undefined : Number(request.query.year)))

  app.get('/api/program-approvals', async (): Promise<ProgramApproval[]> => listProgramApprovals(database))
  app.post<{ Body: unknown }>('/api/program-approvals', async (request, reply) => {
    const result = isRecord(request.body) && 'input' in request.body ? saveProgramApproval(database, request.body.input) : { ok: false as const, reason: 'validation' as const, message: 'Некоректні реквізити рішення.' }
    return reply.status(saveStatus(result)).send(result)
  })
  app.put<{ Params: { id: string }; Body: unknown }>('/api/program-approvals/:id', async (request, reply) => {
    const result = isRecord(request.body) && 'input' in request.body && typeof request.body.expectedUpdatedAt === 'string' && request.body.expectedUpdatedAt
      ? saveProgramApproval(database, request.body.input, request.params.id, request.body.expectedUpdatedAt)
      : { ok: false as const, reason: 'validation' as const, message: 'Для редагування потрібна початкова версія рішення.' }
    return reply.status(saveStatus(result)).send(result)
  })

  app.get<{ Querystring: { year?: string } }>('/api/dashboard', async (request): Promise<DashboardData> =>
    dashboardSummary(database, request.query.year === undefined ? undefined : Number(request.query.year)))

  app.get<{ Querystring: { sheet?: string } }>('/api/reports/source-rows', async (request): Promise<ReportSourceRow[]> =>
    listReportSourceRows(database, request.query.sheet))

  app.get<{ Querystring: { year?: string; period?: string } }>('/api/reports/summary', async (request): Promise<ReportSummary> =>
    reportSummary(database, request.query.year === undefined ? undefined : Number(request.query.year), readJsonQuery(request.query.period) as ReportPeriod))

  app.get<{ Querystring: { year?: string } }>('/api/reports/annual-plans', async (request): Promise<AnnualAidPlan[]> =>
    listAnnualPlans(database, resolveAccountingYear(request.query.year === undefined ? undefined : Number(request.query.year))))

  app.get<{ Querystring: { year?: string } }>('/api/reports/plan-entries', async (request): Promise<AnnualPlanEntry[]> =>
    listAnnualPlanEntries(database, request.query.year === undefined ? undefined : Number(request.query.year)))

  app.setErrorHandler((error, _request, reply) => {
    const details = error as { statusCode?: unknown; code?: unknown }
    const status = typeof details.statusCode === 'number' && details.statusCode >= 400 && details.statusCode < 500 ? details.statusCode : 500
    if (status >= 500) app.log.error(error)
    else app.log.warn({ status, code: details.code }, 'Некоректний HTTP-запит')
    return reply.status(status).send({ status: 'error', message: status === 500 ? 'Внутрішня помилка сервера.' : 'Некоректний запит до сервера.' })
  })

  return app
}
