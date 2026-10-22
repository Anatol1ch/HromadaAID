export const USER_ROLES = [
  'administrator',
  'assignment_specialist',
  'payment_specialist',
  'planning_specialist',
  'viewer',
] as const

export type UserRole = typeof USER_ROLES[number]

export const WORKSPACE_PAGES = ['home', 'overview', 'assignments', 'statements', 'reports', 'dictionaries', 'users'] as const
export type WorkspacePage = typeof WORKSPACE_PAGES[number]
export const DICTIONARY_SECTIONS = ['people', 'programs', 'decisions', 'banks', 'plans'] as const
export type AuthorizedDictionarySection = typeof DICTIONARY_SECTIONS[number]

const ROLE_WORKSPACE_PAGES: Record<UserRole, readonly WorkspacePage[]> = {
  administrator: WORKSPACE_PAGES,
  assignment_specialist: ['home', 'assignments', 'dictionaries'],
  payment_specialist: ['home', 'statements'],
  planning_specialist: ['home', 'overview', 'reports', 'dictionaries'],
  viewer: ['home', 'overview'],
}

const ROLE_DICTIONARY_SECTIONS: Record<UserRole, readonly AuthorizedDictionarySection[]> = {
  administrator: DICTIONARY_SECTIONS,
  assignment_specialist: ['people', 'decisions', 'banks'],
  payment_specialist: [],
  planning_specialist: ['programs', 'plans'],
  viewer: [],
}

export function hasWorkspacePage(roles: readonly UserRole[], page: WorkspacePage): boolean {
  return roles.some((role) => ROLE_WORKSPACE_PAGES[role].includes(page))
}

export function allowedDictionarySections(roles: readonly UserRole[]): AuthorizedDictionarySection[] {
  const allowed = new Set(roles.flatMap((role) => ROLE_DICTIONARY_SECTIONS[role]))
  return DICTIONARY_SECTIONS.filter((section) => allowed.has(section))
}

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
  'planning.read',
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
    'dashboard.read',
  ],
  payment_specialist: [
    'personal_data.read', 'dashboard.read', 'statements.generate',
    'assignments.change_financial_status',
  ],
  planning_specialist: [
    'catalogs.read', 'catalogs.manage', 'program_approvals.manage', 'dashboard.read',
    'reports.read', 'planning.read', 'planning.manage', 'reports.export',
  ],
  // Overview uses catalog labels to render aggregate program/type summaries.
  // The workspace page gate still keeps the Dictionaries section unavailable.
  viewer: ['catalogs.read', 'dashboard.read'],
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
