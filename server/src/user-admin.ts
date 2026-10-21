import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { ManagedUser, ManagedUserInput, ManagedUserSaveResult } from '../../shared/api-contract.js'
import { isUserRole, USER_ROLES, type UserRole } from '../../shared/authorization.js'
import { nextRecordRevision } from '../../shared/record-revision.js'
import { hashPassword, normalizeUsername, revokeUserSessions, validatePassword } from './auth.js'

type UserRow = { id: string; username: string; username_key: string; display_name: string | null; status: ManagedUser['status']; must_change_password: number; created_at: string; updated_at: string }

function userRoles(database: DatabaseSync, userId: string): UserRole[] {
  return (database.prepare('SELECT role FROM user_roles WHERE user_id=? ORDER BY role').all(userId) as { role: unknown }[])
    .map((item) => item.role).filter(isUserRole)
}

function toManagedUser(database: DatabaseSync, row: UserRow): ManagedUser {
  return { id: row.id, username: row.username, displayName: row.display_name, roles: userRoles(database, row.id), status: row.status, mustChangePassword: row.must_change_password === 1, createdAt: row.created_at, updatedAt: row.updated_at }
}

function normalizeDisplayName(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') return undefined
  const trimmed = value.normalize('NFKC').trim()
  return trimmed.length >= 1 && trimmed.length <= 150 && !/[\u0000-\u001F\u007F]/.test(trimmed) ? trimmed : undefined
}

function rolesFrom(value: unknown): UserRole[] | undefined {
  if (!Array.isArray(value)) return undefined
  const roles = value.filter(isUserRole)
  return roles.length && roles.length === value.length && new Set(roles).size === roles.length ? [...roles].sort((a, b) => USER_ROLES.indexOf(a) - USER_ROLES.indexOf(b)) : undefined
}

function inputFrom(value: unknown, passwordRequired: boolean): { username: string; usernameKey: string; displayName: string | null; roles: UserRole[]; password?: string } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const input = value as ManagedUserInput
  const username = typeof input.username === 'string' ? input.username.normalize('NFKC').trim() : undefined
  const usernameKey = normalizeUsername(input.username)
  const displayName = normalizeDisplayName(input.displayName)
  const roles = rolesFrom(input.roles)
  const password = input.password === undefined ? undefined : validatePassword(input.password)
  if (!username || !usernameKey || displayName === undefined || !roles || (passwordRequired && !password) || (input.password !== undefined && !password)) return undefined
  return { username, usernameKey, displayName, roles, password: password ?? undefined }
}

function readUser(database: DatabaseSync, id: string): UserRow | undefined {
  return database.prepare('SELECT id,username,username_key,display_name,status,must_change_password,created_at,updated_at FROM users WHERE id=?').get(id) as UserRow | undefined
}

function activeAdministratorCount(database: DatabaseSync): number {
  const row = database.prepare("SELECT COUNT(DISTINCT u.id) AS value FROM users u JOIN user_roles r ON r.user_id=u.id WHERE u.status='active' AND r.role='administrator'").get() as { value: number }
  return Number(row.value)
}

function requireActiveAdministrator(database: DatabaseSync, current: UserRow, nextStatus: ManagedUser['status'], nextRoles: readonly UserRole[]): string | undefined {
  if (current.status === 'active' && userRoles(database, current.id).includes('administrator') && (nextStatus !== 'active' || !nextRoles.includes('administrator')) && activeAdministratorCount(database) <= 1) {
    return 'У системі має залишатися щонайменше один активний адміністратор.'
  }
  return undefined
}

function failure(reason: 'validation' | 'conflict' | 'not-found', message: string): ManagedUserSaveResult { return { ok: false, reason, message } }

export function listManagedUsers(database: DatabaseSync): ManagedUser[] {
  return (database.prepare('SELECT id,username,username_key,display_name,status,must_change_password,created_at,updated_at FROM users ORDER BY username_key').all() as UserRow[]).map((row) => toManagedUser(database, row))
}

export function getManagedUser(database: DatabaseSync, id: string): ManagedUser | null {
  const row = readUser(database, id)
  return row ? toManagedUser(database, row) : null
}

export async function createManagedUser(database: DatabaseSync, value: unknown): Promise<ManagedUserSaveResult> {
  const input = inputFrom(value, true)
  if (!input?.password) return failure('validation', 'Перевірте логін, ім’я, пароль і призначені ролі користувача.')
  const passwordHash = await hashPassword(input.password)
  const id = randomUUID(); const timestamp = nextRecordRevision(undefined)
  let open = false
  try {
    database.exec('BEGIN IMMEDIATE'); open = true
    if (database.prepare('SELECT 1 FROM users WHERE username_key=?').get(input.usernameKey)) { database.exec('ROLLBACK'); return failure('conflict', 'Користувач із таким логіном уже існує.') }
    database.prepare('INSERT INTO users(id,username,username_key,display_name,password_hash,status,password_changed_at,created_at,updated_at,must_change_password) VALUES(?,?,?,?,?,?,?,?,?,0)').run(id, input.username, input.usernameKey, input.displayName, passwordHash, 'active', timestamp, timestamp, timestamp)
    const insertRole = database.prepare('INSERT INTO user_roles(user_id,role) VALUES(?,?)')
    for (const role of input.roles) insertRole.run(id, role)
    const user = toManagedUser(database, readUser(database, id)!)
    database.exec('COMMIT'); return { ok: true, user }
  } catch {
    if (open) try { database.exec('ROLLBACK') } catch { /* already closed */ }
    return failure('conflict', 'Не вдалося створити користувача. Перевірте введені дані.')
  }
}

export function updateManagedUser(database: DatabaseSync, id: string, value: unknown, expectedUpdatedAt: unknown): ManagedUserSaveResult {
  const input = inputFrom(value, false)
  if (!input || typeof expectedUpdatedAt !== 'string' || !expectedUpdatedAt) return failure('validation', 'Для редагування потрібна початкова версія облікового запису.')
  let open = false
  try {
    database.exec('BEGIN IMMEDIATE'); open = true
    const current = readUser(database, id)
    if (!current) { database.exec('ROLLBACK'); return failure('not-found', 'Користувача не знайдено.') }
    if (current.updated_at !== expectedUpdatedAt) { database.exec('ROLLBACK'); return failure('conflict', 'Обліковий запис уже змінив інший користувач. Оновіть список.') }
    const administratorError = requireActiveAdministrator(database, current, current.status, input.roles)
    if (administratorError) { database.exec('ROLLBACK'); return failure('conflict', administratorError) }
    const duplicate = database.prepare('SELECT id FROM users WHERE username_key=? AND id<>?').get(input.usernameKey, id)
    if (duplicate) { database.exec('ROLLBACK'); return failure('conflict', 'Користувач із таким логіном уже існує.') }
    const updatedAt = nextRecordRevision(current.updated_at)
    database.prepare('UPDATE users SET username=?,username_key=?,display_name=?,updated_at=? WHERE id=? AND updated_at=?').run(input.username, input.usernameKey, input.displayName, updatedAt, id, expectedUpdatedAt)
    database.prepare('DELETE FROM user_roles WHERE user_id=?').run(id)
    const insertRole = database.prepare('INSERT INTO user_roles(user_id,role) VALUES(?,?)')
    for (const role of input.roles) insertRole.run(id, role)
    revokeUserSessions(database, id)
    const user = toManagedUser(database, readUser(database, id)!)
    database.exec('COMMIT'); return { ok: true, user }
  } catch {
    if (open) try { database.exec('ROLLBACK') } catch { /* already closed */ }
    return failure('conflict', 'Не вдалося зберегти обліковий запис.')
  }
}

export function setManagedUserStatus(database: DatabaseSync, actorId: string, id: string, status: unknown, expectedUpdatedAt: unknown): ManagedUserSaveResult {
  if ((status !== 'active' && status !== 'inactive' && status !== 'blocked') || typeof expectedUpdatedAt !== 'string' || !expectedUpdatedAt) return failure('validation', 'Перевірте статус і початкову версію облікового запису.')
  if (actorId === id && status !== 'active') return failure('conflict', 'Не можна заблокувати або деактивувати власний активний обліковий запис.')
  let open = false
  try {
    database.exec('BEGIN IMMEDIATE'); open = true
    const current = readUser(database, id)
    if (!current) { database.exec('ROLLBACK'); return failure('not-found', 'Користувача не знайдено.') }
    if (current.updated_at !== expectedUpdatedAt) { database.exec('ROLLBACK'); return failure('conflict', 'Обліковий запис уже змінив інший користувач. Оновіть список.') }
    const administratorError = requireActiveAdministrator(database, current, status, userRoles(database, id))
    if (administratorError) { database.exec('ROLLBACK'); return failure('conflict', administratorError) }
    const updatedAt = nextRecordRevision(current.updated_at)
    database.prepare('UPDATE users SET status=?,updated_at=? WHERE id=? AND updated_at=?').run(status, updatedAt, id, expectedUpdatedAt)
    revokeUserSessions(database, id)
    const user = toManagedUser(database, readUser(database, id)!)
    database.exec('COMMIT'); return { ok: true, user }
  } catch {
    if (open) try { database.exec('ROLLBACK') } catch { /* already closed */ }
    return failure('conflict', 'Не вдалося змінити статус користувача.')
  }
}

export async function resetManagedUserPassword(database: DatabaseSync, id: string, newPassword: unknown, expectedUpdatedAt: unknown): Promise<ManagedUserSaveResult> {
  const password = validatePassword(newPassword)
  if (!password || typeof expectedUpdatedAt !== 'string' || !expectedUpdatedAt) return failure('validation', 'Новий пароль має містити від 12 до 256 символів; також потрібна початкова версія облікового запису.')
  const passwordHash = await hashPassword(password)
  let open = false
  try {
    database.exec('BEGIN IMMEDIATE'); open = true
    const current = readUser(database, id)
    if (!current) { database.exec('ROLLBACK'); return failure('not-found', 'Користувача не знайдено.') }
    if (current.updated_at !== expectedUpdatedAt) { database.exec('ROLLBACK'); return failure('conflict', 'Обліковий запис уже змінив інший користувач. Оновіть список.') }
    const updatedAt = nextRecordRevision(current.updated_at)
    database.prepare('UPDATE users SET password_hash=?,password_changed_at=?,must_change_password=1,updated_at=? WHERE id=? AND updated_at=?').run(passwordHash, updatedAt, updatedAt, id, expectedUpdatedAt)
    revokeUserSessions(database, id)
    const user = toManagedUser(database, readUser(database, id)!)
    database.exec('COMMIT'); return { ok: true, user }
  } catch {
    if (open) try { database.exec('ROLLBACK') } catch { /* already closed */ }
    return failure('conflict', 'Не вдалося скинути пароль користувача.')
  }
}
