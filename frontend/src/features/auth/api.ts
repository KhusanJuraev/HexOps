import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { healthKey } from '@/features/connection'
import { api, ApiError } from '@/shared/api/client'

export interface User {
  id: number
  username: string
  last_login_at: string | null
}

export interface SessionInfo {
  user: User
  expires_at: string
}

export const sessionKey = ['auth', 'session'] as const

async function fetchSession(): Promise<SessionInfo | null> {
  try {
    return await api<SessionInfo>('/api/auth/me')
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null
    throw err
  }
}

export function useSession() {
  return useQuery({ queryKey: sessionKey, queryFn: fetchSession, staleTime: 5 * 60_000 })
}

export function useLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { username: string; password: string }) =>
      api<SessionInfo>('/api/auth/login', { method: 'POST', body }),
    onSuccess: (session) => {
      qc.removeQueries({ queryKey: noticeKey, exact: true })
      qc.setQueryData(sessionKey, session)
    },
  })
}

/**
 * Drop the session and every private query. RequireAuth then shows the login page.
 * Not qc.clear(): that would detach the mounted session observer, so the null
 * session would never reach RequireAuth and the private page would stay.
 */
function clearAuthState(qc: QueryClient) {
  qc.setQueryData(sessionKey, null)
  qc.removeQueries({ predicate: (q) => q.queryKey[0] !== sessionKey[0] && q.queryKey[0] !== healthKey[0] })
}

/** A one-off message for the login page, e.g. after a password change. Memory only. */
export const noticeKey = ['auth', 'notice'] as const
export type AuthNotice = 'passwordChanged' | 'usernameChanged'

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<void>('/api/auth/logout', { method: 'POST' }),
    // Even if the server call fails the local view must drop private data.
    onSettled: () => clearAuthState(qc),
  })
}

export interface PasswordChangeInput {
  current_password: string
  new_password: string
  new_password_confirm: string
}

/** On success the server has revoked every session, including this one. */
export function useChangePassword() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: PasswordChangeInput) => api<void>('/api/auth/password', { method: 'POST', body }),
    onSuccess: () => {
      qc.setQueryData<AuthNotice>(noticeKey, 'passwordChanged')
      clearAuthState(qc)
    },
  })
}

export interface UsernameChangeInput {
  new_username: string
  current_password: string
}

/** Settings → Account (D-91): on success every session is revoked; sign in with the new name. */
export function useChangeUsername() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: UsernameChangeInput) => api<void>('/api/auth/username', { method: 'POST', body }),
    onSuccess: () => {
      qc.setQueryData<AuthNotice>(noticeKey, 'usernameChanged')
      clearAuthState(qc)
    },
  })
}

export const setupKey = ['auth', 'setup'] as const

/** Whether the database has no account yet (first-run setup instead of sign-in). */
export function useSetupStatus() {
  return useQuery({
    queryKey: setupKey,
    queryFn: ({ signal }) => api<{ required: boolean }>('/api/auth/setup', { signal }),
    staleTime: Infinity, // changes only through useSetup below
  })
}

export interface SetupInput {
  username: string
  password: string
  password_confirm: string
}

export function useSetup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: SetupInput) => api<SessionInfo>('/api/auth/setup', { method: 'POST', body }),
    onSuccess: (session) => {
      qc.setQueryData(setupKey, { required: false })
      qc.setQueryData(sessionKey, session)
    },
    onError: (error) => {
      // Someone else finished setup first: switch this browser to sign-in.
      if (error instanceof ApiError && error.code === 'setup_closed') qc.setQueryData(setupKey, { required: false })
    },
  })
}
