import type { FieldError } from '@/shared/api/client'

// Mirrors backend schemas (app/modules/auth/schemas.py) and app/core/security.py.
export const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,64}$/
export const MIN_PASSWORD_LENGTH = 12
export const MAX_PASSWORD_LENGTH = 256

export type FieldErrors<F extends string> = Partial<Record<F, FieldError>>

export function checkUsername(username: string): FieldError | undefined {
  if (!username) return { field: 'username', code: 'missing' }
  if (!USERNAME_PATTERN.test(username)) return { field: 'username', code: 'string_pattern_mismatch' }
}

/** The codes match pydantic's, so client and server errors share one translation path. */
export function checkNewPassword(password: string, confirm: string): FieldErrors<'password' | 'password_confirm'> {
  const errors: FieldErrors<'password' | 'password_confirm'> = {}
  if (!password) errors.password = { field: 'password', code: 'missing' }
  else if (password.length < MIN_PASSWORD_LENGTH)
    errors.password = { field: 'password', code: 'string_too_short', params: { min_length: MIN_PASSWORD_LENGTH } }
  if (!confirm) errors.password_confirm = { field: 'password_confirm', code: 'missing' }
  else if (password && confirm !== password) errors.password_confirm = { field: 'password_confirm', code: 'password_mismatch' }
  return errors
}
