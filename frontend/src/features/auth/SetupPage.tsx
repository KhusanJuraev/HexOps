import { useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate } from 'react-router'

import { ApiError } from '@/shared/api/client'
import { apiErrorMessage, fieldErrorMessage, fieldErrorsOf } from '@/shared/api/errors'
import { FormField } from '@/shared/components/FormField'
import { FullPageStatus } from '@/shared/layout/FullPageStatus'
import { Button } from '@/shared/ui/button'

import { useSetup, useSetupStatus } from './api'
import { AuthLayout } from './AuthLayout'
import { checkNewPassword, checkUsername, MAX_PASSWORD_LENGTH, type FieldErrors } from './validation'

type Field = 'username' | 'password' | 'password_confirm'
const FIELDS: Field[] = ['username', 'password', 'password_confirm']

/**
 * First-run setup: shown only while the database has no account. The backend
 * accepts it only from this machine and only once (D-49). The password lives in
 * component state until submitted; it is never written to browser storage.
 */
export default function SetupPage() {
  const { t } = useTranslation()
  const status = useSetupStatus()
  const setup = useSetup()
  const [values, setValues] = useState<Record<Field, string>>({ username: '', password: '', password_confirm: '' })
  const [clientErrors, setClientErrors] = useState<FieldErrors<Field>>({})
  const usernameRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLInputElement>(null)

  if (setup.isSuccess) return <Navigate to="/" replace />
  if (status.isPending) return <FullPageStatus kind="loading" />
  if (status.data && !status.data.required) return <Navigate to="/login" replace />

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const username = values.username.trim()
    const errors: FieldErrors<Field> = {
      username: checkUsername(username),
      ...checkNewPassword(values.password, values.password_confirm),
    }
    const invalid = FIELDS.filter((f) => errors[f])
    setClientErrors(errors)
    if (invalid.length) {
      const refs = { username: usernameRef, password: passwordRef, password_confirm: confirmRef }
      refs[invalid[0]].current?.focus()
      return
    }
    setup.mutate({ ...values, username })
  }

  const edit = (name: Field, value: string) => {
    setValues((v) => ({ ...v, [name]: value }))
    setClientErrors((prev) => ({ ...prev, [name]: undefined }))
    if (setup.error) setup.reset()
  }

  const serverErrors = fieldErrorsOf(setup.error)
  const message = (name: Field) => {
    const error = clientErrors[name] ?? serverErrors[name]
    if (!error) return null
    return fieldErrorMessage(t, error, name === 'username' ? { string_pattern_mismatch: t('validation.username') } : {})
  }

  // setup_closed needs no message: useSetup flips the status and this page
  // redirects to the normal sign-in (someone finished setup first).
  let formError: string | null = null
  if (setup.error instanceof ApiError && setup.error.code === 'setup_local_only') formError = t('setup.localOnly')
  else if (setup.error && Object.keys(serverErrors).length === 0) formError = apiErrorMessage(t, setup.error)

  return (
    <AuthLayout title={t('setup.title')} description={t('setup.intro')}>
      <form className="grid gap-4" onSubmit={onSubmit} noValidate>
        <FormField
          ref={usernameRef}
          id="username"
          label={t('auth.username')}
          hint={t('validation.username')}
          error={message('username')}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={64}
          value={values.username}
          onChange={(e) => edit('username', e.target.value)}
        />
        <FormField
          ref={passwordRef}
          id="password"
          type="password"
          label={t('auth.password')}
          hint={t('setup.passwordHint')}
          error={message('password')}
          autoComplete="new-password"
          maxLength={MAX_PASSWORD_LENGTH}
          value={values.password}
          onChange={(e) => edit('password', e.target.value)}
        />
        <FormField
          ref={confirmRef}
          id="password_confirm"
          type="password"
          label={t('setup.confirm')}
          error={message('password_confirm')}
          autoComplete="new-password"
          maxLength={MAX_PASSWORD_LENGTH}
          value={values.password_confirm}
          onChange={(e) => edit('password_confirm', e.target.value)}
        />
        {formError && (
          <p role="alert" className="text-danger text-sm">
            {formError}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={setup.isPending}>
          {setup.isPending ? t('setup.submitting') : t('setup.submit')}
        </Button>
        <p className="text-muted-foreground text-xs">
          {t('setup.recovery')}{' '}
          <code className="bg-muted rounded px-1 py-0.5 break-all">python -m app.cli set-password &lt;name&gt;</code>
        </p>
      </form>
    </AuthLayout>
  )
}
