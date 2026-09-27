import { useQuery } from '@tanstack/react-query'
import { useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useLocation } from 'react-router'

import { apiErrorMessage, fieldErrorMessage, fieldErrorsOf } from '@/shared/api/errors'
import { FormField } from '@/shared/components/FormField'
import { Button } from '@/shared/ui/button'

import { noticeKey, useLogin, useSession, useSetupStatus, type AuthNotice } from './api'
import { AuthLayout } from './AuthLayout'
import { checkUsername, MAX_PASSWORD_LENGTH, type FieldErrors } from './validation'

type Field = 'username' | 'password'

function safeRedirect(from: unknown): string {
  // Only accept in-app paths; never an absolute or protocol-relative URL.
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : '/'
}

export default function LoginPage() {
  const { t } = useTranslation()
  const location = useLocation()
  const { data: session } = useSession()
  const setupStatus = useSetupStatus()
  const login = useLogin()
  // Set by useChangePassword; read-only here (memory only, cleared on sign-in).
  const { data: notice } = useQuery<AuthNotice | null>({ queryKey: noticeKey, queryFn: () => null, enabled: false })
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [clientErrors, setClientErrors] = useState<FieldErrors<Field>>({})
  const usernameRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  if (session) return <Navigate to={safeRedirect(location.state?.from)} replace />
  // An empty database has no one to sign in as: offer first-run setup instead.
  if (setupStatus.data?.required) return <Navigate to="/setup" replace />

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const errors: FieldErrors<Field> = {
      username: checkUsername(username.trim()),
      password: password ? undefined : { field: 'password', code: 'missing' },
    }
    setClientErrors(errors)
    const firstInvalid = (['username', 'password'] as const).find((f) => errors[f])
    if (firstInvalid) {
      const ref = firstInvalid === 'username' ? usernameRef : passwordRef
      ref.current?.focus()
      return
    }
    login.mutate({ username: username.trim(), password }, { onSettled: () => setPassword('') })
  }

  // Editing a field clears its own error and any stale server response.
  const edited = (name: Field) => {
    setClientErrors((prev) => ({ ...prev, [name]: undefined }))
    if (login.error) login.reset()
  }

  const serverErrors = fieldErrorsOf(login.error)
  const message = (field: Field) => {
    const error = clientErrors[field] ?? serverErrors[field]
    if (!error) return null
    return fieldErrorMessage(t, error, field === 'username' ? { string_pattern_mismatch: t('validation.username') } : {})
  }
  // Field problems are shown next to their fields; everything else in one alert.
  const formError = login.error && Object.keys(serverErrors).length === 0 ? apiErrorMessage(t, login.error) : null

  return (
    <AuthLayout title={t('auth.signIn')}>
      <form className="grid gap-4" onSubmit={onSubmit} noValidate>
        {notice && (
          <p role="status" className="bg-success/12 text-success rounded-lg px-3 py-2 text-sm">
            {t(notice === 'usernameChanged' ? 'account.usernameChanged' : 'security.passwordChanged')}
          </p>
        )}
        <FormField
          ref={usernameRef}
          id="username"
          label={t('auth.username')}
          error={message('username')}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={64}
          value={username}
          onChange={(e) => {
            setUsername(e.target.value)
            edited('username')
          }}
        />
        <FormField
          ref={passwordRef}
          id="password"
          type="password"
          label={t('auth.password')}
          error={message('password')}
          autoComplete="current-password"
          maxLength={MAX_PASSWORD_LENGTH}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            edited('password')
          }}
        />
        {formError && (
          <p role="alert" className="text-danger text-sm">
            {formError}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={login.isPending}>
          {login.isPending ? t('auth.signingIn') : t('auth.signIn')}
        </Button>
      </form>
    </AuthLayout>
  )
}
