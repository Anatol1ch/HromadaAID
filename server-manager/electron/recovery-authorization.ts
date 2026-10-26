export function assertWindowsRecoveryAdministrator(isAdministrator: boolean): void {
  if (!isAdministrator) throw new Error('Для локального аварійного відновлення запустіть Server Manager від імені адміністратора Windows.')
}

/** /auth/me is read afresh before an online database recovery. A remembered
 * successful login is not evidence of current permissions or session validity. */
export function assertRecoveryApiPermission(value: unknown): void {
  const user = value as { permissions?: unknown; mustChangePassword?: unknown } | null
  if (!user || !Array.isArray(user.permissions) || !user.permissions.includes('backups.manage') || user.mustChangePassword !== false) throw new Error('Потрібні чинне право керування резервними копіями та завершена зміна початкового пароля.')
}
