export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 256

/** Counts Unicode code points without modifying the password. */
export function passwordLength(value: string): number {
  return Array.from(value).length
}

export function isValidPassword(value: unknown): value is string {
  return typeof value === 'string' && passwordLength(value) >= PASSWORD_MIN_LENGTH && passwordLength(value) <= PASSWORD_MAX_LENGTH
}

export function passwordValidationMessage(value: unknown): string | undefined {
  if (typeof value !== 'string') return `Пароль має містити від ${PASSWORD_MIN_LENGTH} до ${PASSWORD_MAX_LENGTH} символів.`
  const length = passwordLength(value)
  return length >= PASSWORD_MIN_LENGTH && length <= PASSWORD_MAX_LENGTH ? undefined : `Пароль має містити від ${PASSWORD_MIN_LENGTH} до ${PASSWORD_MAX_LENGTH} символів.`
}
