import { beforeEach, describe, expect, it } from 'vitest'

import i18n from '@/shared/i18n'

import { ApiError, UNREACHABLE } from './client'
import { apiErrorMessage, fieldErrorMessage, fieldErrorsOf } from './errors'

describe('error messages', () => {
  beforeEach(() => void i18n.changeLanguage('en'))
  const t = i18n.t.bind(i18n)

  it('translates backend validation codes with their parameters', () => {
    expect(fieldErrorMessage(t, { field: 'a', code: 'missing' })).toBe('This field is required.')
    expect(fieldErrorMessage(t, { field: 'a', code: 'string_too_short', params: { min_length: 12 } })).toBe(
      'Must be at least 12 characters.',
    )
    expect(fieldErrorMessage(t, { field: 'a', code: 'string_too_short', params: { min_length: 1 } })).toBe(
      'This field is required.',
    )
    expect(fieldErrorMessage(t, { field: 'a', code: 'string_too_long', params: { max_length: 64 } })).toBe(
      'Must be at most 64 characters.',
    )
    expect(fieldErrorMessage(t, { field: 'a', code: 'something_new' })).toBe('This value is not valid.')
    expect(fieldErrorMessage(t, { field: 'a', code: 'string_pattern_mismatch' }, { string_pattern_mismatch: 'custom' })).toBe(
      'custom',
    )
  })

  it('translates validation messages into Russian and Uzbek', async () => {
    await i18n.changeLanguage('ru')
    expect(fieldErrorMessage(t, { field: 'a', code: 'string_too_long', params: { max_length: 64 } })).toBe(
      'Максимум символов: 64.',
    )
    await i18n.changeLanguage('uz')
    expect(fieldErrorMessage(t, { field: 'a', code: 'missing' })).toBe('Bu maydon toʻldirilishi shart.')
  })

  it('keys field errors by field, first error wins', () => {
    const err = new ApiError(422, 'validation_error', 'x', [
      { field: 'username', code: 'missing' },
      { field: 'username', code: 'string_type' },
    ])
    expect(fieldErrorsOf(err)).toEqual({ username: { field: 'username', code: 'missing' } })
    expect(fieldErrorsOf(new Error('x'))).toEqual({})
  })

  it('never describes an outage as bad credentials', () => {
    expect(apiErrorMessage(t, new ApiError(0, UNREACHABLE, 'x'))).toBe('Can’t reach the HexOps server')
    expect(apiErrorMessage(t, new ApiError(503, 'database_unavailable', 'x'))).toBe('The database is unavailable')
    expect(apiErrorMessage(t, new ApiError(401, 'invalid_credentials', 'x'))).toBe('Incorrect username or password.')
    expect(apiErrorMessage(t, new ApiError(403, 'csrf_failed', 'x'))).toMatch(/security token/)
  })
})
