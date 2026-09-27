import { Navigate, Outlet, useLocation } from 'react-router'

import { FullPageStatus } from '@/shared/layout/FullPageStatus'
import { ApiError, isUnreachable } from '@/shared/api/client'

import { useSession } from './api'

export function RequireAuth() {
  const location = useLocation()
  const { data: session, isPending, isError, error, refetch } = useSession()

  if (isPending) return <FullPageStatus kind="loading" />
  if (isError) {
    // Only a 401 (session === null) leads to the login screen; an outage does not.
    const kind = isUnreachable(error)
      ? 'offline'
      : error instanceof ApiError && error.code === 'database_unavailable'
        ? 'database'
        : 'error'
    return <FullPageStatus kind={kind} onRetry={() => void refetch()} />
  }
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}
