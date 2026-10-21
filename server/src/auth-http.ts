import type { FastifyReply, FastifyRequest } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import type { Permission } from '../../shared/authorization.js'
import type { AuthenticatedSession } from './auth.js'
import { authenticateSession, userHasPermission } from './auth.js'

function bearerToken(request: FastifyRequest): string | undefined {
  const authorization = request.headers.authorization
  if (!authorization) return undefined
  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(authorization)
  return match?.[1]
}

export function requireAuthenticated(database: DatabaseSync, request: FastifyRequest, reply: FastifyReply): AuthenticatedSession | undefined {
  const result = authenticateSession(database, bearerToken(request))
  if (result.ok) return result.value
  void reply.status(401).send({ message: result.message })
  return undefined
}

export function requirePermission(session: AuthenticatedSession, permission: Permission, reply: FastifyReply): boolean {
  if (userHasPermission(session.user, permission)) return true
  void reply.status(403).send({ message: 'Недостатньо прав для цієї операції.' })
  return false
}
