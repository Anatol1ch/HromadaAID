import type { Permission, UserRole } from './authorization.js'

export const USER_STATUSES = ['active', 'inactive', 'blocked'] as const
export type UserStatus = typeof USER_STATUSES[number]

export type AuthenticatedUser = {
  id: string
  username: string
  displayName: string | null
  roles: UserRole[]
  permissions: Permission[]
}

export type LoginInput = { username: string; password: string }
export type LoginResult = { token: string; user: AuthenticatedUser; expiresAt: string }
export type ChangePasswordInput = { currentPassword: string; newPassword: string }

export function isUserStatus(value: unknown): value is UserStatus {
  return typeof value === 'string' && (USER_STATUSES as readonly string[]).includes(value)
}
