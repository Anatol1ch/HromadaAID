import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import type { Permission } from '../../shared/authorization.js'
import type { AuthenticatedSession } from './auth.js'
import { requireAuthenticated, requirePermission } from './auth-http.js'

type ApiMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

export type ApiRoutePolicy = {
  method: ApiMethod
  url: string
  permissions: readonly Permission[]
}

/**
 * This is the complete allow-list for business API routes. It is deliberately
 * separate from handlers so a newly registered `/api/*` route cannot become
 * public by omission.
 */
export const API_ROUTE_POLICIES: readonly ApiRoutePolicy[] = [
  { method: 'GET', url: '/api/catalogs', permissions: ['catalogs.read'] },
  { method: 'POST', url: '/api/catalogs/save', permissions: ['catalogs.manage'] },
  { method: 'POST', url: '/api/catalogs/reorder', permissions: ['catalogs.manage'] },

  { method: 'GET', url: '/api/recipients', permissions: ['personal_data.read'] },
  { method: 'GET', url: '/api/recipients/:id', permissions: ['personal_data.read'] },
  { method: 'GET', url: '/api/recipients/:id/assignment-history', permissions: ['personal_data.read', 'assignments.read'] },
  { method: 'POST', url: '/api/recipients', permissions: ['recipients.manage'] },
  { method: 'PUT', url: '/api/recipients/:id', permissions: ['recipients.manage'] },

  { method: 'GET', url: '/api/banks', permissions: ['personal_data.read'] },
  { method: 'GET', url: '/api/banks/:id', permissions: ['personal_data.read'] },
  { method: 'GET', url: '/api/banks/:id/details', permissions: ['personal_data.read'] },
  { method: 'POST', url: '/api/banks', permissions: ['banks.manage'] },
  { method: 'PUT', url: '/api/banks/:id', permissions: ['banks.manage'] },
  { method: 'DELETE', url: '/api/banks/:id', permissions: ['protected_entities.delete'] },

  { method: 'GET', url: '/api/decisions', permissions: ['decisions.read'] },
  { method: 'GET', url: '/api/decisions/:id', permissions: ['decisions.read', 'personal_data.read'] },
  { method: 'POST', url: '/api/decisions', permissions: ['decisions.manage'] },
  { method: 'PUT', url: '/api/decisions/:id', permissions: ['decisions.manage'] },
  { method: 'POST', url: '/api/decisions/:id/assignments', permissions: ['assignments.manage', 'personal_data.read'] },

  { method: 'GET', url: '/api/assignments', permissions: ['assignments.read', 'personal_data.read'] },
  { method: 'POST', url: '/api/assignments', permissions: ['assignments.manage', 'personal_data.read'] },
  { method: 'PUT', url: '/api/assignments/:id', permissions: ['assignments.manage', 'personal_data.read'] },
  { method: 'POST', url: '/api/assignments/change-statuses', permissions: ['assignments.change_financial_status', 'personal_data.read'] },

  { method: 'GET', url: '/api/statements', permissions: ['statements.generate', 'personal_data.read'] },
  { method: 'POST', url: '/api/statements/snapshot', permissions: ['statements.generate', 'personal_data.read'] },
  { method: 'POST', url: '/api/statements/bank-snapshot', permissions: ['statements.generate', 'personal_data.read'] },

  { method: 'GET', url: '/api/deletion/:entity/:id', permissions: ['protected_entities.delete'] },
  { method: 'POST', url: '/api/deletion/:entity/:id', permissions: ['protected_entities.delete'] },

  { method: 'GET', url: '/api/program-approvals', permissions: ['catalogs.read'] },
  { method: 'POST', url: '/api/program-approvals', permissions: ['program_approvals.manage'] },
  { method: 'PUT', url: '/api/program-approvals/:id', permissions: ['program_approvals.manage'] },

  { method: 'GET', url: '/api/dashboard', permissions: ['dashboard.read'] },
  { method: 'GET', url: '/api/reports/source-rows', permissions: ['reports.read'] },
  { method: 'GET', url: '/api/reports/summary', permissions: ['reports.read'] },
  { method: 'GET', url: '/api/reports/annual-plans', permissions: ['planning.read'] },
  { method: 'GET', url: '/api/reports/plan-entries', permissions: ['planning.read'] },
  { method: 'POST', url: '/api/reports/annual-plans', permissions: ['planning.manage'] },
  { method: 'POST', url: '/api/reports/plan-entries', permissions: ['planning.manage'] },
  { method: 'DELETE', url: '/api/reports/plan-entries/:id', permissions: ['planning.manage'] },
]

const policyByRoute = new Map(API_ROUTE_POLICIES.map((policy) => [`${policy.method} ${policy.url}`, policy]))

function routeKey(method: string, url: string): string {
  return `${method.toUpperCase()} ${url}`
}

function policyFor(method: string, url: string): ApiRoutePolicy | undefined {
  return policyByRoute.get(routeKey(method, url))
    // Fastify adds HEAD for GET routes. It must inherit the same policy.
    ?? (method.toUpperCase() === 'HEAD' ? policyByRoute.get(routeKey('GET', url)) : undefined)
}

function routeMethods(method: string | string[]): string[] {
  return Array.isArray(method) ? method : [method]
}

declare module 'fastify' {
  interface FastifyRequest {
    authenticatedSession: AuthenticatedSession | undefined
  }
}

export function installApiAuthorization(app: FastifyInstance, database: DatabaseSync): void {
  app.decorateRequest('authenticatedSession', undefined)

  app.addHook('onRoute', (route) => {
    if (!route.url.startsWith('/api/')) return
    for (const method of routeMethods(route.method)) {
      if (!policyFor(method, route.url)) {
        throw new Error(`Для бізнес-маршруту ${method} ${route.url} не визначено серверний дозвіл.`)
      }
    }
  })

  app.addHook('preHandler', async (request, reply) => {
    const url = request.routeOptions.url ?? ''
    if (!url.startsWith('/api/')) return
    const policy = policyFor(request.method, url)
    if (!policy) {
      return reply.status(500).send({ message: 'Для маршруту не налаштовано політику доступу.' })
    }
    const session = requireAuthenticated(database, request, reply)
    if (!session) return reply
    for (const permission of policy.permissions) {
      if (!requirePermission(session, permission, reply)) return reply
    }
    request.authenticatedSession = session
  })
}

export function currentApiSession(request: FastifyRequest): AuthenticatedSession {
  if (!request.authenticatedSession) throw new Error('Сесія не була встановлена політикою API.')
  return request.authenticatedSession
}
