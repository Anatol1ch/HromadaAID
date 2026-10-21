import Fastify, { type FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import { bankDetails, getBank, listBanks } from '../../electron/bank-store.js'
import { getDecision, listAssignments, listDecisions, listRecipientAssignmentHistory } from '../../electron/assignment-data.js'
import { listCatalogs } from '../../electron/catalog-data.js'
import { getRecipient, listRecipients } from '../../electron/recipient-data.js'
import type { AssignmentListResult, AssignmentRecord, BankDetail, BankRecord, CatalogList, DecisionRecord, DecisionSummary, HealthResponse, RecipientRecord, RecipientSummary } from '../../shared/api-contract.js'

export function createApp(database: DatabaseSync): FastifyInstance {
  const app = Fastify({ logger: true })

  app.get('/health', async (): Promise<HealthResponse> => {
    database.prepare('SELECT 1 AS ready').get()
    return { status: 'ok', service: 'hromada-aid-api' }
  })

  app.get<{ Querystring: { includeInactive?: string } }>('/api/catalogs', async (request): Promise<CatalogList> =>
    listCatalogs(database, request.query.includeInactive === 'true'))

  app.get('/api/recipients', async (): Promise<RecipientSummary[]> => listRecipients(database))

  app.get<{ Params: { id: string } }>('/api/recipients/:id', async (request): Promise<RecipientRecord | null> =>
    getRecipient(database, request.params.id))

  app.get<{ Params: { id: string } }>('/api/recipients/:id/assignment-history', async (request): Promise<AssignmentRecord[]> =>
    listRecipientAssignmentHistory(database, request.params.id))

  app.get<{ Querystring: { query?: string } }>('/api/banks', async (request): Promise<BankRecord[]> =>
    listBanks(database, request.query.query ?? ''))

  app.get<{ Params: { id: string } }>('/api/banks/:id', async (request): Promise<BankRecord | null> =>
    getBank(database, request.params.id))

  app.get<{ Params: { id: string } }>('/api/banks/:id/details', async (request): Promise<BankDetail[]> =>
    bankDetails(database, request.params.id))

  app.get('/api/decisions', async (): Promise<DecisionSummary[]> => listDecisions(database))

  app.get<{ Params: { id: string } }>('/api/decisions/:id', async (request): Promise<DecisionRecord | null> =>
    getDecision(database, request.params.id))

  app.get<{ Querystring: { year?: string } }>('/api/assignments', async (request): Promise<AssignmentListResult> =>
    listAssignments(database, request.query.year === undefined ? undefined : Number(request.query.year)))

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error)
    return reply.status(500).send({ status: 'error', message: 'Внутрішня помилка сервера.' })
  })

  return app
}
