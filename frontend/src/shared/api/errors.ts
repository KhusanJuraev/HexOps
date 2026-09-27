import i18n, { type TFunction } from 'i18next'

import { ApiError, UNREACHABLE, type FieldError } from './client'

/**
 * Translate one field error. Client-side checks produce the same codes as the
 * backend (pydantic error types), so both paths share these messages.
 * `overrides` gives a field-specific message for a code, e.g. a pattern hint.
 */
export function fieldErrorMessage(t: TFunction, error: FieldError, overrides: Record<string, string> = {}): string {
  if (overrides[error.code]) return overrides[error.code]
  const p = error.params ?? {}
  switch (error.code) {
    case 'missing':
      return t('validation.required')
    case 'string_too_short':
      return p.min_length === 1 ? t('validation.required') : t('validation.tooShort', { min: p.min_length })
    case 'string_too_long':
      return t('validation.tooLong', { max: p.max_length })
    case 'string_pattern_mismatch':
      return t('validation.pattern')
    case 'extra_forbidden':
      return t('validation.unexpected')
    case 'password_mismatch':
      return t('validation.passwordMismatch')
    case 'invalid_current_password':
      return t('validation.currentPasswordWrong')
    case 'password_reused':
      return t('validation.passwordReused')
    default: {
      // Module-specific codes (e.g. scope_invalid_domain) live under validation.codes.*
      const key = `validation.codes.${error.code}`
      return i18n.exists(key) ? t(key, p) : t('validation.invalid')
    }
  }
}

/** Field errors from an API validation failure, keyed by field name (first error wins). */
export function fieldErrorsOf(error: unknown): Record<string, FieldError> {
  const out: Record<string, FieldError> = {}
  if (error instanceof ApiError) {
    for (const e of error.errors) out[e.field] ??= e
  }
  return out
}

/** A translated, user-facing sentence for any failed request. */
export function apiErrorMessage(t: TFunction, error: unknown): string {
  if (!(error instanceof ApiError)) return t('common.error')
  switch (error.code) {
    case UNREACHABLE:
      return t('connection.offlineTitle')
    case 'database_unavailable':
      return t('connection.databaseTitle')
    case 'invalid_credentials':
      return t('auth.invalid')
    case 'rate_limited':
      return t('auth.throttled', { seconds: error.retryAfter ?? 60 })
    case 'csrf_failed':
      return t('errors.csrf')
    case 'untrusted_origin':
      return t('errors.origin')
    case 'not_authenticated':
      return t('errors.sessionExpired')
    case 'validation_error':
      return t('errors.validation')
    default:
      // Module-specific codes (e.g. invalid_status_transition) live under errors.codes.*
      return i18n.exists(`errors.codes.${error.code}`) ? t(`errors.codes.${error.code}`) : t('common.error')
  }
}
