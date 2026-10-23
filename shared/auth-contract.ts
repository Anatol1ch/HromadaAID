import type { Permission, UserRole } from './authorization.js'

export const USER_STATUSES = ['active', 'inactive', 'blocked'] as const
export type UserStatus = typeof USER_STATUSES[number]

export type AuthenticatedUser = {
  id: string
  username: string
  displayName: string | null
  firstName?: string | null
  lastName?: string | null
  roles: UserRole[]
  permissions: Permission[]
  mustChangePassword: boolean
}

export type LoginInput = { username: string; password: string }
export type LoginResult = { token: string; user: AuthenticatedUser; expiresAt: string }
export type ChangePasswordInput = { currentPassword: string; newPassword: string }

/** Public session state deliberately excludes the bearer token. */
export type ClientAuthState =
  | { status: 'authenticated'; user: AuthenticatedUser }
  | { status: 'password-change-required'; user: AuthenticatedUser }
  | { status: 'unauthenticated' | 'unavailable'; user: null; message?: string }

export type AuthActionResult = { ok: true; state: ClientAuthState } | { ok: false; state: ClientAuthState; message: string; failureKind?: 'session-expired' | 'connection' | 'permission' | 'server' }

export function isUserStatus(value: unknown): value is UserStatus {
  return typeof value === 'string' && (USER_STATUSES as readonly string[]).includes(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

export function isAuthenticatedUser(value: unknown): value is AuthenticatedUser {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return typeof item.id === 'string' && typeof item.username === 'string' &&
    (typeof item.displayName === 'string' || item.displayName === null) &&
    (item.firstName === undefined || typeof item.firstName === 'string' || item.firstName === null) &&
    (item.lastName === undefined || typeof item.lastName === 'string' || item.lastName === null) &&
    isStringArray(item.roles) && isStringArray(item.permissions) && typeof item.mustChangePassword === 'boolean'
}

export function isLoginResult(value: unknown): value is LoginResult {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).token === 'string' &&
    typeof (value as Record<string, unknown>).expiresAt === 'string' &&
    isAuthenticatedUser((value as Record<string, unknown>).user)
}
