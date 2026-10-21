export const USER_ROLES = [
  'administrator',
  'assignment_specialist',
  'payment_specialist',
  'planning_specialist',
  'viewer',
] as const

export type UserRole = typeof USER_ROLES[number]

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  administrator: 'Адміністратор',
  assignment_specialist: 'Фахівець з призначень',
  payment_specialist: 'Фахівець з виплат',
  planning_specialist: 'Фахівець з планування',
  viewer: 'Переглядач',
}

export const PERMISSIONS = [
  'catalogs.read',
  'catalogs.manage',
  'program_approvals.manage',
  'personal_data.read',
  'recipients.manage',
  'banks.manage',
  'decisions.read',
  'decisions.manage',
  'assignments.read',
  'assignments.manage',
  'assignments.change_financial_status',
  'dashboard.read',
  'reports.read',
  'planning.manage',
  'statements.generate',
  'reports.export',
  'protected_entities.delete',
  'users.manage',
] as const

export type Permission = typeof PERMISSIONS[number]

const allPermissions = new Set<Permission>(PERMISSIONS)

export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  administrator: PERMISSIONS,
  assignment_specialist: [
    'catalogs.read', 'personal_data.read', 'recipients.manage', 'banks.manage',
    'decisions.read', 'decisions.manage', 'assignments.read', 'assignments.manage',
    'dashboard.read', 'reports.read', 'statements.generate', 'reports.export',
  ],
  payment_specialist: [
    'catalogs.read', 'personal_data.read', 'decisions.read', 'assignments.read',
    'assignments.change_financial_status', 'dashboard.read', 'reports.read',
    'statements.generate', 'reports.export',
  ],
  planning_specialist: [
    'catalogs.read', 'catalogs.manage', 'program_approvals.manage', 'dashboard.read',
    'reports.read', 'planning.manage', 'reports.export',
  ],
  viewer: ['catalogs.read', 'dashboard.read', 'reports.read', 'reports.export'],
}

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value)
}

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && allPermissions.has(value as Permission)
}

export function effectivePermissions(roles: readonly UserRole[]): Permission[] {
  const permissions = new Set<Permission>()
  for (const role of roles) for (const permission of ROLE_PERMISSIONS[role]) permissions.add(permission)
  return PERMISSIONS.filter((permission) => permissions.has(permission))
}

export function hasPermission(roles: readonly UserRole[], permission: Permission): boolean {
  return effectivePermissions(roles).includes(permission)
}
