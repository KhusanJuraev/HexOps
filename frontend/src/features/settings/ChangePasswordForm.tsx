import { useId, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, useChangePassword, useSession } from '@/features/auth'
import type { FieldError } from '@/shared/api/client'
import { apiErrorMessage, fieldErrorMessage, fieldErrorsOf } from '@/shared/api/errors'
import { FormField } from '@/shared/components/FormField'
import { Button } from '@/shared/ui/button'

type Field = 'current_password' | 'new_password' | 'new_password_confirm'
const FIELDS: Field[] = ['current_password', 'new_password', 'new_password_confirm']
const EMPTY: Record<Field, string> = { current_password: '', new_password: '', new_password_confirm: '' }

/** Same codes as the backend (pydantic + auth router), so one translation path. */
function validate(v: Record<Field, string>): Partial<Record<Field, FieldError>> {
  const e: Partial<Record<Field, FieldError>> = {}
  if (!v.current_password) e.current_password = { field: 'current_password', code: 'missing' }
  if (!v.new_password) e.new_password = { field: 'new_password', code: 'missing' }
  else if (v.new_password.length < MIN_PASSWORD_LENGTH)
    e.new_password = { field: 'new_password', code: 'string_too_short', params: { min_length: MIN_PASSWORD_LENGTH } }
  else if (v.new_password === v.current_password) e.new_password = { field: 'new_password', code: 'password_reused' }
  if (!v.new_password_confirm) e.new_password_confirm = { field: 'new_password_confirm', code: 'missing' }
  else if (v.new_password && v.new_password_confirm !== v.new_password)
    e.new_password_confirm = { field: 'new_password_confirm', code: 'password_mismatch' }
  return e
}

/**
 * Settings → Security. On success the server revokes every session; the auth
 * hook clears local state and RequireAuth shows the login page with a notice.
 * Passwords live only in this component's state.
 */
export function ChangePasswordForm() {
  const { t } = useTranslation()
  const { data: session } = useSession()
  const change = useChangePassword()
  const [values, setValues] = useState(EMPTY)
  const [clientErrors, setClientErrors] = useState<Partial<Record<Field, FieldError>>>({})
  const [show, setShow] = useState(false)
  const showId = useId()
  const currentRef = useRef<HTMLInputElement>(null)
  const newRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLInputElement>(null)

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const errors = validate(values)
    setClientErrors(errors)
    const first = FIELDS.find((f) => errors[f])
    if (first) {
      const refs = { current_password: currentRef, new_password: newRef, new_password_confirm: confirmRef }
      refs[first].current?.focus()
      return
    }
    change.mutate(values, {
      onError: (err) => {
        // Keep the session; clear only what must be retyped.
        const field = fieldErrorsOf(err)
        if (field.current_password) {
          setValues((v) => ({ ...v, current_password: '' }))
          currentRef.current?.focus()
        } else if (field.new_password) newRef.current?.focus()
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
    return error ? fieldErrorMessage(t, error) : null
  }
  const formError = change.error && Object.keys(serverErrors).length === 0 ? apiErrorMessage(t, change.error) : null
  const type = show ? 'text' : 'password'

  return (
    <form className="grid gap-4" onSubmit={onSubmit} noValidate aria-label={t('security.changePassword')}>
      {/* Lets password managers attach the new password to the right account. */}
      <input type="text" autoComplete="username" value={session?.user.username ?? ''} readOnly hidden />
      <FormField
        ref={currentRef}
        id="current_password"
        type={type}
        label={t('security.current')}
        error={message('current_password')}
        autoComplete="current-password"
        maxLength={MAX_PASSWORD_LENGTH}
        value={values.current_password}
        onChange={(e) => edit('current_password', e.target.value)}
      />
      <FormField
        ref={newRef}
        id="new_password"
        type={type}
        label={t('security.new')}
        hint={t('setup.passwordHint')}
        error={message('new_password')}
        autoComplete="new-password"
        maxLength={MAX_PASSWORD_LENGTH}
        value={values.new_password}
        onChange={(e) => edit('new_password', e.target.value)}
      />
      <FormField
        ref={confirmRef}
        id="new_password_confirm"
        type={type}
        label={t('security.confirm')}
        error={message('new_password_confirm')}
        autoComplete="new-password"
        maxLength={MAX_PASSWORD_LENGTH}
        value={values.new_password_confirm}
        onChange={(e) => edit('new_password_confirm', e.target.value)}
      />
      <label htmlFor={showId} className="flex min-h-11 w-fit cursor-pointer items-center gap-3 text-sm">
        <input
          id={showId}
          type="checkbox"
          checked={show}
          onChange={(e) => setShow(e.target.checked)}
          aria-controls="current_password new_password new_password_confirm"
          className="accent-primary focus-visible:ring-ring/50 size-4 rounded outline-none focus-visible:ring-[3px]"
        />
        {t('security.show')}
      </label>
      {formError && (
        <p role="alert" className="text-danger text-sm">
          {formError}
        </p>
      )}
      <Button type="submit" className="w-full sm:w-fit" disabled={change.isPending}>
        {change.isPending ? t('security.submitting') : t('security.submit')}
      </Button>
    </form>
  )
}
