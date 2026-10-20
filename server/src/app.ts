import Fastify, { type FastifyInstance } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import type { HealthResponse } from '../../shared/api-contract.js'

export function createApp(database: DatabaseSync): FastifyInstance {
  const app = Fastify({ logger: true })

  app.get('/health', async (): Promise<HealthResponse> => {
    database.prepare('SELECT 1 AS ready').get()
    return { status: 'ok', service: 'hromada-aid-api' }
  })

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error)
    return reply.status(500).send({ status: 'error', message: 'Внутрішня помилка сервера.' })
  })

  return app
}
