import type { AuthenticatedUser } from '../../shared/auth-contract'

export function welcomeHeading(user: AuthenticatedUser): string {
  const firstName = user.firstName?.trim()
  return firstName ? `Вітаємо в системі, ${firstName}!` : 'Вітаємо в системі!'
}
