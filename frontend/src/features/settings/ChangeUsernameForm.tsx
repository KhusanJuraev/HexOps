import { useId, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { MAX_PASSWORD_LENGTH, USERNAME_PATTERN, useChangeUsername, useSession } from '@/features/auth'
import type { FieldError } from '@/shared/api/client'
import { apiErrorMessage, fieldErrorMessage, fieldErrorsOf } from '@/shared/api/errors'
import { FormField } from '@/shared/components/FormField'
import { Button } from '@/shared/ui/button'

type Field = 'new_username' | 'current_password'
const EMPTY: Record<Field, string> = { new_username: '', current_password: '' }

/** Same codes as the backend (pydantic + auth router), so one translation path. */
function validate(v: Record<Field, string>, current: string): Partial<Record<Field, FieldError>> {
  const e: Partial<Record<Field, FieldError>> = {}
  if (!v.new_username) e.new_username = { field: 'new_username', code: 'missing' }
  else if (!USERNAME_PATTERN.test(v.new_username)) e.new_username = { field: 'new_username', code: 'string_pattern_mismatch' }
  else if (v.new_username.toLowerCase() === current) e.new_username = { field: 'new_username', code: 'username_unchanged' }
  if (!v.current_password) e.current_password = { field: 'current_password', code: 'missing' }
  return e
}

/**
 * Settings → Account (D-91). Changes the login name only; on success the server
 * revokes every session and the login page says to sign in with the new name.
 * The password lives only in this component's state.
 */
export function ChangeUsernameForm() {
  const { t } = useTranslation()
  const { data: session } = useSession()
  const current = session?.user.username ?? ''
  const change = useChangeUsername()
  const [values, setValues] = useState(EMPTY)
  const [clientErrors, setClientErrors] = useState<Partial<Record<Field, FieldError>>>({})
  const [show, setShow] = useState(false)
  const showId = useId()
  const nameRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const errors = validate(values, current)
    setClientErrors(errors)
    if (errors.new_username) return nameRef.current?.focus()
    if (errors.current_password) return passwordRef.current?.focus()
    change.mutate(values, {
      onError: (err) => {
        const field = fieldErrorsOf(err)
        if (field.current_password) {
          setValues((v) => ({ ...v, current_password: '' })) // retype, never kept
          passwordRef.current?.focus()
        } else if (field.new_username) nameRef.current?.focus()
      },
    })
  }

  const edit = (name: Field, value: string) => {
    setValues((v) => ({ ...v, [name]: value }))
    setClientErrors((prev) => ({ ...prev, [name]: undefined }))
    if (change.error) change.reset()
  }

  const serverErrors = fieldErrorsOf(change.error)
  const message = (name: Field) => {
    const error = clientErrors[name] ?? serverErrors[name]
    return error ? fieldErrorMessage(t, error, { string_pattern_mismatch: t('account.usernameRules') }) : null
  }
  const formError = change.error && Object.keys(serverErrors).length === 0 ? apiErrorMessage(t, change.error) : null

  return (
    <form className="grid gap-4" onSubmit={onSubmit} noValidate aria-label={t('account.changeUsername')}>
      <p className="text-sm">
        {t('account.current')} <span className="font-medium break-all" data-current-username>{current}</span>
      </p>
      <FormField
        ref={nameRef}
        id="new_username"
        label={t('account.newUsername')}
        hint={t('account.usernameRules')}
        error={message('new_username')}
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        maxLength={64}
        value={values.new_username}
        onChange={(e) => edit('new_username', e.target.value)}
      />
      <FormField
        ref={passwordRef}
        id="username_current_password"
        type={show ? 'text' : 'password'}
        label={t('security.current')}
        error={message('current_password')}
        autoComplete="current-password"
        maxLength={MAX_PASSWORD_LENGTH}
        value={values.current_password}
        onChange={(e) => edit('current_password', e.target.value)}
      />
      <label htmlFor={showId} className="flex min-h-11 w-fit cursor-pointer items-center gap-3 text-sm">
        <input
          id={showId}
          type="checkbox"
          checked={show}
          onChange={(e) => setShow(e.target.checked)}
          aria-controls="username_current_password"
          className="accent-primary focus-visible:ring-ring/50 size-4 rounded outline-none focus-visible:ring-[3px]"
        />
        {t('security.show')}
      </label>
      <p className="text-muted-foreground text-xs">{t('account.signOutNote')}</p>
      {formError && (
        <p role="alert" className="text-danger text-sm">
          {formError}
        </p>
      )}
      <Button type="submit" className="w-full sm:w-fit" disabled={change.isPending}>
        {change.isPending ? t('account.saving') : t('account.save')}
      </Button>
    </form>
  )
}
