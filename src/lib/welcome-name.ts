import type { AuthenticatedUser } from '../../shared/auth-contract'

export function welcomeHeading(user: AuthenticatedUser): string {
  const firstName = user.firstName?.trim()
  return firstName ? `ВІТАЄМО В СИСТЕМІ, ${firstName.toLocaleUpperCase('uk-UA')}!` : 'ВІТАЄМО В СИСТЕМІ!'
}
