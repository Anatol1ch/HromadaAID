import argon2 from 'argon2'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { effectivePermissions, isUserRole, type Permission, type UserRole } from '../../shared/authorization.js'
import type { AuthenticatedUser, ChangePasswordInput, LoginInput, LoginResult } from '../../shared/auth-contract.js'
import { nextRecordRevision } from '../../shared/record-revision.js'
import { isValidPassword } from '../../shared/password-policy.js'

export const SESSION_DURATION_MS = 8 * 60 * 60 * 1000
const MAX_ACTIVE_SESSIONS_PER_USER = 5
const ARGON_OPTIONS = { type: argon2.argon2id as 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 }

type UserRow = {
  id: string
  username: string
  display_name: string | null
  first_name: string | null
  last_name: string | null
  password_hash: string
  status: string
  must_change_password: number
}

export type AuthenticatedSession = {
  tokenHash: string
  user: AuthenticatedUser
  expiresAt: string
}

export type AuthResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 401 | 409 | 429; message: string }

let unavailableUserPasswordHash: Promise<string> | undefined

function nowRevision(now = Date.now()): string {
  return nextRecordRevision(undefined, now)
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function normalizeUsername(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.normalize('NFKC').trim().toLocaleLowerCase('uk-UA')
  return normalized.length >= 3 && normalized.length <= 80 && !/[\u0000-\u001F\u007F]/.test(normalized) ? normalized : null
}

function displayUsername(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.normalize('NFKC').trim()
  return normalized.length >= 3 && normalized.length <= 80 && !/[\u0000-\u001F\u007F]/.test(normalized) ? normalized : null
}

export function validatePassword(value: unknown): string | null {
  return isValidPassword(value) ? value : null
}

async function dummyPasswordHash(): Promise<string> {
  unavailableUserPasswordHash ??= argon2.hash(randomBytes(32).toString('base64url'), ARGON_OPTIONS)
  return unavailableUserPasswordHash
}

async function verifyCredentialHash(hash: string | undefined, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash ?? await dummyPasswordHash(), password)
  } catch {
    return false
  }
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON_OPTIONS)
}

function readRoles(database: DatabaseSync, userId: string): UserRole[] {
  const rows = database.prepare('SELECT role FROM user_roles WHERE user_id=? ORDER BY role').all(userId) as { role: unknown }[]
  return rows.map(({ role }) => role).filter(isUserRole)
}

function fullName(row: Pick<UserRow, 'display_name' | 'first_name' | 'last_name'>): string | null {
  const value = [row.first_name, row.last_name].filter((part): part is string => !!part).join(' ')
  return value || row.display_name
}

function profile(database: DatabaseSync, row: UserRow): AuthenticatedUser {
  const roles = readRoles(database, row.id)
  return {
    id: row.id,
    username: row.username,
    displayName: fullName(row),
    firstName: row.first_name,
    lastName: row.last_name,
    roles,
    permissions: effectivePermissions(roles),
    mustChangePassword: row.must_change_password === 1,
  }
}

function activeUser(database: DatabaseSync, usernameKey: string): UserRow | undefined {
  return database.prepare('SELECT id,username,display_name,first_name,last_name,password_hash,status,must_change_password FROM users WHERE username_key=?').get(usernameKey) as UserRow | undefined
}

function cleanExpiredSessions(database: DatabaseSync, current: string): void {
  database.prepare('DELETE FROM user_sessions WHERE expires_at<=?').run(current)
}

export function revokeUserSessions(database: DatabaseSync, userId: string): void {
  database.prepare('DELETE FROM user_sessions WHERE user_id=?').run(userId)
}

export async function login(database: DatabaseSync, input: LoginInput, now = Date.now()): Promise<AuthResult<LoginResult>> {
  const usernameKey = normalizeUsername(input.username)
  const password = typeof input.password === 'string' ? input.password : ''
  if (!usernameKey || !password) return { ok: false, status: 400, message: 'Вкажіть коректний логін і пароль.' }

  const user = activeUser(database, usernameKey)
  const credentialValid = await verifyCredentialHash(user?.password_hash, password)
  if (!user || !credentialValid) {
    return { ok: false, status: 401, message: 'Неправильний логін або пароль.' }
  }
  if (user.status === 'blocked') return { ok: false, status: 401, message: 'Обліковий запис заблоковано. Зверніться до адміністратора системи.' }
  if (user.status === 'inactive') return { ok: false, status: 401, message: 'Обліковий запис деактивовано. Зверніться до адміністратора системи.' }

  const createdAt = nowRevision(now)
  const expiresAt = new Date(now + SESSION_DURATION_MS).toISOString()
  const token = randomBytes(32).toString('base64url')
  const hash = tokenHash(token)
  let open = false
  try {
    database.exec('BEGIN IMMEDIATE')
    open = true
    const current = activeUser(database, usernameKey)
    if (!current || current.status !== 'active' || current.password_hash !== user.password_hash) {
      database.exec('ROLLBACK')
      return { ok: false, status: 401, message: 'Неправильний логін або пароль.' }
    }
    cleanExpiredSessions(database, createdAt)
    const count = database.prepare('SELECT COUNT(*) AS value FROM user_sessions WHERE user_id=? AND expires_at>?').get(current.id, createdAt) as { value: number }
    if (Number(count.value) >= MAX_ACTIVE_SESSIONS_PER_USER) {
      database.exec('ROLLBACK')
      return { ok: false, status: 429, message: 'Перевищено ліміт активних сесій. Завершіть одну з них і повторіть вхід.' }
    }
    database.prepare('INSERT INTO user_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)').run(hash, current.id, createdAt, expiresAt)
    const result: LoginResult = { token, user: profile(database, current), expiresAt }
    database.exec('COMMIT')
    return { ok: true, value: result }
  } catch {
    if (open) try { database.exec('ROLLBACK') } catch { /* transaction is already closed */ }
    return { ok: false, status: 409, message: 'Не вдалося створити сесію. Повторіть спробу.' }
  }
}

export function authenticateSession(database: DatabaseSync, token: string | undefined, now = Date.now()): AuthResult<AuthenticatedSession> {
  if (!token || token.length > 1024) return { ok: false, status: 401, message: 'Потрібна чинна сесія.' }
  const current = nowRevision(now)
  cleanExpiredSessions(database, current)
  const row = database.prepare(`SELECT s.token_hash,s.expires_at,u.id,u.username,u.display_name,u.first_name,u.last_name,u.password_hash,u.status,u.must_change_password
    FROM user_sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>?`).get(tokenHash(token), current) as (UserRow & { token_hash: string; expires_at: string }) | undefined
  if (!row || row.status !== 'active') return { ok: false, status: 401, message: 'Потрібна чинна сесія.' }
  return { ok: true, value: { tokenHash: row.token_hash, user: profile(database, row), expiresAt: row.expires_at } }
}

export function logout(database: DatabaseSync, tokenHashValue: string): void {
  database.prepare('DELETE FROM user_sessions WHERE token_hash=?').run(tokenHashValue)
}

export async function changePassword(database: DatabaseSync, session: AuthenticatedSession, input: ChangePasswordInput): Promise<AuthResult<void>> {
  const nextPassword = validatePassword(input.newPassword)
  if (!nextPassword || typeof input.currentPassword !== 'string' || !input.currentPassword) {
    return { ok: false, status: 400, message: 'Новий пароль має містити від 8 до 256 символів.' }
  }
  const current = database.prepare('SELECT id,password_hash,status,updated_at FROM users WHERE id=?').get(session.user.id) as (UserRow & { updated_at: string }) | undefined
  if (!current || current.status !== 'active' || !await verifyCredentialHash(current.password_hash, input.currentPassword)) {
    return { ok: false, status: 401, message: 'Не вдалося підтвердити чинний пароль.' }
  }
  const passwordHash = await hashPassword(nextPassword)
  let open = false
  try {
    database.exec('BEGIN IMMEDIATE')
    open = true
    const latest = database.prepare('SELECT password_hash,status,updated_at FROM users WHERE id=?').get(session.user.id) as { password_hash: string; status: string; updated_at: string } | undefined
    if (!latest || latest.status !== 'active') {
      database.exec('ROLLBACK')
      return { ok: false, status: 401, message: 'Потрібна чинна сесія.' }
    }
    if (latest.password_hash !== current.password_hash) {
      database.exec('ROLLBACK')
      return { ok: false, status: 409, message: 'Пароль уже змінився в іншій сесії. Увійдіть повторно.' }
    }
    const changedAt = nextRecordRevision(latest.updated_at)
    database.prepare('UPDATE users SET password_hash=?,password_changed_at=?,must_change_password=0,updated_at=? WHERE id=?').run(passwordHash, changedAt, changedAt, session.user.id)
    revokeUserSessions(database, session.user.id)
    database.exec('COMMIT')
    return { ok: true, value: undefined }
  } catch {
    if (open) try { database.exec('ROLLBACK') } catch { /* transaction is already closed */ }
    return { ok: false, status: 409, message: 'Не вдалося змінити пароль. Повторіть спробу.' }
  }
}

export async function createFirstAdministrator(database: DatabaseSync, input: { username: unknown; password: unknown; displayName?: unknown }): Promise<AuthResult<AuthenticatedUser>> {
  const username = displayUsername(input.username)
  const usernameKey = normalizeUsername(input.username)
  const password = validatePassword(input.password)
  const displayName = input.displayName === undefined || input.displayName === null || input.displayName === '' ? null : typeof input.displayName === 'string' && input.displayName.trim().length <= 150 ? input.displayName.trim() : undefined
  if (!username || !usernameKey || !password || displayName === undefined) {
    return { ok: false, status: 400, message: 'Логін, відображуване ім’я або пароль не відповідають вимогам.' }
  }
  const passwordHash = await hashPassword(password)
  const id = randomUUID()
  let open = false
  try {
    database.exec('BEGIN IMMEDIATE')
    open = true
    const users = database.prepare('SELECT COUNT(*) AS value FROM users').get() as { value: number }
    if (Number(users.value) !== 0) {
      database.exec('ROLLBACK')
      return { ok: false, status: 409, message: 'Початковий адміністратор уже створений.' }
    }
    const createdAt = nowRevision()
    database.prepare('INSERT INTO users(id,username,username_key,display_name,password_hash,status,password_changed_at,created_at,updated_at,must_change_password) VALUES(?,?,?,?,?,?,?,?,?,0)')
      .run(id, username, usernameKey, displayName, passwordHash, 'active', createdAt, createdAt, createdAt)
    database.prepare('INSERT INTO user_roles(user_id,role) VALUES(?,?)').run(id, 'administrator')
    const user = profile(database, { id, username, display_name: displayName, first_name: null, last_name: null, password_hash: passwordHash, status: 'active', must_change_password: 0 })
    database.exec('COMMIT')
    return { ok: true, value: user }
  } catch {
    if (open) try { database.exec('ROLLBACK') } catch { /* transaction is already closed */ }
    return { ok: false, status: 409, message: 'Не вдалося створити початкового адміністратора.' }
  }
}

export function userHasPermission(user: AuthenticatedUser, permission: Permission): boolean {
  return user.permissions.includes(permission)
}
